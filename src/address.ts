/**
 * Addresses.
 *
 * An address is always parsed against a profile: an address of another network is refused with
 * the reason `wrong-network`. On the devnets of today an address is the network byte and the
 * RIPEMD-160 of the key in Base58Check (34 characters starting with `d` on network byte 90).
 *
 * @module
 */

import { InvalidAddress, InvalidPublicKey, type AddressProblem } from "./errors.js";
import { call } from "./internal/bindings.js";
import { fromHex, toHex } from "./internal/hex.js";
import { networkByteOf, profileOf, type ProfileSource } from "./profiles.js";
import type { Hex } from "./types.js";

/** The result of {@link Address.check}, for feedback in a form. */
export interface AddressCheck {
  /** Whether the text is an address of the profile's network. */
  readonly ok: boolean;
  /** Why it is not. */
  readonly reason?: AddressProblem;
  /** The index of the first bad character, when the problem is one. */
  readonly position?: number;
}

/** An address of a network. */
export class Address {
  readonly #text: string;
  readonly #bytes: Uint8Array;

  private constructor(text: string, bytes: Uint8Array) {
    this.#text = text;
    this.#bytes = bytes;
  }

  /** The address in `text`, which must belong to the network of `source`. */
  static parse(text: string, source: ProfileSource): Address {
    const networkByte = networkByteOf(profileOf(source), "addresses");
    const bytes = call((module) => module.parseAddress(text, networkByte));
    return new Address(text, bytes);
  }

  /** Whether `text` is an address of the network of `source`, and if not, why. */
  static check(text: string, source: ProfileSource): AddressCheck {
    try {
      Address.parse(text, source);
      return { ok: true };
    } catch (error) {
      if (error instanceof InvalidAddress) {
        return error.position === undefined
          ? { ok: false, reason: error.reason }
          : { ok: false, reason: error.reason, position: error.position };
      }
      throw error;
    }
  }

  /** The address of a public key (33 or 65 bytes, or their hex) on the network of `source`. */
  static fromPublicKey(publicKey: Hex | Uint8Array, source: ProfileSource): Address {
    const networkByte = networkByteOf(profileOf(source), "addresses");
    const bytes = typeof publicKey === "string" ? fromHex(publicKey) : publicKey;
    if (bytes === undefined) {
      throw new InvalidPublicKey("the public key is not hex");
    }
    const text = call((module) => module.addressFromPublicKey(bytes, networkByte));
    return new Address(text, call((module) => module.parseAddress(text, networkByte)));
  }

  /** The network byte. */
  get network(): number {
    return this.#bytes[0] ?? 0;
  }

  /** The address's bytes (network byte and key hash), as a new array. */
  get bytes(): Uint8Array {
    return this.#bytes.slice();
  }

  /** Whether `other` is the same address. */
  equals(other: Address): boolean {
    return toHex(this.#bytes) === toHex(other.#bytes);
  }

  /** The address text. */
  toString(): string {
    return this.#text;
  }

  /** The address text, so that `JSON.stringify` writes it as a string. */
  toJSON(): string {
    return this.#text;
  }
}
