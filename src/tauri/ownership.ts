/**
 * Ownership proofs of Solar addresses, version 1, through the plugin, exported as
 * `@iceroot-network/sdk/tauri/ownership`: the same format and functions as
 * `@iceroot-network/sdk/ownership`, with the Solar key held by the plugin.
 *
 * @module
 */

import { InvalidArgument, KeyReleased } from "../errors.js";
import {
  expectedAddress,
  milliseconds,
  proofOf,
  proofWire,
  requestWire,
  stringArg,
} from "../internal/ownership-args.js";
import type { OwnershipProof as Proof, ParsedAccount, ProofExpectations, ProofFields, ProofRequest } from "../ownership.js";
import type { Hex } from "../types.js";
import { dropWith, invoke, keep, withSecrets } from "./invoke.js";

export * from "../ownership-errors.js";
export {
  PROOF_ALGORITHM,
  PROOF_TYPE,
  PROOF_VERSION,
  SOLAR_NETWORK_BYTE,
  SOURCE_NETWORK,
} from "../internal/ownership-args.js";
export type { AccountNetwork, ParsedAccount, ProofExpectations, ProofFields, ProofRequest } from "../ownership.js";

/** A signed ownership proof. */
export type OwnershipProof = Proof;

const handles = new WeakMap<SolarKey, number>();

/** A Solar key from its passphrase, held by the plugin. It signs ownership proofs and nothing else. */
export class SolarKey {
  /** The key's Solar mainnet address. */
  readonly address: string;
  /** The key's public key, 33 bytes compressed, as lowercase hex. */
  readonly publicKey: Hex;

  private constructor(info: { key: number; address: string; publicKey: Hex }) {
    handles.set(this, info.key);
    this.address = info.address;
    this.publicKey = info.publicKey;
    dropWith(this, "proof_key_release", { key: info.key }, this);
  }

  /**
   * The key of `passphrase`, hashed exactly as given, in the plugin. A passphrase given as bytes
   * is overwritten with zeros.
   */
  static async fromPassphrase(passphrase: string | Uint8Array): Promise<SolarKey> {
    return withSecrets([passphrase], "a passphrase", async ([bytes]) => {
      const info = await invoke<{ key: number; address: string; publicKey: Hex }>("proof_key_from_passphrase", {
        passphrase: bytes,
      });
      return new SolarKey(info);
    });
  }

  /** Whether the key was released. */
  get released(): boolean {
    return !handles.has(this);
  }

  /** Wipes the key in the plugin; signing afterwards throws `KeyReleased`. Calling it again does nothing. */
  async release(): Promise<void> {
    const key = handles.get(this);
    if (key === undefined) {
      return;
    }
    handles.delete(this);
    keep(this);
    await invoke("proof_key_release", { key });
  }
}

/**
 * The plugin's number of `key`.
 *
 * @internal
 */
export function solarKeyOf(key: SolarKey): number {
  const handle = key instanceof SolarKey ? handles.get(key) : undefined;
  if (handle === undefined) {
    throw key instanceof SolarKey ? new KeyReleased() : new InvalidArgument("the key is not a SolarKey");
  }
  return handle;
}

function ownershipCall(operation: string, first = "", second = "", now = 0): Promise<string> {
  return invoke<string>("ownership_call", { operation, first, second, nowMs: now });
}

/** The Solar mainnet address of a public key (33 bytes compressed, lowercase hex). */
export function sourceAddress(publicKey: Hex): Promise<string> {
  return ownershipCall("source-address", stringArg(publicKey, "the public key"));
}

/** Reading the IceRoot account a proof names. */
export const IceRootAccount = Object.freeze({
  /** The account in `text` as a person types it. */
  async parse(text: string): Promise<ParsedAccount> {
    return JSON.parse(await ownershipCall("account", stringArg(text, "the account"))) as ParsedAccount;
  },

  /** The account in `text` exactly as a proof message writes it. */
  async parseCanonical(text: string): Promise<ParsedAccount> {
    return JSON.parse(await ownershipCall("account-canonical", stringArg(text, "the account"))) as ParsedAccount;
  },
});

/** Building, signing, checking and reading ownership proofs. Times are a `Date` or milliseconds since 1970. */
export const OwnershipProof = Object.freeze({
  /** A new nonce: 64 lowercase hex digits from 32 random bytes. */
  randomNonce(): Promise<Hex> {
    return ownershipCall("nonce");
  },

  /** The proof message of `request`. */
  async build(request: ProofRequest): Promise<string> {
    return ownershipCall("build", requestWire(request));
  },

  /** The fields of the proof `message`, after every check at the reader's time `now`. */
  async parse(message: string, expected: ProofExpectations, now: Date | number): Promise<ProofFields> {
    const address = expectedAddress(expected);
    return JSON.parse(
      await ownershipCall("parse", stringArg(message, "the message"), address, milliseconds(now, "now")),
    ) as ProofFields;
  },

  /** The proof of `message` signed with `key` at the signer's time `now`, in the plugin. */
  async sign(key: SolarKey, message: string, now: Date | number): Promise<OwnershipProof> {
    const handle = solarKeyOf(key);
    const json = await invoke<string>("proof_key_sign", {
      key: handle,
      message: stringArg(message, "the message"),
      nowMs: milliseconds(now, "now"),
    });
    return proofOf(json);
  },

  /** The proof of `message` with a signature made elsewhere, such as on a Ledger, checked at `now`. */
  async fromSignature(message: string, publicKey: Hex, signature: Hex, now: Date | number): Promise<OwnershipProof> {
    const wire = JSON.stringify({ publicKey: stringArg(publicKey, "the public key"), signature: stringArg(signature, "the signature") });
    return proofOf(await ownershipCall("from-signature", stringArg(message, "the message"), wire, milliseconds(now, "now")));
  },

  /** Checks the signed `proof` at the reader's time `now`; the message's fields. */
  async verify(proof: OwnershipProof | string, now: Date | number): Promise<ProofFields> {
    const json = typeof proof === "string" ? proof : proofWire(proof);
    return JSON.parse(await ownershipCall("verify", json, "", milliseconds(now, "now"))) as ProofFields;
  },

  /** The signed proof in JSON `text`. Not verified. */
  async fromJson(text: string): Promise<OwnershipProof> {
    return proofOf(await ownershipCall("from-json", stringArg(text, "the proof")));
  },

  /** The proof as compact JSON text with its fields in the format's order, byte for byte as the Legacy Signer copies it. */
  async toJson(proof: OwnershipProof): Promise<string> {
    return ownershipCall("from-json", proofWire(proof));
  },
});
