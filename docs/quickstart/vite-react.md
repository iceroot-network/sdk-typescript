# Quickstart: Vite and React wallet

A small React wallet page: restore an account from a phrase, show its balance and history, send a transfer through a review screen and follow it to a block. The desktop and mobile wallets use the same pattern inside Tauri; see the [Tauri quickstart](tauri.md) for the settings a webview adds.

Requirements: Node.js 22 or later, and a devnet (see [Devnet](../devnet.md)).

## 1. Create the project

<!-- sample: pending; needs: release-tarball -->
```sh
npm create vite@latest iceroot-wallet -- --template react-ts
cd iceroot-wallet
npm install
npm install https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz
```

## 2. Configure Vite

Vite's dependency pre-bundling rewrites the module and breaks the URL of its `.wasm` file. Exclude the SDK from it:

<!-- sample: pending; needs: web-build-vite -->
```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["@iceroot-network/sdk"] },
});
```

If the page sets a Content Security Policy, `script-src` needs `'wasm-unsafe-eval'`, and `connect-src` needs the devnet's origin:

<!-- sample: plain -->
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' http://127.0.0.1:6003; object-src 'none'; base-uri 'none'">
```

## 3. Load the SDK and connect once

Load the module before the first render, and share one connected network through a context:

<!-- sample: pending; needs: init, connect, profiles.devnet, net.profile -->
```tsx
// src/network.tsx
import { createContext, useContext } from "react";
import { init, connect, profiles, type Network } from "@iceroot-network/sdk";

const NETHASH_KEY = "iceroot.devnet.nethash";   // public network identity, not a secret

export async function openNetwork(): Promise<Network> {
  await init();
  const net = await connect(profiles.devnet({
    relays: [import.meta.env.VITE_ICEROOT_RELAY ?? "http://127.0.0.1:6003/api"],
    nethash: localStorage.getItem(NETHASH_KEY) ?? undefined,
  }));
  localStorage.setItem(NETHASH_KEY, net.profile.chain.nethash);
  return net;
}

export const NetworkContext = createContext<Network | null>(null);
export function useNetwork(): Network {
  const net = useContext(NetworkContext);
  if (!net) throw new Error("useNetwork outside NetworkContext");
  return net;
}
```

<!-- sample: pending; needs: init, connect, IceRootError -->
```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IceRootError } from "@iceroot-network/sdk";
import { NetworkContext, openNetwork } from "./network";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);
openNetwork().then(
  (net) => root.render(
    <StrictMode>
      <NetworkContext.Provider value={net}><App /></NetworkContext.Provider>
    </StrictMode>,
  ),
  (error) => root.render(
    <p role="alert">
      {error instanceof IceRootError && error.code === "NetworkMismatch"
        ? "The devnet was reset. Clear its saved identity to continue."
        : "The network is unavailable. Reload to try again."}
    </p>,
  ),
);
```

## 4. Restore an account

For this quickstart the phrase is held in memory for the session only. A real wallet stores keys encrypted (see [rules](../rules.md#security-notes)).

<!-- sample: pending; needs: Mnemonic.check, net.keys.fromPhrase, account.release, Account -->
```tsx
// src/Restore.tsx
import { useState } from "react";
import { Mnemonic, type Account } from "@iceroot-network/sdk";
import { useNetwork } from "./network";

export function Restore({ onAccount }: { onAccount: (account: Account) => void }) {
  const net = useNetwork();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  function restore() {
    const check = Mnemonic.check(text);
    if (!check.ok) return setProblem(`This phrase is not valid (${check.reason}).`);
    onAccount(net.keys.fromPhrase(text.trim(), { account: 0, index: 0 }));
    setText("");
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); restore(); }}>
      <label>Recovery phrase (18, 21 or 24 words)
        <textarea value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <button type="submit">Restore</button>
    </form>
  );
}
```

## 5. Balance and history

<!-- sample: pending; needs: net.accounts.get, net.history.forAccount, Amount.format, TxRecord -->
```tsx
// src/Overview.tsx
import { useEffect, useState } from "react";
import { Amount, type TxRecord } from "@iceroot-network/sdk";
import { useNetwork } from "./network";

