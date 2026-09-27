# Quickstart: Manifest V3 extension

A Chromium extension with the three contexts the browser wallet has:

- a **wallet page** (an extension page) that talks to the network and builds drafts;
- a **sandbox page** that holds a key only while it signs, and has no network access at all (`connect-src 'none'`);
- a **service worker** that checks website sign-in messages with the SDK's parser.

The wallet page builds a transfer, the sandbox signs it from serialized bytes, and the wallet page submits it. The example ends with the transfer confirmed in a block.

Requirements: Node.js 22 or later, Chromium or Chrome 120 or later, and a devnet (see [Devnet](../devnet.md)).

## How each context loads the SDK

| Context | Build | Loading | Why |
|---|---|---|---|
| Wallet page | Classic script `iceroot-sdk.js` | `await IceRootSdk.init(url)` fetches the `.wasm` file | Extension pages may fetch their own files |
| Sandbox page | Classic script plus `iceroot-sdk-bytes.js` | `IceRootSdk.initSync(IceRootSdkWasmBytes)` | `connect-src 'none'` also blocks fetching the module |
| Service worker | `importScripts` of the same two files | `IceRootSdk.initSync(IceRootSdkWasmBytes)` | Synchronous compilation is allowed off the main thread |

All three need `'wasm-unsafe-eval'` in their Content Security Policy.

## 1. Project layout

<!-- sample: plain -->
```text
iceroot-mv3-quickstart/
  package.json
  scripts/copy-sdk.mjs
  extension/
    manifest.json
    background.js
    wallet.html
    wallet.js
    sandbox.html
    sandbox.js
    vendor/iceroot-sdk/      written by scripts/copy-sdk.mjs
```

<!-- sample: pending; needs: release-tarball -->
```sh
mkdir iceroot-mv3-quickstart && cd iceroot-mv3-quickstart
npm init -y
npm pkg set type=module scripts.build="node scripts/copy-sdk.mjs"
npm install https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz
```

## 2. Copy the SDK's files into the extension

An extension cannot load files from `node_modules`. Copy the classic-script build into the extension at build time:

<!-- sample: pending; needs: iife-build, embedded-bytes -->
```js
// scripts/copy-sdk.mjs
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.resolve("@iceroot-network/sdk/iife"));
const source = path.dirname(script);
const target = path.resolve("extension/vendor/iceroot-sdk");
await mkdir(target, { recursive: true });
for (const file of ["iceroot-sdk.js", "iceroot-sdk_bg.wasm", "iceroot-sdk-bytes.js"]) {
  await cp(path.join(source, file), path.join(target, file));
}
console.log(`Copied the SDK into ${target}`);
```

Add `extension/vendor/` to `.gitignore`, and run `npm run build` after every SDK upgrade.

## 3. Manifest

<!-- sample: pending; needs: mv3-wasm-csp -->
```json
{
  "manifest_version": 3,
  "name": "IceRoot SDK quickstart",
  "version": "0.1.0",
  "minimum_chrome_version": "120",
  "action": { "default_title": "Open the wallet" },
  "background": { "service_worker": "background.js" },
  "sandbox": { "pages": ["sandbox.html"] },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-src 'self'",
    "sandbox": "sandbox allow-scripts; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'none'; default-src 'none'"
  }
}
```

The service worker must be a classic worker (no `"type": "module"`), because the SDK's classic build is loaded with `importScripts`.

## 4. Sandbox page: keys only, no network

<!-- sample: pending; needs: mv3-wasm-csp -->
```html
<!-- extension/sandbox.html -->
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; object-src 'none'; base-uri 'none'">
<script src="vendor/iceroot-sdk/iceroot-sdk.js"></script>
<script src="vendor/iceroot-sdk/iceroot-sdk-bytes.js"></script>
<script src="sandbox.js"></script>
```

