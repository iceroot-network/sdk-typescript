// Sending the node API client's requests through the host's transport.
//
// The Rust client builds each request and decodes each answer; this module only moves bytes. It
// tries the relays in order (one that cannot be reached, times out, answers with a server error
// or answers with a redirect is skipped), keeps to the node's request allowance with the Rust
// client's request budget, and retries HTTP 429 with the Rust client's backoff. It asks the
// transport not to follow redirects, as the Rust client follows none: a request, its headers and
// its body go to the relays and nowhere else.

import type { ConnectOptions, RateLimit, Transport } from "../client.js";
import { IceRootError, InvalidArgument, NodeUnavailable, Timeout } from "../errors.js";
import { call, type RequestBudgetHandle } from "./bindings.js";

/** A request as the Rust client writes it. */
export interface RequestJson {
  readonly method: "GET" | "POST";
  /** The path and encoded query string, appended to the relay URL. */
  readonly target: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body?: string;
}

/** An answer as the Rust client decodes it. */
export interface Answer {
  readonly status: number;
  /** The headers the client reads, as JSON `[name, value]` pairs. */
  readonly headers: string;
  readonly body: Uint8Array;
}

/** The headers of an answer the Rust client reads. */
const ANSWER_HEADERS = ["retry-after", "x-block-height"] as const;

/** The default allowance: the reference implementation's 100 requests per 60 seconds. */
export const DEFAULT_RATE_LIMIT: RateLimit = { requests: 100, windowMs: 60_000 };

/** The default time allowed for one request. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** The longest delay a timer keeps (2^31 - 1 ms, about 24.8 days); a longer one fires at once. */
const MAX_DELAY_MS = 2_147_483_647;

/** The most requests a window allows (2^32 - 1, the Rust client's `u32`). */
const MAX_REQUESTS = 4_294_967_295;

/** An HTTP header name (a token of RFC 9110). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** A header value both entries send as it is: visible ASCII, spaces and tabs. */
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;

/** The options of `connect`, checked by the same rules on both entries. */
export interface ConnectSettings {
  readonly headers: Readonly<Record<string, string>>;
  readonly rateLimit: RateLimit | false;
  readonly timeoutMs: number;
}

/**
 * Checks the options of `connect`: `InvalidArgument` for a header HTTP does not allow (naming the
 * header, never showing its value), an allowance of more than 2^32 - 1 requests, or a window or
 * timeout that is not a positive number of milliseconds up to 2^31 - 1.
 */
export function connectSettings(options: ConnectOptions): ConnectSettings {
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  if (rateLimit !== false) {
    const { requests } = rateLimit;
    if (!Number.isInteger(requests) || requests < 1 || requests > MAX_REQUESTS) {
      throw new InvalidArgument(`rateLimit.requests is a whole number from 1 to ${MAX_REQUESTS}`, { requests });
    }
    delay(rateLimit.windowMs, "windowMs", 1);
  }
  return {
    headers: checkedHeaders(options.headers ?? {}),
    rateLimit,
    timeoutMs: delay(options.timeoutMs, "timeoutMs", DEFAULT_TIMEOUT_MS),
  };
}

/** A positive number of milliseconds a timer can wait, or `fallback` when absent. */
function delay(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidArgument(`${name} is a positive number of milliseconds`, { [name]: value });
  }
  if (value > MAX_DELAY_MS) {
    throw new InvalidArgument(`${name} is at most ${MAX_DELAY_MS} milliseconds`, { [name]: value });
  }
  return value;
}

function checkedHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    throw new InvalidArgument("headers is an object of header names and their values");
  }
  const checked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) {
      throw new InvalidArgument(`${JSON.stringify(name)} is not an HTTP header name`, { header: name });
    }
    if (typeof value !== "string" || !HEADER_VALUE.test(value)) {
      throw new InvalidArgument(
        `the value of the header ${name} is not valid: a header value is text of visible ASCII characters, spaces and tabs`,
        { header: name },
      );
    }
    checked[name] = value;
  }
  return checked;
}

