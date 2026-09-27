/**
 * The keystore, exported as `@iceroot-network/sdk/keystore`: a recovery phrase encrypted under a
 * password, in one versioned format that every IceRoot wallet reads.
 *
 * The key comes from the password by Argon2id, and the phrase's entropy (never its text) is sealed
 * with XChaCha20-Poly1305. The header (the format version, the parameters, the salt, the nonce and
 * the payload's kind and length) is readable without the password ({@link inspect}) and
 * authenticated with the payload, so any change to a keystore makes it fail to open. A wrong
 * password and a damaged keystore are one error, `WrongPasswordOrCorrupt`, by design.
 *
 * Nothing is stored: an app keeps the bytes (or their text form, {@link armor}) where its platform
 * keeps secrets best, and never stores the password.
 *
 * Secrets are passed as `string` or as UTF-8 bytes. Bytes are overwritten with zeros once used,
 * whatever the outcome, so an app that holds a password or phrase in a `Uint8Array` leaves no copy
 * behind; the copies the SDK makes, in JavaScript and in WebAssembly memory (its stack included),
 * are wiped too. A JavaScript `string` cannot be wiped, so prefer bytes where the app can keep
 * them.
 *
 * Argon2id is deliberately slow (about 0.5 to 1.5 seconds with a platform's preset) and blocks the
 * thread it runs on: run these functions in a Web Worker to keep a page responsive.
 *
 * @module
 */

import { InvalidArgument } from "./errors.js";
import { call, parse } from "./internal/bindings.js";

export * from "./keystore-errors.js";

/** Argon2id cost parameters. */
export interface KeystoreParams {
  /** Memory, in KiB. */
  readonly memoryKib: number;
  /** Passes over the memory. */
  readonly iterations: number;
  /** Lanes. They are computed one after another, so more lanes cost the same time. */
  readonly parallelism: number;
}

/** A parameter preset, one per kind of platform. */
export type Preset =
  /** Native code on a desktop or laptop: 256 MiB, 3 passes, 4 lanes. */
  | "desktop"
  /** Native code on a phone or tablet: 128 MiB, 3 passes, 4 lanes. */
  | "mobile"
  /** WebAssembly in a browser page, an extension or a webview: 64 MiB, 4 passes, 4 lanes. */
  | "web";

/** The presets' parameters. Presets may rise in later releases; a keystore always opens with the parameters it was written with. */
export const PRESETS: Readonly<Record<Preset, KeystoreParams>> = Object.freeze({
  desktop: Object.freeze({ memoryKib: 262_144, iterations: 3, parallelism: 4 }),
  mobile: Object.freeze({ memoryKib: 131_072, iterations: 3, parallelism: 4 }),
  web: Object.freeze({ memoryKib: 65_536, iterations: 4, parallelism: 4 }),
});

/**
 * The range every keystore's parameters must lie in, when written and when read: the floor
 * refuses weak keystores, the ceilings stop a crafted keystore from demanding gigabytes of memory
 * or minutes of work. `maxWork` bounds memory in KiB times iterations.
 */
export const BOUNDS = Object.freeze({
  floor: Object.freeze({ memoryKib: 19_456, iterations: 2, parallelism: 1 }) as KeystoreParams,
  ceiling: Object.freeze({ memoryKib: 524_288, iterations: 16, parallelism: 16 }) as KeystoreParams,
  maxWork: 2_097_152,
});

/** The longest password, in UTF-8 bytes as given, before its Unicode NFKD normalization. */
export const MAX_PASSWORD_BYTES = 1024;

/** What a keystore holds. */
export type PayloadKind =
  /** The entropy of a BIP39 recovery phrase of 18, 21 or 24 words. */
  | "bip39-entropy"
  /** Reserved for the ML-DSA-65 key seed of IceRoot's post-quantum keys; this release reads its header only. */
  | "ml-dsa-65-seed";

/** A keystore's header, readable without the password. */
export interface KeystoreHeader {
  /** The format version: 1. */
  readonly version: number;
  /** The key derivation function: `argon2id`. */
  readonly kdf: string;
  readonly memoryKib: number;
  readonly iterations: number;
  readonly parallelism: number;
  /** The salt, as hex. */
  readonly salt: string;
  /** The nonce, as hex. */
  readonly nonce: string;
  readonly payloadKind: PayloadKind;
  /** The payload's length in bytes. */
  readonly payloadLength: number;
  /** The keystore's length in bytes. */
  readonly keystoreLength: number;
}

