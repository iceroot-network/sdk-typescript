// The wrapper's own behaviour: profiles, errors, released keys, phrases, amounts, capabilities and
// sign-in. Shared by the WebAssembly builds in Node and the Tauri plugin (see test/node/env.mjs
// and the Tauri plugin check): every call of the SDK is awaited, so the suite runs on either entry.

const RELAY = "http://127.0.0.1:4003/api";

export default function suite(test, env) {
  const { sdk, assert } = env;

  test("devnet profiles are checked and frozen", async () => {
    const devnet = sdk.profiles.devnet({ relays: [`${RELAY}/`] });
    assert.deepEqual(devnet.api.relays, [RELAY]);
    assert.equal(devnet.chain.networkByte, 90);
    assert.equal(devnet.backend, "solar-compat");
    assert.equal(devnet.keyScheme, "bip32-secp256k1");
    assert.equal(devnet.coinType, 1);
    assert.ok(Object.isFrozen(devnet) && Object.isFrozen(devnet.chain) && Object.isFrozen(devnet.api.relays));

    for (const options of [
      { relays: [] },
      { relays: ["not a url"] },
      { relays: ["ftp://127.0.0.1/api"] },
      { relays: [RELAY], networkByte: 256 },
      { relays: [RELAY], networkByte: 1.5 },
      { relays: [RELAY], nethash: "ABC" },
    ]) {
      assert.throws(() => sdk.profiles.devnet(options), sdk.InvalidProfile, JSON.stringify(options));
    }
  });

  test("errors carry stable codes and details", async () => {
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    await assert.rejects(
      async () => sdk.Address.parse("dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF", sdk.profiles.devnet({ relays: [RELAY], networkByte: 30 })),
      (error) => {
        assert.ok(error instanceof sdk.InvalidAddress && error instanceof sdk.IceRootError && error instanceof Error);
        assert.equal(error.code, "InvalidAddress");
        assert.equal(error.name, "InvalidAddress");
        assert.equal(error.reason, "wrong-network");
        assert.deepEqual({ ...error.details }, { reason: "wrong-network", expected: 30, actual: 90 });
        return true;
      },
    );
    // One code for a bad key, whether the hex or the key is wrong.
    for (const key of ["02zz", "05" + "11".repeat(32)]) {
      await assert.rejects(async () => sdk.Address.fromPublicKey(key, devnet), (error) => {
        assert.ok(error instanceof sdk.InvalidKey);
        assert.equal(error.code, "InvalidKey");
        return true;
      });
    }
    assert.equal("InvalidPublicKey" in sdk, false);
    await assert.rejects(async () => sdk.Keys.fromLegacyPassphrase(Uint8Array.of(0xff), devnet), sdk.InvalidPhrase);
  });

  test("the legacy import is refused where the key scheme is not classical", async () => {
    const pq = { ...sdk.profiles.devnet({ relays: [RELAY] }), id: "devnet-pq", keyScheme: "slip10-mldsa65" };
    const bytes = new TextEncoder().encode("probe passphrase");
    await assert.rejects(async () => sdk.Keys.fromLegacyPassphrase(bytes, pq), (error) => {
      assert.ok(error instanceof sdk.UnsupportedOnNetwork);
      assert.equal(error.capability, "legacy-passphrase-import");
      return true;
    });
    assert.ok(bytes.every((byte) => byte === 0));
  });

  test("a released account keeps its address and refuses to sign", async () => {
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const account = await sdk.Keys.fromLegacyPassphrase("probe passphrase", devnet);
    const connected = { profile: devnet };
    assert.equal((await sdk.Address.parse(account.address, connected)).toString(), account.address);
    assert.equal(account.released, false);
    await account.release();
    await account.release();
    assert.equal(account.released, true);
    assert.equal(account.address, "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF");
    assert.equal(account.publicKeyBytes.length, 33);
    await assert.rejects(async () => sdk.Messages.sign(account, "x"), sdk.KeyReleased);
  });

  test("message verification never throws on malformed input", async () => {
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const account = await sdk.Keys.fromLegacyPassphrase("probe passphrase", devnet);
    const signed = { ...(await sdk.Messages.sign(account, "hello")), message: "hello" };
    assert.equal(await sdk.Messages.verify(signed), true);
    assert.equal(await sdk.Messages.verify(signed, devnet), true);
    assert.equal(await sdk.Messages.verify(signed, sdk.profiles.devnet({ relays: [RELAY], networkByte: 30 })), false);
    assert.equal(await sdk.Messages.verify({ ...signed, algorithm: "ml-dsa-65" }), false);
    assert.equal(await sdk.Messages.verify({ ...signed, signature: "zz" }), false);
    assert.equal(await sdk.Messages.verify({ ...signed, signature: signed.signature.slice(2) }), false);
    assert.equal(await sdk.Messages.verify({ ...signed, publicKey: "" }), false);
    await account.release();
  });

  test("a message is signed only as UTF-8 text, which no transaction is", async () => {
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const account = await sdk.Keys.fromLegacyPassphrase("probe passphrase", devnet);
    // Every transaction's bytes begin with 0xff, which UTF-8 text never contains.
    for (const message of [Uint8Array.of(0xff), Uint8Array.of(0xff, 0x03, 0x5a, 0x01), Uint8Array.of(0x00, 0xff), Uint8Array.of(0xc3)]) {
      await assert.rejects(async () => sdk.Messages.sign(account, message), (error) => {
        assert.ok(error instanceof sdk.InvalidArgument);
        assert.equal(error.details.reason, "a message is signed only as UTF-8 text");
        return true;
      });
    }
    // Text, given as a string or as its UTF-8 bytes, is signed as before.
    const text = { ...(await sdk.Messages.sign(account, "\u00ff")), message: "\u00ff" };
    assert.equal(await sdk.Messages.verify(text, devnet), true);
    const bytes = new TextEncoder().encode("bytes of text \u00ff");
    assert.equal(await sdk.Messages.verify({ ...(await sdk.Messages.sign(account, bytes)), message: bytes }, devnet), true);
    // Bytes that are not text never verify as a message either.
    assert.equal(await sdk.Messages.verify({ ...text, message: Uint8Array.of(0xff) }, devnet), false);
    assert.equal(await sdk.Messages.verify({ ...text, message: Uint8Array.of(0xc3, 0xbf, 0xff) }, devnet), false);
    await account.release();
  });

  test("recovery phrases: new phrases, form feedback and derived accounts", async () => {
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const phrase = await sdk.Mnemonic.generate();
    assert.equal(phrase.split(" ").length, 24);
    assert.notEqual(await sdk.Mnemonic.generate(), phrase);
    assert.deepEqual({ ...(await sdk.Mnemonic.check(phrase)) }, { ok: true, words: 24 });
    const twelve = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    assert.deepEqual({ ...(await sdk.Mnemonic.check(twelve)) }, { ok: false, words: 12, reason: "too-short" });
    await assert.rejects(async () => sdk.Keys.fromPhrase(twelve, devnet), (error) => {
      assert.ok(error instanceof sdk.PhraseTooShort);
      assert.deepEqual({ ...error.details }, { words: 12, minimum: 18 });
      assert.equal(error.message.includes("abandon"), false);
      return true;
    });
    const typo = phrase.replace(/\S+$/, "zzzz");
    await assert.rejects(async () => sdk.Keys.fromPhrase(typo, devnet), (error) => {
      assert.ok(error instanceof sdk.InvalidPhrase);
      assert.equal(error.details.reason, "unknown-word");
      assert.equal(error.details.position, 24);
      assert.equal(error.message.includes("zzzz"), false);
      return true;
    });

    const first = await sdk.Keys.fromPhrase(phrase, devnet);
    const second = await sdk.Keys.fromPhrase(phrase, devnet, { index: 1 });
    assert.equal(first.path, "m/44'/1'/0'/0'/0'");
    assert.equal(second.path, "m/44'/1'/0'/0'/1'");
    assert.notEqual(first.address, second.address);
    assert.equal(first.legacy, false);
    assert.equal((await sdk.Address.fromPublicKey(first.publicKey, devnet)).toString(), first.address);
    await assert.rejects(async () => sdk.Keys.fromPhrase(phrase, devnet, { account: -1 }), sdk.InvalidArgument);
    const bytes = new TextEncoder().encode(phrase);
    await assert.rejects(async () => sdk.Keys.fromPhrase(bytes, devnet, { index: 2 ** 31 }), sdk.InvalidArgument);
    assert.ok(bytes.every((byte) => byte === 0));
    await first.release();
    await second.release();
  });

  test("amounts are exact", async () => {
    assert.equal(await sdk.Amount.parse("1.5", 8), 150_000_000n);
    assert.equal(await sdk.Amount.format(150_000_000n, 8), "1.5");
    assert.equal(await sdk.Amount.format(123_456_789_012_345_678n, 8, { maxFraction: 2, grouping: true }), "1,234,567,890.12");
    await assert.rejects(async () => sdk.Amount.parse("1.123456789", 8), sdk.InvalidAmount);
    await assert.rejects(async () => sdk.Amount.parse("1", 1.5), sdk.InvalidArgument);
    await assert.rejects(async () => sdk.Amount.format(-1n, 8), sdk.InvalidAmount);
    await assert.rejects(async () => sdk.Amount.format(1n, 8, { maxFraction: 256 }), sdk.InvalidArgument);
    assert.equal(sdk.AssetId.ROOT, "ROOT");
  });

  test("capabilities come from the profile", async () => {
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const capabilities = await sdk.capabilitiesOf(devnet);
    for (const name of ["transfer", "vote", "burn", "message-signing", "legacy-passphrase-import", "phrase-accounts"]) {
      assert.equal(capabilities.has(name), true, name);
    }
    for (const name of ["finality", "names", "swaps", "transaction-id-before-signing"]) {
      assert.equal(capabilities.has(name), false, name);
    }
    assert.ok(capabilities.list().includes("transfer"));
    assert.equal(await sdk.messageNetworkOf(devnet), "heartwood-devnet-v90");
    assert.equal(await sdk.messageAlgorithmOf(devnet), "secp256k1-bip340-sha256");
    const later = { ...devnet, id: "devnet-pq", keyScheme: "slip10-mldsa65" };
    assert.deepEqual([...(await sdk.capabilitiesOf(later)).list()], []);
    await assert.rejects(async () => sdk.Address.parse("dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNF", later), sdk.UnsupportedOnNetwork);
    await assert.rejects(async () => sdk.capabilitiesOf({ ...devnet, backend: "other" }), sdk.InvalidProfile);
  });

  test("sign-in messages are built and checked by the same code", async () => {
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const account = await sdk.Keys.fromLegacyPassphrase("probe passphrase", devnet);
    const issuedAt = new Date("2026-09-27T10:00:00Z");
    const expiresAt = new Date("2026-09-27T10:05:00Z");
    const nonce = "ab".repeat(32);
    const message = await sdk.SignIn.build(
      { origin: "https://validators.example", publicKey: account.publicKey, nonce, issuedAt, expiresAt },
      devnet,
    );
    assert.equal(message.split("\n").length, 12);
    const now = new Date("2026-09-27T10:01:00Z");
    const fields = await sdk.SignIn.parse(message, devnet, {
      origin: "https://validators.example",
      address: account.address,
      publicKey: account.publicKey,
      now,
    });
    assert.equal(fields.nonce, nonce);
    assert.equal(fields.address, account.address);
    assert.equal(fields.issuedAt.getTime(), issuedAt.getTime());
    assert.equal(fields.network, "heartwood-devnet-v90");
    const signature = await sdk.Messages.sign(account, message);
    assert.equal(await sdk.Messages.verify({ ...signature, message }, devnet), true);

    const selected = {
      origin: "https://validators.example",
      address: account.address,
      publicKey: account.publicKey,
      now,
    };
    for (const expected of [
      { ...selected, origin: "https://other.example" },
      { ...selected, address: "dDSccdbPRhfrcbUeFLMbGC1rtnfCsjJcNX" },
      { ...selected, publicKey: "02" + "11".repeat(32) },
      { ...selected, now: new Date("2026-09-27T10:10:00Z") },
    ]) {
      await assert.rejects(async () => sdk.SignIn.parse(message, devnet, expected), (error) => {
        assert.ok(error instanceof sdk.InvalidSignIn);
        assert.equal(typeof error.details.reason, "string");
        return true;
      });
    }
    await assert.rejects(async () => sdk.SignIn.parse(message.replace("Version: 1", "Version: 2"), devnet, selected), sdk.InvalidSignIn);
    await assert.rejects(async () => sdk.SignIn.parse(message, devnet, { ...selected, now: new Date(Number.NaN) }), sdk.InvalidArgument);
    // The origin and the identity are always compared: leaving one out is refused, never skipped.
    for (const field of ["origin", "address", "publicKey"]) {
      const { [field]: _left, ...partial } = selected;
      await assert.rejects(async () => sdk.SignIn.parse(message, devnet, partial), (error) => {
        assert.ok(error instanceof sdk.InvalidArgument);
        assert.equal(error.details.field, field);
        return true;
      });
      await assert.rejects(async () => sdk.SignIn.parse(message, devnet, { ...selected, [field]: "" }), sdk.InvalidArgument);
    }
    await account.release();
  });

  test("a sign-in message is signed only once it passes its checks, where the key signs", async () => {
    const devnet = sdk.profiles.devnet({ relays: [RELAY] });
    const account = await sdk.Keys.fromLegacyPassphrase("probe passphrase", devnet);
    const other = await sdk.Keys.fromLegacyPassphrase("another passphrase", devnet);
    const origin = "https://validators.example";
    const message = await sdk.SignIn.build(
      {
        origin,
        publicKey: account.publicKey,
        nonce: "cd".repeat(32),
        issuedAt: new Date("2026-09-27T10:00:00Z"),
        expiresAt: new Date("2026-09-27T10:05:00Z"),
      },
      devnet,
    );
    const now = new Date("2026-09-27T10:01:00Z");
    const signature = await sdk.SignIn.sign(account, message, { origin, now });
    assert.ok(Object.isFrozen(signature));
    assert.equal(signature.publicKey, account.publicKey);
    assert.equal(signature.network, "heartwood-devnet-v90");
    assert.equal(await sdk.Messages.verify({ ...signature, message }, devnet), true);

    // A challenge a page of another origin relays, one made for another account, a lapsed one and
    // text that is no sign-in message are refused with the reason.
    for (const [key, text, signing, reason] of [
      [account, message, { origin: "https://other.example", now }, "mismatch"],
      [other, message, { origin, now }, "mismatch"],
      [account, message, { origin, now: new Date("2026-09-27T10:10:00Z") }, "expired"],
      [account, "Sign in to validators.example", { origin, now }, "format"],
    ]) {
      await assert.rejects(async () => sdk.SignIn.sign(key, text, signing), (error) => {
        assert.ok(error instanceof sdk.InvalidSignIn, String(error));
        assert.equal(error.details.reason, reason);
        return true;
      });
    }
    // The origin and the time are always given.
    await assert.rejects(async () => sdk.SignIn.sign(account, message, { now }), (error) => {
      assert.ok(error instanceof sdk.InvalidArgument, String(error));
      assert.equal(error.details.field, "origin");
      return true;
    });
    await assert.rejects(async () => sdk.SignIn.sign(account, message, { origin, now: new Date(Number.NaN) }), sdk.InvalidArgument);
    await assert.rejects(async () => sdk.SignIn.sign(account, new TextEncoder().encode(message), { origin, now }), sdk.InvalidArgument);
    await account.release();
    await assert.rejects(async () => sdk.SignIn.sign(account, message, { origin, now }), sdk.KeyReleased);
    await other.release();
  });
}
