// The WebAssembly module's exports, once a loader has instantiated it.

import type * as Glue from "#glue/web";

import { IceRootError, SdkNotInitialized } from "../errors.js";
import { errorFromCode } from "./error-codes.js";

/** The functions and classes of the module, without the loader functions. */
export type Bindings = Omit<typeof Glue, "default" | "initSync">;

/** A secret key held in WebAssembly memory, with its profile. */
export type KeyHandle = Glue.KeyHandle;
/** A network profile of the Rust core. */
export type ProfileHandle = Glue.ProfileHandle;
/** A loaded chain of the Rust core. */
export type ChainHandle = Glue.ChainHandle;
/** A draft of the Rust core. */
export type DraftHandle = Glue.DraftHandle;
/** A signed transaction of the Rust core. */
export type SignedHandle = Glue.SignedHandle;
/** A prepared call of the node API client. */
export type ApiCall = Glue.ApiCall;
/** A submission planned within the pool's limits. */
export type SubmitPlanHandle = Glue.SubmitPlanHandle;
/** The node's request allowance. */
export type RequestBudgetHandle = Glue.RequestBudgetHandle;

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

/**
 * The SDK error for an error thrown by the module. The module names each error with the Rust
 * core's stable code and puts its structured fields in `details`; anything else is returned
 * unchanged.
 */
export function fromBindingError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof IceRootError) {
    return error;
  }
  const raw: unknown = (error as Error & { details?: unknown }).details;
  if (raw === undefined) {
    // Not an error the module made (for example a JavaScript TypeError).
    return error;
  }
  const details: Record<string, unknown> = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return errorFromCode(error.name, error.message, details);
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

/** Parses JSON the module wrote. */
export function parse<T>(json: string): T {
  return JSON.parse(json) as T;
}
