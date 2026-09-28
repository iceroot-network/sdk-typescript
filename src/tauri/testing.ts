// Entry of the test build of the Tauri entry only: the published package never contains this
// file. It carries the vote library, the keystore and the ownership proofs as the namespaces
// `vote`, `keystore` and `ownership`, as the WebAssembly test entry does, and the seams of the
// plugin's test build (`tauri-plugin-iceroot` with the feature `test-seams`): signatures and
// proofs with fixed auxiliary bytes, the keystore vectors' salts and nonces, and the constants of
// the vote library and the keystore.

import { InvalidArgument } from "../errors.js";
import { messageBytes, toHex } from "../internal/hex.js";
import { signWith, type Draft, type SignedTransaction } from "./build.js";
import { pluginHasTestSeams } from "./init.js";
import { bytesOf, hex, invoke } from "./invoke.js";
import { keyOf, type Account } from "./keys.js";
import { solarKeyOf, type OwnershipProof, type SolarKey } from "./ownership.js";
import { proofOf } from "../internal/ownership-args.js";

export * from "./index.js";
export * as vote from "./vote.js";
export * as keystore from "./keystore.js";
export * as ownership from "./ownership.js";

/** Keystore parameters, as the keystore vectors write them. */
interface VectorParams {
  readonly memoryKib: number;
  readonly iterations: number;
  readonly parallelism: number;
}

/** Test-only functions, through the plugin's test seams. */
export const testing = {
  /** Whether the plugin is its test build (`init()` must have run). */
  hasFixedAux(): boolean {
    return pluginHasTestSeams();
  },

  /** A message signature with these 32 auxiliary bytes instead of random ones, as hex. */
  async signMessageWithAux(account: Account, message: string | Uint8Array, aux: Uint8Array): Promise<string> {
    const text = await invoke<string>("seam_key_sign_message_with_aux", {
      key: keyOf(account),
      message: toHex(messageBytes(message)),
      aux: hex(aux, "the auxiliary bytes"),
    });
    return (JSON.parse(text) as { signature: string }).signature;
  },

  /** `draft` signed with these 32 auxiliary bytes for every signature instead of random ones. */
  async signDraftWithAux(draft: Draft, account: Account, aux: Uint8Array, secondKey?: Account): Promise<SignedTransaction> {
    const auxHex = hex(aux, "the auxiliary bytes");
    return signWith(draft, account, secondKey, (args) => invoke("seam_draft_sign_with_aux", { ...args, aux: auxHex }));
  },

  /** An ownership proof of `message` signed with `key` and these 32 auxiliary bytes, at `nowMs`. */
  async signProofWithAux(key: SolarKey, message: string, nowMs: number, aux: Uint8Array): Promise<OwnershipProof> {
    const json = await invoke<string>("seam_proof_key_sign_with_aux", {
      key: solarKeyOf(key),
      message,
      nowMs,
      aux: hex(aux, "the auxiliary bytes"),
    });
    return proofOf(json);
  },

  /** The module's memory: there is none with the plugin. */
  wasmMemory(): never {
    throw new InvalidArgument("the Tauri entry has no WebAssembly memory");
  },

  /** Whether the plugin has the keystore vectors' seam (`init()` must have run). */
  hasKeystoreSeam(): boolean {
    return pluginHasTestSeams();
  },

  /** A keystore of raw payload bytes with the vectors' salt and nonce, under `standard` or `test` bounds. */
  async keystoreEncryptWithSaltAndNonce(
    kind: string,
    secret: Uint8Array,
    password: string,
    params: VectorParams,
    salt: Uint8Array,
    nonce: Uint8Array,
    bounds: "standard" | "test",
  ): Promise<Uint8Array> {
    return bytesOf(
      await invoke<string>("seam_keystore_encrypt_with_salt_and_nonce", {
        kind,
        secret: hex(secret, "the secret"),
        password,
        params: JSON.stringify(params),
        salt: hex(salt, "the salt"),
        nonce: hex(nonce, "the nonce"),
        bounds,
      }),
    );
  },

  /** A keystore's payload under `standard` or `test` bounds, as the vectors write it. */
  async keystoreDecryptWithBounds(
    keystore: Uint8Array,
    password: string,
    bounds: "standard" | "test",
  ): Promise<{ kind: string; secret: string; wordCount?: number }> {
    return JSON.parse(
      await invoke<string>("seam_keystore_decrypt_with_bounds", { keystore: hex(keystore, "a keystore"), password, bounds }),
    ) as { kind: string; secret: string; wordCount?: number };
  },

  /** Checks parameters against `standard` or `test` bounds. */
  async keystoreCheckParamsWithBounds(params: VectorParams, bounds: "standard" | "test"): Promise<void> {
    await invoke("seam_keystore_check_params_with_bounds", { params: JSON.stringify(params), bounds });
  },

  /** The vote library's constants in the plugin, which the wrapper's must equal. */
  async voteLibrary(): Promise<unknown> {
    return JSON.parse(await invoke<string>("seam_vote_library"));
  },

  /** The keystore's constants in the plugin, which the wrapper's must equal. */
  async keystoreConstants(): Promise<unknown> {
    return JSON.parse(await invoke<string>("seam_keystore_constants"));
  },

  /** A vote snapshot of relay data in the vote library's own relay form, as JSON. */
  voteSnapshotFromRelay(relay: string): Promise<string> {
    return invoke<string>("seam_vote_snapshot_from_relay", { relay });
  },

  /** The SHA-256 of `data`, as hex. */
  sha256(data: string | Uint8Array): Promise<string> {
    return invoke<string>("seam_sha256", { data: toHex(messageBytes(data)) });
  },
} as const;
