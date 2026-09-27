/**
 * Ownership proofs of Solar addresses, version 1, exported as `@iceroot-network/sdk/ownership`.
 *
 * A holder proves control of a Solar mainnet address by signing a fixed nine-line message with the
 * address's key. The message names the address and the IceRoot account its holding should be bound
 * to, a nonce and the issue time; the signature is Solar's own message signature (BIP340 Schnorr
 * over the SHA-256 of the message, algorithm `secp256k1-bip340-sha256`). The Solar network no
 * longer runs, so a proof moves nothing and authorizes no transaction: what it is accepted for is
 * decided by the process that asks for it. This is the format the IceRoot Legacy Signer signs.
 *
 * - {@link OwnershipProof.build} writes a message; {@link OwnershipProof.parse} checks one, as a
 *   signer does before it shows the message and a verifier does before it checks the signature.
 * - {@link SolarKey.fromPassphrase} holds a Solar key in WebAssembly memory;
 *   {@link OwnershipProof.sign} signs a message with it.
 * - A key held elsewhere, such as on a Ledger, signs the message there, and
 *   {@link OwnershipProof.fromSignature} checks the device's signature before the proof is shown.
 * - {@link OwnershipProof.verify} checks a signed proof; {@link OwnershipProof.fromJson} and
 *   {@link OwnershipProof.toJson} read and write its JSON exactly as the Legacy Signer copies it.
 *
 * These functions need no network profile and no connection. Refusals are {@link InvalidProof}
 * with a `reason`. The SDK is stricter than the Legacy Signer's own checks where no correct signer
 * is affected: the source address must have a valid checksum and network byte 63, the issue time
 * must be a real date and time, and a typed IceRoot account must be ASCII.
 *
 * @module
 */

import { InvalidArgument, KeyReleased } from "./errors.js";
import { call, parse } from "./internal/bindings.js";
import { solarKeyHandles as handles, type SolarKeyHandle } from "./internal/solar-keys.js";
import type { Hex } from "./types.js";

export * from "./ownership-errors.js";

/** The `type` of a signed proof. */
export const PROOF_TYPE = "iceroot-migration-ownership-proof";
/** The proof format version. */
export const PROOF_VERSION = 1;
/** The source network every proof names. */
export const SOURCE_NETWORK = "solar-mainnet";
/** The network byte of Solar mainnet addresses (they start with `S`). */
export const SOLAR_NETWORK_BYTE = 63;
/** The signature algorithm. */
export const PROOF_ALGORITHM = "secp256k1-bip340-sha256";

/**
 * A Solar key from its passphrase, held in WebAssembly memory: the SHA-256 of the passphrase's
 * exact UTF-8 text, as the Solar reference implementation derives it (a Solar wallet's 12-word
 * recovery phrase is such a passphrase). It signs ownership proofs and nothing else.
 */
export class SolarKey {
  /** The key's Solar mainnet address. */
  readonly address: string;
  /** The key's public key, 33 bytes compressed, as lowercase hex. */
  readonly publicKey: Hex;

  private constructor(handle: SolarKeyHandle) {
    handles.set(this, handle);
    this.address = call(() => handle.address);
    this.publicKey = call(() => handle.publicKey);
  }

  /**
   * The key of `passphrase`, hashed exactly as given: any text is a key. The IceRoot Legacy Signer
   * trims a typed phrase and joins its words with single spaces first; an app that reads a phrase
   * from a text field should do the same. A passphrase given as bytes is overwritten with zeros.
   */
  static fromPassphrase(passphrase: string | Uint8Array): SolarKey {
    const bytes = passphraseBytes(passphrase);
    try {
      const handle = call((module) => module.SolarKeyHandle.fromPassphrase(bytes));
      try {
        return new SolarKey(handle);
      } catch (error) {
        call(() => {
          handle.release();
          handle.free();
        });
        throw error;
      }
    } finally {
      bytes.fill(0);
      if (typeof passphrase !== "string") {
        passphrase.fill(0);
      }
    }
  }

  /** Whether the key was released. */
  get released(): boolean {
    return !handles.has(this);
  }

  /** Wipes the key from WebAssembly memory; signing afterwards throws `KeyReleased`. Calling it again does nothing. */
  release(): void {
    const handle = handles.get(this);
    if (handle === undefined) {
      return;
    }
    handles.delete(this);
    call(() => {
      handle.release();
      handle.free();
    });
  }
}

function handleOf(key: SolarKey): SolarKeyHandle {
  const handle = key instanceof SolarKey ? handles.get(key) : undefined;
  if (handle === undefined) {
    throw key instanceof SolarKey ? new KeyReleased() : new InvalidArgument("the key is not a SolarKey");
  }
  return handle;
}

