/**
 * The keystore through the plugin, exported as `@iceroot-network/sdk/tauri/keystore`: the same
 * format and functions as `@iceroot-network/sdk/keystore`, run natively by the plugin, where
 * Argon2id has the memory of the platform's preset (`"desktop"`: 256 MiB, `"mobile"`: 128 MiB)
 * and runs off the webview's thread.
 *
 * To open an account, prefer `Keys.fromKeystore` of `@iceroot-network/sdk/tauri`: it decrypts the
 * keystore and derives the key in the plugin, so the phrase never enters the webview. `decrypt`
 * gives the phrase to the page, for showing it to the holder.
 *
 * Secrets are passed as `string` or as UTF-8 bytes; bytes are overwritten with zeros once the call
 * settles, whatever the outcome.
 *
 * @module
 */

import { InvalidArgument } from "../errors.js";
import { memoryLimit, paramsWire } from "../internal/keystore-args.js";
import type {
  DecryptOptions,
  DecryptedPhrase,
  KeystoreData,
  KeystoreHeader,
  KeystoreParams,
  Preset,
} from "../keystore.js";
import { bytesOf, hex, invoke, isBytes, withSecrets } from "./invoke.js";
import { keystoreHex } from "./keys.js";

export * from "../keystore-errors.js";
export { BOUNDS, MAX_PASSWORD_BYTES, PRESETS } from "../internal/keystore-args.js";
export type {
  DecryptOptions,
  DecryptedPhrase,
  KeystoreData,
  KeystoreHeader,
  KeystoreParams,
  PayloadKind,
  Preset,
} from "../keystore.js";

/** A new keystore of a recovery phrase under `password`, with a platform's preset or explicit parameters. */
export async function encrypt(
  phrase: string | Uint8Array,
  password: string | Uint8Array,
  params: Preset | KeystoreParams,
): Promise<Uint8Array> {
  return withSecrets([phrase, password], "a phrase or password", async ([phraseBytes, passwordBytes]) => {
    const wire = paramsWire(params);
    return bytesOf(await invoke<string>("keystore_encrypt", { phrase: phraseBytes, password: passwordBytes, params: wire }));
  });
}

/**
 * Opens a keystore with `password` and gives back its recovery phrase, for a screen that shows it
 * again. The plugin's default permission set leaves this command out: the app's capability grants
 * it with `iceroot:allow-keystore-decrypt`, and without it the call is refused with
 * `SdkNotInitialized`. Opening an account needs no phrase: use `net.keys.fromKeystore`.
 */
export async function decrypt(
  keystore: KeystoreData,
  password: string | Uint8Array,
  options: DecryptOptions = {},
): Promise<DecryptedPhrase> {
  return withSecrets([password], "a password", async ([passwordBytes]) => {
    const stored = await keystoreHex(keystore);
    const limit = memoryLimit(options);
    const bytes = await invoke<number[]>("keystore_decrypt", {
      keystore: stored,
      password: passwordBytes,
      maxMemoryKib: limit ?? null,
    });
    const phrase = Uint8Array.from(bytes);
    bytes.fill(0);
    // The canonical phrase: words joined by single spaces.
    const words = (phrase.reduce((count, byte) => count + (byte === 0x20 ? 1 : 0), 0) + 1) as 18 | 21 | 24;
    return Object.freeze({ kind: "bip39-entropy", words, phrase });
  });
}

/** A keystore's header, read without the password. */
export async function inspect(keystore: KeystoreData): Promise<KeystoreHeader> {
  const stored = await keystoreHex(keystore);
  return Object.freeze(JSON.parse(await invoke<string>("keystore_inspect", { keystore: stored })) as KeystoreHeader);
}

/** The keystore encrypted again under `newPassword`, once `oldPassword` opens it. */
export async function changePassword(
  keystore: KeystoreData,
  oldPassword: string | Uint8Array,
  newPassword: string | Uint8Array,
  params: Preset | KeystoreParams,
): Promise<Uint8Array> {
  return withSecrets([oldPassword, newPassword], "a password", async ([oldBytes, newBytes]) => {
    const stored = await keystoreHex(keystore);
    const wire = paramsWire(params);
    return bytesOf(
      await invoke<string>("keystore_change_password", {
        keystore: stored,
        oldPassword: oldBytes,
        newPassword: newBytes,
        params: wire,
      }),
    );
  });
}

/** The keystore encrypted again under the same password with new `params`. */
export async function reencrypt(
  keystore: KeystoreData,
  password: string | Uint8Array,
  params: Preset | KeystoreParams,
): Promise<Uint8Array> {
  return withSecrets([password], "a password", async ([passwordBytes]) => {
    const stored = await keystoreHex(keystore);
    const wire = paramsWire(params);
    return bytesOf(await invoke<string>("keystore_reencrypt", { keystore: stored, password: passwordBytes, params: wire }));
  });
}

/** Whether a keystore written with `params` should be encrypted again with `than`. */
export async function isWeakerThan(params: KeystoreParams | KeystoreHeader, than: Preset | KeystoreParams): Promise<boolean> {
  const own = { memoryKib: params.memoryKib, iterations: params.iterations, parallelism: params.parallelism };
  return invoke<boolean>("keystore_is_weaker", { params: paramsWire(own), than: paramsWire(than) });
}

/** Checks parameters against the format's bounds, with the memory ceiling lowered by `options.maxMemoryKib`. */
export async function checkParams(params: Preset | KeystoreParams, options: DecryptOptions = {}): Promise<void> {
  const limit = memoryLimit(options);
  await invoke("keystore_check_params", { params: paramsWire(params), maxMemoryKib: limit ?? null });
}

/** The text form of a keystore: `irks:` and its bytes in unpadded base64url. */
export async function armor(keystore: Uint8Array): Promise<string> {
  if (!isBytes(keystore)) {
    throw new InvalidArgument("a keystore is a Uint8Array");
  }
  return invoke<string>("keystore_armor", { keystore: hex(keystore, "a keystore") });
}

/** The bytes of a keystore's text form. */
export async function dearmor(text: string): Promise<Uint8Array> {
  if (typeof text !== "string") {
    throw new InvalidArgument("the text form of a keystore is a string");
  }
  return bytesOf(await invoke<string>("keystore_dearmor", { text }));
}
