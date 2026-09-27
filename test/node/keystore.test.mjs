// The keystore through WebAssembly: every record of the keystore vectors (sdk-rust's
// vectors/sdk/S07-keystore.jsonl, whose oracle is an independent JavaScript implementation of the
// format) through the published functions, and through the test build where a record fixes the
// salt and nonce or lowers the parameter floor; round trips of recovery phrases; the wiping of
// every secret passed as bytes; and the error codes.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import * as sdk from "../../dist/node/index.js";
import * as keystore from "../../dist/node/keystore.js";
import * as testSdk from "../../build/test/dist/node/index.js";
import { root } from "./helpers.mjs";

const VECTORS = join(root, "..", "sdk-rust", "vectors", "sdk", "S07-keystore.jsonl");
if (!existsSync(VECTORS)) {
  throw new Error(`the keystore vectors are missing: check out sdk-rust next to this repository (${VECTORS})`);
}
const { testing } = testSdk;
// The lowest parameters the format accepts, so that the round trips run quickly.
const LOW = { memoryKib: 19_456, iterations: 2, parallelism: 1 };
const PHRASE_24 = entropyToMnemonic(new Uint8Array(32).fill(7), wordlist);

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));
const text = (bytes) => new TextDecoder().decode(bytes);
const wiped = (bytes) => bytes.every((byte) => byte === 0);

function refusal(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected a refusal");
}

