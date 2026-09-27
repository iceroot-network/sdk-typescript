/**
 * Accounts and their keys.
 *
 * Secret keys live in WebAssembly memory and never cross into JavaScript: an {@link Account}
 * holds a handle to its key, exposes the public key and the address, and signs through the module.
 * {@link Account.release} wipes the key.
 *
 * New accounts come from 24-word recovery phrases with hardened derivation; that part arrives
 * with the Rust core. Today the module offers the legacy passphrase import, which the devnet
 * tooling's wallets and existing devnet identities need.
 *
 * @module
 */

import { KeyReleased, UnsupportedOnNetwork } from "./errors.js";
import { call, type KeyHandle } from "./internal/bindings.js";
import { fromHex, toHex } from "./internal/hex.js";
import { networkByteOf, profileOf, type NetworkProfile, type ProfileSource } from "./profiles.js";
import type { Algorithm, Hex } from "./types.js";

const handles = new WeakMap<Account, KeyHandle>();

/** An account whose key the SDK holds. */
export class Account {
  /** The account's address on its profile's network. */
  readonly address: string;
  /** The compressed public key, as lowercase hex. */
  readonly publicKey: Hex;
  /** The signature algorithm of the key. */
  readonly algorithm: Algorithm;
  /** True when the key was imported from a legacy passphrase. */
  readonly legacy: boolean;
  /** The profile the account belongs to. */
  readonly profile: NetworkProfile;

  private constructor(handle: KeyHandle, profile: NetworkProfile, networkByte: number) {
    handles.set(this, handle);
    this.profile = profile;
    this.algorithm = "secp256k1-bip340";
    this.legacy = handle.legacy;
    this.publicKey = toHex(call(() => handle.publicKey()));
    this.address = call(() => handle.address(networkByte));
  }

  /** @internal */
  static fromHandle(handle: KeyHandle, profile: NetworkProfile, networkByte: number): Account {
    return new Account(handle, profile, networkByte);
  }

  /** The compressed public key (33 bytes), as a new array. */
  get publicKeyBytes(): Uint8Array {
    return fromHex(this.publicKey) ?? new Uint8Array(0);
  }

  /** Whether the key was released. */
  get released(): boolean {
    return !handles.has(this);
  }

  /**
   * Wipes the secret key from WebAssembly memory. The address and public key stay readable;
   * signing afterwards throws `KeyReleased`. Calling it again does nothing.
   */
  release(): void {
    const handle = handles.get(this);
    if (handle === undefined) {
      return;
    }
    handles.delete(this);
    handle.release();
    handle.free();
  }
}

/**
 * The key handle of `account`, for signing.
 *
 * @internal
 */
export function keyHandleOf(account: Account): KeyHandle {
  const handle = handles.get(account);
  if (handle === undefined) {
    throw new KeyReleased();
  }
  return handle;
}

/** Creating and importing accounts. */
export const Keys = {
  /**
   * Imports the passphrase key of the reference implementation: the SHA-256 of the passphrase's
   * UTF-8 bytes. For the devnet tooling's wallets and existing devnet identities only; it is not
   * a way to create an account, and profiles from the post-quantum formats on refuse it with
   * `UnsupportedOnNetwork`.
   *
   * Any text is accepted. When the passphrase is given as bytes, the array is overwritten with
   * zeros once the key is derived, whatever the outcome.
   */
  fromLegacyPassphrase(passphrase: string | Uint8Array, source: ProfileSource): Account {
    const profile = profileOf(source);
    if (profile.keyScheme !== "bip32-secp256k1") {
      if (typeof passphrase !== "string") {
        passphrase.fill(0);
      }
      throw new UnsupportedOnNetwork(
        "legacy-passphrase-import",
        `the ${profile.id} profile does not accept legacy passphrase keys`,
      );
    }
    const networkByte = networkByteOf(profile, "legacy-passphrase-import");
    const handle = call((module) =>
      typeof passphrase === "string"
        ? module.KeyHandle.fromLegacyPassphrase(passphrase)
        : module.KeyHandle.fromLegacyPassphraseBytes(passphrase),
    );
    try {
      return Account.fromHandle(handle, profile, networkByte);
    } catch (error) {
      handle.release();
      handle.free();
      throw error;
    }
  },
} as const;
