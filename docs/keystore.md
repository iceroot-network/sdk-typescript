# Keystore

A keystore is a recovery phrase encrypted under a password, in one versioned format that every IceRoot wallet reads. `@iceroot-network/sdk/keystore` writes and opens it with the SDK's Rust core; the Rust crate is `iceroot_sdk::keystore`, and in Tauri apps `@iceroot-network/sdk/tauri/keystore` runs the same format natively in the SDK's plugin, with the same functions returning promises.

- **What is inside.** The entropy of the recovery phrase (24, 28 or 32 bytes for 18, 21 or 24 words), never its text and never a derived key. Opening a keystore gives the phrase back.
- **How.** The key comes from the password by Argon2id; the entropy is sealed with XChaCha20-Poly1305. The header (the format version, the parameters, the salt, the nonce and the payload's kind and length) is readable without the password and authenticated with the payload, so any change to a keystore makes it fail to open. A wrong password and a damaged keystore are one error, `WrongPasswordOrCorrupt`, by design.
- **What it does not do.** It stores nothing. The app keeps the bytes (or their text form) where its platform keeps secrets best, and never stores the password. Salts and nonces come from `crypto.getRandomValues`; no function lets the app choose them.

## Presets

Argon2id is deliberately slow and memory-hungry, which is what makes guessing passwords expensive. Each platform has a preset of about 0.5 to 1.5 seconds on a mid-range device of its kind.

| Preset | Memory | Passes | Lanes | For |
|---|---|---|---|---|
| `"desktop"` | 256 MiB | 3 | 4 | Native code on a desktop or laptop (the native Tauri plugin) |
| `"mobile"` | 128 MiB | 3 | 4 | Native code on a phone or tablet (the native Tauri plugin) |
| `"web"` | 64 MiB | 4 | 4 | WebAssembly in a browser page, an extension or a webview |

`PRESETS` has their parameters, and explicit `{ memoryKib, iterations, parallelism }` work too, within the format's bounds (`BOUNDS`: from 19 MiB and 2 passes to 512 MiB and 16 passes). A keystore always opens with the parameters it was written with, whichever preset the reading app uses.

## Encrypting a recovery phrase

<!-- sample: verified 0.1.0 -->
```ts
import { Mnemonic } from "@iceroot-network/sdk";
import { armor, encrypt } from "@iceroot-network/sdk/keystore";

const phrase = Mnemonic.generate();                  // show it once, to be written down
const stored = encrypt(phrase, password, "web");     // Uint8Array; about a second of work
const text = armor(stored);                          // "irks:...", for a store that keeps strings
```

`encrypt` accepts only phrases keys are made from (18, 21 or 24 words; `PhraseTooShort` below that), a password that is not empty and at most 1,024 bytes of UTF-8 (`InvalidPassword`), and parameters within the bounds (`ParamsOutOfRange`). The password is normalized to Unicode NFKD, so the same password typed on different systems opens the same keystore.

## Opening it

<!-- sample: verified 0.1.0 -->
```ts
import { Keys } from "@iceroot-network/sdk";
import { WrongPasswordOrCorrupt, decrypt } from "@iceroot-network/sdk/keystore";

try {
  const opened = decrypt(stored, password);          // bytes or the "irks:" text
  opened.words;                                      // 18, 21 or 24
  const account = Keys.fromPhrase(opened.phrase, net.profile);   // wipes opened.phrase
  void account;
} catch (error) {
  if (error instanceof WrongPasswordOrCorrupt) {
    showRefusal("Wrong password.");
  } else {
    throw error;
  }
}
```

`opened.phrase` is the canonical phrase (words joined by single spaces) as UTF-8 bytes, a new array the app owns: pass it to `Keys.fromPhrase`, which overwrites it with zeros, or overwrite it yourself (`opened.phrase.fill(0)`) once shown for a backup.

To unlock an account, open it straight from the keystore instead: `Keys.fromKeystore(stored, password, net.profile, { account: 0, index: 0 })`, or `net.keys.fromKeystore(stored, password)`, decrypts the keystore and derives the key inside the SDK, so the phrase never reaches JavaScript (with the Tauri plugin, it never enters the webview). Its refusals are `decrypt`'s, and it takes `maxMemoryKib` among its options.

<!-- sample: verified 0.1.0 -->
```ts
import { Keys } from "@iceroot-network/sdk";

const account = Keys.fromKeystore(stored, password, net.profile, { account: 0, index: 0 });
account.address;                                     // the key stays in the SDK until account.release()
```

Opening a key needs a profile, not a connected network. `net.profile` is one, and so is `profiles.devnet({ relays, nethash })`, which needs no request, so a wallet unlocks with no connection and a sandbox page that never connects can derive a key. The derivation is offline; only the calls that read or submit need the node.

Compare the account's address with the address the wallet saved, every time a wallet is reopened. A wrong account or index, the keystore of another wallet, or a changed key scheme each open without error and give a valid key of an address the holder never saw. Anything built and signed with it would act as that other account.

<!-- sample: verified 0.1.0 -->
```ts
import { Keys, type NetworkProfile } from "@iceroot-network/sdk";

/** Opens the saved wallet's key, only if it is the address the holder saw and saved. No connection is needed. */
function unlockSaved(stored: string, password: Uint8Array, profile: NetworkProfile, savedAddress: string, index: number) {
  const account = Keys.fromKeystore(stored, password, profile, { account: 0, index });
  if (account.address !== savedAddress) {
    account.release();                               // wipe the key of the other address
    throw new Error("This keystore belongs to another wallet.");
  }
  return account;
}
```

A keystore this release cannot open is refused before any work: `Malformed` (not a keystore; `error.reason` says why), `UnsupportedVersion`, `UnsupportedKdf`, `UnsupportedPayload`, or `ParamsOutOfRange` for parameters outside the bounds. `decrypt(stored, password, { maxMemoryKib })` lowers the memory a keystore may ask for, on a platform that cannot spare the format's ceiling: a keystore that asks for more is refused with `ParamsOutOfRange` rather than failing mid-way with `OutOfMemory`. `changePassword` and `reencrypt` take the same option as their last argument, and apply it to the keystore they open and to the parameters they write.

## Changing the password, and newer presets

<!-- sample: verified 0.1.0 -->
```ts
import { changePassword, inspect, isWeakerThan, reencrypt } from "@iceroot-network/sdk/keystore";

const changed = changePassword(stored, password, newPassword, "web");   // a fresh salt and nonce

// After a successful unlock: move a keystore to the platform's current preset.
if (isWeakerThan(inspect(stored), "web")) {
  const upgraded = reencrypt(stored, password, "web");
  void upgraded;                                     // store it in place of the old one
}
void changed;
```

`inspect` reads the header without the password: the version, `argon2id`, the parameters, the salt, the nonce, the payload kind and the lengths. `isWeakerThan` is true when a keystore has less memory than the given parameters, or the same memory and fewer passes. A keystore never moves to less memory: one written with the desktop preset and opened in a browser keeps its 256 MiB.

## Secrets in memory

- Phrases and passwords may be `string` or UTF-8 `Uint8Array`. Arrays are overwritten with zeros once used, whatever the outcome, including a refusal before any work; the SDK's own copies, in JavaScript and in WebAssembly memory, are wiped too. A JavaScript string cannot be wiped, so keep a password in a `Uint8Array` where the app can.
- Argon2id blocks the thread it runs on for about a second with the web preset. Run the keystore in a Web Worker (or the Manifest V3 service worker) to keep a page responsive; the worker loads the module with `initSync` as the [Manifest V3 quickstart](quickstart/mv3-extension.md) shows.

## Errors

The keystore's errors are `IceRootError`s; their classes are exported by `@iceroot-network/sdk/keystore`, since some of the names are general.

| Code | When | `details` |
|---|---|---|
| `WrongPasswordOrCorrupt` | A wrong password, or any change to the keystore | |
| `Malformed` | Not a keystore of a known layout, or not its text form | `reason`: `magic`, `truncated`, `payload-length`, `length`, `armor-prefix`, `armor-encoding`, `armor-length` |
| `UnsupportedVersion` | A format version this release does not read | `version` |
| `UnsupportedKdf` | A key derivation function this release does not know | `kdf` |
| `UnsupportedPayload` | A payload kind this release does not open (the post-quantum key seed arrives later) | `kind` |
| `ParamsOutOfRange` | Parameters outside the bounds, or above `maxMemoryKib` | `param` (`memory`, `iterations`, `parallelism`, `work`), `value`, `minimum`, `maximum` |
| `InvalidPayload` | Secret material of the wrong length for its kind | `kind`, `length` |
| `InvalidPassword` | An empty or too long password | `reason` (`empty`, `too-long` with `bytes` and `maximum`) |
| `OutOfMemory` | The platform could not give Argon2id the memory it needs | `memoryKib` |

A failing random generator raises the core's `RandomnessUnavailable`, and a phrase keys are not made from raises `InvalidPhrase` or `PhraseTooShort`.

## In a classic script

The classic-script build carries the keystore as the namespace `keystore` of its global: `IceRootSdk.keystore.encrypt(phrase, password, "web")`, `IceRootSdk.keystore.decrypt(stored, password)` and so on.
