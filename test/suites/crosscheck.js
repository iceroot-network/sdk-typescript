// Independent cross-checks on 1,000 phrases each, against the @noble and @scure libraries (the
// ones an existing wallet implementation uses, and the reference implementation's own @scure/bip32):
//
// - legacy passphrase keys: 1,000 random 12-word phrases, as the devnet's genesis wallets and the
//   existing wallet implementation's identities are; the SDK and @noble must agree on the key, the
//   address and the message signature, byte for byte with the same auxiliary bytes, and each must
//   verify the other's signatures;
// - hardened derivation: 1,000 random phrases of 18, 21 and 24 words, with and without a BIP39
//   passphrase, at random hardened accounts and indexes of m/44'/1'/account'/0'/index'; the SDK and
//   @scure/bip39 with @scure/bip32 must agree on the key and the address;
// - recovery phrases the SDK generates are valid BIP39 phrases for @scure/bip39.
//
// The phrases come from a SHA-256 counter stream, so every run checks the same cases.

const CASES = 1000;
const HARDENED_LIMIT = 0x80000000;
const RELAY = "http://127.0.0.1:4003/api";

export default function suite(test, env) {
  const { sdk, testSdk, assert } = env;
  const { schnorr, secp256k1, ripemd160, sha256, bytesToHex, hexToBytes, utf8ToBytes, createBase58check } = env.noble;
  const { HDKey, entropyToMnemonic, mnemonicToSeedSync, validateMnemonic, wordlist } = env.scure;
  const base58check = createBase58check(sha256);

  /** 32 deterministic bytes for case `index` of stream `label`. */
  function stream(label, index) {
    return sha256(utf8ToBytes(`iceroot-sdk crosscheck/${label}/${index}`));
  }

  function uint31(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0) & 0x7fffffff;
  }

  function address(publicKey) {
    return base58check.encode(Uint8Array.of(sdk.DEVNET_NETWORK_BYTE, ...ripemd160(publicKey)));
  }

  test("1,000 legacy passphrase keys, addresses and message signatures agree with @noble", async () => {
    const profile = sdk.profiles.devnet({ relays: [RELAY] });
    const testProfile = testSdk.profiles.devnet({ relays: [RELAY] });
    for (let i = 0; i < CASES; i++) {
      const phrase = entropyToMnemonic(stream("legacy", i).slice(0, 16), wordlist);
      const secret = sha256(utf8ToBytes(phrase));
      const publicKey = secp256k1.getPublicKey(secret, true);
      const account = await sdk.Keys.fromLegacyPassphrase(phrase, profile);
      assert.equal(account.publicKey, bytesToHex(publicKey), `key of case ${i}`);
      assert.equal(account.address, address(publicKey), `address of case ${i}`);

      // The same signature with the same auxiliary bytes (the test build can choose them).
      const message = `IceRoot cross-check ${i}: ${phrase.split(" ")[i % 12]}`;
      const digest = sha256(utf8ToBytes(message));
      const aux = stream("aux", i);
      const testAccount = await testSdk.Keys.fromLegacyPassphrase(phrase, testProfile);
      const fixed = await testSdk.testing.signMessageWithAux(testAccount, message, aux);
      assert.equal(fixed, bytesToHex(schnorr.sign(digest, secret, aux)), `signature of case ${i}`);
      await testAccount.release();

      // Signatures with fresh randomness verify both ways.
      const ours = await sdk.Messages.sign(account, message);
      assert.ok(schnorr.verify(hexToBytes(ours.signature), digest, publicKey.slice(1)), `@noble verifies case ${i}`);
      const theirs = bytesToHex(schnorr.sign(digest, secret));
      assert.ok(await sdk.Messages.verify({ ...ours, signature: theirs, message }, profile), `the SDK verifies case ${i}`);
      assert.equal(await sdk.Messages.verify({ ...ours, signature: theirs, message: `${message} ` }, profile), false);
      await account.release();
    }
  });

  test("1,000 hardened derivations agree with @scure/bip39 and @scure/bip32", async () => {
    const profile = sdk.profiles.devnet({ relays: [RELAY] });
    const passphrases = ["", "TREZOR", "Crème brûlée", "メモ ✓"];
    const counts = { 18: 0, 21: 0, 24: 0 };
    for (let i = 0; i < CASES; i++) {
      const bytes = stream("derive", i);
      const words = [18, 21, 24][bytes[0] % 3];
      counts[words] += 1;
      const phrase = entropyToMnemonic(stream("derive-entropy", i).slice(0, (words / 3) * 4), wordlist);
      const passphrase = passphrases[bytes[1] % passphrases.length];
      // Small numbers mostly, as wallets use them, and the whole hardened range now and then.
      const small = bytes[2] % 4 !== 0;
      const accountNumber = small ? bytes[3] % 8 : uint31(bytes, 4);
      const index = small ? bytes[8] % 32 : uint31(bytes, 12);
      assert.ok(accountNumber < HARDENED_LIMIT && index < HARDENED_LIMIT);

      const path = `m/44'/1'/${accountNumber}'/0'/${index}'`;
      const node = HDKey.fromMasterSeed(mnemonicToSeedSync(phrase, passphrase)).derive(path);
      const account = await sdk.Keys.fromPhrase(phrase, profile, { account: accountNumber, index, passphrase });
      assert.equal(account.path, path, `path of case ${i}`);
      assert.equal(account.publicKey, bytesToHex(node.publicKey), `key of case ${i} (${words} words, ${path})`);
      assert.equal(account.address, address(node.publicKey), `address of case ${i}`);
      await account.release();
    }
    assert.ok(counts[18] > 250 && counts[21] > 250 && counts[24] > 250, JSON.stringify(counts));
  });

  test("phrases the SDK generates are valid BIP39 phrases of 24 words", async () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const phrase = await sdk.Mnemonic.generate();
      assert.equal(phrase.split(" ").length, 24);
      assert.ok(validateMnemonic(phrase, wordlist), phrase);
      seen.add(phrase);
    }
    assert.equal(seen.size, 200);
  });
}