export function Overview({ address }: { address: string }) {
  const net = useNetwork();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([net.accounts.get(address), net.history.forAccount(address, { page: 1, limit: 20 })])
      .then(([info, page]) => { if (live) { setBalance(info.balances.get(net.token.assetId) ?? 0n); setHistory(page.items); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [net, address]);
  if (failed) return <p role="alert">The network is unavailable. Try again in a moment.</p>;
  if (balance === null) return <p>Loading</p>;
  const { decimals, symbol } = net.token;
  return (
    <section>
      <h2>{Amount.format(balance, decimals, { grouping: true })} {symbol}</h2>
      <ul>
        {history.map((tx) => (
          <li key={tx.id}>{tx.kind} {tx.direction} {tx.status === "pending" ? "pending" : `block ${tx.height}`} fee {Amount.format(tx.fee, decimals)} {symbol}</li>
        ))}
      </ul>
    </section>
  );
}
```

## 6. Send with a review screen

The form builds a draft; the review screen shows the draft; only the confirm button signs.

<!-- sample: pending; needs: Address.check, Amount.parse, net.build.transfer, fee-floor, draft.summary, draft.sign, net.submit, net.transactions.wait, IceRootError, Draft, Account -->
```tsx
// src/Send.tsx
import { useState } from "react";
import { Address, Amount, IceRootError, type Account, type Draft } from "@iceroot-network/sdk";
import { useNetwork } from "./network";

export function Send({ account }: { account: Account }) {
  const net = useNetwork();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const { decimals, symbol } = net.token;

  async function review() {
    setMessage("");
    const address = Address.check(to, net);
    if (!address.ok) return setMessage(`Check the address (${address.reason}).`);
    try {
      setDraft(await net.build.transfer({
        from: account.address,
        to: [{ address: Address.parse(to, net), amount: Amount.parse(amount, decimals) }],
        memo,
      }));
    } catch (error) {
      setMessage(error instanceof IceRootError ? error.message : "Could not prepare the transfer.");
    }
  }

  async function confirm() {
    if (!draft) return;
    try {
      const signed = draft.sign(account);
      const result = await net.submit(signed);
      if (result.status !== "accepted") return setMessage(`The network refused the transfer (${result.reason}).`);
      setMessage("Submitted. Waiting for a block.");
      const status = await net.transactions.wait(signed.id, { until: "confirmed" });
      setMessage(`Confirmed in a block (${status.confirmations} confirmation). Not final: this devnet has no finality.`);
    } catch (error) {
      setMessage(error instanceof IceRootError && error.code === "StaleDraft" ? "The network changed. Review the transfer again." : "The transfer failed.");
    } finally {
      setDraft(null);
    }
  }

  if (draft) {
    return (
      <section>
        <h2>Review transfer</h2>
        <pre>{JSON.stringify(draft.summary, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}</pre>
        <p>Fee: {Amount.format(draft.fee, decimals)} {symbol}</p>
        <button onClick={confirm}>Sign and send</button>
        <button onClick={() => setDraft(null)}>Edit</button>
      </section>
    );
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); void review(); }}>
      <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="Recipient address" spellCheck={false} />
      <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={`Amount in ${symbol}`} inputMode="decimal" />
      <input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Memo (optional)" />
      {message && <p role="status">{message}</p>}
      <button type="submit">Review</button>
    </form>
  );
}
```

A real review screen renders the summary's fields (recipients with amounts, total, fee, memo) instead of JSON.

## 7. Put it together

<!-- sample: pending; needs: account.release, Account -->
```tsx
// src/App.tsx
import { useEffect, useState } from "react";
import type { Account } from "@iceroot-network/sdk";
import { Restore } from "./Restore";
import { Overview } from "./Overview";
import { Send } from "./Send";

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => () => account?.release(), [account]);
  if (!account) return <Restore onAccount={setAccount} />;
  return (
    <main>
      <p>{account.address}</p>
      <Overview address={account.address} />
      <Send account={account} />
      <button onClick={() => setAccount(null)}>Lock</button>
    </main>
  );
}
```

Run `npm run dev`, restore a devnet account that holds some ROOT (fund one with the [Node quickstart](node.md)), and send a transfer. The screen ends with the transfer confirmed in a block.
