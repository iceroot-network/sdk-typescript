// The devnet end-to-end scenario, shared by Node and Chromium.
//
// Against a running devnet, through the SDK's WebAssembly build: connect and pin the chain, import a
// genesis wallet with the legacy passphrase import, create an account from a new recovery phrase
// (and restore it from its words), fund it, then from it: a validator registration and a temporary
// resignation, a revoke that the node refuses, a transfer with a memo, a transfer to 256
// recipients, a transfer built here and signed in a second WebAssembly instance that has no
// network, a burn, a second key and a transfer signed with it, a fee one base unit below the floor
// that the node refuses, a vote for 20 validators and its withdrawal, and a signed message.
//
// The node takes a revoke only from a validator that operates a node, as it takes votes only for
// such validators; the new validator runs none, so its revoke is refused for that reason, after
// the node has read its bytes, signature and fee. The revoke's bytes are checked against the
// reference implementation by the SDK's transaction vectors.
//
// After each transaction: it is forged, the node's JSON is the signed JSON, the node's record
// carries what was signed, balances and nonces change exactly as expected, and the fee is the
// floor (computed from the fees the node's pool reports).
//
// The node is reached through `node` (node-api.js today; the SDK's node client once it exists) and
// the second instance through `signElsewhere`. Nothing here is specific to Node or to a browser.

const ROOT = 100_000_000n;

class ScenarioError extends Error {}

function text(value) {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? `${v}n` : v));
}

function check(condition, message) {
  if (!condition) {
    throw new ScenarioError(message);
  }
}

function equal(actual, expected, what) {
  if (text(actual) !== text(expected)) {
    throw new ScenarioError(`${what}: expected ${text(expected)}, got ${text(actual)}`);
  }
}

/** A value with the keys of every object sorted, for comparing JSON regardless of key order. */
function sorted(value) {
  if (Array.isArray(value)) {
    return value.map(sorted);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])]),
    );
  }
  return value;
}

