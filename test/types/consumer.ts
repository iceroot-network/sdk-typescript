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
  capabilitiesOf,
  init,
  initSync,
  messageAlgorithmOf,
  profiles,
  type AccountInfo,
  type AddressCheck,
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
  const algorithm: "secp256k1-bip340-sha256" | "ml-dsa-65" = messageAlgorithmOf(chain);
  const hasFinality: boolean = capabilitiesOf(chain).has("finality");
  sender.release();
  void [feedback, rules, back.id, vote.fee, text, message, algorithm, hasFinality, AssetId.ROOT];
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
  const rejected = report.outcomes.filter((outcome) => outcome.outcome.status === "rejected").length;
  const reason = error instanceof TxRejected ? error.reason : undefined;
  return `${limit} ${amount} ${weight} ${rejected} ${reason}`;
}

export type Uses = [Draft, Mode, Selection, VoteSnapshot];
