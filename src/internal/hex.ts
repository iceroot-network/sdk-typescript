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

/**
 * The first byte of every transaction in today's format (the standard header). No UTF-8 text
 * begins with it.
 */
const TRANSACTION_HEADER = 0xff;

/**
 * Whether `bytes` begin as a transaction's do. In today's format a message signature and a
 * transaction signature are the same BIP340 signature over the SHA-256 of the bytes, so a
 * signature of such a message could be a valid signature of a transaction.
 */
function beginsLikeTransaction(bytes: Uint8Array): boolean {
  return bytes.length > 0 && bytes[0] === TRANSACTION_HEADER;
}

/**
 * The bytes of a message to sign. Bytes that begin as a transaction's do are refused with
 * `InvalidArgument` (reason `transaction-header`); text never begins that way.
 */
export function signableMessage(message: string | Uint8Array): Uint8Array {
  const bytes = messageBytes(message);
  if (beginsLikeTransaction(bytes)) {
    throw new InvalidArgument(
      "a message may not begin with the byte 0xff, which begins every transaction: its signature could sign a transaction",
      { reason: "transaction-header" },
    );
  }
  return bytes;
}

/** The bytes of a message to verify, or `undefined` for bytes no message signature may cover. */
export function verifiableMessage(message: string | Uint8Array): Uint8Array | undefined {
  const bytes = messageBytes(message);
  return beginsLikeTransaction(bytes) ? undefined : bytes;
}
