# Quickstart: Tauri 2 desktop and mobile

Tauri apps (the desktop wallet on Linux and macOS, the mobile wallet on Android and iOS) use the SDK in one of two ways. Both have the same TypeScript interface, so an app is wired once.

| | WebAssembly in the webview | Native plugin |
|---|---|---|
| Release | 0.1.0 | A later release |
| Where keys and signing run | WebAssembly inside the webview | Rust, outside the webview |
| Node requests | Through Rust with the Tauri HTTP plugin's `fetch`, or from the webview | Rust |
| Import | `@iceroot-network/sdk` | `@iceroot-network/sdk/tauri` |
| CSP change | `'wasm-unsafe-eval'` | None |
| Keystore (encrypted keys on disk) | No | Yes |

Start with the WebAssembly path; switching to the plugin changes the import and the plugin registration, not the app's calls.

Requirements: the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platforms, Node.js 22 or later, and a devnet (see [Devnet](../devnet.md)).

## 1. Install and configure Vite

Follow steps 1 to 3 of the [Vite and React quickstart](vite-react.md): install the tarball, exclude the SDK from `optimizeDeps`, and call `init()` before the first render.

## 2. Allow WebAssembly in the webview's CSP

Add `'wasm-unsafe-eval'` to `script-src` in both `csp` and `devCsp` of `src-tauri/tauri.conf.json`. Keep everything else:

<!-- sample: verified 0.1.0 -->
```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; form-action 'none'"
    }
  }
}
```

- **Older WebKit.** `'wasm-unsafe-eval'` is recognised by WebKit from Safari 16 on. A macOS 11 system (the desktop wallet's minimum) or an iOS 15 device (the mobile wallet's minimum) may have an older WebKit that refuses to compile the module under this CSP. If the SDK's WebKit check confirms this, the fallback for those systems is `'unsafe-eval'` in `script-src`, which also allows JavaScript `eval`; the native plugin removes the question. Do not add `'unsafe-eval'` before the check says so.
- **Android.** The system WebView is updated with Chrome, which recognises `'wasm-unsafe-eval'` from version 97 on.

## 3. Send node requests through Rust

Route the SDK's requests through the Tauri HTTP plugin. Requests then leave from Rust: the webview's `connect-src` stays unchanged, and the mobile platforms' web security rules do not apply to them.

<!-- sample: plain -->
```sh
npm install @tauri-apps/plugin-http
cd src-tauri && cargo add tauri-plugin-http && cd ..
```

Register the plugin:

<!-- sample: plain -->
```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
```

Allow exactly the devnet URLs the app uses, in a capability file (`src-tauri/capabilities/main.json`, listed in `app.security.capabilities` of `tauri.conf.json`):

<!-- sample: plain -->
```json
{
  "identifier": "main",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "http://127.0.0.1:6003/api/*" },
        { "url": "https://<devnet host>/api/*" }
      ]
    }
  ]
}
```

Pass the plugin's `fetch` as the transport:

<!-- sample: verified 0.1.0 -->
```ts
// src/network.ts
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

The browser preview (`npm run dev` in a normal browser) has no Tauri plugin. It falls back to `fetch`, which needs the devnet's origin in the page's `connect-src` and works only with a devnet that answers CORS (a local one does).

## 4. Desktop

- Store the pinned network identity and the app's settings with the app's existing storage. Never store a phrase or key there: release 0.1.0 has no keystore, so a desktop wallet holds keys for the session only (the holder enters the phrase each time) until the native plugin and keystore arrive.
- Everything else is the Vite and React pattern: build drafts, render `draft.summary` on the review screen, sign, submit, follow.

## 5. Mobile

- **HTTPS.** Phones and emulators use the hosted devnet endpoint over HTTPS (see [Devnet](../devnet.md#the-hosted-devnet-endpoint)). The Android emulator reaches the host machine at `10.0.2.2`; the iOS simulator at `127.0.0.1`.
- **No keys in the webview on mobile.** The mobile wallet's architecture requires a reviewed native key vault before any create or import control exists. With release 0.1.0, a mobile app wires the read side (balances, history, validators, watch-only accounts) and can build drafts to show real fees; creating, importing and signing wait for the native plugin and keystore.
- **Capabilities.** A mobile app without a capabilities file must add one (step 3) for the HTTP plugin.

## 6. Later: the native plugin

When the native plugin is released, the app registers it and imports the Tauri entry point. The calls stay the same; keys and signing move to Rust, and node requests are made by the plugin.

<!-- sample: later; needs: tauri-plugin-iceroot -->
```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_iceroot::init())
```

<!-- sample: later; needs: sdk/tauri, tauri-plugin-iceroot, keystore -->
```ts
import { connect, profiles, Keystore } from "@iceroot-network/sdk/tauri";

const net = await connect(profiles.devnet({ relays: [relay], nethash }));   // requests from Rust; no transport needed
const stored = await Keystore.create(phrase, password);                       // encrypted by the plugin; the app stores the bytes
const account = await net.keys.fromKeystore(stored, password, { account: 0, index: 0 });
```

With the plugin, remove `'wasm-unsafe-eval'` from the CSP and the HTTP plugin if nothing else uses them.
