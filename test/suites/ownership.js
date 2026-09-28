// Ownership proofs: every record of the ownership proof vectors (sdk-rust's
// vectors/sdk/S08-ownership-proofs.jsonl) through the published functions and the test build's
// seam for fixed randomness (the checks of test/shared/ownership-checks.js, which the environment
// loads as `env.ownershipChecks`), a proof round trip with fresh randomness, and the refusals.

const VECTORS = "rs/vectors/sdk/S08-ownership-proofs.jsonl";

export default function suite(test, env) {
  const { sdk, ownership, testSdk, assert } = env;
  const { testing } = testSdk;

  async function records() {
    const lines = (await env.read(VECTORS)).trim().split("\n").map((line) => JSON.parse(line));
    const [meta, ...rest] = lines;
    assert.equal(meta.class, "S08-ownership-proofs");
    assert.equal(meta.sourceNetworkByte, ownership.SOLAR_NETWORK_BYTE);
    assert.equal(rest.length, meta.records);
    return rest;
  }

  /** The output of `fn`, or `{ refused: reason }` for an `InvalidProof`. Any other error fails. */
  async function outcome(fn) {
    try {
      return { output: await fn() };
    } catch (error) {
      assert.ok(error instanceof ownership.InvalidProof, String(error));
      assert.equal(error.code, "InvalidProof");
      assert.equal(error.reason, error.details.reason);
      return { refused: error.reason };
    }
  }

  test("every ownership proof vector runs", async () => {
    assert.ok(testing.hasFixedAux());
    const report = await env.ownershipChecks.run(ownership, { ...testing, ownership: testSdk.ownership }, await records());
    assert.deepEqual(report.failures, []);
    // 112 records match; 7 are the documented cases where the SDK is stricter than the Legacy Signer.
    assert.deepEqual(report.tally, { matched: 112, divergent: 7 });
  });

  test("a proof is built, signed with fresh randomness, verified and read back", async () => {
    const passphrase = new TextEncoder().encode("ownership proof round trip");
    const key = await ownership.SolarKey.fromPassphrase(passphrase);
    assert.ok(passphrase.every((byte) => byte === 0), "the passphrase bytes are wiped");
    assert.match(key.address, /^S[1-9A-HJ-NP-Za-km-z]{33}$/);
    const now = new Date("2026-09-27T08:00:00.000Z");
    const account = await ownership.IceRootAccount.parse("  TICE1XXY02TYLS8D0P0JK8DWXNQJQTS8LY4E87648J8ZQDD7MNFNDXSYQPJ8XTY ");
    assert.deepEqual({ ...account }, { account: "tice1xxy02tyls8d0p0jk8dwxnqjqts8ly4e87648j8zqdd7mnfndxsyqpj8xty", network: "testnet" });
    const nonce = await ownership.OwnershipProof.randomNonce();
    assert.match(nonce, /^[0-9a-f]{64}$/);
    const message = await ownership.OwnershipProof.build({ address: key.address, account: account.account, nonce, issuedAt: now });
    assert.match(message, /\nIssued at: 2026-09-27T08:00:00\.000Z\n/);
    const fields = await ownership.OwnershipProof.parse(message, { address: key.address }, now);
    assert.equal(fields.issuedAtMs, now.getTime());
    assert.equal(fields.accountNetwork, "testnet");

    const proof = await ownership.OwnershipProof.sign(key, message, now);
    const json = await ownership.OwnershipProof.toJson(proof);
    assert.equal(
      json,
      JSON.stringify({
        type: ownership.PROOF_TYPE,
        version: ownership.PROOF_VERSION,
        network: ownership.SOURCE_NETWORK,
        address: proof.address,
        publicKey: proof.publicKey,
        algorithm: ownership.PROOF_ALGORITHM,
        message,
        signature: proof.signature,
      }),
    );
    assert.deepEqual(await ownership.OwnershipProof.verify(proof, now), fields);
    // Signed again with fresh randomness: another signature, the same proof otherwise.
    const again = await ownership.OwnershipProof.sign(key, message, now);
    assert.notEqual(again.signature, proof.signature);
    // Another message's signature does not make a proof.
    const other = await ownership.OwnershipProof.build({
      address: key.address,
      account: account.account,
      nonce: await ownership.OwnershipProof.randomNonce(),
      issuedAt: now,
    });
    assert.equal((await outcome(() => ownership.OwnershipProof.fromSignature(other, proof.publicKey, proof.signature, now))).refused, "signature");
    await key.release();
    assert.ok(key.released);
    await assert.rejects(async () => ownership.OwnershipProof.sign(key, message, now), (error) => error instanceof sdk.KeyReleased);
  });

  test("refusals carry the reason, and wrong arguments are InvalidArgument", async () => {
    assert.equal(
      (await outcome(() => ownership.IceRootAccount.parseCanonical("ICE1XXY02TYLS8D0P0JK8DWXNQJQTS8LY4E87648J8ZQDD7MNFNDXSYQV4QS2H"))).refused,
      "account",
    );
    assert.equal((await outcome(() => ownership.sourceAddress("04" + "00".repeat(32)))).refused, "key");
    assert.equal((await outcome(() => ownership.OwnershipProof.fromJson("{}"))).refused, "json");
    assert.equal((await outcome(() => ownership.OwnershipProof.parse("not a proof", {}, Date.now()))).refused, "format");
    for (const call of [
      () => ownership.OwnershipProof.parse("x", {}, Number.NaN),
      () => ownership.OwnershipProof.parse("x", { address: "" }, 0),
      () => ownership.OwnershipProof.build(null),
      () => ownership.SolarKey.fromPassphrase(42),
    ]) {
      await assert.rejects(async () => call(), (error) => error instanceof sdk.InvalidArgument);
    }
    // The published build has no seam for fixed randomness.
    assert.equal(typeof sdk.testing, "undefined");
  });
}
