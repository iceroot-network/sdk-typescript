#!/usr/bin/env node
// The differential test: 10,000 random cases through the bindings compiled natively and through
// the WebAssembly build behind the TypeScript wrapper, which must give the same results byte for
// byte, errors (code and details) included; then 10,000 random vote snapshots through the vote
// library the same way.
//
//   node scripts/check-differential.mjs [--cases N] [--vote-cases N] [--seed TEXT]
//
// The cases are recovery phrases of every length (valid, too short or with a bad checksum) with
// passphrases and hardened paths; legacy passphrase keys with message signatures; amounts parsed
// and formatted at every number of decimals; addresses of this network, of others and with typos;
// transfers to 1 to 256 recipients with memos around the 255-byte limit; and votes of 0 to 55
// entries with valid and invalid names and shares. Signatures take each case's fixed auxiliary
// bytes. The native side is wasm/examples/differential.rs; the WebAssembly side is the test build
// (npm run build:test), which can sign with chosen auxiliary bytes.
//
// The vote cases are snapshots of 1 to 120 validators with random ranks, seats, statuses,
// production, penalties, declarations, payouts and heights (a few of them inconsistent, which the
// library refuses), each with a selection request in a random mode, number of picks, draw and vote
// rules; the selection is then checked against a changed snapshot, the snapshot evaluated by a
// random mode, a vote validated and names split. Every result is compared as canonical JSON, the
// reasons' sentences included. The native side is wasm/examples/vote_differential.rs.
//
// The cases come from a SHA-256 counter stream of the seed, so a run is reproducible.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { wordlist } from "@scure/bip39/wordlists/english.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: options } = parseArgs({
  options: {
    cases: { type: "string", default: "10000" },
    "vote-cases": { type: "string", default: "10000" },
    seed: { type: "string", default: "iceroot-sdk differential" },
  },
});
const TOTAL = Number(options.cases);
const VOTE_TOTAL = Number(options["vote-cases"]);
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

// ---- the vote library ------------------------------------------------------------------------------

const vote = sdk.vote;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const OPERATORS = ["Acme Nodes", "Blue Hosting", "Coldstake", "Delta Ops", "\u202eevil\u202c", "quote \"op\""];
const HOSTS = ["Metalbox", "Hostco", "Cloudia", "Home"];
const COUNTRIES = ["DE", "NL", "US", "BR", "JP", "AU", "ZA", "IN", "FI", "SG", "XX", "de", ""];

function voteName(style, i) {
  if (style === "solar") {
    return pick([`genesis_${i + 1}`, `v${i}`, `node.${i}`, `a${i}b`]);
  }
  let name = "";
  let n = i + 1;
  while (n > 0) {
    name += LETTERS[n % 26];
    n = Math.floor(n / 26);
  }
  return `${pick(["val", "node", "x", LETTERS.slice(0, 1 + int(12))])}${name}`.slice(0, 20);
}

function maybe(percent, make) {
  return chance(percent) ? make() : null;
}

