// Compiled against the published declarations (dist/web/*.d.ts) through the package's exports, as
// an app sees them. Nothing here runs; the compiler checks the public types.

import {
  Account,
  Address,
  Amount,
  AssetId,
  Chain,
  Draft,
  IceRootError,
  InvalidAddress,
  Keys,
  Messages,
  Mnemonic,
  SignIn,
  SignedTransaction,
  TxRejected,
  balanceOf,
  capabilitiesOf,
  connect,
  init,
  initSync,
  messageAlgorithmOf,
  profiles,
  type AccountInfo,
  type AddressCheck,
  type Network,
  type Page,
  type TxWaitResult,
  type DraftSummary,
  type ErrorCode,
  type FeeStatistics,
  type MessageSignature,
  type NetworkProfile,
  type NodeConfiguration,
  type PhraseCheck,
  type Rules,
  type SubmitReport,
  type Transport,
  type TxRecord,
  type ValidatorInfo,
  type WatchedAccount,
  type WatchEvent,
} from "@iceroot-network/sdk";
import {
  BreaksRules,
  VoteRules,
  VoteSnapshot,
  check,
  select,
  split,
  validateVote,
  type Mode,
  type Reason,
  Selection,
} from "@iceroot-network/sdk/vote";
import * as keystore from "@iceroot-network/sdk/keystore";
import * as ownership from "@iceroot-network/sdk/ownership";

export async function example(bytes: Uint8Array, transport: Transport): Promise<string> {
  await init();
  await init(new URL("https://example.com/iceroot_sdk_bg.wasm"));
  initSync(bytes);

  const devnet: NetworkProfile = profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });
  const account: Account = Keys.fromLegacyPassphrase("passphrase", devnet);
  const signed: MessageSignature = Messages.sign(account, "hello");
  const valid: boolean = Messages.verify({ ...signed, message: "hello" }, devnet);
  const check: AddressCheck = Address.check(account.address, { profile: devnet });
  account.release();

  try {
    Address.parse("d...", devnet);
  } catch (error) {
    if (error instanceof InvalidAddress) {
      const reason: "checksum" | "length" | "wrong-network" | "format" = error.reason;
      return reason;
    }
    if (error instanceof IceRootError) {
      const code: ErrorCode = error.code;
      return code;
    }
  }
  void transport;
  return `${valid} ${check.ok}`;
}

export function transactions(configuration: string, statistics: FeeStatistics, account: AccountInfo): bigint {
  // A draft's fee never comes from the node's statistics, which are for display only.
  const shown: bigint | undefined = statistics.entries[0]?.max;
  const phrase: string = Mnemonic.generate();
  const feedback: PhraseCheck = Mnemonic.check(phrase);
  const chain = Chain.load(profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] }), configuration);
  const pinned: NetworkProfile = chain.profile;
  const rules: Rules = chain.rules(2);
  const sender = Keys.fromPhrase(phrase, chain, { account: 0, index: 0 });
  const draft = Draft.build(
    chain,
    {
      operation: { kind: "transfer", to: [{ address: account.address, amount: Amount.parse("1.5", chain.token.decimals) }] },
      memo: "invoice 42",
      fee: "minimum",
    },
    { sender, nonce: account.nonce + 1n, height: 2 },
  );
  // @ts-expect-error Draft.build takes no fee statistics.
  Draft.build(chain, { operation: { kind: "burn", amount: 2_000_000n } }, { sender, nonce: 1n, height: 2 }, statistics);
  const summary: DraftSummary = draft.summary;
  const source: "floor" | "explicit" = summary.fee.source;
  const floorInForce: boolean = rules.fees.floorAvailable;
  const again = Draft.deserialize(draft.serialize(), pinned);
  const signed: SignedTransaction = again.sign(sender);
  const back = SignedTransaction.deserialize(signed.serialize(), pinned);
  const vote = Draft.build(
    chain,
    { operation: { kind: "vote", entries: [{ validator: "genesis_1", basisPoints: 10_000 }] }, fee: 1_000_000n },
    { sender: sender.publicKey, nonce: 2n, height: 2 },
  );
  const text: string = Amount.format(summary.total, chain.token.decimals, { maxFraction: 2, grouping: true });
  const message: string = SignIn.build(
    { origin: "https://example.com", publicKey: sender.publicKey, nonce: "00".repeat(32), issuedAt: new Date(), expiresAt: new Date() },
    chain,
  );
  const fields = SignIn.parse(message, chain, {
    origin: "https://example.com",
    address: sender.address,
    publicKey: sender.publicKey,
    now: new Date(),
  });
  const expires: Date = fields.expiresAt;
  const algorithm: "secp256k1-bip340-sha256" | "ml-dsa-65" = messageAlgorithmOf(chain);
  const hasFinality: boolean = capabilitiesOf(chain).has("finality");
  sender.release();
  void [feedback, rules, back.id, vote.fee, text, message, expires, algorithm, hasFinality, AssetId.ROOT, shown, source, floorInForce];
  return summary.fee.amount + BigInt(rules.memo.maxBytes);
}

export function records(
  configuration: NodeConfiguration,
  history: readonly TxRecord[],
  validators: readonly ValidatorInfo[],
  report: SubmitReport,
  error: unknown,
): string {
  const limit: number = configuration.pool.maxTransactionsPerRequest;
  const first = history[0];
  const amount = first?.details.kind === "transfer" ? first.details.recipients[0]?.amount : undefined;
  const weight: bigint | undefined = validators[0]?.voteWeight;
  const rejected = report.outcomes.filter((outcome) => outcome.status === "rejected").length;
  const reason = error instanceof TxRejected ? error.reason : undefined;
  return `${limit} ${amount} ${weight} ${rejected} ${reason}`;
}

