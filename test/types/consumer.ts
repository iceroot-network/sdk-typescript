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
} from "@iceroot-network/sdk";
import type { Mode, Selection, VoteSnapshot } from "@iceroot-network/sdk/vote";

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
    statistics,
  );
  const summary: DraftSummary = draft.summary;
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
  void [feedback, rules, back.id, vote.fee, text, message, expires, algorithm, hasFinality, AssetId.ROOT];
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
  return `${pinned} ${maxEntries} ${seats} ${burned} ${balance} ${more} ${validators.total} ${validator?.name} ${reason} ${confirmations}`;
}

export type Uses = [Draft, Mode, Selection, VoteSnapshot];