function voteSnapshot() {
  const size = chance(15) ? 1 + int(40) : chance(70) ? 40 + int(41) : 80 + int(41);
  const seats = chance(80) ? 53 : pick([5, 11, 21, 60]);
  const height = chance(90) ? bigint(chance(50) ? 24 : 40) + 1n : bigint(64);
  const style = chance(65) ? "letters" : "solar";
  const ranks = Array.from({ length: size }, (_, i) => i + 1);
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }
  const records = ranks.map((rank, i) => {
    const resigned = chance(6) ? pick(["resigned-temporary", "resigned-permanent"]) : null;
    const ranked = resigned === null && !chance(3);
    const seated = ranked && rank <= seats;
    const assigned = int(20_000);
    return {
      name: voteName(style, i),
      address: `addr-${i}-${int(1000)}`,
      rank: ranked ? rank : null,
      seated,
      status: resigned ?? (seated ? "active" : "standby"),
      registeredHeight: maybe(85, () => String(bigint(64) % (height + 1n))),
      seatedDaysInWindow: maybe(85, () => int(31)),
      voteWeight: String(bigint(chance(10) ? 100 : 60)),
      voters: int(5000),
      production: maybe(85, () => ({
        forged: assigned - int(Math.max(1, Math.floor(assigned / (chance(80) ? 50 : 5)))),
        assigned,
      })),
      penalties: maybe(70, () => ({ jailedInWindow: chance(5), equivocationInWindow: chance(3), ever: chance(10) })),
      declarations: maybe(70, () => ({
        operator: maybe(80, () => (chance(30) ? `${pick(OPERATORS)} ${i}` : pick(OPERATORS))),
        hosting: maybe(80, () => pick(HOSTS)),
        country: maybe(80, () => pick(COUNTRIES)),
        complete: chance(70),
      })),
      payouts: maybe(60, () => ({ perUnitWeight: String(bigint(chance(5) ? 110 : 20)), intervals: int(40) })),
      selfFundedWeightBp: maybe(60, () => int(10_001)),
    };
  });
  const snapshot = {
    height: String(height),
    windowDays: 30,
    seats,
    blockTimeSeconds: pick([8, 8, 8, 3, 60]),
    source: pick(["indexer", "relay-approximate"]),
    records,
  };
  // One snapshot in twenty has one problem, which the library refuses.
  if (chance(5)) {
    const record = pick(records);
    const other = records.length > 1 ? records[(records.indexOf(record) + 1) % records.length] : record;
    const problem = int(10);
    if (problem === 0) record.production = { forged: 11, assigned: 10 };
    if (problem === 1) record.seatedDaysInWindow = 31;
    if (problem === 2) record.registeredHeight = String(height + 1n);
    if (problem === 3) record.selfFundedWeightBp = 10_001;
    if (problem === 4) Object.assign(record, { status: "resigned-temporary", seated: true });
    if (problem === 5) other.name = record.name;
    if (problem === 6) other.address = record.address;
    if (problem === 7) snapshot.windowDays = 7;
    if (problem === 8) snapshot.blockTimeSeconds = 0;
    if (problem === 9) record.name = "Upper_Case";
  }
  return snapshot;
}

function voteRules(style) {
  const iceroot = style === undefined ? chance(50) : chance(85) === (style === "letters");
  const base = iceroot ? vote.VoteRules.ICEROOT : vote.VoteRules.SOLAR_COMPATIBLE;
  if (chance(70)) {
    return { ...base };
  }
  return {
    ...base,
    minEntries: pick([base.minEntries, 1, 20, 25]),
    maxEntries: pick([base.maxEntries, 30, 53]),
    maxEntryBasisPoints: pick([base.maxEntryBasisPoints, 188, 500, 10_000]),
    maxBytes: pick([base.maxBytes, 400, 700, 1024, 1280]),
  };
}

function changed(snapshot) {
  const records = snapshot.records
    .filter(() => !chance(4))
    .map((record) => {
      if (chance(5)) {
        return { ...record, status: "resigned-permanent", seated: false, rank: null };
      }
      if (chance(5) && record.penalties !== null) {
        return { ...record, penalties: { ...record.penalties, jailedInWindow: true } };
      }
      if (chance(5) && record.production !== null) {
        return { ...record, production: { forged: 0, assigned: record.production.assigned } };
      }
      return record;
    });
  return { ...snapshot, records };
}

