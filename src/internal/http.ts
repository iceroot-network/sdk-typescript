// Sending the node API client's requests through the host's transport.
//
// The Rust client builds each request and decodes each answer; this module only moves bytes. It
// tries the relays in order (one that cannot be reached, times out, answers with a server error
// or answers with a redirect is skipped), keeps to the node's request allowance with the Rust
// client's request budget, and retries HTTP 429 with the Rust client's backoff. It asks the
// transport not to follow redirects, as the Rust client follows none: a request, its headers and
// its body go to the relays and nowhere else. It reads at most 8 MiB of an answer, as the Rust
// client does: a larger one is refused before it is decoded, whatever it declares, and the next
// relay is asked.
//
// Its own bounds do not depend on the module it runs with: the answer limit, the one-minute
// ceiling on a `Retry-After` (read from the answer here, as the Rust client reads it) and the
// number of retries are this module's, and a wait the module's backoff gives is honoured only up
// to that ceiling.

import type { ConnectOptions, RateLimit, Transport } from "../client.js";
import { BadResponse, IceRootError, InvalidArgument, NodeUnavailable, Timeout } from "../errors.js";
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

/** An answer, with what the transport itself reads of its headers. */
interface Received extends Answer {
  /** Its `X-Block-Height`, as sent. */
  readonly height: string | null;
  /** Its `Retry-After` in milliseconds, when it is whole seconds (see {@link retryAfterMs}). */
  readonly retryAfterMs: number | undefined;
}

/** The headers of an answer the Rust client reads. */
const ANSWER_HEADERS = ["retry-after", "x-block-height"] as const;

/** The default allowance: the reference implementation's 100 requests per 60 seconds. */
export const DEFAULT_RATE_LIMIT: RateLimit = { requests: 100, windowMs: 60_000 };

/** The default time allowed for one request. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The largest answer the client reads, in bytes once decoded (8 MiB, the Rust client's limit). The
 * largest answers of the node API are pages of at most 100 records and the chain's configuration,
 * far smaller; a larger answer is refused before it is decoded, whatever it declares, and the next
 * relay is asked.
 */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024;

/** The longest delay a timer keeps (2^31 - 1 ms, about 24.8 days); a longer one fires at once. */
const MAX_DELAY_MS = 2_147_483_647;

/**
 * The longest `Retry-After` honoured before retrying HTTP 429 on the same relay: one minute, as
 * the Rust client. A relay that asks for longer counts as unavailable for this request, so the
 * next relay is asked, and the shared request budget is never blocked for longer. No wait before
 * a retry is longer, whatever the module's backoff answers.
 */
const MAX_RETRY_WAIT_MS = 60_000;

/** The retries of HTTP 429 on one relay for one request: three, as the Rust client's backoff. */
const MAX_RETRIES = 3;

/** The largest block height an answer's `X-Block-Height` may carry (2^64 - 1, as the Rust client reads it). */
const MAX_U64 = 18_446_744_073_709_551_615n;

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

/**
 * Waits `ms` milliseconds. A wait longer than a timer keeps (2^31 - 1 ms) is made of several
 * timers, since a single one would fire at once.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    let remaining = Number.isNaN(ms) ? 0 : Math.max(0, ms);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const arm = () => {
      const step = Math.min(remaining, MAX_DELAY_MS);
      timer = setTimeout(() => {
        remaining -= step;
        if (remaining > 0) {
          arm();
          return;
        }
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, step);
    };
    arm();
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

/**
 * A `Retry-After` in milliseconds, read as the Rust client reads it: whole seconds, a number of
 * at most 2^64 - 1 with an optional `+`, around which white space is ignored (the characters of a
 * header value Rust's `trim` removes). Anything else, such as an HTTP date, is no wait at all, and
 * the backoff alone spaces the retries.
 */
