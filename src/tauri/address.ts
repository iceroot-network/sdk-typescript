/**
 * Addresses, always parsed against a profile, in the plugin.
 *
 * @module
 */

import { InvalidAddress, InvalidKey } from "../errors.js";
import type { AddressCheck } from "../address.js";
import { fromHex, toHex } from "../internal/hex.js";
import type { ProfileSource } from "../profiles.js";
import type { Hex } from "../types.js";
import { bytesOf, invoke, isBytes } from "./invoke.js";
import { profileJson } from "./profiles.js";

export type { AddressCheck } from "../address.js";

/** An address of a network. */
export class Address {
  readonly #text: string;
  readonly #bytes: Uint8Array;

  private constructor(text: string, bytes: Uint8Array) {
    this.#text = text;
    this.#bytes = bytes;
  }

  /** The address in `text`, which must belong to the network of `source`. */
  static async parse(text: string, source: ProfileSource): Promise<Address> {
    const bytes = await invoke<string>("address_parse", { text, profile: profileJson(source) });
    return new Address(text, bytesOf(bytes));
  }

  /** Whether `text` is an address of the network of `source`, and if not, why. */
  static async check(text: string, source: ProfileSource): Promise<AddressCheck> {
    try {
      await Address.parse(text, source);
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
  static async fromPublicKey(publicKey: Hex | Uint8Array, source: ProfileSource): Promise<Address> {
    const bytes = typeof publicKey === "string" ? fromHex(publicKey) : isBytes(publicKey) ? publicKey : undefined;
    if (bytes === undefined) {
      throw new InvalidKey("the public key is not hex");
    }
    const profile = profileJson(source);
    const text = await invoke<string>("address_from_public_key", { publicKey: toHex(bytes), profile });
    return new Address(text, bytesOf(await invoke<string>("address_parse", { text, profile })));
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