/** Waits `ms` milliseconds. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new Timeout("the wait was cancelled");
}

/** Milliseconds on a monotonic clock. */
export function now(): number {
  return typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/** What an error decoding an answer says about trying again elsewhere. */
function isServerError(error: unknown): boolean {
  if (!(error instanceof IceRootError) || error.code !== "Refused") {
    return false;
  }
  const status = error.details["status"];
  return typeof status === "number" && status >= 500;
}

function retryAfterMs(error: IceRootError): number | undefined {
  const seconds = error.details["retryAfterSeconds"];
  return typeof seconds === "number" ? seconds * 1000 : undefined;
}

/** Sends requests to a network's relays. */
export class Relays {
  readonly #relays: readonly string[];
  readonly #transport: Transport;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #timeoutMs: number;
  readonly #budget: RequestBudgetHandle | undefined;
  /** The highest block height a node reported in an answer's `X-Block-Height`. */
  latestHeight: bigint | undefined;

  constructor(
    relays: readonly string[],
    transport: Transport,
    headers: Readonly<Record<string, string>>,
    rateLimit: RateLimit | false,
    timeoutMs: number,
  ) {
    if (relays.length === 0) {
      throw new InvalidArgument("a network needs at least one relay URL");
    }
    this.#relays = relays.map((relay) => call((module) => module.checkRelay(relay)));
    this.#transport = transport;
    this.#headers = { ...headers };
    this.#timeoutMs = timeoutMs;
    this.#budget =
      rateLimit === false
        ? undefined
        : call((module) => new module.RequestBudgetHandle(rateLimit.requests, rateLimit.windowMs));
  }

  /** The relay URLs, in the order they are tried. */
  get relays(): readonly string[] {
    return this.#relays;
  }

  /**
   * Sends `request` and decodes the answer with `decode`. Relays are tried in order: one that
   * cannot be reached, times out, answers with a server error or answers with a redirect is
   * skipped. HTTP 429 is retried on the same relay after the backoff; when the retries are spent
   * the error is `RateLimited`.
   */
  async send<T>(request: RequestJson, decode: (answer: Answer) => T): Promise<T> {
    let last: unknown = new NodeUnavailable("no relay was tried");
    for (const relay of this.#relays) {
      for (let attempt = 0; ; attempt += 1) {
        await this.#spend();
        let answer: Answer;
        try {
          answer = await this.#fetch(relay, request);
        } catch (error) {
          last = error;
          break;
        }
        try {
          return decode(answer);
        } catch (error) {
          if (error instanceof IceRootError && error.code === "RateLimited") {
            const wait = retryAfterMs(error);
            const delay = call((module) => module.backoffDelay(attempt, wait));
            if (delay === undefined) {
              throw error;
            }
            this.#budget?.blockFor(now(), delay);
            if (this.#budget === undefined) {
              await sleep(delay);
            }
            continue;
          }
          if (isServerError(error)) {
            last = error;
            break;
          }
          throw error;
        }
      }
    }
    throw last;
  }

  async #spend(): Promise<void> {
    const budget = this.#budget;
    if (budget === undefined) {
      return;
    }
    for (;;) {
      const wait = budget.acquire(now());
      if (wait === 0) {
        return;
      }
      await sleep(wait);
    }
  }

  async #fetch(relay: string, request: RequestJson): Promise<Answer> {
    const headers: Record<string, string> = { ...this.#headers };
    for (const [name, value] of request.headers) {
      headers[name] = value;
    }
    const controller = typeof AbortController === "function" ? new AbortController() : undefined;
    const init: RequestInit & { maxRedirections: number } = {
      method: request.method,
      headers,
      // A redirect would take the request, its headers and its body to a host the relays do not
      // name. `maxRedirections: 0` asks the same of the Tauri HTTP plugin's fetch, which reads no
      // `redirect`; other transports ignore it.
      redirect: "manual",
      maxRedirections: 0,
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(controller === undefined ? {} : { signal: controller.signal }),
    };
    const url = relay + request.target;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Timeout(`${request.method} ${url} took more than ${this.#timeoutMs} ms`, { url }));
      }, this.#timeoutMs);
    });
    try {
      const response = await Promise.race([this.#transport(url, init), timeout]);
      // A browser reports a redirect it did not follow as an "opaqueredirect" answer of status 0.
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        response.body?.cancel().catch(() => undefined);
        const status = response.status === 0 ? "" : ` (HTTP ${response.status})`;
        const message = `${request.method} ${url} answered with a redirect${status}, which the client does not follow`;
        throw new NodeUnavailable(message, { url });
      }
      const body = new Uint8Array(await Promise.race([response.arrayBuffer(), timeout]));
      const pairs: [string, string][] = [];
      for (const name of ANSWER_HEADERS) {
        const value = response.headers.get(name);
        if (value !== null) {
          pairs.push([name, value]);
        }
      }
      this.#note(response.headers.get("x-block-height"));
      return { status: response.status, headers: JSON.stringify(pairs), body };
    } catch (error) {
      if (error instanceof IceRootError) {
        throw error;
      }
      throw new NodeUnavailable(`${request.method} ${url} failed: ${describe(error)}`, { url }, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  #note(height: string | null): void {
    if (height === null || !/^[0-9]{1,20}$/.test(height.trim())) {
      return;
    }
    const value = BigInt(height.trim());
    if (this.latestHeight === undefined || value > this.latestHeight) {
      this.latestHeight = value;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