function retryAfterMs(value: string | null): number | undefined {
  const text = value?.replace(/^[\t\n\v\f\r \u0085\u00a0]+|[\t\n\v\f\r \u0085\u00a0]+$/g, "");
  if (text === undefined || !/^\+?[0-9]+$/.test(text)) {
    return undefined;
  }
  const seconds = BigInt(text.startsWith("+") ? text.slice(1) : text);
  return seconds > MAX_U64 ? undefined : Number(seconds) * 1000;
}

/** One relay's attempt at a request: the value, or the error that skips the relay. */
type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/** Sends requests to a network's relays. */
export class Relays {
  readonly #relays: readonly string[];
  readonly #transport: Transport;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #timeoutMs: number;
  readonly #budget: RequestBudgetHandle | undefined;
  /** Checks a relay's chain identity, once {@link Relays.requireIdentity} set it. */
  #identify: ((relay: string) => Promise<void>) | undefined;
  /** Relays whose identity was checked. */
  readonly #identified = new Set<string>();
  /** Relays found to serve another chain, with the error that says so. */
  readonly #refused = new Map<string, unknown>();
  /** Identity checks under way, so concurrent requests make one. */
  readonly #checking = new Map<string, Promise<void>>();
  /** The relay whose answer was used last. */
  #answered: string | undefined;
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

  /** The relay whose answer was used last. */
  get answered(): string | undefined {
    return this.#answered;
  }

  /**
   * From now on, every relay is asked for its chain's identity with `identify` before the first
   * answer from it is used, except `known`, the relay the chain was read from. A relay that fails
   * the check with `NetworkMismatch` is never asked again, and its error stands for it; one that
   * fails it otherwise (for example, it cannot be reached) is skipped and checked again later.
   */
  requireIdentity(known: string | undefined, identify: (relay: string) => Promise<void>): void {
    if (known !== undefined) {
      this.#identified.add(known);
    }
    this.#identify = identify;
  }

  /**
   * Sends `request` and decodes the answer with `decode`. Relays are tried in order: one that
   * cannot be reached, times out, answers with a server error, answers with a redirect or answers
   * with more than 8 MiB is skipped, and so is one whose chain identity differs or cannot be
   * checked (see {@link Relays.requireIdentity}). HTTP 429 is retried on the same relay after the
   * backoff, or after the node's `Retry-After` when it is longer, up to a minute; a relay that asks
   * for longer, or whose retries are spent, is skipped, and the error is `RateLimited` when no
   * other relay answers.
   */
  async send<T>(request: RequestJson, decode: (answer: Answer) => T): Promise<T> {
    let last: unknown = new NodeUnavailable("no relay was tried");
    for (const relay of this.#relays) {
      const refused = this.#refused.get(relay);
      if (refused !== undefined) {
        last = refused;
        continue;
      }
      try {
        await this.#identity(relay);
      } catch (error) {
        last = error;
        continue;
      }
      const attempt = await this.#attempt(relay, request, decode);
      if (attempt.ok) {
        return attempt.value;
      }
      last = attempt.error;
    }
    throw last;
  }

  /** Sends `request` to `relay` alone, as {@link Relays.send} would; throws what would skip it. */
  async sendTo<T>(relay: string, request: RequestJson, decode: (answer: Answer) => T): Promise<T> {
    const attempt = await this.#attempt(relay, request, decode);
    if (attempt.ok) {
      return attempt.value;
    }
    throw attempt.error;
  }