function snapshotCase() {
  const snapshot = voteSnapshot();
  const names = snapshot.records.map((record) => record.name);
  const accounts = ["holder-a", "holder-b", "dZ1W1GsDCSyhR148oMhuHy3PkhnnSGCqVn", snapshot.records[0]?.address ?? "x"];
  const request = {
    mode: pick(vote.MODES),
    account: chance(95) ? pick(accounts.slice(0, 3)) : accounts[3],
    count: chance(70) ? 20 : chance(95) ? 20 + int(34) : pick([0, 19, 54, 255]),
    draw: chance(70) ? 0 : int(4),
    rules: voteRules(snapshot.records.some((record) => record.name.includes("_") || /[0-9.]/.test(record.name)) ? "solar" : "letters"),
  };
  const chosen = names.filter(() => chance(40)).slice(0, chance(90) ? 53 : 60);
  const entries = chance(80)
    ? chosen.map((validator, i) => ({ validator, basisPoints: Math.trunc(10_000 / chosen.length) + (i < 10_000 % chosen.length ? 1 : 0) }))
    : chosen.map((validator) => ({ validator, basisPoints: int(chance(50) ? 600 : 10_001) }));
  return {
    snapshot,
    request,
    newer: changed(snapshot),
    evaluate: pick(vote.MODES),
    validate: { entries, rules: voteRules(), voter: pick(["ordinary", "validator"]) },
    split: chance(95) ? names.slice(0, int(names.length + 1)) : Array.from({ length: 10_001 }, (_, i) => `n${i}`),
  };
}

/** Canonical JSON: object keys sorted, bigints as decimal strings, as the native side writes it. */
function canonical(value) {
  if (typeof value === "bigint") {
    return JSON.stringify(value.toString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (value) => sha256(canonical(value));

function voteOutcome(fn) {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof sdk.IceRootError)) {
      throw error;
    }
    return { error: { code: error.code, details: { ...error.details } } };
  }
}

function wasmVoteResult(c) {
  const snapshot = vote.VoteSnapshot.deserialize(JSON.stringify(c.snapshot));
  const selection = voteOutcome(() => {
    const { vote: _entries, ...rest } = vote.select(snapshot, c.request);
    return rest;
  });
  const checked =
    selection.error === undefined
      ? voteOutcome(() => vote.check(selection, vote.VoteSnapshot.deserialize(JSON.stringify(c.newer))))
      : null;
  return {
    select: selection.error?.code ?? "ok",
    selection: digest(selection),
    check: digest(checked),
    evaluate: digest(voteOutcome(() => vote.evaluate(snapshot, c.evaluate))),
    validate: digest(voteOutcome(() => vote.validateVote(c.validate.entries, c.validate.rules, c.validate.voter))),
    split: digest(voteOutcome(() => vote.split(c.split))),
  };
}

const voteCases = Array.from({ length: VOTE_TOTAL }, snapshotCase);
// In batches: the cases of 10,000 snapshots are more text than one JavaScript string may hold.
const BATCH = 1000;
const voteNative = [];
for (let start = 0; start < voteCases.length; start += BATCH) {
  const batch = voteCases.slice(start, start + BATCH);
  const lines = execFileSync(
    "cargo",
    ["run", "--quiet", "--locked", "--release", "--example", "vote_differential", "--features", "fixed-aux"],
    {
      cwd: join(root, "wasm"),
      input: `${batch.map((c) => JSON.stringify(c)).join("\n")}\n`,
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["pipe", "pipe", "inherit"],
    },
  )
    .trimEnd()
    .split("\n");
  voteNative.push(...lines);
}
if (voteNative.length !== voteCases.length) {
  fail(`native Rust answered ${voteNative.length} of ${voteCases.length} vote cases`);
}
const voteFailures = [];
const voteTally = {};
for (const [i, c] of voteCases.entries()) {
  const ours = wasmVoteResult(c);
  voteTally[ours.select] = (voteTally[ours.select] ?? 0) + 1;
  if (JSON.stringify(ours) !== voteNative[i]) {
    voteFailures.push({ case: i, native: voteNative[i], webassembly: JSON.stringify(ours) });
    if (process.env.DIFFERENTIAL_DUMP !== undefined && voteFailures.length === 1) {
      writeFileSync(process.env.DIFFERENTIAL_DUMP, JSON.stringify(c));
    }
  }
}
console.log(`check-differential: ${voteCases.length} vote snapshots, selections: ${JSON.stringify(voteTally)}`);
if (voteFailures.length > 0) {
  for (const failure of voteFailures.slice(0, 5)) {
    console.error(JSON.stringify(failure, null, 2));
  }
  fail(`${voteFailures.length} of ${voteCases.length} vote cases differ between native Rust and WebAssembly`);
}
console.log("check-differential: native Rust and WebAssembly agree on every vote case");