export async function client(transport: Transport, account: Account): Promise<string> {
  const net: Network = await connect(profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] }), {
    transport,
    headers: { authorization: "Bearer token" },
    rateLimit: { requests: 100, windowMs: 60_000 },
    timeoutMs: 10_000,
  });
  const pinned: string | undefined = net.profile.chain.nethash;
  const maxEntries: number = net.rules.vote.maxEntries;
  const seats: number = net.economics.seats;
  const burned: bigint = (await net.economics.supply()).burned.total;
  const info: AccountInfo = await net.accounts.get(account.address);
  const balance: bigint = balanceOf(info);
  const page: Page<TxRecord> = await net.history.forAccount(account.address, { direction: "sent", limit: 25 });
  const more: boolean = page.hasNext;
  const validators: Page<ValidatorInfo> = await net.validators.list({ page: 1, limit: 100 });
  const validator: ValidatorInfo | null = await net.validators.get("genesis_1");
  const draft = await net.build.transfer({ from: account, to: [{ address: account.address, amount: 1n }], memo: "x" });
  const signed = draft.sign(account);
  const outcome = await net.submit(signed);
  const reason = outcome.status === "rejected" ? outcome.reason : outcome.broadcast;
  const result: TxWaitResult = await net.transactions.wait(signed.id, { until: "confirmed", timeoutMs: 60_000 });
  const confirmations = result.state === "dropped" ? 0n : result.confirmations;
  const watched: WatchedAccount = net.keys.watch(account.address);
  const heights: bigint[] = [];
  const stop: () => void = net.watch({ address: watched }, (event: WatchEvent) => {
    if (event.type === "block") {
      heights.push(event.block.height);
    } else if (event.type === "transaction") {
      heights.push(event.transaction.nonce);
    }
  }, { intervalMs: 8_000, signal: new AbortController().signal });
  stop();
  return `${pinned} ${maxEntries} ${seats} ${burned} ${balance} ${more} ${validators.total} ${validator?.name} ${reason} ${confirmations} ${watched.address} ${heights.length}`;
}

export type Uses = [Draft, Mode, Selection, VoteSnapshot];

export async function voting(net: Network, account: Account, saved: string): Promise<string> {
  const snapshot: VoteSnapshot = await VoteSnapshot.fromNode(net, { firstForged: true });
  const mode: Mode = "diversity";
  const rules: VoteRules = VoteRules.of(net);
  let selection: Selection;
  try {
    selection = select(snapshot, { mode, account: account.address, rules, count: 20, draw: 0 });
  } catch (error) {
    if (error instanceof BreaksRules) {
      return error.problems.map((problem) => problem.reason).join(", ");
    }
    throw error;
  }
  const lines: string[] = selection.entries.flatMap((pick) => pick.reasons.map((reason: Reason) => reason.text));
  const drawn = selection.entries[0]?.reasons.find((reason) => reason.kind === "drawn");
  const weight: bigint | undefined = drawn?.kind === "drawn" ? drawn.totalWeight : undefined;
  const findings = check(Selection.deserialize(saved), snapshot);
  const problems = validateVote(split(["genesis_1", "genesis_2"]), rules, "ordinary");
  const draft = await net.build.vote({ from: account, entries: selection.vote });
  return `${lines.length} ${weight} ${findings.length} ${problems.length} ${draft.summary.fee.amount} ${Selection.serialize(selection).length}`;
}

export function keys(phrase: string, password: Uint8Array, stored: Uint8Array | string): string {
  const bytes: Uint8Array = keystore.encrypt(phrase, password, "web");
  const header: keystore.KeystoreHeader = keystore.inspect(bytes);
  const opened: keystore.DecryptedPhrase = keystore.decrypt(stored, password, { maxMemoryKib: 65_536 });
  const words: 18 | 21 | 24 = opened.words;
  opened.phrase.fill(0);
  const upgrade: boolean = keystore.isWeakerThan(header, keystore.PRESETS.web);
  const text: string = keystore.armor(keystore.reencrypt(bytes, password, "web"));
  try {
    keystore.decrypt(text, "wrong");
  } catch (error) {
    if (error instanceof keystore.WrongPasswordOrCorrupt || error instanceof keystore.Malformed) {
      return error.code;
    }
  }
  return `${words} ${upgrade} ${text.length}`;
}

export function proofs(passphrase: string, typedAccount: string, pasted: string, now: Date): string {
  const key: ownership.SolarKey = ownership.SolarKey.fromPassphrase(passphrase);
  const account: ownership.ParsedAccount = ownership.IceRootAccount.parse(typedAccount);
  const network: ownership.AccountNetwork = account.network;
  const message: string = ownership.OwnershipProof.build({
    address: key.address,
    account: account.account,
    nonce: ownership.OwnershipProof.randomNonce(),
    issuedAt: now,
  });
  const fields: ownership.ProofFields = ownership.OwnershipProof.parse(message, { address: key.address }, now);
  const proof: ownership.OwnershipProof = ownership.OwnershipProof.sign(key, message, now.getTime());
  key.release();
  const json: string = ownership.OwnershipProof.toJson(proof);
  const again = ownership.OwnershipProof.fromSignature(message, proof.publicKey, proof.signature, now);
  const source: string = ownership.sourceAddress(again.publicKey);
  try {
    ownership.OwnershipProof.verify(ownership.OwnershipProof.fromJson(pasted), now);
  } catch (error) {
    if (error instanceof ownership.InvalidProof) {
      const reason: ownership.ProofProblem = error.reason;
      return reason;
    }
  }
  return `${network} ${fields.issuedAtMs} ${json.length} ${source} ${ownership.SOLAR_NETWORK_BYTE}`;
}