/** What a keystore opened to. */
export interface DecryptedPhrase {
  readonly kind: "bip39-entropy";
  /** The recovery phrase's word count. */
  readonly words: 18 | 21 | 24;
  /**
   * The canonical recovery phrase (the words joined by single spaces) as UTF-8 bytes, a new array
   * that the app owns: pass it to `Keys.fromPhrase`, which wipes it, or overwrite it with zeros
   * (`phrase.fill(0)`) once shown.
   */
  readonly phrase: Uint8Array;
}

/** A keystore as bytes, or in its text form (`irks:...`). */
export type KeystoreData = Uint8Array | string;

/** How much memory a keystore may ask for when it is opened. */
export interface DecryptOptions {
  /**
   * The most memory, in KiB, a keystore may ask for: for a platform that cannot spare the format's
   * ceiling (512 MiB). A keystore that asks for more is refused with `ParamsOutOfRange` before any
   * work is done. The format's ceiling by default.
   */
  readonly maxMemoryKib?: number;
}

/**
 * A new keystore of a recovery phrase (18, 21 or 24 BIP39 English words) under `password`, with a
 * platform's preset or explicit parameters, a fresh salt and a fresh nonce. Returns its bytes; use
 * {@link armor} for text. Phrases and passwords given as bytes are overwritten with zeros.
 *
 * Throws `InvalidPhrase` or `PhraseTooShort` for a phrase keys are not made from, `InvalidPassword`
 * for an empty or too long password, `ParamsOutOfRange`, and `RandomnessUnavailable`.
 */
export function encrypt(phrase: string | Uint8Array, password: string | Uint8Array, params: Preset | KeystoreParams): Uint8Array {
  return withSecrets([phrase, password], ([phraseBytes, passwordBytes]) => {
    const wire = paramsWire(params);
    return call((module) => module.keystoreEncrypt(phraseBytes, passwordBytes, wire));
  });
}

/**
 * Opens a keystore with `password` and gives back its recovery phrase. A password given as bytes
 * is overwritten with zeros.
 *
 * Throws `WrongPasswordOrCorrupt` for a wrong password or a changed keystore, and, before any work,
 * `Malformed`, `UnsupportedVersion`, `UnsupportedKdf`, `UnsupportedPayload` or `ParamsOutOfRange`
 * for a keystore this release cannot open; `OutOfMemory` when the platform cannot give Argon2id
 * the memory the keystore asks for.
 */
export function decrypt(keystore: KeystoreData, password: string | Uint8Array, options: DecryptOptions = {}): DecryptedPhrase {
  return withSecrets([password], ([passwordBytes]) => {
    const bytes = keystoreBytes(keystore);
    const limit = memoryLimit(options);
    const phrase = call((module) => module.keystoreDecrypt(bytes, passwordBytes, limit));
    // The canonical phrase: words joined by single spaces.
    const words = (phrase.reduce((count, byte) => count + (byte === 0x20 ? 1 : 0), 0) + 1) as 18 | 21 | 24;
    return Object.freeze({ kind: "bip39-entropy", words, phrase });
  });
}

/** A keystore's header, read without the password. Throws `Malformed`, `UnsupportedVersion`, `UnsupportedKdf` or `UnsupportedPayload`. */
export function inspect(keystore: KeystoreData): KeystoreHeader {
  const bytes = keystoreBytes(keystore);
  return Object.freeze(parse<KeystoreHeader>(call((module) => module.keystoreInspect(bytes))));
}

/**
 * The keystore encrypted again under `newPassword`, with `params`, a fresh salt and a fresh nonce,
 * once `oldPassword` opens it. The new password and parameters are checked first, so a refusal
 * costs no key derivation. Passwords given as bytes are overwritten with zeros.
 */
export function changePassword(
  keystore: KeystoreData,
  oldPassword: string | Uint8Array,
  newPassword: string | Uint8Array,
  params: Preset | KeystoreParams,
): Uint8Array {
  return withSecrets([oldPassword, newPassword], ([oldBytes, newBytes]) => {
    const bytes = keystoreBytes(keystore);
    const wire = paramsWire(params);
    return call((module) => module.keystoreChangePassword(bytes, oldBytes, newBytes, wire));
  });
}

/**
 * The keystore encrypted again under the same password with new `params`, a fresh salt and a fresh
 * nonce: for moving a keystore to the platform's current preset after an unlock, when
 * {@link isWeakerThan} says its parameters are weaker. A password given as bytes is overwritten
 * with zeros.
 */
