#!/usr/bin/env node
// The differential test: 10,000 random cases through the bindings compiled natively and through
// the WebAssembly build behind the TypeScript wrapper, which must give the same results byte for
// byte, errors (code and details) included.
//
//   node scripts/check-differential.mjs [--cases N] [--seed TEXT]
//
// The cases are recovery phrases of every length (valid, too short or with a bad checksum) with
// passphrases and hardened paths; legacy passphrase keys with message signatures; amounts parsed
// and formatted at every number of decimals; addresses of this network, of others and with typos;
// transfers to 1 to 256 recipients with memos around the 255-byte limit; and votes of 0 to 55
// entries with valid and invalid names and shares. Signatures take each case's fixed auxiliary
// bytes. The native side is wasm/examples/differential.rs; the WebAssembly side is the test build
// (npm run build:test), which can sign with chosen auxiliary bytes.
//
// The cases come from a SHA-256 counter stream of the seed, so a run is reproducible.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { wordlist } from "@scure/bip39/wordlists/english.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: options } = parseArgs({
  options: { cases: { type: "string", default: "10000" }, seed: { type: "string", default: "iceroot-sdk differential" } },
});
const TOTAL = Number(options.cases);
const RELAY = "http://127.0.0.1:4003/api";

const sdk = await import(join(root, "build", "test", "dist", "node", "index.js"));
if (!sdk.testing.hasFixedAux()) {
  fail("the test build has no reproducible signatures: run npm run build:test");
}

function fail(message) {
  console.error(`check-differential: ${message}`);
  process.exit(1);
}

// ---- a reproducible stream of random numbers ----------------------------------------------------

let counter = 0;
let pool = Buffer.alloc(0);
function bytes(n) {
  while (pool.length < n) {
    pool = Buffer.concat([pool, createHash("sha256").update(`${options.seed}/${counter++}`).digest()]);
  }
  const out = pool.subarray(0, n);
  pool = pool.subarray(n);
  return Buffer.from(out);
}
const int = (n) => bytes(4).readUInt32BE(0) % n;
const chance = (percent) => int(100) < percent;
const pick = (list) => list[int(list.length)];
const bigint = (maxBits) => BigInt(`0x${bytes(Math.ceil(maxBits / 8)).toString("hex")}`) >> BigInt(Math.ceil(maxBits / 8) * 8 - maxBits);

const TEXTS = ["", "a", "IceRoot", "✓", "冰根", "\u{1F332}", " ", "\n", "café", "é", "0123456789", " x", "Z"];
function randomText(maxUnits) {
  let out = "";
  const n = int(maxUnits + 1);
  for (let i = 0; i < n; i++) {
    out += pick(TEXTS);
  }
  return out;
}

// ---- the cases ------------------------------------------------------------------------------------

const profile = sdk.profiles.devnet({ relays: [RELAY] });
const chain = sdk.Chain.load(profile, readFileSync(join(root, "wasm", "examples", "devnet-configuration.json"), "utf8"));
const addressFor = (text, network = 90) =>
  sdk.Keys.fromLegacyPassphrase(text, network === 90 ? profile : sdk.profiles.devnet({ relays: [RELAY], networkByte: network })).address;
