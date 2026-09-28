// The environment of the test suites (test/suites) in Node, through the WebAssembly builds: the
// published Node build, the test build, the browser build as a second module instance, Node's
// assertions, the files the suites read, and a recorded node the WebAssembly entry's transport
// reaches in the process.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { createBase58check } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import * as sdk from "../../dist/node/index.js";
import * as vote from "../../dist/node/vote.js";
import * as keystore from "../../dist/node/keystore.js";
import * as ownership from "../../dist/node/ownership.js";
import * as testSdk from "../../build/test/dist/node/index.js";
import * as webSdk from "../../dist/web/index.js";
import { recordedNode } from "../suites/recorded-node.js";
import { dist, root } from "./helpers.mjs";

const SDK_RUST = join(root, "..", "sdk-rust");
const FIXTURES = join(SDK_RUST, "crates", "iceroot-sdk-api", "tests", "fixtures", "devnet");

/** The text of a file of this repository (`ts/...`) or of sdk-rust next to it (`rs/...`). */
function read(path) {
  const [base, rest] = [path.slice(0, 3), path.slice(3)];
  const dir = base === "ts/" ? root : base === "rs/" ? SDK_RUST : undefined;
  if (dir === undefined) {
    throw new Error(`a suite's file is ts/... or rs/...: ${path}`);
  }
  return readFileSync(join(dir, rest), "utf8");
}

const fixtures = {
  index: JSON.parse(readFileSync(join(FIXTURES, "index.json"), "utf8")),
  text: (file) => readFileSync(join(FIXTURES, file), "utf8"),
};

/**
 * A recorded node reached through a transport in the process. `node(routes, vars)` gives the
 * relay to connect to, the connect options that reach it, and the node, whose `route`, `set` and
 * `requests` the suites use. Each call makes a node of its own.
 */
function node(routes = {}, vars = {}) {
  const recorded = recordedNode(fixtures);
  recorded.reset(routes, vars);
  const transport = async (url, init = {}) => {
    const parsed = new URL(url);
    assert.ok(parsed.pathname.startsWith("/api/"), url);
    const answer = recorded.answer({
      url,
      method: init.method ?? "GET",
      path: parsed.pathname.slice("/api".length),
      query: parsed.searchParams,
      headers: init.headers ?? {},
      body: init.body,
    });
    if (answer.hang) {
      return new Promise(() => {});
    }
    return new Response(answer.status === 204 ? null : answer.body, {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    });
  };
  return {
    relay: "http://127.0.0.1:4003/api",
    options: { transport },
    route: async (key, value) => recorded.route(key, value),
    set: async (values) => recorded.set(values),
    requests: async () => recorded.requests(),
  };
}

/**
 * Relays for the failover tests: one that cannot be reached, one that answers every request with a
 * server error, one that answers every request with a redirect to another host, and a recorded
 * node, all through one transport that notes the host of each request (and what the SDK asked of
 * redirects, for the one that answers with them).
 */
async function relays() {
  const working = node();
  const tried = [];
  const redirectModes = [];
  const transport = async (url, init = {}) => {
    tried.push(new URL(url).host);
    if (url.startsWith("http://down.example")) {
      throw new TypeError("fetch failed");
    }
    if (url.startsWith("http://busy.example")) {
      return new Response(JSON.stringify({ statusCode: 503, error: "Service Unavailable", message: "busy" }), { status: 503 });
    }
    if (url.startsWith("http://moved.example")) {
      redirectModes.push(`${init.redirect}/${init.maxRedirections}`);
      return new Response(null, { status: 307, headers: { location: url.replace("moved.example", "target.example") } });
    }
    if (url.startsWith("http://target.example")) {
      throw new Error("the redirect was followed");
    }
    return working.options.transport(url.replace(/^http:\/\/[^/]+/, "http://127.0.0.1:4003"), init);
  };
  return {
    down: "http://down.example/api",
    busy: "http://busy.example/api",
    moved: "http://moved.example/api",
    working: working.relay,
    options: { transport },
    tried: async () => tried,
    busyRequests: async () => tried.filter((host) => host === "busy.example").length,
    movedRequests: async () => tried.filter((host) => host === "moved.example").length,
    targetRequests: async () => tried.filter((host) => host === "target.example").length,
    redirectModes: async () => redirectModes,
  };
}

/** The environment of the suites through the WebAssembly builds. */
export async function nodeEnv() {
  await webSdk.init(readFileSync(join(dist, "web", "iceroot_sdk_bg.wasm")));
  return {
    kind: "wasm",
    sdk,
    vote,
    keystore,
    ownership,
    testSdk,
    // A second module instance, for a draft built in one and signed in another.
    otherSdk: webSdk,
    assert,
    read: async (path) => read(path),
    // Independent implementations the suites check the SDK against.
    noble: { schnorr, secp256k1, ripemd160, sha256, bytesToHex, hexToBytes, utf8ToBytes, createBase58check },
    scure: { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic, wordlist, HDKey },
    node,
    relays,
    // How much slower than in the process a round trip to the node is.
    slow: 1,
    // What only the WebAssembly entry has: loading the module, its memory, the default transport.
    wasm: true,
  };
}