The sandbox answers three operations. `address` returns the address of a phrase. `review` returns the summary recomputed from the draft's bytes, so the approval screen shows what will really be signed. `sign` signs the same bytes with a key derived for this one operation and wipes it.

<!-- sample: pending; needs: initSync, embedded-bytes, iife-build, profile-structured-clone, Draft.deserialize, Keys.fromPhrase, draft.sign, signed.serialize, account.release -->
```js
// extension/sandbox.js
(function () {
  "use strict";
  const Sdk = globalThis.IceRootSdk;
  Sdk.initSync(globalThis.IceRootSdkWasmBytes);

  const toJson = (value) => JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)));

  // `profile` is the wallet page's net.profile, a plain object; the sandbox never contacts its relays.
  const ops = {
    address({ profile, phrase }) {
      const account = Sdk.Keys.fromPhrase(phrase, profile, { account: 0, index: 0 });
      try { return { address: account.address }; } finally { account.release(); }
    },
    review({ profile, draft }) {
      const parsed = Sdk.Draft.deserialize(draft, profile);   // refuses a draft for another network
      return { summary: toJson(parsed.summary), fee: parsed.fee.toString() };
    },
    sign({ profile, draft, phrase }) {
      const parsed = Sdk.Draft.deserialize(draft, profile);
      const account = Sdk.Keys.fromPhrase(phrase, profile, { account: 0, index: 0 });
      try {
        return { signed: parsed.sign(account).serialize() };
      } finally {
        account.release();
      }
    },
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;   // only the embedding wallet page may drive the sandbox
    const { __quickstart, id, op, args } = event.data || {};
    if (__quickstart !== 1 || !Object.hasOwn(ops, op)) return;
    let reply;
    try { reply = { __quickstart: 1, id, ok: true, result: ops[op](args) }; }
    catch (error) { reply = { __quickstart: 1, id, ok: false, error: String(error?.message ?? error) }; }
    event.source.postMessage(reply, "*");   // a sandbox page has an opaque origin
  });
})();
```

## 5. Wallet page: network, drafts and submission

<!-- sample: pending; needs: mv3-wasm-csp -->
```html
<!-- extension/wallet.html -->
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' http://127.0.0.1:6003; frame-src 'self'; object-src 'none'; base-uri 'none'">
<title>IceRoot SDK quickstart</title>
<form id="send">
  <label>Recovery phrase (devnet only) <input id="phrase" type="password" autocomplete="off"></label>
  <label>Recipient <input id="to" spellcheck="false"></label>
  <label>Amount <input id="amount" inputmode="decimal"></label>
  <button>Review</button>
</form>
<pre id="review"></pre>
<button id="confirm" hidden>Sign and send</button>
<p id="status" role="status"></p>
<iframe id="signer" src="sandbox.html" hidden></iframe>
<script src="vendor/iceroot-sdk/iceroot-sdk.js"></script>
<script src="wallet.js"></script>
```

Replace `http://127.0.0.1:6003` with your devnet's origin.