function records() {
  const lines = readFileSync(VECTORS, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const [meta, ...rest] = lines;
  assert.equal(meta.class, "S07-keystore");
  assert.equal(rest.length, meta.records);
  return { meta, records: rest };
}

/** The outcome of `fn` as the vectors record it: the output, or the error's code and details. */
function outcome(fn) {
  try {
    return { output: fn() };
  } catch (error) {
    // The published build's classes or the test build's: two instances of the SDK.
    assert.ok(error instanceof sdk.IceRootError || error instanceof testSdk.IceRootError, String(error));
    return { error: { class: error.code, details: { ...error.details } } };
  }
}

function compare(record, got) {
  const name = `${record.op} ${record.name}`;
  if (record.error !== undefined) {
    assert.deepEqual(got.error, { class: record.error.class, details: record.error.details }, name);
  } else {
    assert.deepEqual(got.output, record.output, name);
  }
}

test("the wrapper's constants are the format's", () => {
  const constants = testing.keystoreConstants();
  assert.deepEqual(JSON.parse(JSON.stringify(keystore.PRESETS)), constants.presets);
  assert.deepEqual(JSON.parse(JSON.stringify(keystore.BOUNDS)), constants.bounds);
  assert.equal(keystore.MAX_PASSWORD_BYTES, constants.maxPasswordBytes);
  assert.ok(testing.hasKeystoreSeam());
  assert.equal(typeof testSdk.keystore.encrypt, "function");
});

test("every keystore vector passes in WebAssembly", () => {
  const { records: all } = records();
  const tally = {};
  for (const record of all) {
    const input = record.input;
    tally[record.op] = (tally[record.op] ?? 0) + 1;
    switch (record.op) {
      case "keystore.encrypt": {
        // Fixed salt and nonce: the test build's seam, as the Rust runner does it.
        compare(
          record,
          outcome(() => {
            const bytes = testing.keystoreEncryptWithSaltAndNonce(
              input.kind,
              fromHex(input.secret),
              input.password,
              input.params,
              fromHex(input.salt),
              fromHex(input.nonce),
              input.bounds,
            );
            // What was written reads back through the published functions.
            assert.deepEqual({ ...keystore.inspect(bytes) }.memoryKib, input.params.memoryKib);
            assert.equal(hex(keystore.dearmor(keystore.armor(bytes))), hex(bytes));
            return { keystore: hex(bytes), text: keystore.armor(bytes) };
          }),
        );
        break;
      }
      case "keystore.decrypt": {
        const data = input.keystore === undefined ? input.text : fromHex(input.keystore);
        compare(
          record,
          outcome(() => {
            const bytes = typeof data === "string" ? keystore.dearmor(data) : data;
            return testing.keystoreDecryptWithBounds(bytes, input.password, input.bounds);
          }),
        );
        if (input.bounds === "standard") {
          tally.published = (tally.published ?? 0) + 1;
          // The published function opens the same keystores and refuses the same ones.
          compare(
            record,
            outcome(() => {
              const opened = keystore.decrypt(data, input.password);
              const secret = hex(mnemonicToEntropy(text(opened.phrase), wordlist));
              return { kind: opened.kind, secret, wordCount: opened.words };
            }),
          );
        }
        break;
      }
      case "keystore.inspect":
        compare(record, outcome(() => ({ ...keystore.inspect(fromHex(input.keystore)) })));
        break;
      case "keystore.dearmor":
        compare(record, outcome(() => ({ keystore: hex(keystore.dearmor(input.text)) })));
        break;
      case "keystore.checkParams":
        compare(
          record,
          outcome(() => {
            if (input.bounds === "standard") {
              keystore.checkParams(input.params);
            } else {
              testing.keystoreCheckParamsWithBounds(input.params, input.bounds);
            }
            return { ok: true };
          }),
        );
        break;
      default:
        assert.fail(`no runner for ${record.op}`);
    }
  }
  assert.deepEqual(tally, {
    "keystore.encrypt": 18,
    "keystore.decrypt": 72,
    "keystore.checkParams": 12,
    "keystore.inspect": 12,
    "keystore.dearmor": 22,
    published: 14,
  });
});

test("a recovery phrase round-trips, in bytes and in text", () => {
  for (const words of [18, 21, 24]) {
    const phrase = entropyToMnemonic(new Uint8Array((words / 3) * 4).fill(words), wordlist);
    const stored = keystore.encrypt(phrase, "correct horse", LOW);
    const header = keystore.inspect(stored);
    assert.equal(header.version, 1);
    assert.equal(header.kdf, "argon2id");
    assert.equal(header.payloadKind, "bip39-entropy");
    assert.equal(header.payloadLength, (words / 3) * 4);
    assert.equal(header.keystoreLength, stored.length);
    const opened = keystore.decrypt(keystore.armor(stored), "correct horse");
    assert.equal(opened.kind, "bip39-entropy");
    assert.equal(opened.words, words);
    assert.equal(text(opened.phrase), phrase);
  }
  // The phrase is read as keys read it: any white space and case, in its canonical form after.
  const messy = `  ${PHRASE_24.toUpperCase().split(" ").join("\n ")} `;
  const opened = keystore.decrypt(keystore.encrypt(messy, "pw", LOW), "pw");
  assert.equal(text(opened.phrase), PHRASE_24);
  // Two keystores of the same phrase and password differ: fresh salt and nonce.
  assert.notEqual(hex(keystore.encrypt(PHRASE_24, "pw", LOW)), hex(keystore.encrypt(PHRASE_24, "pw", LOW)));
  // The opened phrase gives the same account as the phrase itself.
  const profile = sdk.profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });
  const expected = sdk.Keys.fromPhrase(PHRASE_24, profile);
  const again = sdk.Keys.fromPhrase(keystore.decrypt(keystore.encrypt(PHRASE_24, "pw", LOW), "pw").phrase, profile);
  assert.equal(again.address, expected.address);
  expected.release();
  again.release();
});

test("every secret given as bytes is overwritten, whatever the outcome", () => {
  const encoder = new TextEncoder();
  const phrase = encoder.encode(PHRASE_24);
  const password = encoder.encode("correct horse");
  const stored = keystore.encrypt(phrase, password, LOW);
  assert.ok(wiped(phrase) && wiped(password));

  const good = encoder.encode("correct horse");
  const opened = keystore.decrypt(stored, good);
  assert.ok(wiped(good));
  assert.equal(text(opened.phrase), PHRASE_24);
  opened.phrase.fill(0);

  const wrong = encoder.encode("wrong horse");
  assert.ok(refusal(() => keystore.decrypt(stored, wrong)) instanceof keystore.WrongPasswordOrCorrupt);
  assert.ok(wiped(wrong));

  // Refused before the module is reached: the arrays are wiped all the same.
  const early = encoder.encode("correct horse");
  assert.ok(refusal(() => keystore.decrypt("not a keystore", early)) instanceof keystore.Malformed);
  assert.ok(wiped(early));
  const phraseAgain = encoder.encode(PHRASE_24);
  const passwordAgain = encoder.encode("pw");
  assert.ok(refusal(() => keystore.encrypt(phraseAgain, passwordAgain, "server")) instanceof sdk.InvalidArgument);
  assert.ok(wiped(phraseAgain) && wiped(passwordAgain));

  const old = encoder.encode("correct horse");
  const next = encoder.encode("battery staple");
  const changed = keystore.changePassword(stored, old, next, LOW);
  assert.ok(wiped(old) && wiped(next));
  assert.equal(text(keystore.decrypt(changed, "battery staple").phrase), PHRASE_24);
  const same = encoder.encode("battery staple");
  const moved = keystore.reencrypt(changed, same, { ...LOW, iterations: 3 });
  assert.ok(wiped(same));
  assert.equal(keystore.inspect(moved).iterations, 3);
});

