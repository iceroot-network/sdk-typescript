// Calls into the SDK's Tauri plugin (tauri-plugin-iceroot), and the plugin's handles.
//
// The page calls the plugin through Tauri's IPC (`plugin:iceroot|<command>`), with the internal
// invoke function every Tauri 2 webview has, so the package needs no runtime dependency. A
// refusal of the plugin carries an SDK error code and becomes the SDK's error class of that code,
// as a refusal of the WebAssembly module does. A call Tauri itself refuses (the plugin is not
// registered, or the application's capabilities do not allow the command) is `SdkNotInitialized`.

import { IceRootError, SdkNotInitialized } from "../errors.js";
import { errorFromCode } from "../internal/error-codes.js";
import { fromHex, toHex } from "../internal/hex.js";
import { InvalidArgument } from "../errors.js";

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

function internals(): TauriInternals {
  const value = (globalThis as { __TAURI_INTERNALS__?: Partial<TauriInternals> }).__TAURI_INTERNALS__;
  if (value === undefined || typeof value.invoke !== "function") {
    throw new SdkNotInitialized(
      "the Tauri entry of the SDK runs in a Tauri webview with the iceroot plugin registered: this page is not in one",
    );
  }
  return value as TauriInternals;
}

/** A refusal of the plugin as the SDK's error, or a refusal of Tauri as `SdkNotInitialized`. */
export function fromPluginError(error: unknown): unknown {
  if (error instanceof IceRootError) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof code === "string" && typeof message === "string") {
      const fields = typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
      return errorFromCode(code, message, fields);
    }
  }
  return new SdkNotInitialized(`the Tauri plugin iceroot refused the call: ${String(error)}`);
}

/** Calls the plugin's `command` with `args`. */
export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const tauri = internals();
  try {
    return (await tauri.invoke(`plugin:iceroot|${command}`, args)) as T;
  } catch (error) {
    throw fromPluginError(error);
  }
}

/** Whether `value` is a `Uint8Array`, also one made in another realm. */
export function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || Object.prototype.toString.call(value) === "[object Uint8Array]";
}

/** `bytes` as the lowercase hex the plugin reads. */
export function hex(bytes: Uint8Array, what: string): string {
  if (!isBytes(bytes)) {
    throw new InvalidArgument(`${what} is a Uint8Array`);
  }
  return toHex(bytes);
}

/** The bytes of the hex the plugin writes. */
export function bytesOf(text: string): Uint8Array {
  return fromHex(text) ?? new Uint8Array(0);
}

const encoder = new TextEncoder();

/**
 * Calls `f` with each secret as the array of UTF-8 bytes the plugin reads. Arrays the caller gave
 * are overwritten with zeros once the call settles, whatever the outcome, as the WebAssembly
 * entry does; the SDK's own copies too. The IPC message itself is the webview's, and cannot be
 * wiped.
 */
export async function withSecrets<T>(
  secrets: readonly (string | Uint8Array)[],
  what: string,
  f: (bytes: number[][]) => Promise<T>,
): Promise<T> {
  const arrays: Uint8Array[] = [];
  const lists: number[][] = [];
  try {
    for (const secret of secrets) {
      let bytes: Uint8Array;
      if (isBytes(secret)) {
        bytes = secret;
      } else if (typeof secret === "string") {
        bytes = encoder.encode(secret);
        arrays.push(bytes);
      } else {
        throw new InvalidArgument(`${what} is a string or a Uint8Array of UTF-8`);
      }
      lists.push(Array.from(bytes));
    }
    return await f(lists);
  } finally {
    for (const secret of secrets) {
      if (isBytes(secret)) {
        secret.fill(0);
      }
    }
    for (const bytes of arrays) {
      bytes.fill(0);
    }
    for (const list of lists) {
      list.fill(0);
    }
  }
}

/**
 * Asks the plugin to drop a handle when its object is collected: a key the page never released,
 * a chain or a connection it no longer holds. The plugin also drops everything a page held when
 * the webview loads another page or closes.
 */
const collector =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<{ command: string; args: Record<string, unknown> }>(({ command, args }) => {
        invoke(command, args).catch(() => {
          // The page is going away or the plugin already dropped it.
        });
      })
    : undefined;

/** Drops the plugin's handle with `command` and `args` when `owner` is collected. */
export function dropWith(owner: object, command: string, args: Record<string, unknown>, token?: object): void {
  collector?.register(owner, { command, args }, token);
}

/** Stops dropping the handle registered with `token`: it was released explicitly. */
export function keep(token: object): void {
  collector?.unregister(token);
}
