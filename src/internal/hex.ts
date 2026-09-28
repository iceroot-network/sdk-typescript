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

/** Whether `bytes` are UTF-8 text. */
function isText(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The bytes of a message to sign. In today's format a message signature and a transaction
 * signature are the same BIP340 signature over the SHA-256 of the bytes, so a message is signed
 * only as UTF-8 text: every transaction begins with the byte 0xff, which UTF-8 text never
 * contains. Other bytes are refused with `InvalidArgument`; a string is always text.
 */
export function signableMessage(message: string | Uint8Array): Uint8Array {
  const bytes = messageBytes(message);
  if (typeof message !== "string" && !isText(bytes)) {
    throw new InvalidArgument(NOT_TEXT, { reason: NOT_TEXT });
  }
  return bytes;
}

/** The bytes of a message to verify, or `undefined` for bytes that are not UTF-8 text. */
export function verifiableMessage(message: string | Uint8Array): Uint8Array | undefined {
  const bytes = messageBytes(message);
  return typeof message !== "string" && !isText(bytes) ? undefined : bytes;
}