test("presets, parameters and memory limits", () => {
  // One run of the web preset, the one browsers and extensions use.
  const stored = keystore.encrypt(PHRASE_24, "correct horse", "web");
  const header = keystore.inspect(stored);
  assert.deepEqual(
    { memoryKib: header.memoryKib, iterations: header.iterations, parallelism: header.parallelism },
    { ...keystore.PRESETS.web },
  );
  assert.equal(text(keystore.decrypt(stored, "correct horse").phrase), PHRASE_24);
  // A platform that cannot spare the memory refuses before any work.
  const limited = refusal(() => keystore.decrypt(stored, "correct horse", { maxMemoryKib: 32_768 }));
  assert.ok(limited instanceof keystore.ParamsOutOfRange);
  assert.deepEqual(limited.details, { param: "memory", value: 65_536, minimum: 19_456, maximum: 32_768 });

  assert.equal(keystore.isWeakerThan(header, "desktop"), true);
  assert.equal(keystore.isWeakerThan(keystore.PRESETS.desktop, "web"), false);
  assert.equal(keystore.isWeakerThan(LOW, LOW), false);
  keystore.checkParams("mobile");
  assert.ok(refusal(() => keystore.checkParams("desktop", { maxMemoryKib: 65_536 })) instanceof keystore.ParamsOutOfRange);
  const weak = refusal(() => keystore.encrypt(PHRASE_24, "pw", { memoryKib: 8, iterations: 1, parallelism: 1 }));
  assert.ok(weak instanceof keystore.ParamsOutOfRange);
  assert.equal(weak.details.param, "memory");
});

test("refusals carry the keystore's codes and details", () => {
  const twelve = entropyToMnemonic(new Uint8Array(16).fill(3), wordlist);
  assert.ok(refusal(() => keystore.encrypt(twelve, "pw", LOW)) instanceof sdk.PhraseTooShort);
  assert.ok(refusal(() => keystore.encrypt("not a phrase", "pw", LOW)) instanceof sdk.InvalidPhrase);
  const empty = refusal(() => keystore.encrypt(PHRASE_24, "", LOW));
  assert.ok(empty instanceof keystore.InvalidPassword);
  assert.deepEqual(empty.details, { reason: "empty" });
  const long = refusal(() => keystore.encrypt(PHRASE_24, "x".repeat(1025), LOW));
  assert.deepEqual(long.details, { reason: "too-long", bytes: 1025, maximum: 1024 });
  assert.ok(refusal(() => keystore.encrypt(PHRASE_24, new Uint8Array([0xff]), LOW)) instanceof sdk.InvalidArgument);

  const stored = keystore.encrypt(PHRASE_24, "pw", LOW);
  const tampered = new Uint8Array(stored);
  tampered[tampered.length - 1] ^= 1;
  const corrupt = refusal(() => keystore.decrypt(tampered, "pw"));
  assert.ok(corrupt instanceof keystore.WrongPasswordOrCorrupt && corrupt instanceof sdk.IceRootError);
  assert.equal(corrupt.code, "WrongPasswordOrCorrupt");
  const malformed = refusal(() => keystore.inspect(new Uint8Array([1, 2, 3])));
  assert.ok(malformed instanceof keystore.Malformed);
  assert.equal(malformed.reason, "magic");
  const version = new Uint8Array(stored);
  version[4] = 9;
  assert.ok(refusal(() => keystore.inspect(version)) instanceof keystore.UnsupportedVersion);
  assert.equal(refusal(() => keystore.dearmor("irks:!!")).reason, "armor-encoding");
});
