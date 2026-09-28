/**
 * Recovery phrases, accounts and their keys, held by the plugin.
 *
 * An {@link Account}'s secret key lives in the plugin, in Rust, and never crosses into the
 * webview: the account holds an opaque number, exposes the public key and the address, and signs
 * through the plugin. {@link Account.release} wipes the key; the plugin also wipes every key a
 * page opened when the webview loads another page or closes.
 *
 * With the plugin, {@link Keys.fromKeystore} opens an account straight from a keystore: the
 * phrase is decrypted and the key derived in the plugin, so the phrase never enters the webview.
 *
 * @module
 */

import { InvalidArgument, KeyReleased } from "../errors.js";
import { fromHex } from "../internal/hex.js";
import { pathNumber } from "../internal/key-args.js";
import { isBytes, memoryLimit } from "../internal/keystore-args.js";
import type { AccountOptions, KeystoreAccountOptions, PhraseCheck } from "../keys.js";
import type { KeystoreData } from "../keystore.js";
import type { NetworkProfile, ProfileSource } from "../profiles.js";
import { profileOf } from "../profiles.js";
import type { Algorithm, Hex } from "../types.js";
import { dropWith, hex, invoke, keep, withSecrets } from "./invoke.js";
import { profileJson } from "./profiles.js";

export type { AccountOptions, KeystoreAccountOptions, PhraseCheck, PhraseProblem } from "../keys.js";

/** A key the plugin holds, as it describes it. */
interface KeyInfo {
  readonly key: number;
  readonly address: string;
  readonly publicKey: Hex;
  readonly algorithm: Algorithm;
  readonly legacy: boolean;
  readonly path: string | null;
}

const handles = new WeakMap<Account, number>();

/** An account whose key the plugin holds. */
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

  private constructor(info: KeyInfo, profile: NetworkProfile) {
    handles.set(this, info.key);
    this.profile = profile;
    this.algorithm = info.algorithm;
    this.legacy = info.legacy;
    this.path = info.path ?? undefined;
    this.publicKey = info.publicKey;
    this.address = info.address;
    // A key the page never releases is wiped when the account is collected.
    dropWith(this, "key_release", { key: info.key }, this);
  }

  /** @internal */
  static fromInfo(info: KeyInfo, profile: NetworkProfile): Account {
    return new Account(info, profile);
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
   * Wipes the secret key in the plugin. The address and public key stay readable; signing
   * afterwards throws `KeyReleased`. Calling it again does nothing.
   */
  async release(): Promise<void> {
    const key = handles.get(this);
    if (key === undefined) {
      return;
    }
    handles.delete(this);
    keep(this);
    await invoke("key_release", { key });
  }
}

/**
 * The plugin's number of the key of `account`, for signing.
 *
 * @internal
 */
export function keyOf(account: Account): number {
  const key = account instanceof Account ? handles.get(account) : undefined;
  if (key === undefined) {
    throw account instanceof Account ? new KeyReleased() : new InvalidArgument("not an account of the SDK's Tauri entry");
  }
  return key;
}

/** Creating and importing accounts. */
export const Keys = {
  /**
   * The account at `options.account` and `options.index` of a recovery phrase of 18, 21 or 24
   * BIP39 English words, derived with the key scheme of the profile of `source`, in the plugin.
   * Phrases of fewer than 18 words are refused with `PhraseTooShort`. A phrase given as bytes is
   * overwritten with zeros once the call settles, whatever the outcome.
   */
  async fromPhrase(phrase: string | Uint8Array, source: ProfileSource, options: AccountOptions = {}): Promise<Account> {
    const profile = profileOf(source);
    return withSecrets([phrase, options.passphrase ?? ""], "a phrase", async ([phraseBytes, passphraseBytes]) => {
      const info = await invoke<KeyInfo>("key_from_phrase", {
        profile: profileJson(profile),
        phrase: phraseBytes,
        account: pathNumber(options.account, "account"),
        index: pathNumber(options.index, "index"),
        passphrase: passphraseBytes,
      });
      return Account.fromInfo(info, profile);
    });
  },

  /**
   * Imports the passphrase key of the reference implementation: the SHA-256 of the passphrase's
   * UTF-8 bytes. For the devnet tooling's wallets and existing devnet identities only; profiles
   * from the post-quantum formats on refuse it with `UnsupportedOnNetwork`. A passphrase given as
   * bytes is overwritten with zeros.
   */
  async fromLegacyPassphrase(passphrase: string | Uint8Array, source: ProfileSource): Promise<Account> {
    const profile = profileOf(source);
    return withSecrets([passphrase], "a passphrase", async ([bytes]) => {
      const info = await invoke<KeyInfo>("key_from_legacy_passphrase", { profile: profileJson(profile), passphrase: bytes });
      return Account.fromInfo(info, profile);
    });
  },

  /**
   * The account at `options.account` and `options.index` of the recovery phrase a keystore holds,
   * opened with `password`: the plugin decrypts the keystore and derives the key, and the phrase
   * never enters the webview. `options.maxMemoryKib` lowers the memory the keystore may ask for.
   * A password given as bytes is overwritten with zeros. Refusals are the keystore's
   * (`WrongPasswordOrCorrupt` and the others of `@iceroot-network/sdk/tauri/keystore`) and the
   * phrase's.
   */
  async fromKeystore(
    keystore: KeystoreData,
    password: string | Uint8Array,
    source: ProfileSource,
    options: KeystoreAccountOptions = {},
  ): Promise<Account> {
    const profile = profileOf(source);
    return withSecrets([password, options.passphrase ?? ""], "a password", async ([passwordBytes, passphraseBytes]) => {
      const stored = await keystoreHex(keystore);
      const info = await invoke<KeyInfo>("key_from_keystore", {
        profile: profileJson(profile),
        keystore: stored,
        password: passwordBytes,
        account: pathNumber(options.account, "account"),
        index: pathNumber(options.index, "index"),
        passphrase: passphraseBytes,
        maxMemoryKib: memoryLimit(options) ?? null,
      });
      return Account.fromInfo(info, profile);
    });
  },
} as const;

/**
 * A keystore's bytes as hex, its text form read by the plugin.
 *
 * @internal
 */
export async function keystoreHex(keystore: KeystoreData): Promise<string> {
  if (typeof keystore === "string") {
    return invoke<string>("keystore_dearmor", { text: keystore });
  }
  if (!isBytes(keystore)) {
    throw new InvalidArgument("a keystore is a Uint8Array or its text form");
  }
  return hex(keystore, "a keystore");
}

/** Recovery phrases. */
export const Mnemonic = {
  /**
   * A new 24-word recovery phrase from 256 bits of the platform's random generator, made in the
   * plugin. Show it to the holder only to write it down; never store it unencrypted.
   */
  generate(): Promise<string> {
    return invoke<string>("phrase_generate");
  },

  /** What is wrong with `text` as a recovery phrase for keys. No word of the phrase is ever repeated in the result. */
  async check(text: string): Promise<PhraseCheck> {
    if (typeof text !== "string") {
      throw new InvalidArgument("a phrase to check is a string");
    }
    return withSecrets([text], "a phrase", async ([bytes]) =>
      Object.freeze(JSON.parse(await invoke<string>("phrase_check", { text: bytes })) as PhraseCheck),
    );
  },
} as const;
