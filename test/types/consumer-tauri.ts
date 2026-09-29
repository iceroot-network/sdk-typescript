// The Tauri plugin's entry, compiled against the published declarations (dist/web/tauri/*.d.ts)
// through the package's exports, as an app sees them. The same calls as consumer.ts, awaited: code
// written this way runs on either entry. Nothing here runs; the compiler checks the public types.

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
  type SignInSigning,
  SignedTransaction,
  TxRejected,
  balanceOf,
  bindingsVersion,
  capabilitiesOf,
  connect,
  init,
  isInitialized,
  messageAlgorithmOf,
  profiles,
  type AccountInfo,
  type AddressCheck,
  type DraftRequest,
  type DraftSummary,
  type FeeSource,
  type ErrorCode,
  type KeystoreAccountOptions,
  type MessageSignature,
  type Network,
  type NetworkProfile,
  type Page,
  type PhraseCheck,
  type Recipient,
  type Rules,
  type TxRecord,
  type TxWaitResult,
  type WatchedAccount,
  type WatchEvent,
} from "@iceroot-network/sdk/tauri";
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
} from "@iceroot-network/sdk/tauri/vote";
import * as keystore from "@iceroot-network/sdk/tauri/keystore";
import * as ownership from "@iceroot-network/sdk/tauri/ownership";

export async function example(): Promise<string> {
  await init();
  const ready: boolean = isInitialized();
  const version: string = await bindingsVersion();

  const devnet: NetworkProfile = profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });
  const account: Account = await Keys.fromLegacyPassphrase("passphrase", devnet);
  const signed: MessageSignature = await Messages.sign(account, "hello");
  const valid: boolean = await Messages.verify({ ...signed, message: "hello" }, devnet);
  const check: AddressCheck = await Address.check(account.address, { profile: devnet });
  await account.release();
  // @ts-expect-error The Tauri entry has no WebAssembly module to compile synchronously.
  void import("@iceroot-network/sdk/tauri").then((sdk) => sdk.initSync);

  try {
    await Address.parse("d...", devnet);
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
  return `${ready} ${version} ${valid} ${check.ok}`;
}

export async function transactions(configuration: string, account: AccountInfo): Promise<bigint> {
  const phrase: string = await Mnemonic.generate();
  const feedback: PhraseCheck = await Mnemonic.check(phrase);
  const chain: Chain = await Chain.load(profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] }), configuration);
  const pinned: NetworkProfile = chain.profile;
  const rules: Rules = await chain.rules(2);
  const sender = await Keys.fromPhrase(phrase, chain, { account: 0, index: 0 });
  // A recipient's address is this entry's Address or text.
  const recipient: Recipient = { address: await Address.parse(account.address, chain), amount: await Amount.parse("1.5", chain.token.decimals) };
  const request: DraftRequest = { operation: { kind: "transfer", to: [recipient, { address: account.address, amount: 1n }] }, memo: "invoice 42", fee: "minimum" };
  const draft: Draft = await Draft.build(chain, request, { sender, nonce: account.nonce + 1n, height: 2 });
  const summary: DraftSummary = draft.summary;
  const source: "floor" | "explicit" | "unverified" = summary.fee.source;
  const unverified: FeeSource = "unverified";
  const bytes: Uint8Array = draft.serialize();
  const again = await Draft.deserialize(bytes, pinned);
  const signed: SignedTransaction = await again.sign(sender);
  const back = await SignedTransaction.deserialize(signed.serialize(), pinned);
  const second: boolean = await back.verifySecondSignature(sender.publicKey);
  const text: string = await Amount.format(summary.total, chain.token.decimals, { maxFraction: 2, grouping: true });
  const message: string = await SignIn.build(
    { origin: "https://example.com", publicKey: sender.publicKey, nonce: "00".repeat(32), issuedAt: new Date(), expiresAt: new Date() },
    chain,
  );
  const fields = await SignIn.parse(message, chain, { origin: "https://example.com", address: sender.address, publicKey: sender.publicKey, now: new Date() });
  const expires: Date = fields.expiresAt;
  const signing: SignInSigning = { origin: "https://example.com", now: new Date() };
  const signedIn: MessageSignature = await SignIn.sign(sender, message, signing);
  const algorithm: "secp256k1-bip340-sha256" | "ml-dsa-65" = await messageAlgorithmOf(chain);
  const hasFinality: boolean = (await capabilitiesOf(chain)).has("finality");
  await sender.release();
  void [feedback, back.id, second, text, expires, signedIn, algorithm, hasFinality, AssetId.ROOT, source];
  return summary.fee.amount + BigInt(rules.memo.maxBytes);
}

