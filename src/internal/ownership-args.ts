// The ownership proof format's constants and argument checks, shared by the WebAssembly entry
// and the Tauri plugin's entry.

import { InvalidArgument } from "../errors.js";
import type { OwnershipProof, ProofRequest } from "../ownership.js";

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

export function proofOf(json: string): OwnershipProof {
  const { address, publicKey, message, signature } = JSON.parse(json) as OwnershipProof;
  return Object.freeze({ address, publicKey, message, signature });
}

export function stringArg(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new InvalidArgument(`${what} is not a string`);
  }
  return value;
}

export function milliseconds(value: Date | number, what: string): number {
  const ms = value instanceof Date ? value.getTime() : value;
  if (typeof ms !== "number" || !Number.isInteger(ms) || Math.abs(ms) > 8.64e15) {
    throw new InvalidArgument(`${what} is a valid Date or a whole number of milliseconds`);
  }
  return ms;
}

/** Whether `value` is a `Uint8Array`, also one made in another realm (a frame, a worker's copy). */
export function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || Object.prototype.toString.call(value) === "[object Uint8Array]";
}

/** The passphrase as a new array the SDK owns and wipes. */
export function passphraseBytes(passphrase: string | Uint8Array): Uint8Array {
  if (typeof passphrase === "string") {
    return new TextEncoder().encode(passphrase);
  }
  if (isBytes(passphrase)) {
    return new Uint8Array(passphrase);
  }
  throw new InvalidArgument("a passphrase is a string or a Uint8Array of UTF-8");
}

/** The proof request of `OwnershipProof.build` in the bindings' JSON. */
export function requestWire(request: ProofRequest): string {
  if (typeof request !== "object" || request === null) {
    throw new InvalidArgument("a proof request is { address, account, nonce, issuedAt }");
  }
  return JSON.stringify({
    address: stringArg(request.address, "the address"),
    account: stringArg(request.account, "the account"),
    nonce: stringArg(request.nonce, "the nonce"),
    issuedAtMs: milliseconds(request.issuedAt, "issuedAt"),
  });
}

/** A proof's JSON with its constant fields, in the format's order, for the core to write again. */
export function proofWire(proof: OwnershipProof): string {
  if (typeof proof !== "object" || proof === null) {
    throw new InvalidArgument("a proof is { address, publicKey, message, signature }");
  }
  return JSON.stringify({
    type: PROOF_TYPE,
    version: PROOF_VERSION,
    network: SOURCE_NETWORK,
    address: stringArg(proof.address, "the address"),
    publicKey: stringArg(proof.publicKey, "the public key"),
    algorithm: PROOF_ALGORITHM,
    message: stringArg(proof.message, "the message"),
    signature: stringArg(proof.signature, "the signature"),
  });
}

/** The expected address of `OwnershipProof.parse`, checked; empty when none. */
export function expectedAddress(expected: { readonly address?: string } | undefined): string {
  const address = expected?.address;
  if (address !== undefined && (typeof address !== "string" || address === "")) {
    throw new InvalidArgument("the expected address is a Solar address");
  }
  return address ?? "";
}