/** The Solar mainnet address of a public key (33 bytes compressed, lowercase hex): network byte 63 and the RIPEMD-160 of the key, in Base58Check. A Ledger's public key gives its proofs' address this way. */
export function sourceAddress(publicKey: Hex): string {
  return ownershipCall("source-address", stringArg(publicKey, "the public key"));
}

/** The IceRoot network of an account, by its prefix: `ice1` on mainnet, `tice1` on the public testnet. */
export type AccountNetwork = "mainnet" | "testnet";

/** An IceRoot account as a proof names it. */
export interface ParsedAccount {
  /** The account in lowercase, as a message writes it. */
  readonly account: string;
  readonly network: AccountNetwork;
}

/** Reading the IceRoot account a proof names: a 32-byte hash in Bech32m (BIP 350), 58 characters after `ice1` or `tice1`. */
export const IceRootAccount = Object.freeze({
  /**
   * The account in `text` as a person types it: surrounding white space (what JavaScript's `trim`
   * removes) is dropped, and an account written all in capitals is read in lowercase. The
   * checksum catches a typing error. Characters outside ASCII are refused.
   */
  parse(text: string): ParsedAccount {
    return parse(ownershipCall("account", stringArg(text, "the account")));
  },

  /** The account in `text` exactly as a proof message writes it: in lowercase, with nothing around it. */
  parseCanonical(text: string): ParsedAccount {
    return parse(ownershipCall("account-canonical", stringArg(text, "the account")));
  },
});

/** A signed ownership proof. Its JSON form ({@link OwnershipProof.toJson}) also carries the constant type, version, network and algorithm. */
export interface OwnershipProof {
  /** The Solar mainnet address whose control is proved. */
  readonly address: string;
  /** The public key of the address, 33 bytes compressed, as lowercase hex. */
  readonly publicKey: Hex;
  /** The signed proof message. */
  readonly message: string;
  /** The BIP340 signature of the message's SHA-256, 64 bytes as lowercase hex. */
  readonly signature: Hex;
}

/** What goes into a new proof message. */
export interface ProofRequest {
  /** The Solar mainnet address whose control is proved. */
  readonly address: string;
  /** The IceRoot account its holding should be bound to, in lowercase (see {@link IceRootAccount.parse} for typed input). */
  readonly account: string;
  /** 64 lowercase hex digits: {@link OwnershipProof.randomNonce}, or one the issuing process chose. */
  readonly nonce: Hex;
  /** When the message is issued: a `Date`, or milliseconds since 1970. */
  readonly issuedAt: Date | number;
}

/** What a reader expects of a proof message. */
export interface ProofExpectations {
  /** The Solar mainnet address the message must name: the signer's own, or the one a verifier's proof names. */
  readonly address?: string;
}

/** A checked proof message's fields. */
export interface ProofFields {
  /** The Solar mainnet address. */
  readonly address: string;
  /** The IceRoot account, in lowercase. */
  readonly account: string;
  /** The IceRoot account's network. */
  readonly accountNetwork: AccountNetwork;
  /** The nonce. */
  readonly nonce: Hex;
  /** The issue time as the message writes it. */
  readonly issuedAt: string;
  /** The issue time, in milliseconds since 1970. */
  readonly issuedAtMs: number;
}

