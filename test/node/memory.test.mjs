// No copy of a secret is left in WebAssembly memory once a call returns or a key is released.
//
// The module's stack lives in its memory, and the frames that hashing, key derivation, signing and
// decryption use keep copies of secrets after they return, so the wrapper overwrites the stack
// after every call. These tests search the whole memory of the test build (which exposes it) for
// the secrets themselves: a keystore's password, phrase and entropy after it is opened, and a key's
// bytes after it is released.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { HDKey } from "@scure/bip32";
import { mnemonicToEntropy, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import * as testSdk from "../../build/test/dist/node/index.js";

const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal will";
const LOW = { memoryKib: 19_456, iterations: 2, parallelism: 1 };
const encode = (text) => new TextEncoder().encode(text);

/** How many times `needle` occurs in the module's memory. */
function occurrences(needle) {
  const memory = new Uint8Array(testSdk.testing.wasmMemory().buffer);
  let count = 0;
  let from = memory.indexOf(needle[0]);
  while (from !== -1 && from + needle.length <= memory.length) {
    let match = true;
    for (let i = 1; i < needle.length; i += 1) {
      if (memory[from + i] !== needle[i]) {
        match = false;
        break;
      }
    }
    if (match) count += 1;
    from = memory.indexOf(needle[0], from + 1);
  }
  return count;
}

function profile() {
  return testSdk.profiles.devnet({ relays: ["http://127.0.0.1:1/api"] });
}

test("the published build has no memory seam", async () => {
  const published = await import("../../dist/node/index.js");
  assert.equal(published.testing, undefined);
});

test("an opened keystore leaves no copy of its password, phrase or entropy", () => {
  const password = "keystore password 5d1e";
  const entropy = mnemonicToEntropy(PHRASE, wordlist);
  const stored = testSdk.keystore.encrypt(PHRASE, encode(password), LOW);
  assert.equal(occurrences(encode(password)), 0);
  assert.equal(occurrences(entropy), 0);

  const opened = testSdk.keystore.decrypt(stored, encode(password));
  assert.equal(new TextDecoder().decode(opened.phrase), PHRASE);
  assert.equal(occurrences(encode(password)), 0, "password");
  assert.equal(occurrences(encode(PHRASE)), 0, "phrase");
  assert.equal(occurrences(entropy), 0, "entropy");

  // A wrong password, a changed password and a new preset leave nothing either.
  assert.throws(() => testSdk.keystore.decrypt(stored, "not the password"), { code: "WrongPasswordOrCorrupt" });
  const changed = testSdk.keystore.changePassword(stored, password, "another password 77c0", LOW);
  testSdk.keystore.reencrypt(changed, "another password 77c0", LOW);
  for (const secret of [encode(password), encode("another password 77c0"), encode(PHRASE), entropy]) {
    assert.equal(occurrences(secret), 0);
  }
});

test("a released account key leaves no copy of the key", () => {
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(PHRASE)).derive("m/44'/1'/0'/0'/0'").privateKey;
  const account = testSdk.Keys.fromPhrase(encode(PHRASE), profile());
  assert.equal(occurrences(key), 1, "held once, in its handle");
  testSdk.Messages.sign(account, "sign a message before the release");
  assert.equal(occurrences(key), 1);
  account.release();
  assert.equal(occurrences(key), 0);
  assert.equal(occurrences(entropyOf(PHRASE)), 0);

  const passphrase = "a legacy devnet passphrase 3b9a";
  const legacyKey = createHash("sha256").update(passphrase).digest();
  const legacy = testSdk.Keys.fromLegacyPassphrase(encode(passphrase), profile());
  testSdk.Messages.sign(legacy, "a message");
  legacy.release();
  assert.equal(occurrences(legacyKey), 0);
  assert.equal(occurrences(encode(passphrase)), 0);
});

test("a released Solar key leaves no copy of the key", () => {
  const passphrase = "a solar passphrase for proofs 8e41";
  const secret = createHash("sha256").update(passphrase).digest();
  const key = testSdk.ownership.SolarKey.fromPassphrase(encode(passphrase));
  assert.equal(occurrences(secret), 1, "held once, in its handle");
  const message = testSdk.ownership.OwnershipProof.build({
    address: key.address,
    account: "ice1q8y55x5z8dr5uepshat727uvt328lfkklzwvvmt4p42qlcrggxtsk8zw2r",
    nonce: "ab".repeat(32),
    issuedAt: Date.now(),
  });
  testSdk.ownership.OwnershipProof.sign(key, message, Date.now());
  assert.equal(occurrences(secret), 1);
  key.release();
  assert.equal(occurrences(secret), 0);
  assert.equal(occurrences(encode(passphrase)), 0);
});

function entropyOf(phrase) {
  return mnemonicToEntropy(phrase, wordlist);
}
