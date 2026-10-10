# Quickstart: Next.js explorer or portal

Next.js 15 apps use the SDK in two places: server code (route handlers and server components) with the Node build, and client components with the web build. This page builds a validators page read on the server, an address search box checked in the browser, and a wallet sign-in verified on the server.

An application can use a Rust backend to read the network. In that setup the Next.js side needs no SDK for reads: the backend uses the [Rust SDK](rust-backend.md) and Next.js keeps proxying `/api/v1/*`. Use this page for what runs in Next.js itself: client-side checks, and server routes where there is no Rust backend.

Requirements: Node.js 22 or later, Next.js 15 with the App Router, and a devnet (see [Devnet](../devnet.md)).

## 1. Install and configure

<!-- sample: pending; needs: release-tarball -->
```sh
npm install https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz
```

Keep the SDK out of the server bundle, so Node loads its Node build and `.wasm` file directly:

<!-- sample: verified 0.1.0 -->
```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@iceroot-network/sdk"],
};
export default nextConfig;
```

If the app sends a Content Security Policy header, add `'wasm-unsafe-eval'` to `script-src` for pages whose client components load the SDK.

## 2. One connection for server code

Route handlers that use the SDK run on the Node.js runtime, never the Edge runtime. Share one connection per server process:

<!-- sample: verified 0.1.0 -->
```ts
// lib/iceroot.server.ts
import "server-only";
import { connect, profiles, type Network } from "@iceroot-network/sdk";

let network: Promise<Network> | null = null;

export function iceroot(): Promise<Network> {
  network ??= connect(profiles.devnet({
    relays: [process.env.ICEROOT_RELAY ?? "http://127.0.0.1:6003/api"],
    nethash: process.env.ICEROOT_NETHASH,   // pin the devnet in deployment settings
  })).catch((error) => { network = null; throw error; });
  return network;
}

/** JSON cannot hold bigint: send base units as decimal strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}
```

## 3. A server route: validators

<!-- sample: verified 0.1.0 -->
```ts
// app/api/validators/route.ts
import { IceRootError } from "@iceroot-network/sdk";
import { iceroot, toJson } from "../../../lib/iceroot.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const net = await iceroot();
    const validators = await net.validators.list();
    return new Response(toJson({ data: validators, meta: { network: net.profile.id, stage: net.stage } }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof IceRootError ? error.code : "Unexpected";
    return Response.json({ error: { code, message: "The network is unavailable. Please try again." } }, { status: 503 });
  }
}
```

A server component can call `iceroot()` the same way and render the list directly.

## 4. A client component: address search

Client components load the web build with `init()`. Here a search box tells an address from a block height or a validator name, without a request:

<!-- sample: verified 0.1.0 -->
```tsx
// components/Search.tsx
"use client";
import { useEffect, useState } from "react";
import { init, Address, profiles } from "@iceroot-network/sdk";

// Used only for the address format; the browser never contacts the relay here.
const profile = profiles.devnet({
  relays: [process.env.NEXT_PUBLIC_ICEROOT_RELAY ?? "http://127.0.0.1:6003/api"],
  nethash: process.env.NEXT_PUBLIC_ICEROOT_NETHASH,
});

export function Search({ onSearch }: { onSearch: (kind: "address" | "height" | "name", value: string) => void }) {
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => { init().then(() => setReady(true)); }, []);
  function submit() {
    const value = text.trim();
    if (/^\d+$/.test(value)) return onSearch("height", value);
    if (ready && Address.check(value, profile).ok) return onSearch("address", value);
    onSearch("name", value.toLowerCase());
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Address, block height or validator" />
    </form>
  );
}
```

## 5. Wallet sign-in verified on the server

This example assumes a wallet provider at `window.iceroot` that offers `connect` and `signMessage`. The server builds a single-use challenge with `SignIn.build` and verifies the signature with `Messages.verify`. The wallet signs the challenge with `SignIn.sign`, which checks the requesting page's origin and the account; `Messages.sign` refuses sign-in text with `InvalidArgument`, including a lapsed challenge or another network's. The page needs no SDK for this; only the server does. Route files may export only handlers, so the helpers live in `lib/signin.server.ts`.

<!-- sample: verified 0.1.0 -->
```ts
// lib/signin.server.ts
import "server-only";
import { randomBytes } from "node:crypto";
import { Address, Messages, SignIn, messageAlgorithmOf, messageNetworkOf } from "@iceroot-network/sdk";
import { iceroot } from "./iceroot.server";

const ORIGIN = process.env.PUBLIC_ORIGIN!;   // for example https://validators.example

export async function issueChallenge(publicKey: string) {
  const net = await iceroot();
  const address = Address.fromPublicKey(publicKey, net).toString();   // refuses a key that is not a valid point
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
  const message = SignIn.build(
    { origin: ORIGIN, publicKey, nonce: randomBytes(32).toString("hex"), issuedAt, expiresAt },
    net,
  );
  // Store { message, publicKey, expiresAt } under a random challenge id, bound to this browser, usable once.
  return { message, address, network: messageNetworkOf(net), expiresAt: expiresAt.toISOString() };
}

export async function checkSignature(stored: { message: string; publicKey: string }, signature: string) {
  const net = await iceroot();
  return Messages.verify({
    message: stored.message, publicKey: stored.publicKey, signature,
    algorithm: messageAlgorithmOf(net), network: messageNetworkOf(net),
  }, net);
}
```

<!-- sample: verified 0.1.0 -->
```ts
// app/api/auth/challenge/route.ts
import { IceRootError } from "@iceroot-network/sdk";
import { issueChallenge } from "../../../../lib/signin.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { publicKey } = await request.json().catch(() => ({}));
  if (typeof publicKey !== "string") return Response.json({ error: "Send a public key." }, { status: 400 });
  try {
    return Response.json(await issueChallenge(publicKey), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof IceRootError && error.code === "InvalidKey") {
      return Response.json({ error: "This public key is not valid on this network." }, { status: 400 });
    }
    return Response.json({ error: "The network is unavailable. Please try again." }, { status: 503 });
  }
}
```

The page side is the provider call:

<!-- sample: plain -->
```ts
const identity = await window.iceroot.request({ method: "connect" });
const challenge = await post("/api/auth/challenge", { publicKey: identity.publicKey });
const proof = await window.iceroot.request({
  method: "signMessage",
  params: { message: challenge.message, publicKey: identity.publicKey, network: challenge.network },
});
await post("/api/auth/verify", { challengeId: challenge.challengeId, signature: proof.signature });
```

Keep the usual protections around the check: bind the challenge to the browser, store the exact message, consume it once, expire it after five minutes, and rate-limit.

## 6. Check it

Run `npm run dev` (Turbopack) and `npm run build && npm start` (webpack): both must load the SDK. Open `/api/validators`: the response lists the devnet's validators in rank order, with vote weights as decimal strings.
