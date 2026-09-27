// Hexadecimal text and bytes.

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