const ADDRESSES = Array.from({ length: 64 }, (_, i) => addressFor(`differential recipient ${i}`));
const OTHER_NETWORKS = [30, 63].map((network) => addressFor("differential elsewhere", network));
const SIGNERS = Array.from({ length: 8 }, (_, i) => `differential signer ${i}`);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function phraseCase() {
  const lengths = [12, 15, 18, 21, 24];
  const words = pick(lengths);
  // A valid phrase: the SDK's own generator cannot be seeded, so the checksum is made here.
  const entropy = bytes((words / 3) * 4);
  const hash = createHash("sha256").update(entropy).digest();
  const bits = [...entropy, hash[0]].map((b) => b.toString(2).padStart(8, "0")).join("").slice(0, words * 11);
  let phrase = Array.from({ length: words }, (_, i) => wordlist[Number.parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
  if (chance(10)) {
    phrase[int(words)] = pick(wordlist); // usually breaks the checksum
  } else if (chance(5)) {
    phrase[int(words)] = "iceroot"; // not a word of the list
  } else if (chance(5)) {
    phrase = phrase.slice(0, words - 1);
  }
  const separator = chance(20) ? pick(["  ", "\n", "\t", " 　"]) : " ";
  const text = (chance(10) ? phrase.map((w) => w.toUpperCase()) : phrase).join(separator);
  return {
    kind: "phrase",
    phrase: chance(10) ? ` ${text} ` : text,
    passphrase: chance(60) ? "" : randomText(6),
    account: chance(80) ? int(10) : int(0x80000000),
    index: chance(80) ? int(100) : int(0x80000000),
  };
}

function legacyCase() {
  return { kind: "legacy", passphrase: randomText(12), message: randomText(40), aux: bytes(32).toString("hex") };
}

function amountCase() {
  const decimals = chance(70) ? pick([0, 2, 8, 18]) : int(39);
  let text = String(bigint(pick([8, 32, 64, 96, 128, 140]))).replace(/^0+(?=\d)/, "");
  const fraction = int(decimals + 4);
  if (fraction > 0 && chance(70)) {
    text += `.${bigint(64).toString().padStart(fraction, "0").slice(0, fraction)}`;
  }
  if (chance(8)) {
    text = pick(["", ".", "1.", ".5", "-1", "+1", "1e8", " 1", "1 ", "0x10", "1,000", "١", "00.1", "007"]);
  }
  const units = String(bigint(pick([1, 8, 40, 64, 100, 128])));
  return {
    kind: "amount",
    text,
    decimals,
    units,
    maxFraction: chance(50) ? null : int(40),
    grouping: chance(50),
  };
}

function addressCase() {
  let text = pick(ADDRESSES);
  switch (int(8)) {
    case 0:
      text = pick(OTHER_NETWORKS);
      break;
    case 1: {
      const at = int(text.length);
      text = text.slice(0, at) + pick([...BASE58]) + text.slice(at + 1);
      break;
    }
    case 2:
      text = text.slice(0, int(text.length));
      break;
    case 3:
      text = `${text}${pick([...BASE58])}`;
      break;
    case 4:
      text = pick(["", "0", "dOIl", " " + text, "tice1qqqq", text.toLowerCase()]);
      break;
    default:
      break;
  }
  return { kind: "address", text };
}

function feeWire() {
  if (chance(5)) {
    return { kind: "minimum" };
  }
  return { kind: "exact", amount: String(chance(5) ? 0n : chance(3) ? (1n << 64n) + bigint(8) : 1n + bigint(34)) };
}

function draftFacts(caseObject) {
  const second = chance(20) ? pick(SIGNERS) : undefined;
  return {
    ...caseObject,
    signer: pick(SIGNERS),
    ...(second === undefined ? {} : { secondSigner: `${second} second` }),
    nonce: String(chance(3) ? (1n << 64n) + 1n : chance(10) ? 0n : 1n + bigint(40)),
    height: 1 + int(100000),
    aux: bytes(32).toString("hex"),
  };
}

function memoWire() {
  if (chance(30)) {
    return null;
  }
  if (chance(20)) {
    const unit = pick(["m", "✓", "\u{1F332}", "é"]);
    const size = Buffer.byteLength(unit);
    return unit.repeat(Math.floor((pick([254, 255, 256, 257]) + size - 1) / size));
  }
  return randomText(30);
}

function transferCase() {
  const count = chance(3) ? pick([0, 256, 257]) : 1 + int(chance(80) ? 3 : 40);
  const to = Array.from({ length: count }, () => ({
    address: chance(2) ? pick(OTHER_NETWORKS) : pick(ADDRESSES),
    amount: String(chance(3) ? 0n : chance(2) ? (1n << 64n) : 1n + bigint(chance(50) ? 30 : 62)),
  }));
  return draftFacts({ kind: "transfer", request: { operation: { kind: "transfer", to }, memo: memoWire(), fee: feeWire() } });
}

function voteCase() {
  const count = chance(10) ? 0 : chance(5) ? pick([53, 54, 55]) : 1 + int(25);
  const names = Array.from({ length: count }, (_, i) => {
    if (chance(3)) {
      return pick(["", "Genesis_1", "_lead", "12345", "a".repeat(21), "café", "has space", `genesis_${i}`]);
    }
    return `genesis_${1 + ((i * 7 + int(3)) % 60)}`;
  });
  const even = count === 0 ? [] : names.map((_, i) => Math.trunc(10000 / count) + (i < 10000 % count ? 1 : 0));
  const shares = chance(85) ? even : names.map(() => int(chance(50) ? 10001 : 600));
  const entries = names.map((validator, i) => ({ validator, basisPoints: shares[i] }));
  return draftFacts({ kind: "vote", request: { operation: { kind: "vote", entries }, memo: chance(80) ? null : randomText(10), fee: feeWire() } });
}

const MIX = [
  [phraseCase, 1500],
  [legacyCase, 1500],
  [amountCase, 2000],
  [addressCase, 1000],
  [transferCase, 2000],
  [voteCase, 2000],
];
const cases = [];
for (const [make, share] of MIX) {
  for (let i = 0; i < Math.round((share * TOTAL) / 10000); i++) {
    cases.push(make());
  }
}

// ---- the WebAssembly side, through the wrapper -------------------------------------------------

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function caught(fn) {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof sdk.IceRootError)) {
      throw error;
    }
    return { error: { code: error.code, details: { ...error.details } } };
  }
}

