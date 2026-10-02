// Hexadecimal text and bytes, and the bytes of messages.

import { InvalidArgument } from "../errors.js";

const DIGITS = "0123456789abcdef";

/** Lowercase hex of `bytes`. */
export function toHex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += DIGITS.charAt(byte >> 4) + DIGITS.charAt(byte & 15);
  }
  return text;
}

/** The bytes of hex `text` (either case), or `undefined` if it is not hex of whole bytes. */
export function fromHex(text: string): Uint8Array | undefined {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) {
    return undefined;
  }
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(text.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}

const encoder = new TextEncoder();

/** The UTF-8 bytes of a message given as text or bytes. */
export function messageBytes(message: string | Uint8Array): Uint8Array {
  return typeof message === "string" ? encoder.encode(message) : message;
}

/** Why a message given as bytes is refused, as the Rust SDK words it. */
const NOT_TEXT = "a message is signed only as UTF-8 text";

/** Why the text of an ownership proof is refused as a message. */
const NOT_A_PROOF = "an ownership proof is signed only as a proof, never as a message";

/** The first line of every ownership proof (`@iceroot-network/sdk/ownership`). */
const PROOF_TITLE = "IceRoot migration ownership proof";

/** The text of `bytes`, kept exactly (a byte order mark included), or `undefined` if they are not UTF-8. */
function textOf(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The bytes of a message to sign. In today's format a message signature, a transaction signature
 * and an ownership proof's signature are the same BIP340 signature over the SHA-256 of the bytes,
 * so a message is refused with `InvalidArgument` when it could be one of the others:
 *
 * - bytes that are not UTF-8 text: every transaction begins with the byte 0xff, which UTF-8 text
 *   never contains (a string is always text);
 * - text whose first line is an ownership proof's, `IceRoot migration ownership proof`: a devnet
 *   account imported from a Solar passphrase has the Solar key itself, and its message signature
 *   of a proof's text would verify as that proof. Proofs are made by `OwnershipProof.sign` and
 *   `OwnershipProof.fromSignature` only.
 */
export function signableMessage(message: string | Uint8Array): Uint8Array {
  const bytes = messageBytes(message);
  const text = textOf(bytes);
  if (text === undefined) {
    throw new InvalidArgument(NOT_TEXT, { reason: NOT_TEXT });
  }
  if (text.split("\n", 1)[0] === PROOF_TITLE) {
    throw new InvalidArgument(NOT_A_PROOF, { reason: NOT_A_PROOF });
  }
  return bytes;
}

/** The bytes of a message to verify, or `undefined` for bytes that are not UTF-8 text. */
export function verifiableMessage(message: string | Uint8Array): Uint8Array | undefined {
  const bytes = messageBytes(message);
  return typeof message !== "string" && textOf(bytes) === undefined ? undefined : bytes;
}