<!-- sample: pending; needs: init, iife-build, connect, profiles.devnet, net.profile, profile-structured-clone, net.build.transfer, fee-floor, draft.serialize, SignedTransaction.deserialize, net.submit, net.transactions.wait, Address.parse, Amount.parse, Amount.format, account.release -->
```js
// extension/wallet.js
(async function () {
  "use strict";
  const Sdk = globalThis.IceRootSdk;
  const $ = (id) => document.getElementById(id);
  const frame = $("signer");
  let sequence = 0;
  const pending = new Map();

  function sandbox(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      frame.contentWindow.postMessage({ __quickstart: 1, id, op, args }, "*");
    });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.data?.__quickstart !== 1) return;
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    event.data.ok ? entry.resolve(event.data.result) : entry.reject(new Error(event.data.error));
  });

  await Sdk.init(new URL("vendor/iceroot-sdk/iceroot-sdk_bg.wasm", location.href));   // or init(): it fetches the file next to the script
  const net = await Sdk.connect(Sdk.profiles.devnet({ relays: ["http://127.0.0.1:6003/api"] }));
  const profile = net.profile;   // sent to the sandbox with every operation
  const { decimals, symbol } = net.token;
  let draftBytes = null;

  $("send").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("status").textContent = "";
    try {
      // Keys exist only in the sandbox; the wallet page asks it for the address.
      const { address: from } = await sandbox("address", { profile, phrase: $("phrase").value });
      const draft = await net.build.transfer({
        from,
        to: [{ address: Sdk.Address.parse($("to").value.trim(), net), amount: Sdk.Amount.parse($("amount").value.trim(), decimals) }],
      });
      draftBytes = draft.serialize();
      const reviewed = await sandbox("review", { profile, draft: draftBytes });
      $("review").textContent = JSON.stringify(reviewed.summary, null, 2) + `\nFee: ${Sdk.Amount.format(BigInt(reviewed.fee), decimals)} ${symbol}`;
      $("confirm").hidden = false;
    } catch (error) {
      $("status").textContent = error.message;
    }
  });

  $("confirm").addEventListener("click", async () => {
    $("confirm").hidden = true;
    try {
      const { signed } = await sandbox("sign", { profile, draft: draftBytes, phrase: $("phrase").value });
      const transaction = Sdk.SignedTransaction.deserialize(signed, net.profile);
      const result = await net.submit(transaction);
      if (result.status !== "accepted") throw new Error(`Refused: ${result.reason}`);
      $("status").textContent = "Submitted. Waiting for a block.";
      const status = await net.transactions.wait(transaction.id, { until: "confirmed" });
      $("status").textContent = `Confirmed (${status.confirmations} confirmation). Not final: this devnet has no finality.`;
    } catch (error) {
      $("status").textContent = error.message;
    } finally {
      draftBytes = null;
    }
  });
})();
```

In a real wallet the phrase comes from an encrypted vault that the trusted page unlocks, and it is passed to the sandbox per operation, as the browser wallet does today. The address is stored with the account when it is created, so it is not derived again for every transfer.

## 6. Service worker: the sign-in check

<!-- sample: pending; needs: initSync, embedded-bytes, iife-build, profiles.devnet, offline-profile, SignIn.parse -->
```js
// extension/background.js
importScripts("vendor/iceroot-sdk/iceroot-sdk.js", "vendor/iceroot-sdk/iceroot-sdk-bytes.js");
IceRootSdk.initSync(IceRootSdkWasmBytes);
// Never contacted: the worker uses the profile only for the devnet's network name and address format.
const devnet = IceRootSdk.profiles.devnet({ relays: ["http://127.0.0.1:6003/api"] });

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("wallet.html") }));

// A content script on an allowed website would forward { type: "check-sign-in", message, publicKey, address };
// this example registers no content script, so the listener shows only the check itself.
chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (request?.type !== "check-sign-in" || !sender.origin) return false;
  try {
    const fields = IceRootSdk.SignIn.parse(request.message, devnet, {
      origin: sender.origin,   // the real requesting origin, never one the page claims
      publicKey: request.publicKey,
      address: request.address,
      now: new Date(),
    });
    reply({ ok: true, fields });
  } catch (error) {
    reply({ ok: false, error: error.message });
  }
  return false;
});
```

`importScripts` must run at the top level of the worker, during its first evaluation. The worker checks the message before it opens any approval screen; the sandbox signs only after the holder approves.

## 7. Load and run

1. Run `npm run build`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked** and select the `extension` folder.
3. Click the extension's toolbar button. Enter a funded devnet account's phrase (a 24-word phrase; see the [Node quickstart](node.md) to fund one), a recipient and an amount, then **Review** and **Sign and send**.

The page ends with the transfer confirmed in a block. Open the sandbox frame's console: it made no network request, and cannot.
