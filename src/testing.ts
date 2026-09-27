// Entry of the test build only: the published package never contains this file.
//
// The test build compiles the WebAssembly module with reproducible signatures, so the cross-checks
// can compare signature bytes with native Rust. The published module has no way to choose the
// auxiliary randomness of a signature.

import { keyHandleOf, type Account } from "./keys.js";
import { call, type KeyHandle } from "./internal/bindings.js";
import { messageBytes, toHex } from "./internal/hex.js";

export * from "./index.js";

type TestKeyHandle = KeyHandle & {
  signMessageWithAux?(message: Uint8Array, aux: Uint8Array): Uint8Array;
};

/** Test-only functions. */
export const testing = {
  /** Whether the loaded module has the reproducible-signature seam. */
  hasFixedAux(): boolean {
    const bindings = call((module) => module);
    return typeof (bindings.KeyHandle.prototype as TestKeyHandle).signMessageWithAux === "function";
  },

  /** A message signature with these 32 auxiliary bytes instead of random ones, as hex. */
  signMessageWithAux(account: Account, message: string | Uint8Array, aux: Uint8Array): string {
    const handle = keyHandleOf(account) as TestKeyHandle;
    const sign = handle.signMessageWithAux;
    if (sign === undefined) {
      throw new Error("this build has no reproducible signatures");
    }
    return toHex(call(() => sign.call(handle, messageBytes(message), aux)));
  },

  /** The SHA-256 of `data`, as hex. */
  sha256(data: string | Uint8Array): string {
    return toHex(call((module) => module.sha256(messageBytes(data))));
  },
} as const;
