/**
 * Recovery phrases, accounts and their keys.
 *
 * Secret keys live in WebAssembly memory and never cross into JavaScript: an {@link Account}
 * holds a handle to its key, exposes the public key and the address, and signs through the module.
 * {@link Account.release} wipes the key.
 *
 * New accounts come from 24-word recovery phrases ({@link Mnemonic.generate}); imports accept 18,
 * 21 or 24 words. Keys are derived with hardened steps only, at `m/44'/1'/account'/0'/index'` on
 * devnets and the public testnet. The legacy passphrase import exists for the devnet tooling's
 * wallets and existing devnet identities.
 *
 * @module
 */

import { InvalidArgument, KeyReleased } from "./errors.js";
import { call, parse, type KeyHandle } from "./internal/bindings.js";
import { fromHex, toHex } from "./internal/hex.js";
import { profileHandleOf, profileOf, type NetworkProfile, type ProfileSource } from "./profiles.js";
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
  /** The derivation path of a key from a recovery phrase, such as `m/44'/1'/0'/0'/0'`. */
  readonly path: string | undefined;
  /** The profile the account belongs to. */
  readonly profile: NetworkProfile;

  private constructor(handle: KeyHandle, profile: NetworkProfile) {
    handles.set(this, handle);
    this.profile = profile;
    this.algorithm = call(() => handle.algorithm()) as Algorithm;
    this.legacy = handle.legacy;
    this.path = handle.path;
    this.publicKey = toHex(call(() => handle.publicKey()));
    this.address = call(() => handle.address());
  }

  /** @internal */
  static fromHandle(handle: KeyHandle, profile: NetworkProfile): Account {
    try {
      return new Account(handle, profile);
    } catch (error) {
      call(() => {
        handle.release();
        handle.free();
      });
      throw error;
    }
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
    call(() => {
      handle.release();
      handle.free();
    });
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

/** Where an account sits in a recovery phrase. */
export interface AccountOptions {
  /** The account number, from 0 to 2^31 − 1; 0 by default. */
  readonly account?: number;
  /** The address index within the account, from 0 to 2^31 − 1; 0 by default. */
  readonly index?: number;
  /** The optional BIP39 passphrase. A different passphrase gives unrelated keys. */
  readonly passphrase?: string;
}

function pathNumber(value: number | undefined, name: string): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new InvalidArgument(`the ${name} is an integer from 0 to 2147483647`, { [name]: value });
  }
  return value;
}

/** Creating and importing accounts. */
export const Keys = {
  /**
   * The account at `options.account` and `options.index` of a recovery phrase of 18, 21 or 24
   * BIP39 English words, derived with the key scheme of the profile of `source`. Words may be
   * separated by any white space and written in any case. Phrases of fewer than 18 words are
   * refused with `PhraseTooShort`.
   *
   * When the phrase is given as UTF-8 bytes, the array is overwritten with zeros once the key is
   * derived, whatever the outcome.
   */
  fromPhrase(phrase: string | Uint8Array, source: ProfileSource, options: AccountOptions = {}): Account {
    const profile = profileOf(source);
    let handle: KeyHandle;
    try {
      const account = pathNumber(options.account, "account");
      const index = pathNumber(options.index, "index");
      const passphrase = options.passphrase ?? "";
      const profileHandle = profileHandleOf(profile);
      handle = call((module) =>
        typeof phrase === "string"
          ? module.KeyHandle.fromPhrase(profileHandle, phrase, account, index, passphrase)
          : module.KeyHandle.fromPhraseBytes(profileHandle, phrase, account, index, passphrase),
      );
    } finally {
      if (typeof phrase !== "string") {
        phrase.fill(0);
      }
    }
    return Account.fromHandle(handle, profile);
  },

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
    let handle: KeyHandle;
    try {
      const profileHandle = profileHandleOf(profile);
      handle = call((module) =>
        typeof passphrase === "string"
          ? module.KeyHandle.fromLegacyPassphrase(profileHandle, passphrase)
          : module.KeyHandle.fromLegacyPassphraseBytes(profileHandle, passphrase),
      );
    } finally {
      if (typeof passphrase !== "string") {
        passphrase.fill(0);
      }
    }
    return Account.fromHandle(handle, profile);
  },
} as const;

/** Why a recovery phrase cannot give keys yet. */
export type PhraseProblem = "empty" | "not-text" | "unknown-word" | "word-count" | "too-short" | "checksum";

/** The result of {@link Mnemonic.check}, for feedback while a phrase is typed. */
export interface PhraseCheck {
  /** Whether keys can be made from the phrase. */
  readonly ok: boolean;
  /** The words typed so far. */
  readonly words: number;
  /** The first problem. */
  readonly reason?: PhraseProblem;
  /** The 1-based position of an unknown word. */
  readonly position?: number;
}

/** Recovery phrases. */
export const Mnemonic = {
  /**
   * A new 24-word recovery phrase from 256 bits of `crypto.getRandomValues`. Show it to the holder
   * only to write it down; never store it unencrypted.
   */
  generate(): string {
    return call((module) => module.generatePhrase());
  },

  /**
   * What is wrong with `text` as a recovery phrase for keys. No word of the phrase is ever
   * repeated in the result.
   */
  check(text: string): PhraseCheck {
    return Object.freeze(parse<PhraseCheck>(call((module) => module.checkPhrase(text))));
  },
} as const;
