// Entry of the test build only: the published package never contains this file.
//
// The test build compiles the WebAssembly module with reproducible signatures, so the cross-checks
// can compare signature and transaction bytes with native Rust. The published module has no way
// to choose the auxiliary randomness of a signature.

import { handleOf as draftHandleOf, SignedTransaction, type Draft } from "./build.js";
import { InvalidArgument } from "./errors.js";
import { keyHandleOf, type Account } from "./keys.js";
import { call, parse, type DraftHandle, type KeyHandle, type SignedHandle } from "./internal/bindings.js";
import { messageBytes, toHex } from "./internal/hex.js";

export * from "./index.js";

type TestKeyHandle = KeyHandle & {
  signMessageWithAux?(message: Uint8Array, aux: Uint8Array): string;
};

type TestDraftHandle = DraftHandle & {
  signWithAux?(key: KeyHandle, aux: Uint8Array): SignedHandle;
  signWithSecondAux?(key: KeyHandle, second: KeyHandle, aux: Uint8Array): SignedHandle;
};

function seam(): never {
  throw new InvalidArgument("this build has no reproducible signatures");
}

/** Test-only functions. */
export const testing = {
  /** Whether the loaded module has the reproducible-signature seam. */
  hasFixedAux(): boolean {
    const bindings = call((module) => module);
    return (
      typeof (bindings.KeyHandle.prototype as TestKeyHandle).signMessageWithAux === "function" &&
      typeof (bindings.DraftHandle.prototype as TestDraftHandle).signWithAux === "function"
    );
  },

  /** A message signature with these 32 auxiliary bytes instead of random ones, as hex. */
  signMessageWithAux(account: Account, message: string | Uint8Array, aux: Uint8Array): string {
    const handle = keyHandleOf(account) as TestKeyHandle;
    const sign = handle.signMessageWithAux ?? seam;
    return parse<{ signature: string }>(call(() => sign.call(handle, messageBytes(message), aux))).signature;
  },

  /** `draft` signed with these 32 auxiliary bytes for every signature instead of random ones. */
  signDraftWithAux(draft: Draft, account: Account, aux: Uint8Array, secondKey?: Account): SignedTransaction {
    const handle = draftHandleOf(draft) as TestDraftHandle;
    const key = keyHandleOf(account);
    const signed = call(() => {
      if (secondKey === undefined) {
        return (handle.signWithAux ?? seam).call(handle, key, aux);
      }
      return (handle.signWithSecondAux ?? seam).call(handle, key, keyHandleOf(secondKey), aux);
    });
    return SignedTransaction.fromHandle(signed);
  },

  /** The SHA-256 of `data`, as hex. */
  sha256(data: string | Uint8Array): string {
    return toHex(call((module) => module.sha256(messageBytes(data))));
  },
} as const;
