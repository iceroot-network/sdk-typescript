# Quickstart: Tauri 2 desktop and mobile

Tauri apps (the desktop wallet on Linux and macOS, the mobile wallet on Android and iOS) use the SDK through its native plugin, `tauri-plugin-iceroot`, and the package's Tauri entry, `@iceroot-network/sdk/tauri`. The entry has the same interface as the WebAssembly entry; the plugin runs every call in Rust, outside the webview.

| | Native plugin (use this) | WebAssembly in the webview |
|---|---|---|
| Import | `@iceroot-network/sdk/tauri` | `@iceroot-network/sdk` |
| Where keys and signing run | Rust, in the plugin; the page holds opaque handles | WebAssembly inside the webview |
| Node requests | The plugin, with reqwest, to the relays the app's capabilities allow | Through Rust with the Tauri HTTP plugin's `fetch`, or from the webview |
| CSP change | None | `'wasm-unsafe-eval'` (and the node origins, without the HTTP plugin) |
| Keystore | Argon2id natively with the `"desktop"` or `"mobile"` preset, off the webview's thread; an account opens from a keystore without the phrase entering the page | The `"web"` preset in the webview |
| Calls that compute | Return promises (they cross Tauri's IPC) | Return their result |

Requirements: the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platforms, Node.js 22 or later, read access to `heartwood-core` for the Rust build (see [Installation](../installation.md#rust)), and a devnet (see [Devnet](../devnet.md)). The repository's [Tauri example](../../examples/tauri-plugin/README.md) is a working application of this page.

## 1. Add the plugin

In `src-tauri/Cargo.toml`, at the release tag of sdk-rust that matches the package:

<!-- sample: pending; needs: rust-release-tag -->
```toml
[dependencies]
tauri-plugin-iceroot = { git = "https://github.com/iceroot-network/sdk-rust.git", tag = "v0.1.0" }
```

Add `git-fetch-with-cli = true` under `[net]` in `src-tauri/.cargo/config.toml`, as for any Rust app on the SDK ([Installation](../installation.md#rust)). Register the plugin:

<!-- sample: plain -->
```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_iceroot::init())
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
```

## 2. Grant the plugin and the relays

The app's capability grants the plugin's commands (`iceroot:default`, every command but `net_connect`) and names the relays the plugin may reach, as the `allow` scope of `iceroot:allow-net-connect`. The page needs no other permission for the SDK; add Tauri's own (`core:default` and the like) only for what the page uses itself. No relay is reachable until an entry names it. An entry is a relay URL with its API base path; `*` matches any run of characters other than `/`. The plugin follows no redirect: a relay that answers with one counts as unavailable, and the next relay is tried.

<!-- sample: plain -->
```json
{
  "identifier": "main",
  "windows": ["main"],
  "permissions": [
    "iceroot:default",
    {
      "identifier": "iceroot:allow-net-connect",
      "allow": [
        { "url": "http://127.0.0.1:6003/api" },
        { "url": "https://<devnet host>/api" }
      ]
    }
  ]
}
```

List the capability in `app.security.capabilities` of `tauri.conf.json` (a mobile app without a capabilities file adds one now). A relay the capability does not allow is refused with `InvalidProfile` (`details.reason: "not-allowed"`) before any request. A capability without `iceroot:allow-net-connect` makes Tauri refuse `connect` itself, which the page sees as `SdkNotInitialized`. Never grant `iceroot` permissions in a capability with a `remote` entry: the plugin's handles are safe only when every page and frame of the webview is the app's own code.

## 3. Keep the content security policy strict

The page loads no WebAssembly and reaches no node, so the policy needs neither `'wasm-unsafe-eval'` nor a node origin. The IPC origins are all `connect-src` needs:

<!-- sample: verified 0.1.0 -->
```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; form-action 'none'"
    }
  }
}
```

This also settles the older-WebKit question of the WebAssembly path (macOS 11 and iOS 15 may predate `'wasm-unsafe-eval'`): the plugin needs no `eval` of any kind.

## 4. Use the SDK from the page

Install the package as in [Installation](../installation.md) and import from `@iceroot-network/sdk/tauri`. Vite needs no `optimizeDeps` setting for this entry, since it loads no `.wasm` file. Call `init()` once at start-up: it checks that the page runs in a Tauri webview whose app registered and allows the plugin, and that the plugin is of the package's release (0.1.x with 0.1.x), and rejects with `SdkNotInitialized` otherwise.

<!-- sample: verified 0.1.0 -->
```ts
// src/network.ts
import { connect, init, profiles, type Network } from "@iceroot-network/sdk/tauri";

export async function openNetwork(relay: string, nethash?: string): Promise<Network> {
  await init();
  // The plugin makes every request; no transport is passed.
  return connect(profiles.devnet({ relays: [relay], nethash }));
}
```

Every call that computes returns a promise; await it. Values that need no call stay synchronous: profiles, a draft's summary and fee, an account's address and public key, `net.rules`, `net.economics` and `net.stage` at the next block, and the text forms of snapshots and selections. Code that awaits every SDK call runs unchanged on either entry: the error codes, the checks of `connect`'s options and the skipping of a relay that answers with a redirect are the same. What differs through the plugin:

- `init()` also rejects with `SdkNotInitialized` when the plugin is not of the package's release (0.1.x with 0.1.x). There is no `initSync`.
- `net.watch` with an address that is not valid on the network reports an `error` event (with that `InvalidAddress`) and ends the watch; the WebAssembly entry throws `InvalidAddress` at once.
- `NodeUnavailable` and `Timeout` carry no `details.url`: the WebAssembly entry names the relay's URL there, and the plugin names none (its `NodeUnavailable` has `details.reason` instead). Branch on the error's class or `code`.
- `connect` takes no `transport`: the plugin makes every request, through a proxy only when the app's environment names one (`HTTP_PROXY`, `HTTPS_PROXY` or `ALL_PROXY`).
- Error messages are worded differently in places; the codes and the documented details are the interface.

<!-- sample: verified 0.1.0 -->
```ts
// src/send.ts
import { Address, Amount, type Account, type Network } from "@iceroot-network/sdk/tauri";

export async function sendRoot(net: Network, account: Account, to: string, amount: string) {
  const draft = await net.build.transfer({
    from: account,
    to: [{ address: await Address.parse(to.trim(), net), amount: await Amount.parse(amount, net.token.decimals) }],
  });
  // The review screen shows draft.summary; then the plugin signs what it reads from the draft's bytes.
  const signed = await draft.sign(account);
  const result = await net.submit(signed);
  if (result.status !== "accepted") return { state: "rejected" as const, reason: result.reason };
  return { state: (await net.transactions.wait(signed.id, { until: "confirmed" })).state };
}
```

## 5. Keys and the keystore

Create a phrase, show it once to be written down, encrypt it with the platform's preset, and keep the keystore's bytes (or their `irks:` text) in the app's storage. Afterwards open the account straight from the keystore: the plugin decrypts it and derives the key, and the phrase never enters the page again.

<!-- sample: verified 0.1.0 -->
```ts
// src/wallet.ts
import { Mnemonic, type Account, type Network } from "@iceroot-network/sdk/tauri";
import { armor, encrypt } from "@iceroot-network/sdk/tauri/keystore";

/** A new wallet: the phrase to show once, and the keystore text to store. */
export async function createWallet(password: string, preset: "desktop" | "mobile") {
  const phrase = await Mnemonic.generate();
  const stored = await encrypt(phrase, password, preset);   // Argon2id in the plugin, off the webview
  return { phrase, keystore: await armor(stored) };
}

/** Unlocks the wallet's first account. */
export function unlock(net: Network, keystore: string, password: string): Promise<Account> {
  return net.keys.fromKeystore(keystore, password, { account: 0, index: 0 });
}
```

- `account.release()` wipes the key in the plugin. The plugin also wipes every key a page opened when the webview loads another page or its window closes, so lock by releasing and, if the product wants, by reloading the page. In a window with several webviews (Tauri's `unstable` multi-webview windows), closing one webview while the window stays open wipes nothing: release its keys first.
- A key belongs to the webview that opened it; another window of the app cannot use its handle.
- A phrase or password the page sends crosses Tauri's IPC, which nothing can wipe. Pass passwords as `Uint8Array` where the app can (the SDK overwrites them with zeros), and use `decrypt` only to show a phrase for a backup; an app that never does can deny it in its capability (`iceroot:deny-keystore-decrypt`).
- The vote library and the ownership proofs have their Tauri entries too: `@iceroot-network/sdk/tauri/vote` and `@iceroot-network/sdk/tauri/ownership`.

## 6. Desktop

- Store the pinned network identity, the settings and the keystore text with the app's existing storage. Never store a phrase or key there.
- Checked on Linux (WebKitGTK) with the SDK's test suites and the devnet scenario through the plugin. A macOS build needs a macOS machine; nothing in the plugin is platform-specific beyond Tauri itself.

## 7. Mobile

- **Relays.** Requests leave from the plugin's own HTTP client, so Android's cleartext rule and iOS App Transport Security, which govern the platform's HTTP stacks, do not stop plain HTTP; use the hosted devnet endpoint over HTTPS anyway for anything beyond a local emulator (see [Devnet](../devnet.md#the-hosted-devnet-endpoint)). The Android emulator reaches the host machine at `10.0.2.2`, the iOS simulator at `127.0.0.1`; allow those relay URLs in the capability.
- **TLS on Android.** On Android the plugin verifies HTTPS relays against the Mozilla root certificates built into it, not the device's certificate store, since the platform's verifier needs the app's Java environment. A relay with a certificate from a public authority works; one from a private or user-installed authority is refused. The roots are those of the `webpki-root-certs` version in the app's `Cargo.lock`, so a root Mozilla adds or distrusts later reaches the app only with a rebuild: run `cargo update -p webpki-root-certs` in `src-tauri` before each release. No certificate revocation is checked there, so a relay's revoked certificate is accepted until it expires.
- **Keys.** The plugin is the native boundary the mobile wallet's architecture requires before create and import controls exist. Use the `"mobile"` keystore preset and the platform's secure storage for the keystore text.
- **Builds.** The plugin builds for Android (`aarch64-linux-android`) with the Android NDK; it has not been run on a device or an emulator yet. An iOS build needs a macOS machine with Xcode.

## The WebAssembly path

The WebAssembly entry also works in a Tauri webview, for an app that is not ready to register the plugin or for a browser preview without Tauri. It needs `'wasm-unsafe-eval'` in `script-src` of `csp` and `devCsp` (WebKit before Safari 16 may refuse it; Android's WebView accepts it from Chrome 97), and node requests through the Tauri HTTP plugin (`@tauri-apps/plugin-http`, registered with `tauri_plugin_http::init()` and allowed with `http:default` for the devnet URLs):

<!-- sample: verified 0.1.0 -->
```ts
// src/network-wasm.ts
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "@tauri-apps/api/core";
import { init, connect, profiles, type Network } from "@iceroot-network/sdk";

export async function openNetwork(relay: string, nethash?: string): Promise<Network> {
  await init();
  return connect(profiles.devnet({ relays: [relay], nethash }), {
    transport: isTauri() ? tauriFetch : globalThis.fetch,   // the browser preview uses the webview's fetch
  });
}
```

Keys then live in WebAssembly memory inside the webview. The desktop and mobile wallets use the plugin: moving from this path changes the imports, adds `await` where the plugin returns promises, and removes `'wasm-unsafe-eval'` and the HTTP plugin if nothing else uses them.
