// The WebAssembly module's exports, once a loader has instantiated it.

import type * as Glue from "#glue/web";

import {
  IceRootError,
  InvalidAddress,
  InvalidPhrase,
  InvalidPublicKey,
  KeyReleased,
  RandomnessUnavailable,
  SdkNotInitialized,
  SigningFailed,
  type AddressProblem,
} from "../errors.js";

/** The functions and classes of the module, without the loader functions. */
export type Bindings = Omit<typeof Glue, "default" | "initSync">;

/** A secret key held in WebAssembly memory. */
export type KeyHandle = Glue.KeyHandle;

let current: Bindings | undefined;

/** Records the instantiated module. */
export function setBindings(bindings: Bindings): void {
  current = bindings;
}

/** Whether the module is instantiated. */
export function isReady(): boolean {
  return current !== undefined;
}

/** The module's exports; throws `SdkNotInitialized` before initialization. */
export function bindings(): Bindings {
  if (current === undefined) {
    throw new SdkNotInitialized();
  }
  return current;
}

const ADDRESS_PROBLEMS: ReadonlySet<string> = new Set([
  "checksum",
  "length",
  "wrong-network",
  "format",
]);

/**
 * The SDK error for an error thrown by the module. The module names each error with a stable code
 * and puts structured fields in `details`; anything else is returned unchanged.
 */
export function fromBindingError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof IceRootError) {
    return error;
  }
  const raw: unknown = (error as Error & { details?: unknown }).details;
  const details: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  switch (error.name) {
    case "InvalidPhrase":
      return new InvalidPhrase(error.message);
    case "InvalidAddress": {
      const reason = details["reason"];
      const position = details["position"];
      return new InvalidAddress(
        typeof reason === "string" && ADDRESS_PROBLEMS.has(reason)
          ? (reason as AddressProblem)
          : "format",
        error.message,
        typeof position === "number" ? position : undefined,
      );
    }
    case "InvalidPublicKey":
      return new InvalidPublicKey(error.message);
    case "RandomnessUnavailable":
      return new RandomnessUnavailable(error.message);
    case "SigningFailed":
      return new SigningFailed(error.message);
    case "KeyReleased":
      return new KeyReleased(error.message);
    default:
      return error;
  }
}

/** Calls `f` and turns module errors into SDK errors. */
export function call<T>(f: (bindings: Bindings) => T): T {
  const module = bindings();
  try {
    return f(module);
  } catch (error) {
    throw fromBindingError(error);
  }
}