export function reencrypt(keystore: KeystoreData, password: string | Uint8Array, params: Preset | KeystoreParams): Uint8Array {
  return withSecrets([password], ([passwordBytes]) => {
    const bytes = keystoreBytes(keystore);
    const wire = paramsWire(params);
    return call((module) => module.keystoreReencrypt(bytes, passwordBytes, wire));
  });
}

/**
 * Whether a keystore written with `params` should be encrypted again with `than`, the parameters
 * the app writes now: when it has less memory, or the same memory and fewer passes. A keystore
 * never moves to less memory: one written with the desktop preset and opened in a browser keeps
 * its 256 MiB.
 */
export function isWeakerThan(params: KeystoreParams | KeystoreHeader, than: Preset | KeystoreParams): boolean {
  const own = { memoryKib: params.memoryKib, iterations: params.iterations, parallelism: params.parallelism };
  return call((module) => module.keystoreIsWeaker(paramsWire(own), paramsWire(than)));
}

/**
 * Checks parameters against the format's bounds, with the memory ceiling lowered by
 * `options.maxMemoryKib`. Throws `ParamsOutOfRange` naming the first parameter out of range.
 */
export function checkParams(params: Preset | KeystoreParams, options: DecryptOptions = {}): void {
  const limit = memoryLimit(options);
  call((module) => module.keystoreCheckParams(paramsWire(params), limit));
}

/** The text form of a keystore: `irks:` and its bytes in unpadded base64url, for stores that keep text. */
export function armor(keystore: Uint8Array): string {
  if (!isBytes(keystore)) {
    throw new InvalidArgument("a keystore is a Uint8Array");
  }
  return call((module) => module.keystoreArmor(keystore));
}

/** The bytes of a keystore's text form. Throws `Malformed` for text that is not one. */
export function dearmor(text: string): Uint8Array {
  if (typeof text !== "string") {
    throw new InvalidArgument("the text form of a keystore is a string");
  }
  return call((module) => module.keystoreDearmor(text));
}

// ---- helpers ----------------------------------------------------------------------------------

/** Whether `value` is a `Uint8Array`, also one made in another realm (a frame, a worker's copy). */
function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function paramsWire(params: Preset | KeystoreParams): string {
  if (typeof params === "string") {
    if (!Object.hasOwn(PRESETS, params)) {
      throw new InvalidArgument(`${JSON.stringify(params)} is not a preset: desktop, mobile or web`);
    }
    return JSON.stringify(PRESETS[params]);
  }
  if (typeof params !== "object" || params === null) {
    throw new InvalidArgument("parameters are a preset (desktop, mobile or web) or { memoryKib, iterations, parallelism }");
  }
  return JSON.stringify({ memoryKib: params.memoryKib, iterations: params.iterations, parallelism: params.parallelism });
}

function keystoreBytes(keystore: KeystoreData): Uint8Array {
  if (typeof keystore === "string") {
    return dearmor(keystore);
  }
  if (!isBytes(keystore)) {
    throw new InvalidArgument("a keystore is a Uint8Array or its text form");
  }
  return keystore;
}

function memoryLimit(options: DecryptOptions): number | undefined {
  const limit = options.maxMemoryKib;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > 0xffffffff)) {
    throw new InvalidArgument("maxMemoryKib is a whole number of KiB", { maxMemoryKib: limit });
  }
  return limit;
}

/**
 * Calls `f` with each secret as UTF-8 bytes: arrays the caller gave as they are, strings encoded
 * into arrays of the SDK's own. The module overwrites the arrays it reads with zeros; every array
 * is overwritten again when `f` returns or throws, so a refusal before the module is reached leaves
 * no copy either.
 */
function withSecrets<const S extends readonly (string | Uint8Array)[], T>(
  secrets: S,
  f: (bytes: { readonly [K in keyof S]: Uint8Array }) => T,
): T {
  const arrays: Uint8Array[] = [];
  try {
    for (const secret of secrets) {
      if (isBytes(secret)) {
        arrays.push(secret);
      } else if (typeof secret === "string") {
        arrays.push(new TextEncoder().encode(secret));
      } else {
        throw new InvalidArgument("a phrase or password is a string or a Uint8Array of UTF-8");
      }
    }
    return f(arrays as unknown as { readonly [K in keyof S]: Uint8Array });
  } finally {
    for (const secret of secrets) {
      if (isBytes(secret)) {
        secret.fill(0);
      }
    }
    for (const bytes of arrays) {
      bytes.fill(0);
    }
  }
}