function wasmResult(c) {
  switch (c.kind) {
    case "phrase":
      return caught(() => {
        const account = sdk.Keys.fromPhrase(c.phrase, profile, { account: c.account, index: c.index, passphrase: c.passphrase });
        const result = { publicKey: account.publicKey, address: account.address, path: account.path ?? null };
        account.release();
        return result;
      });
    case "legacy":
      return caught(() => {
        const account = sdk.Keys.fromLegacyPassphrase(c.passphrase, profile);
        const signature = sdk.testing.signMessageWithAux(account, c.message, Buffer.from(c.aux, "hex"));
        const result = { publicKey: account.publicKey, address: account.address, signature };
        account.release();
        return result;
      });
    case "amount":
      return {
        parsed: caught(() => sdk.Amount.parse(c.text, c.decimals).toString()),
        formatted: caught(() =>
          sdk.Amount.format(BigInt(c.units), c.decimals, { ...(c.maxFraction === null ? {} : { maxFraction: c.maxFraction }), grouping: c.grouping }),
        ),
      };
    case "address":
      return caught(() => ({ bytes: Buffer.from(sdk.Address.parse(c.text, profile).bytes).toString("hex") }));
    case "transfer":
    case "vote": {
      const signer = sdk.Keys.fromLegacyPassphrase(c.signer, profile);
      const second = c.secondSigner === undefined ? undefined : sdk.Keys.fromLegacyPassphrase(c.secondSigner, profile);
      const wire = c.request.operation;
      const operation =
        wire.kind === "transfer"
          ? { kind: "transfer", to: wire.to.map(({ address, amount }) => ({ address, amount: BigInt(amount) })) }
          : wire;
      const fee = c.request.fee.kind === "minimum" ? "minimum" : BigInt(c.request.fee.amount);
      const request = { operation, ...(c.request.memo === null ? {} : { memo: c.request.memo }), fee };
      const facts = { sender: signer, nonce: BigInt(c.nonce), height: c.height, ...(second === undefined ? {} : { secondKey: second.publicKey }) };
      const result = caught(() => {
        const draft = sdk.Draft.build(chain, request, facts);
        const signed = sdk.testing.signDraftWithAux(draft, signer, Buffer.from(c.aux, "hex"), second);
        return {
          unsigned: sha256(draft.unsignedBytes),
          size: draft.summary.size,
          fee: draft.summary.fee.amount.toString(),
          id: signed.id,
          bytes: sha256(signed.bytes),
        };
      });
      signer.release();
      second?.release();
      return result;
    }
    default:
      throw new Error(`no case kind ${c.kind}`);
  }
}

// ---- both sides ------------------------------------------------------------------------------------

const input = [JSON.stringify(profile), ...cases.map((c) => JSON.stringify(c))].join("\n") + "\n";
const native = execFileSync(
  "cargo",
  ["run", "--quiet", "--locked", "--release", "--example", "differential", "--features", "fixed-aux"],
  { cwd: join(root, "wasm"), input, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "inherit"] },
)
  .trimEnd()
  .split("\n");
if (native.length !== cases.length) {
  fail(`native Rust answered ${native.length} of ${cases.length} cases`);
}

const failures = [];
const tally = {};
for (const [i, c] of cases.entries()) {
  const ours = JSON.stringify(wasmResult(c));
  const code = /"code":"([A-Za-z]+)"/.exec(ours)?.[1];
  const outcome = code === undefined ? "done" : `refused ${code}`;
  tally[`${c.kind} ${outcome}`] = (tally[`${c.kind} ${outcome}`] ?? 0) + 1;
  if (ours !== native[i]) {
    failures.push({ case: i, input: c, native: native[i], webassembly: ours });
  }
}
console.log(`check-differential: ${cases.length} cases: ${JSON.stringify(tally)}`);
if (failures.length > 0) {
  for (const failure of failures.slice(0, 5)) {
    console.error(JSON.stringify(failure, null, 2));
  }
  fail(`${failures.length} of ${cases.length} cases differ between native Rust and WebAssembly`);
}
console.log("check-differential: native Rust and WebAssembly agree on every case");