/** Building, signing, checking and reading ownership proofs. Times are a `Date` or milliseconds since 1970. */
export const OwnershipProof = Object.freeze({
  /** A new nonce: 64 lowercase hex digits from 32 random bytes. Throws `RandomnessUnavailable` without a generator. */
  randomNonce(): Hex {
    return ownershipCall("nonce");
  },

  /** The proof message of `request`, its issue time written with milliseconds, as the Legacy Signer writes it. */
  build(request: ProofRequest): string {
    if (typeof request !== "object" || request === null) {
      throw new InvalidArgument("a proof request is { address, account, nonce, issuedAt }");
    }
    const wire = JSON.stringify({
      address: stringArg(request.address, "the address"),
      account: stringArg(request.account, "the account"),
      nonce: stringArg(request.nonce, "the nonce"),
      issuedAtMs: milliseconds(request.issuedAt, "issuedAt"),
    });
    return ownershipCall("build", wire);
  },

  /**
   * The fields of the proof `message`, after every check at the reader's time `now`: its fixed
   * lines, the source network, the forms of the address, account, nonce and issue time, an issue
   * time no more than five minutes ahead of `now`, and the expected address. A message issued long
   * ago is not refused: how old a proof may be is the rule of the process that asks for it.
   */
  parse(message: string, expected: ProofExpectations, now: Date | number): ProofFields {
    const address = expected?.address;
    if (address !== undefined && (typeof address !== "string" || address === "")) {
      throw new InvalidArgument("the expected address is a Solar address");
    }
    return parse(ownershipCall("parse", stringArg(message, "the message"), address ?? "", milliseconds(now, "now")));
  },

  /**
   * The proof of `message` signed with `key` at the signer's time `now`, with fresh randomness. The
   * message must pass {@link OwnershipProof.parse} and name the key's address; show the holder the
   * whole message before calling this. The signature is checked before the proof is returned.
   */
  sign(key: SolarKey, message: string, now: Date | number): OwnershipProof {
    const handle = handleOf(key);
    const json = call(() => handle.signProof(stringArg(message, "the message"), milliseconds(now, "now")));
    return proofOf(json);
  },

  /**
   * The proof of `message` with a signature made elsewhere, such as on a Ledger: the device's
   * public key and signature in lowercase hex. The proof's address is the one the message names,
   * and the proof must pass {@link OwnershipProof.verify} at `now`, so a wrong or forged signature
   * is refused before the proof is shown.
   */
  fromSignature(message: string, publicKey: Hex, signature: Hex, now: Date | number): OwnershipProof {
    const wire = JSON.stringify({ publicKey: stringArg(publicKey, "the public key"), signature: stringArg(signature, "the signature") });
    return proofOf(ownershipCall("from-signature", stringArg(message, "the message"), wire, milliseconds(now, "now")));
  },

  /**
   * Checks the signed `proof` at the reader's time `now`: its message passes
   * {@link OwnershipProof.parse} and names the proof's address, the address is the Solar mainnet
   * address of the public key, and the signature verifies. Returns the message's fields; throws
   * `InvalidProof` with the check it fails.
   */
  verify(proof: OwnershipProof | string, now: Date | number): ProofFields {
    const json = typeof proof === "string" ? proof : OwnershipProof.toJson(proof);
    return parse(ownershipCall("verify", json, "", milliseconds(now, "now")));
  },

  /** The signed proof in JSON `text`: exactly the format's eight fields, of the supported type, version, network and algorithm. Not verified: see {@link OwnershipProof.verify}. */
  fromJson(text: string): OwnershipProof {
    return proofOf(ownershipCall("from-json", stringArg(text, "the proof")));
  },

  /** The proof as compact JSON text with its fields in the format's order, byte for byte as the Legacy Signer copies it. */
  toJson(proof: OwnershipProof): string {
    if (typeof proof !== "object" || proof === null) {
      throw new InvalidArgument("a proof is { address, publicKey, message, signature }");
    }
    const json = JSON.stringify({
      type: PROOF_TYPE,
      version: PROOF_VERSION,
      network: SOURCE_NETWORK,
      address: stringArg(proof.address, "the address"),
      publicKey: stringArg(proof.publicKey, "the public key"),
      algorithm: PROOF_ALGORITHM,
      message: stringArg(proof.message, "the message"),
      signature: stringArg(proof.signature, "the signature"),
    });
    // Written by the core, whose JSON is the format's.
    return ownershipCall("from-json", json);
  },
});

// ---- helpers ----------------------------------------------------------------------------------

function ownershipCall(operation: string, first = "", second = "", now = 0): string {
  return call((module) => module.ownershipCall(operation, first, second, now));
}

function proofOf(json: string): OwnershipProof {
  const { address, publicKey, message, signature } = parse<OwnershipProof>(json);
  return Object.freeze({ address, publicKey, message, signature });
}

function stringArg(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new InvalidArgument(`${what} is not a string`);
  }
  return value;
}

function milliseconds(value: Date | number, what: string): number {
  const ms = value instanceof Date ? value.getTime() : value;
  if (typeof ms !== "number" || !Number.isInteger(ms) || Math.abs(ms) > 8.64e15) {
    throw new InvalidArgument(`${what} is a valid Date or a whole number of milliseconds`);
  }
  return ms;
}

/** Whether `value` is a `Uint8Array`, also one made in another realm (a frame, a worker's copy). */
function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || Object.prototype.toString.call(value) === "[object Uint8Array]";
}

/** The passphrase as a new array the SDK owns and wipes. */
function passphraseBytes(passphrase: string | Uint8Array): Uint8Array {
  if (typeof passphrase === "string") {
    return new TextEncoder().encode(passphrase);
  }
  if (isBytes(passphrase)) {
    return new Uint8Array(passphrase);
  }
  throw new InvalidArgument("a passphrase is a string or a Uint8Array of UTF-8");
}
