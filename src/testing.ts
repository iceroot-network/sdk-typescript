// Entry of the test build only: the published package never contains this file.
//
// The test build compiles the WebAssembly module with reproducible signatures, so the cross-checks
// can compare signature and transaction bytes with native Rust, and with the keystore vectors' own
// salts, nonces and lowered parameter floor, so that every keystore vector runs in WebAssembly.
// The published module has no way to choose the auxiliary randomness of a signature, nor a
// keystore's salt or nonce. The entry also carries the vote library and the keystore as the
// namespaces `vote` and `keystore`, as the published classic-script build does.

import { handleOf as draftHandleOf, SignedTransaction, type Draft } from "./build.js";
import { InvalidArgument } from "./errors.js";
import { keyHandleOf, type Account } from "./keys.js";
import { call, parse, type DraftHandle, type KeyHandle, type SignedHandle } from "./internal/bindings.js";
import { messageBytes, toHex } from "./internal/hex.js";

export * from "./index.js";
export * as vote from "./vote.js";
export * as keystore from "./keystore.js";

/** The test seams of the vote library and the keystore in the test module. */
interface TestSeams {
  voteLibrary?(): string;
  voteSnapshotFromRelay?(relay: string): string;
  keystoreConstants?(): string;
  keystoreEncryptWithSaltAndNonce?(
    kind: string,
    secret: Uint8Array,
    password: string,
    params: string,
    salt: Uint8Array,
    nonce: Uint8Array,
    bounds: string,
  ): Uint8Array;
  keystoreDecryptWithBounds?(keystore: Uint8Array, password: string, bounds: string): string;
  keystoreCheckParamsWithBounds?(params: string, bounds: string): void;
}

/** Keystore parameters, as the keystore vectors write them. */
interface VectorParams {
  readonly memoryKib: number;
  readonly iterations: number;
  readonly parallelism: number;
}

function testSeams(): TestSeams {
  return call((module) => module) as unknown as TestSeams;
}

type TestKeyHandle = KeyHandle & {
  signMessageWithAux?(message: Uint8Array, aux: Uint8Array): string;
};

type TestDraftHandle = DraftHandle & {
  signWithAux?(key: KeyHandle, aux: Uint8Array): SignedHandle;
  signWithSecondAux?(key: KeyHandle, second: KeyHandle, aux: Uint8Array): SignedHandle;
};

function seam(): never {
  throw new InvalidArgument("this build has no test seam");
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

  /** Whether the loaded module has the keystore vectors' seam. */
  hasKeystoreSeam(): boolean {
    return typeof testSeams().keystoreEncryptWithSaltAndNonce === "function";
  },

  /** A keystore of raw payload bytes with the vectors' salt and nonce, under `standard` or `test` bounds. */
  keystoreEncryptWithSaltAndNonce(
    kind: string,
    secret: Uint8Array,
    password: string,
    params: VectorParams,
    salt: Uint8Array,
    nonce: Uint8Array,
    bounds: "standard" | "test",
  ): Uint8Array {
    const module = testSeams();
    const encrypt = module.keystoreEncryptWithSaltAndNonce ?? seam;
    return call(() => encrypt.call(module, kind, secret, password, JSON.stringify(params), salt, nonce, bounds));
  },

  /** A keystore's payload under `standard` or `test` bounds, as the vectors write it: `{ kind, secret, wordCount? }`, the secret in hex. */
  keystoreDecryptWithBounds(
    keystore: Uint8Array,
    password: string,
    bounds: "standard" | "test",
  ): { kind: string; secret: string; wordCount?: number } {
    const module = testSeams();
    const decrypt = module.keystoreDecryptWithBounds ?? seam;
    return parse(call(() => decrypt.call(module, keystore, password, bounds)));
  },

  /** Checks parameters against `standard` or `test` bounds. */
  keystoreCheckParamsWithBounds(params: VectorParams, bounds: "standard" | "test"): void {
    const module = testSeams();
    const check = module.keystoreCheckParamsWithBounds ?? seam;
    call(() => check.call(module, JSON.stringify(params), bounds));
  },

  /** The vote library's constants in the module, which the wrapper's must equal. */
  voteLibrary(): unknown {
    const module = testSeams();
    return parse((module.voteLibrary ?? seam).call(module));
  },

  /** The keystore's constants in the module, which the wrapper's must equal. */
  keystoreConstants(): unknown {
    const module = testSeams();
    return parse((module.keystoreConstants ?? seam).call(module));
  },

  /**
   * A vote snapshot of relay data in the vote library's own relay form (JSON with heights and
   * weights as decimal strings), for the library's devnet-shaped fixture. The snapshot's JSON.
   */
  voteSnapshotFromRelay(relay: string): string {
    const module = testSeams();
    return call(() => (module.voteSnapshotFromRelay ?? seam).call(module, relay));
  },

  /** The SHA-256 of `data`, as hex. */
  sha256(data: string | Uint8Array): string {
    return toHex(call((module) => module.sha256(messageBytes(data))));
  },
} as const;
