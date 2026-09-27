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
// floor (computed here from the fees the node's pool reports, and by the SDK from the milestone).
//
// The node is reached through the SDK's own client: `connect`, the builders of `net.build`, which
// read each draft's nonce, height and second key from the node, `net.submit`,
// `net.transactions.wait` and the reads. Only the node's raw JSON of a transaction, which the
// client has no call for, is read through `nodeJson` (node-json.js). The second instance is
// reached through `signElsewhere`. Nothing here is specific to Node or to a browser.

import { nodeJson } from "./node-json.js";

const ROOT = 100_000_000n;

/**
 * This run's share of the node's request allowance: the Node and Chromium runs go at the same
 * time from one address, which the node allows 100 requests a minute.
 */
const RATE_LIMIT = { requests: 40, windowMs: 60_000 };

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

async function rejectsCode(promise, code, what) {
  try {
    await promise;
  } catch (error) {
    equal(error.code, code, what);
    return error;
  }
  throw new ScenarioError(`${what}: expected ${code}, nothing was thrown`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the scenario against the node at `relay` (its URL with the API base path). `label` names the
 * run in validator names and logs; `funderPassphrase` is the passphrase of a genesis wallet;
 * `maxHeight` is the last height the chain may reach. `signElsewhere({ draft, profile, phrase,
 * account, index })` signs serialized draft bytes in another WebAssembly instance and resolves to
 * `{ signed, lines }`: the signed transaction's serialized bytes and the review lines that instance
 * showed.
 */
export async function runScenario({ sdk, relay, label, funderPassphrase, maxHeight, signElsewhere, log = () => {} }) {
  const transactions = [];
  let checks = 0;
  const step = (message) => log(`${label}: ${message}`);
  const raw = nodeJson(relay);

  // ---- connect --------------------------------------------------------------------------------
  const options = { rateLimit: RATE_LIMIT };
  const net = await sdk.connect(sdk.profiles.devnet({ relays: [relay] }), options);
  const { chain, configuration, profile } = net;
  equal(profile.chain.nethash, chain.nethash, "connecting pins the chain's network hash");
  equal(configuration.network.nethash, chain.nethash, "the node's configuration names the chain");
  equal(configuration.network.networkByte, chain.networkByte, "the network byte");
  equal([net.token.symbol.length > 0, net.token.decimals], [true, 8], "the token");
  equal(net.stage, "s1", "the format stage");
  check(net.capabilities.has("transfer") && net.capabilities.has("vote"), "transfers and votes are available");
  check(!net.capabilities.has("finality"), "this devnet has no finality");
  check(net.rules.fees.floorAvailable, "the SDK computes the exact fee floor");
  const again = await sdk.connect(profile, options);
  equal(again.chain.nethash, chain.nethash, "the pinned profile connects again");
  const elsewhere = sdk.profiles.devnet({ relays: [relay], nethash: "00".repeat(32) });
  await rejectsCode(sdk.connect(elsewhere, options), "NetworkMismatch", "a profile pinned to another chain");
  await rejectsCode(net.transactions.wait("00".repeat(32), { until: "final" }), "UnsupportedOnNetwork", "waiting for finality");
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

  const height = async () => {
    const now = (await net.node.status()).height;
    check(now <= BigInt(maxHeight), `the chain passed its last height ${maxHeight}`);
    return now;
  };
  const account = (address) => net.accounts.get(address);
  const balance = async (address) => sdk.balanceOf(await account(address));

  // ---- accounts -------------------------------------------------------------------------------
  const funder = net.keys.fromLegacyPassphrase(funderPassphrase);
  check(funder.legacy, "the genesis wallet is a legacy import");
  const phrase = sdk.Mnemonic.generate();
  const words = phrase.split(" ");
  equal(words.length, 24, "a new phrase has 24 words");
  check(sdk.Mnemonic.check(phrase).ok, "the new phrase checks");
  const holder = net.keys.fromPhrase(phrase, { account: 0, index: 0 });
  const payee = net.keys.fromPhrase(phrase, { account: 0, index: 1 });
  equal([holder.path, payee.path], ["m/44'/1'/0'/0'/0'", "m/44'/1'/0'/0'/1'"], "hardened derivation paths");
  const restored = net.keys.fromPhrase(`  ${words.join("\n").toUpperCase()} `, { account: 0, index: 0 });
  equal(restored.address, holder.address, "the phrase restores the account");
  restored.release();
  equal((await account(holder.address)).nonce, 0n, "a new account has never sent anything");
  step(`funder ${funder.address}, new account ${holder.address}`);

  // ---- drafts, submission, read-back ----------------------------------------------------------
  /** Builds `operation` with its own builder of `net.build`. */
  function builder(operation, options) {
    switch (operation.kind) {
      case "transfer":
        return net.build.transfer({ ...options, to: operation.to });
      case "vote":
        return net.build.vote({ ...options, entries: operation.entries });
      case "burn":
        return net.build.burn({ ...options, amount: operation.amount });
      case "register-second-key":
        return net.build.registerSecondKey({ ...options, secondKey: operation.publicKey });
      case "register-validator":
        return net.build.registerValidator({ ...options, name: operation.name });
      case "resign-validator":
        return net.build.resignValidator({ ...options, resignation: operation.resignation });
      default:
        return net.build.draft(operation, options);
    }
  }

  /**
   * A draft of `operation` by `sender`. The builder reads the facts from the node (the next nonce
   * and height, and the sender's second key) and takes the default fee, which must be the floor.
   * With `below`, the same transaction is built again with an exact fee that many base units under
   * the floor.
   */
  async function build(operation, sender, { memo, below = 0n } = {}) {
    await height();
    const options = { from: sender, ...(memo === undefined ? {} : { memo }) };
    const draft = await builder(operation, options);
    const info = await account(sender.address);
    equal([draft.nonce, draft.summary.from], [info.nonce + 1n, sender.address], `the ${draft.kind} draft's nonce and sender`);
    equal(draft.summary.secondSignature, info.secondPublicKey !== undefined, "the draft knows the sender's second key");
    equal(draft.summary.fee.source, "floor", "the default fee's source");
    equal(draft.fee, nodeFloor(draft.kind, draft.size), `the ${draft.kind} fee is the floor`);
    if (below === 0n) {
      return draft;
    }
    const low = await builder(operation, { ...options, fee: draft.fee - below });
    equal(low.size, draft.size, "the size does not depend on the fee");
    equal([low.fee, low.summary.fee.source], [draft.fee - below, "explicit"], "the exact fee");
    return low;
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
    const json = { ...(await raw.transaction(signed.id)) };
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
    const outcome = await net.submit(signed);
    equal(outcome.id, signed.id, "the outcome's id");
    check(outcome.status === "accepted", `${signed.summary.kind} ${signed.id} refused: ${text(outcome)}`);
    const waited = await net.transactions.wait(signed.id, { until: "confirmed", timeoutMs: 120_000 });
    equal([waited.state, waited.id], ["confirmed", signed.id], `the wait for ${signed.id}`);
    const record = waited.record;
    check(waited.confirmations >= 1n && record.block !== undefined, "the transaction is in a block");
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
    const outcome = await net.submit(signed);
    equal([outcome.id, outcome.status], [signed.id, "rejected"], what);
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
  equal(sdk.balanceOf(funderAfter), sdk.balanceOf(funderBefore) - 1_001n * ROOT - funded.summary.fee, "the funder's balance");
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
    equal([info.nonce, sdk.balanceOf(info)], [nonce, holderBalance], `the new account after ${what}`);
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
  equal((await net.validators.get(name))?.status, "resigned-temporary", "the validator resigned");
  const resolved = await net.names.resolve(name);
  equal([resolved?.name, resolved?.address, resolved?.publicKey], [name, holder.address, holder.publicKey], "the name resolves to the account");
  equal(await net.names.resolve(`nobody_${label}`), null, "a name nobody registered");

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

  await height();
  const rules = net.rules;
  equal(rules.transfer.maxRecipients, 256, "recipients per transfer");
  const recipients = Array.from({ length: 256 }, (_, i) => {
    const key = net.keys.fromLegacyPassphrase(`sdk e2e ${label} ${phrase.slice(0, 8)} recipient ${i}`);
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
  const secondKey = net.keys.fromPhrase(phrase, { account: 1, index: 0 });
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

  // ---- reads of what the account did --------------------------------------------------------
  const sent = await net.history.forAccount(holder.address, { direction: "sent", limit: 50 });
  const sentIds = new Set(sent.items.map((record) => record.id));
  check(
    transactions.filter((tx) => tx.sender === holder.address).every((tx) => sentIds.has(tx.id)),
    "the account's history holds every transaction it sent",
  );
  const received = await net.history.forAccount(holder.address, { direction: "received" });
  check(received.items.some((record) => record.id === funded.id), "the account's history holds its funding");
  const fundingRecord = await net.transactions.get(funded.id);
  const fundingBlock = await net.blocks.get(fundingRecord.block.height);
  equal([fundingBlock?.id, fundingBlock?.height], [fundingRecord.block.id, fundingRecord.block.height], "the funding's block by height");
  check((await net.blocks.latest()).height >= fundingBlock.height, "the latest block is at or above it");
  const inBlock = await net.blocks.transactions(fundingRecord.block.id);
  check(inBlock.items.some((record) => record.id === funded.id), "the block's transactions hold the funding");
  const supply = await net.economics.supply();
  check(supply.supply > 0n && supply.height > 0n, "the supply the node reports");
  checks += 1;

  // ---- a vote for 20 validators, and its withdrawal -------------------------------------------
  // The node takes votes only for validators that operate a node; they announce it as the chain
  // runs, at the latest in the second round.
  let operating = [];
  for (let attempt = 0; ; attempt++) {
    operating = (await net.validators.list()).items.filter((v) => v.status === "active" && v.version !== undefined).map((v) => v.name);
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
  const signature = net.messages.sign(holder, message);
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