function throwsCode(fn, code, what) {
  try {
    fn();
  } catch (error) {
    equal(error.code, code, what);
    return error;
  }
  throw new ScenarioError(`${what}: expected ${code}, nothing was thrown`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the scenario. `label` names the run in validator names and logs; `funderPassphrase` is the
 * passphrase of a genesis wallet; `maxHeight` is the last height the chain may reach.
 * `signElsewhere({ draft, profile, phrase, account, index })` signs serialized draft bytes in
 * another WebAssembly instance and resolves to `{ signed, lines }`: the signed transaction's
 * serialized bytes and the review lines that instance showed.
 */
export async function runScenario({ sdk, node, label, funderPassphrase, maxHeight, signElsewhere, log = () => {} }) {
  const transactions = [];
  let checks = 0;
  const step = (message) => log(`${label}: ${message}`);

  // ---- connect --------------------------------------------------------------------------------
  const configuration = await node.node.configuration();
  const crypto = await node.node.cryptoConfiguration();
  const relayProfile = sdk.profiles.devnet({ relays: [node.relay] });
  const chain = sdk.Chain.load(relayProfile, crypto);
  const profile = chain.profile;
  equal(profile.chain.nethash, chain.nethash, "the profile is pinned to the chain");
  equal(configuration.network.nethash, chain.nethash, "the node's configuration names the chain");
  equal(configuration.network.networkByte, chain.networkByte, "the network byte");
  equal([chain.token.symbol.length > 0, chain.token.decimals], [true, 8], "the token");
  check(chain.capabilities.has("transfer") && chain.capabilities.has("vote"), "transfers and votes are available");
  check(!chain.capabilities.has("finality"), "this devnet has no finality");
  const elsewhere = sdk.profiles.devnet({ relays: relayProfile.api.relays, nethash: "00".repeat(32) });
  throwsCode(() => sdk.Chain.load(elsewhere, crypto), "NetworkMismatch", "a profile pinned to another chain");
  checks += 1;

  const fees = configuration.poolFees;
  /** The floor from the node's pool fees: (addonBytes + ceil(size / 2)) x minFee; 0 for burns and resignations. */
  const nodeFloor = (kind, size) => {
    if (!fees.dynamic || kind === "burn" || kind === "resign-validator") {
      return 0n;
    }
    const addon = fees.addonBytes.find((entry) => entry.kind === kind)?.bytes ?? 0n;
    const minFee = fees.minFeePool > 1n ? fees.minFeePool : 1n;
    return (addon + BigInt(Math.ceil(size / 2))) * minFee;
  };

  const status = () => node.node.status();
  const height = async () => {
    const now = (await status()).height;
    check(now <= BigInt(maxHeight), `the chain passed its last height ${maxHeight}`);
    return now;
  };
  const account = (address) => node.accounts.get(String(address));
  const balance = async (address) => (await account(address)).balances[0].amount;

  // ---- accounts -------------------------------------------------------------------------------
  const funder = sdk.Keys.fromLegacyPassphrase(funderPassphrase, profile);
  check(funder.legacy, "the genesis wallet is a legacy import");
  const phrase = sdk.Mnemonic.generate();
  const words = phrase.split(" ");
  equal(words.length, 24, "a new phrase has 24 words");
  check(sdk.Mnemonic.check(phrase).ok, "the new phrase checks");
  const holder = sdk.Keys.fromPhrase(phrase, profile, { account: 0, index: 0 });
  const payee = sdk.Keys.fromPhrase(phrase, profile, { account: 0, index: 1 });
  equal([holder.path, payee.path], ["m/44'/1'/0'/0'/0'", "m/44'/1'/0'/0'/1'"], "hardened derivation paths");
  const restored = sdk.Keys.fromPhrase(`  ${words.join("\n").toUpperCase()} `, profile, { account: 0, index: 0 });
  equal(restored.address, holder.address, "the phrase restores the account");
  restored.release();
  equal((await account(holder.address)).nonce, 0n, "a new account has never sent anything");
  step(`funder ${funder.address}, new account ${holder.address}`);

  // ---- drafts, submission, read-back ----------------------------------------------------------
  /**
   * A draft of `operation` by `sender`, with the facts the node reports: the next nonce and height
   * and the sender's second key. When this build computes the fee floor, the draft takes the
   * default fee choice and must come out at the floor; until then the floor from the node's fees
   * is given as an exact fee, `below` base units under it.
   */
  async function build(operation, sender, { memo, below = 0n } = {}) {
    const [now, info] = await Promise.all([height(), account(sender.address)]);
    const facts = {
      sender,
      nonce: info.nonce + 1n,
      height: Number(now + 1n),
      ...(info.secondPublicKey === undefined ? {} : { secondKey: info.secondPublicKey }),
    };
    const request = (fee) => ({ operation, ...(memo === undefined ? {} : { memo }), fee });
    if (chain.rules(facts.height).fees.floorAvailable) {
      const draft = sdk.Draft.build(chain, request("minimum"), facts);
      equal(draft.summary.fee.source, "floor", "the default fee's source");
      equal(draft.fee, nodeFloor(draft.kind, draft.size), `the ${draft.kind} fee is the floor`);
      if (below === 0n) {
        return draft;
      }
    }
    const probe = sdk.Draft.build(chain, request(1n), facts);
    const floor = nodeFloor(probe.kind, probe.size);
    const draft = sdk.Draft.build(chain, request(floor - below), facts);
    equal(draft.size, probe.size, "the size does not depend on the fee");
    equal(draft.fee, floor - below, "the fee");
    return draft;
  }

  /** The node's record and JSON of a signed transaction match it. */
  async function checkForged(signed, record) {
    const s = signed.summary;
    equal(
      [record.id, record.status, record.sender, record.senderPublicKey, record.nonce, record.fee, record.memo, record.secondSigned],
      [signed.id, "confirmed", s.from, s.publicKey, s.nonce, s.fee, s.memo, s.secondSignature],
      `the node's record of ${s.kind} ${signed.id}`,
    );
    const details = record.details;
    equal(details.kind, s.kind, "the node's kind");
    switch (s.kind) {
      case "transfer":
        equal(
          details.recipients,
          s.operation.to.map(({ address, amount }) => ({ address: String(address), amount })),
          "the recipients",
        );
        break;
      case "vote":
        equal(details.entries, s.operation.entries, "the vote entries");
        break;
      case "burn":
        equal(details.amount, s.operation.amount, "the burned amount");
        break;
      case "register-second-key":
        equal(details.publicKey, s.operation.publicKey, "the second key");
        break;
      case "register-validator":
        equal(details.name, s.operation.name, "the validator name");
        break;
      case "resign-validator":
        equal(details.resignation, s.operation.resignation, "the resignation");
        break;
    }
    // The node's own JSON is the signed JSON, plus where the node put it.
    const json = { ...(await node.transactions.json(signed.id)) };
    for (const key of ["blockId", "blockHeight", "sequence", "burnedFee"]) {
      delete json[key];
    }
    if (!("typeGroup" in signed.json)) {
      equal(json.typeGroup, 1, "the node's type group of a group 1 transaction");
      delete json.typeGroup;
    }
    equal(sorted(json), sorted(signed.json), `the node's JSON of ${signed.id}`);
    checks += 1;
  }

  /** Submits a signed transaction, waits until it is forged and checks what the node reports. */
  async function submit(signed) {
    const report = await node.submit(signed);
    equal(report.outcomes.length, 1, "one outcome");
    const [{ id, outcome }] = report.outcomes;
    equal(id, signed.id, "the outcome's id");
    check(outcome.status === "accepted", `${signed.summary.kind} ${signed.id} refused: ${text(outcome)}`);
    const record = await node.transactions.wait(signed.id, { until: "confirmed" });
    await checkForged(signed, record);
    transactions.push({ id: signed.id, sender: signed.summary.from, nonce: String(signed.summary.nonce), kind: signed.summary.kind });
    step(`${signed.summary.kind} ${signed.id} forged at height ${record.block.height}, fee ${signed.summary.fee}`);
    return record;
  }

  /** Signs with the sender (and its second key) and submits. */
  async function send(draft, sender, secondKey) {
    const signed = draft.sign(sender, secondKey === undefined ? {} : { secondKey });
    check(signed.verified, "the signature verifies");
    return { signed, record: await submit(signed) };
  }

  /** Submits a transaction the node must refuse: the outcome. */
  async function refused(signed, what) {
    const report = await node.submit(signed);
    const [{ outcome }] = report.outcomes;
    equal(outcome.status, "rejected", what);
    step(`${what}: refused, ${outcome.nodeCode} (${outcome.reason}): ${outcome.message}`);
    checks += 1;
    return outcome;
  }

  // ---- funding --------------------------------------------------------------------------------
  const funderBefore = await account(funder.address);
  const funding = await build(
    { kind: "transfer", to: [{ address: holder.address, amount: 1_000n * ROOT }, { address: payee.address, amount: ROOT }] },
    funder,
    { memo: `sdk-typescript e2e ${label}: funding` },
  );
  equal(funding.summary.lines.length, 4, "a review line per recipient, the memo and the fee");
  const { signed: funded } = await send(funding, funder);
  const funderAfter = await account(funder.address);
  equal(funderAfter.nonce, funderBefore.nonce + 1n, "the funder's nonce");
  equal(funderAfter.balances[0].amount, funderBefore.balances[0].amount - 1_001n * ROOT - funded.summary.fee, "the funder's balance");
  let holderBalance = 1_000n * ROOT;
  let payeeBalance = ROOT;
  equal(await balance(holder.address), holderBalance, "the new account's balance");
  equal(await balance(payee.address), payeeBalance, "the second address's balance");
  let nonce = 0n;

  /** After a transaction of the holder: its nonce is one more and its balance is as expected. */
  async function holderAfter(spent, what) {
    nonce += 1n;
    holderBalance -= spent;
    const info = await account(holder.address);
    equal([info.nonce, info.balances[0].amount], [nonce, holderBalance], `the new account after ${what}`);
    return info;
  }

  // ---- validator registration and a temporary resignation --------------------------------------
  const name = `e2e_${label}_${holder.address.slice(-5).toLowerCase()}`.slice(0, 20);
  let draft = await build({ kind: "register-validator", name }, holder);
  let { signed } = await send(draft, holder);
  equal((await holderAfter(signed.summary.fee, "the registration")).validatorName, name, "the validator name");
  check(signed.summary.fee > 75n * ROOT, "the registration pays its surcharge");

  draft = await build({ kind: "resign-validator", resignation: "temporary" }, holder);
  equal(draft.fee, 0n, "a resignation's floor is zero");
  let record;
  ({ signed, record } = await send(draft, holder));
  const resignedAt = record.block.height;
  await holderAfter(signed.summary.fee, "the resignation");
  equal((await node.validators.get(name)).status, "resigned-temporary", "the validator resigned");

  const revokeWait = chain.rules(Number(resignedAt) + 1).resignation.blocksBeforeRevoke;
  check(typeof revokeWait === "number" && revokeWait > 0, "a revoke waits some blocks");
  draft = await build({ kind: "resign-validator", resignation: "revoke" }, holder);
  equal(draft.summary.lines, ["Revoke the temporary validator resignation", "Fee 0 " + chain.token.symbol], "the revoke's review lines");
  const revoke = await refused(draft.sign(holder), "a revoke by a validator that operates no node");
  equal([revoke.nodeCode, revoke.reason], ["ERR_APPLY", "invalid"], "the refusal of the revoke");
  check(revoke.message.includes("not operating a node"), `the reason of the refusal: ${revoke.message}`);
  equal((await account(holder.address)).nonce, nonce, "a refused revoke leaves the nonce");

  // ---- transfers ------------------------------------------------------------------------------
  const memo = `sdk-typescript e2e ✓ ${label}`;
  draft = await build({ kind: "transfer", to: [{ address: sdk.Address.parse(payee.address, profile), amount: sdk.Amount.parse("1.5", 8) }] }, holder, { memo });
  ({ signed, record } = await send(draft, holder));
  equal(record.memo, memo, "the memo");
  await holderAfter(150_000_000n + signed.summary.fee, "the transfer with a memo");
  payeeBalance += 150_000_000n;
  equal(await balance(payee.address), payeeBalance, "the second address's balance");

  const rules = chain.rules(Number(await height()) + 1);
  equal(rules.transfer.maxRecipients, 256, "recipients per transfer");
  const recipients = Array.from({ length: 256 }, (_, i) => {
    const key = sdk.Keys.fromLegacyPassphrase(`sdk e2e ${label} ${phrase.slice(0, 8)} recipient ${i}`, profile);
    key.release();
    return { address: key.address, amount: BigInt(i + 1) };
  });
  draft = await build({ kind: "transfer", to: recipients }, holder, { memo: "256 recipients" });
  ({ signed } = await send(draft, holder));
  await holderAfter(BigInt((256 * 257) / 2) + signed.summary.fee, "the transfer to 256 recipients");
  for (const i of [0, 127, 255]) {
    equal(await balance(recipients[i].address), BigInt(i + 1), `recipient ${i}'s balance`);
  }

  // Built here, signed in a second WebAssembly instance that has no network, submitted from here.
  draft = await build({ kind: "transfer", to: [{ address: payee.address, amount: ROOT / 4n }] }, holder, { memo: "signed elsewhere" });
  const bytes = draft.serialize();
  const foreign = { ...profile, chain: { ...profile.chain, nethash: "00".repeat(32) } };
  throwsCode(() => sdk.Draft.deserialize(bytes, foreign), "NetworkMismatch", "a draft read for another chain");
  const elsewhereResult = await signElsewhere({ draft: bytes, profile, phrase, account: 0, index: 0 });
  equal(elsewhereResult.lines, draft.summary.lines, "the signing instance shows what was built");
  signed = sdk.SignedTransaction.deserialize(elsewhereResult.signed, profile);
  check(signed.verified, "the transaction signed elsewhere verifies");
  equal(signed.summary.nonce, draft.nonce, "the nonce signed elsewhere");
  await submit(signed);
  await holderAfter(ROOT / 4n + signed.summary.fee, "the transfer signed elsewhere");
  payeeBalance += ROOT / 4n;

  // ---- burn -----------------------------------------------------------------------------------
  const minBurn = rules.burn.minAmount;
  draft = await build({ kind: "burn", amount: minBurn }, holder);
  ({ signed } = await send(draft, holder));
  await holderAfter(minBurn + signed.summary.fee, "the burn");

  // ---- a second key, and a transfer it co-signs -----------------------------------------------
  const secondKey = sdk.Keys.fromPhrase(phrase, profile, { account: 1, index: 0 });
  draft = await build({ kind: "register-second-key", publicKey: secondKey.publicKey }, holder);
  ({ signed } = await send(draft, holder));
  equal((await holderAfter(signed.summary.fee, "the second key")).secondPublicKey, secondKey.publicKey, "the second key");

  draft = await build({ kind: "transfer", to: [{ address: payee.address, amount: ROOT }] }, holder, { memo: "second-signed" });
  check(draft.summary.secondSignature, "the draft needs the second key");
  throwsCode(() => draft.sign(holder), "WrongKey", "signing without the second key");
  ({ signed, record } = await send(draft, holder, secondKey));
  check(record.secondSigned && signed.verifySecondSignature(secondKey.publicKey), "the second signature");
  await holderAfter(ROOT + signed.summary.fee, "the second-signed transfer");
  payeeBalance += ROOT;
  equal(await balance(payee.address), payeeBalance, "the second address's balance");

  // ---- the fee floor's edge -------------------------------------------------------------------
  draft = await build({ kind: "transfer", to: [{ address: payee.address, amount: 1n }] }, holder, { below: 1n });
  const low = await refused(draft.sign(holder, { secondKey }), "a fee one base unit below the floor");
  equal([low.reason, low.nodeCode], ["low-fee", "ERR_LOW_FEE"], "the refusal of a fee below the floor");
  equal((await account(holder.address)).nonce, nonce, "a refused transaction leaves the nonce");

  // ---- a vote for 20 validators, and its withdrawal -------------------------------------------
  // The node takes votes only for validators that operate a node; they announce it as the chain
  // runs, at the latest in the second round.
  let operating = [];
  for (let attempt = 0; ; attempt++) {
    operating = (await node.validators.list()).filter((v) => v.status === "active" && v.version !== undefined).map((v) => v.name);
    if (operating.length >= 20) {
      break;
    }
    check(attempt < 120, "20 validators operate a node");
    if (attempt === 0) {
      step(`waiting for validators to announce themselves (${operating.length} so far)`);
    }
    await height();
    await sleep(configuration.blockTime * 2_000);
  }
  const entries = operating.slice(0, 20).reverse().map((validator) => ({ validator, basisPoints: 500 }));
  draft = await build({ kind: "vote", entries }, holder);
  const canonical = draft.summary.operation.entries;
  equal(canonical.length, 20, "20 entries");
  ({ signed } = await send(draft, holder, secondKey));
  equal((await holderAfter(signed.summary.fee, "the vote")).vote, canonical, "the account's vote");

  draft = await build({ kind: "vote", entries: [] }, holder);
  equal(draft.summary.lines[0], "Withdraw the current vote", "the withdrawal's review line");
  ({ signed } = await send(draft, holder, secondKey));
  equal((await holderAfter(signed.summary.fee, "the withdrawal")).vote, [], "no vote after the withdrawal");

  // ---- a signed message, which the Rust SDK checks too ----------------------------------------
  const message = `IceRoot SDK end-to-end ${label}: ${holder.address} at ${new Date().toISOString()}`;
  const signature = sdk.Messages.sign(holder, message);
  check(sdk.Messages.verify({ ...signature, message }, profile), "the message verifies");
  check(!sdk.Messages.verify({ ...signature, message: `${message}.` }, profile), "a changed message does not verify");
  checks += 1;

  for (const key of [funder, holder, payee, secondKey]) {
    key.release();
  }
  const finalHeight = await height();
  step(`done at height ${finalHeight}: ${transactions.length} transactions forged, ${checks} checks`);
  return { label, transactions, message: { message, ...signature }, finalHeight: String(finalHeight), checks };
}