  /** Checks `relay`'s chain identity, once, when checks are required. */
  #identity(relay: string): Promise<void> {
    const identify = this.#identify;
    if (identify === undefined || this.#identified.has(relay)) {
      return Promise.resolve();
    }
    let pending = this.#checking.get(relay);
    if (pending === undefined) {
      pending = identify(relay)
        .then(
          () => {
            this.#identified.add(relay);
          },
          (error: unknown) => {
            if (error instanceof IceRootError && error.code === "NetworkMismatch") {
              this.#refused.set(relay, error);
            }
            throw error;
          },
        )
        .finally(() => {
          this.#checking.delete(relay);
        });
      this.#checking.set(relay, pending);
    }
    return pending;
  }

  /**
   * One relay's attempt at `request`, with the retries of HTTP 429. An error that skips the relay
   * is returned; any other error of `decode` is thrown.
   */
  async #attempt<T>(relay: string, request: RequestJson, decode: (answer: Answer) => T): Promise<Attempt<T>> {
    for (let attempt = 0; ; attempt += 1) {
      await this.#spend();
      let answer: Received;
      try {
        answer = await this.#fetch(relay, request);
      } catch (error) {
        return { ok: false, error };
      }
      let value: T;
      try {
        value = decode(answer);
      } catch (error) {
        if (error instanceof IceRootError && error.code === "RateLimited") {
          const delay = retryDelay(attempt, answer.retryAfterMs);
          if (delay === undefined) {
            return { ok: false, error };
          }
          this.#budget?.blockFor(now(), delay);
          if (this.#budget === undefined) {
            await sleep(delay);
          }
          continue;
        }
        if (isServerError(error)) {
          return { ok: false, error };
        }
        throw error;
      }
      this.#answered = relay;
      if (answer.status >= 200 && answer.status < 300) {
        this.#note(answer.height);
      }
      return { ok: true, value };
    }
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

  async #fetch(relay: string, request: RequestJson): Promise<Received> {
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
        discard(response.body);
        const status = response.status === 0 ? "" : ` (HTTP ${response.status})`;
        const message = `${request.method} ${url} answered with a redirect${status}, which the client does not follow`;
        throw new NodeUnavailable(message, { url });
      }
      const body = await Promise.race([readBody(response, `${request.method} ${url}`, url, controller), timeout]);
      const pairs: [string, string][] = [];
      for (const name of ANSWER_HEADERS) {
        const value = response.headers.get(name);
        if (value !== null) {
          pairs.push([name, value]);
        }
      }
      return {
        status: response.status,
        headers: JSON.stringify(pairs),
        body,
        height: response.headers.get("x-block-height"),
        retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
      };
    } catch (error) {
      if (error instanceof IceRootError) {
        throw error;
      }
      throw new NodeUnavailable(`${request.method} ${url} failed: ${describe(error)}`, { url }, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Notes a block height a node reported, if it is a 64-bit number. */
  #note(height: string | null): void {
    if (height === null || !/^[0-9]{1,20}$/.test(height.trim())) {
      return;
    }
    const value = BigInt(height.trim());
    if (value > MAX_U64) {
      return;
    }
    if (this.latestHeight === undefined || value > this.latestHeight) {
      this.latestHeight = value;
    }
  }
}

/**
 * The wait before retry number `attempt` (from 0) of HTTP 429, when the node asked for `asked`
 * milliseconds (its `Retry-After`) or for nothing: the module's backoff (2 s doubling up to 30 s,
 * or the node's wait when longer), within this module's own bounds. `undefined`, so that the
 * next relay is asked, once the retries are spent, when the node asks for more than a minute, and
 * for a wait the module gives that is not a number of milliseconds up to a minute.
 */
