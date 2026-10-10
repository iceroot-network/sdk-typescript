// The native vectors against an independent implementation: the @noble and @scure libraries, which
// an existing wallet implementation uses. Keys, addresses and signatures must agree byte for byte.

import assert from "node:assert/strict";
import { test } from "node:test";

import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { createBase58check } from "@scure/base";

import { vectors } from "./helpers.mjs";

const base58check = createBase58check(sha256);

function address(publicKey, networkByte) {
  return base58check.encode(Uint8Array.of(networkByte, ...ripemd160(publicKey)));
}

test("the native vectors agree with @noble on keys, addresses and signatures", () => {
  for (const keyCase of vectors.keys) {
    const secret = sha256(utf8ToBytes(keyCase.passphrase));
    const publicKey = secp256k1.getPublicKey(secret, true);
    assert.equal(bytesToHex(publicKey), keyCase.publicKey);
    for (const [network, expected] of Object.entries(keyCase.addresses)) {
      assert.equal(address(publicKey, Number(network)), expected);
    }
    for (const sigCase of keyCase.signatures) {
      const digest = sha256(hexToBytes(sigCase.message));
      assert.equal(bytesToHex(digest), sigCase.digest);
      const signature = schnorr.sign(digest, secret, hexToBytes(sigCase.aux));
      assert.equal(bytesToHex(signature), sigCase.signature);
    }
  }
  for (const keyCase of vectors.publicKeyAddresses) {
    assert.equal(address(hexToBytes(keyCase.publicKey), keyCase.network), keyCase.address);
  }
});