export async function client(account: Account, stored: Uint8Array, password: Uint8Array, error: unknown): Promise<string> {
  // No transport: the plugin makes every request.
  const net: Network = await connect(profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] }), {
    headers: { authorization: "Bearer token" },
    rateLimit: { requests: 100, windowMs: 60_000 },
    timeoutMs: 10_000,
  });
  const maxEntries: number = net.rules.vote.maxEntries;
  const seats: number = net.economics.seats;
  const info: AccountInfo = await net.accounts.get(account.address);
  const balance: bigint = balanceOf(info);
  const page: Page<TxRecord> = await net.history.forAccount(account.address, { direction: "sent", limit: 25 });
  const options: KeystoreAccountOptions = { account: 0, index: 1, maxMemoryKib: 262_144 };
  const opened: Account = await net.keys.fromKeystore(stored, password, options);
  const draft = await net.build.transfer({ from: opened, to: [{ address: await Address.parse(account.address, net), amount: 1n }], memo: "x" });
  // A draft read on the connected network is judged by its chain.
  const onNet: Draft = await Draft.deserialize(draft.serialize(), net);
  const signed = await draft.sign(opened);
  const outcome = await net.submit(signed);
  const result: TxWaitResult = await net.transactions.wait(signed.id, { until: "confirmed", timeoutMs: 60_000 });
  const watched: WatchedAccount = await net.keys.watch(account.address);
  const stop: () => void = net.watch({ address: watched }, (event: WatchEvent) => void event.type, { intervalMs: 8_000 });
  stop();
  const reason = error instanceof TxRejected ? error.reason : undefined;
  return `${maxEntries} ${seats} ${balance} ${page.hasNext} ${outcome.status} ${result.state} ${reason}`;
}

export async function voting(net: Network, account: Account, saved: string): Promise<string> {
  const snapshot: VoteSnapshot = await VoteSnapshot.fromNode(net, { firstForged: true });
  const mode: Mode = "diversity";
  const rules: VoteRules = await VoteRules.of(net);
  let selection: Selection;
  try {
    selection = await select(snapshot, { mode, account: account.address, rules, count: 20, draw: 0 });
  } catch (error) {
    if (error instanceof BreaksRules) {
      return error.problems.map((problem) => problem.reason).join(", ");
    }
    throw error;
  }
  const lines: string[] = selection.entries.flatMap((pick) => pick.reasons.map((reason: Reason) => reason.text));
  const findings = await check(Selection.deserialize(saved), snapshot);
  const problems = await validateVote(await split(["genesis_1", "genesis_2"]), rules, "ordinary");
  const draft = await net.build.vote({ from: account, entries: selection.vote });
  return `${lines.length} ${findings.length} ${problems.length} ${draft.summary.fee.amount} ${Selection.serialize(selection).length}`;
}

export async function keys(phrase: string, password: Uint8Array, stored: Uint8Array | string): Promise<string> {
  const bytes: Uint8Array = await keystore.encrypt(phrase, password, "desktop");
  const header: keystore.KeystoreHeader = await keystore.inspect(bytes);
  const opened: keystore.DecryptedPhrase = await keystore.decrypt(stored, password, { maxMemoryKib: 131_072 });
  opened.phrase.fill(0);
  const upgrade: boolean = await keystore.isWeakerThan(header, keystore.PRESETS.mobile);
  const text: string = await keystore.armor(await keystore.reencrypt(bytes, password, "mobile"));
  try {
    await keystore.decrypt(text, "wrong");
  } catch (error) {
    if (error instanceof keystore.WrongPasswordOrCorrupt || error instanceof keystore.Malformed) {
      return error.code;
    }
  }
  return `${opened.words} ${upgrade} ${text.length}`;
}

export async function proofs(passphrase: string, typedAccount: string, now: Date): Promise<string> {
  const key: ownership.SolarKey = await ownership.SolarKey.fromPassphrase(passphrase);
  const account: ownership.ParsedAccount = await ownership.IceRootAccount.parse(typedAccount);
  const message: string = await ownership.OwnershipProof.build({
    address: key.address,
    account: account.account,
    nonce: await ownership.OwnershipProof.randomNonce(),
    issuedAt: now,
  });
  const proof: ownership.OwnershipProof = await ownership.OwnershipProof.sign(key, message, now.getTime());
  await key.release();
  try {
    await ownership.OwnershipProof.verify(proof, now);
  } catch (error) {
    if (error instanceof ownership.InvalidProof) {
      const reason: ownership.ProofProblem = error.reason;
      return reason;
    }
  }
  return `${await ownership.OwnershipProof.toJson(proof)} ${ownership.SOLAR_NETWORK_BYTE}`;
}