function retryDelay(attempt: number, asked: number | undefined): number | undefined {
  if (attempt >= MAX_RETRIES || (asked !== undefined && asked > MAX_RETRY_WAIT_MS)) {
    return undefined;
  }
  const delay: unknown = call((module) => module.backoffDelay(attempt, asked));
  return typeof delay === "number" && delay >= 0 && delay <= MAX_RETRY_WAIT_MS ? delay : undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tooLarge(what: string, url: string): BadResponse {
  return new BadResponse(`the answer to ${what} is larger than ${MAX_ANSWER_BYTES} bytes`, {
    url,
    limit: MAX_ANSWER_BYTES,
  });
}

/**
 * The body of `response`, refused with `BadResponse` once it is larger than
 * {@link MAX_ANSWER_BYTES}: before anything is read when a length it declares is, and otherwise as
 * soon as more than that has arrived, without reading further. The body is read chunk by chunk
 * from a web stream (`getReader`) or from any other async iterable of bytes, such as the Node.js
 * stream of `node-fetch`; only a response with neither is read whole, with `arrayBuffer()`, and
 * checked once it is read.
 */
async function readBody(
  response: Response,
  what: string,
  url: string,
  controller: AbortController | undefined,
): Promise<Uint8Array> {
  const body: unknown = response.body;
  if (declaresMoreThanLimit(response.headers.get("content-length"))) {
    discard(body);
    controller?.abort();
    throw tooLarge(what, url);
  }
  let next: () => Promise<{ readonly done?: boolean; readonly value?: unknown }>;
  let stop: () => unknown;
  if (isWebStream(body)) {
    const reader = body.getReader();
    next = () => reader.read();
    stop = () => reader.cancel();
  } else if (isAsyncIterable(body)) {
    // Ending the iteration destroys a Node.js stream, so nothing more is read.
    const chunks = body[Symbol.asyncIterator]();
    next = () => chunks.next();
    stop = () => chunks.return?.();
  } else {
    // A transport whose answers have no body to read in chunks: the whole body, checked once it
    // is read.
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length > MAX_ANSWER_BYTES) {
      throw tooLarge(what, url);
    }
    return whole;
  }
  const collected = new Collected();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await next();
      if (done === true) {
        finished = true;
        return collected.bytes();
      }
      if (!collected.add(chunkBytes(value))) {
        controller?.abort();
        throw tooLarge(what, url);
      }
      if (controller?.signal.aborted === true) {
        // The request timed out: its answer is no longer read.
        throw new Timeout(`${what} was cancelled`, { url });
      }
    }
  } finally {
    if (!finished) {
      try {
        Promise.resolve(stop()).catch(() => undefined);
      } catch {
        // The body is not read further either way.
      }
    }
  }
}

/**
 * Whether a `Content-Length` declares more than {@link MAX_ANSWER_BYTES}: any of its values, when a
 * transport joined several (`"n, n"`), a whole number above the limit.
 */
function declaresMoreThanLimit(declared: string | null): boolean {
  if (declared === null) {
    return false;
  }
  return declared.split(",").some((value) => {
    const text = value.trim();
    return /^[0-9]+$/.test(text) && Number(text) > MAX_ANSWER_BYTES;
  });
}

/** The chunks of an answer's body, kept while their total is within {@link MAX_ANSWER_BYTES}. */
class Collected {
  readonly #chunks: Uint8Array[] = [];
  #total = 0;

  /** Keeps `chunk`; `false`, keeping nothing, once the body is larger than the limit. */
  add(chunk: Uint8Array): boolean {
    this.#total += chunk.byteLength;
    if (this.#total > MAX_ANSWER_BYTES) {
      this.#chunks.length = 0;
      return false;
    }
    this.#chunks.push(chunk);
    return true;
  }

  /** The body: the chunks joined. */
  bytes(): Uint8Array {
    const [first] = this.#chunks;
    if (this.#chunks.length === 1 && first !== undefined) {
      return first;
    }
    const body = new Uint8Array(this.#total);
    let offset = 0;
    for (const chunk of this.#chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  }
}

/** A chunk of a body as bytes; a chunk of anything else is not an answer the client reads. */
function chunkBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  throw new TypeError("the transport gave a chunk of the answer's body that is not bytes");
}

function isWebStream(body: unknown): body is ReadableStream<unknown> {
  return typeof body === "object" && body !== null && typeof (body as ReadableStream).getReader === "function";
}

function isAsyncIterable(body: unknown): body is AsyncIterable<unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Partial<AsyncIterable<unknown>>)[Symbol.asyncIterator] === "function"
  );
}

/** Stops the transfer of a body that will not be read, whatever kind of body it is. */
function discard(body: unknown): void {
  if (typeof body !== "object" || body === null) {
    return;
  }
  const stream = body as { cancel?: () => Promise<void>; destroy?: () => void };
  try {
    if (typeof stream.cancel === "function") {
      Promise.resolve(stream.cancel()).catch(() => undefined);
    } else if (typeof stream.destroy === "function") {
      stream.destroy();
    }
  } catch {
    // The body is not read either way.
  }
}
