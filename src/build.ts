/**
 * Transactions: drafts and signing.
 *
 * A draft is built from an operation and the facts only a node knows (the sender's next nonce,
 * the height, whether the sender has a second key), checked against every rule of the milestone
 * in force, and signed as a separate step, so a review screen shows exactly what will be signed.
 * A draft serializes, so it can be built where the network is and signed where the key is (a
 * Manifest V3 sandbox page, a native plugin, another device); a signed transaction travels back
 * the same way.
 *
 * Every byte comes from the SDK's Rust core, which builds and signs with Heartwood Core's
 * transaction builder, so the bytes and ids are the node's own.
 *
 * @module
 */

import type { Address } from "./address.js";
import { Amount } from "./amount.js";
import { Chain, checkHeight, handleOf as chainHandleOf, type OperationKind } from "./chain.js";
import type { FeeStatistics, SubmitOutcome } from "./client.js";
import { InvalidArgument } from "./errors.js";
import { call, parse, type DraftHandle, type SignedHandle } from "./internal/bindings.js";
import { fromHex } from "./internal/hex.js";
import { keyHandleOf, type Account } from "./keys.js";
import { profileHandleOf, type ProfileSource } from "./profiles.js";
import type { BaseUnits, Hex } from "./types.js";

export type { OperationKind } from "./chain.js";

/**
 * The fee of a draft: `"minimum"` (the default), an exact amount in base units, or the minimum
 * times `multiplierBasisPoints / 10000` (at least 10,000), rounded up.
 *
 * `"minimum"` is the exact fee floor of the milestone in force for the transaction's type and
 * size, computed with the node's own function. A draft never falls back to a fixed fee.
 */
export type FeeChoice = "minimum" | BaseUnits | { readonly multiplierBasisPoints: number };

/**
 * Where a draft's fee comes from: `"floor"` when the fee equals the exact fee floor, `"explicit"`
 * for a fee the caller set (an exact amount, or a multiple of the minimum above the floor), and
 * `"node-statistics"` where a network's formats have no floor and the node's statistics were
 * used. A deserialized draft reads `"floor"` only when its fee equals the floor computed again,
 * and `"explicit"` otherwise.
 */
export type FeeSource = "floor" | "node-statistics" | "explicit";

/** One recipient of a transfer. */
export interface Recipient {
  /** The recipient's address. */
  readonly address: Address | string;
  /** The amount in base units. */
  readonly amount: BaseUnits;
}

/** One entry of a vote: a validator, by name, and its share in basis points. */
export interface VoteEntry {
  /** The validator's name. */
  readonly validator: string;
  /** The share in whole basis points (10,000 is the whole vote). */
  readonly basisPoints: number;
}

/** The kind of a validator resignation. */
export type Resignation = "temporary" | "permanent" | "revoke";

/** An operation to build. */
export type Operation =
  /** A transfer to 1 to 256 recipients. */
  | { readonly kind: "transfer"; readonly to: readonly Recipient[] }
  /** A vote; no entries withdraws the account's vote. The SDK writes the entries in canonical order. */
  | { readonly kind: "vote"; readonly entries: readonly VoteEntry[] }
  /** A burn of the network's own asset. */
  | { readonly kind: "burn"; readonly amount: BaseUnits }
  /** The registration of a second key (its compressed public key), which then co-signs everything. */
  | { readonly kind: "register-second-key"; readonly publicKey: Hex }
  /** A validator registration under a name. */
  | { readonly kind: "register-validator"; readonly name: string }
  /** A validator resignation, or the revoke of a temporary one. */
  | { readonly kind: "resign-validator"; readonly resignation: Resignation };

/** What to build. */
export interface DraftRequest {
  /** The operation. */
  readonly operation: Operation;
  /** A memo of at most `rules.memo.maxBytes` UTF-8 bytes. */
  readonly memo?: string;
  /** The fee; `"minimum"` by default. */
  readonly fee?: FeeChoice;
}

/** The facts a draft needs from the node, read when it is built. */
export interface OnlineFacts {
  /** The sender: its account, or its public key as hex. */
  readonly sender: Account | Hex;
  /** The nonce the transaction carries: the account's current nonce plus one. */
  readonly nonce: bigint;
  /** The height the draft is built for: the next block's. */
  readonly height: number;
  /** The sender's registered second key, as hex, when it has one; it must then sign too. */
  readonly secondKey?: Hex;
}

/** The fee of a draft. */
export interface DraftFee {
  /** The fee in base units. */
  readonly amount: BaseUnits;
  /** Where it comes from. */
  readonly source: FeeSource;
  /**
   * The exact fee floor of the milestone in force for the transaction's type and size; absent only
   * where a network's formats have no floor.
   */
  readonly floor?: BaseUnits;
}

/** An operation as a draft or a signed transaction carries it, with vote entries in canonical order. */
export type OperationSummary = Operation & { readonly kind: OperationKind };

/** What a review screen shows for a draft, computed from the transaction's own fields. */
export interface DraftSummary {
  /** The profile id. */
  readonly profile: string;
  /** The network byte. */
  readonly networkByte: number;
  /** The network hash. */
  readonly nethash: string;
  /** The height the draft was built for. */
  readonly height: number;
  /** The operation's kind. */
  readonly kind: OperationKind;
  /** The operation, as it will be signed. */
  readonly operation: OperationSummary;
  /** The sender's address. */
  readonly from: string;
  /** The sender's public key. */
  readonly publicKey: Hex;
  /** The nonce. */
  readonly nonce: bigint;
  /** The fee. */
  readonly fee: DraftFee;
  /** The memo, if any. */
  readonly memo?: string;
  /** The amount the operation moves, without the fee. */
  readonly amount: BaseUnits;
  /** The amount and the fee: everything leaving the sender. */
  readonly total: BaseUnits;
  /** The size of the signed transaction in bytes. */
  readonly size: number;
  /** Whether the sender's second key must sign too. */
  readonly secondSignature: boolean;
  /**
   * One readable line per effect, then the memo and the fee. Control characters, line and
   * paragraph separators and bidirectional formatting characters are written as `\uXXXX`
   * escapes, and a backslash as `\\`, so no text from the transaction or the network can start a
   * line of its own or reorder what the screen shows.
   */
  readonly lines: readonly string[];
}

/** How to sign a draft. */
export interface SignOptions {
  /** The sender's second key, when the sender registered one. */
  readonly secondKey?: Account;
}

type OperationJson =
  | { kind: "transfer"; to: { address: string; amount: string }[] }
  | { kind: "vote"; entries: { validator: string; basisPoints: number }[] }
  | { kind: "burn"; amount: string }
  | { kind: "register-second-key"; publicKey: string }
  | { kind: "register-validator"; name: string }
  | { kind: "resign-validator"; resignation: Resignation };

interface DraftSummaryJson {
  profile: string;
  networkByte: number;
  nethash: string;
  height: number;
  kind: OperationKind;
  operation: OperationJson;
  from: string;
  publicKey: string;
  nonce: string;
  fee: { amount: string; source: FeeSource; floor: string | null };
  memo: string | null;
  amount: string;
  size: number;
  secondSignature: boolean;
}

function units(value: BaseUnits, name: string): string {
  if (typeof value !== "bigint" || value < 0n) {
    throw new InvalidArgument(`${name} is a bigint of base units, not negative`, { [name]: String(value) });
  }
  return value.toString();
}

function operationJson(operation: Operation): OperationJson {
  switch (operation.kind) {
    case "transfer":
      return {
        kind: "transfer",
        to: operation.to.map((recipient, index) => ({
          address: String(recipient.address),
          amount: units(recipient.amount, `to[${index}].amount`),
        })),
      };
    case "vote":
      return {
        kind: "vote",
        entries: operation.entries.map(({ validator, basisPoints }) => ({ validator, basisPoints })),
      };
    case "burn":
      return { kind: "burn", amount: units(operation.amount, "amount") };
    case "register-second-key":
      return { kind: "register-second-key", publicKey: operation.publicKey };
    case "register-validator":
      return { kind: "register-validator", name: operation.name };
    case "resign-validator":
      return { kind: "resign-validator", resignation: operation.resignation };
    default:
      throw new InvalidArgument(`no operation is ${JSON.stringify((operation as { kind?: unknown }).kind)}`);
  }
}

function operationFromJson(json: OperationJson): OperationSummary {
  switch (json.kind) {
    case "transfer":
      return {
        kind: "transfer",
        to: json.to.map(({ address, amount }) => ({ address, amount: BigInt(amount) })),
      };
    case "burn":
      return { kind: "burn", amount: BigInt(json.amount) };
    default:
      return json;
  }
}

function feeJson(fee: FeeChoice | undefined): object {
  if (fee === undefined || fee === "minimum") {
    return { kind: "minimum" };
  }
  if (typeof fee === "bigint") {
    return { kind: "exact", amount: units(fee, "fee") };
  }
  const basisPoints = fee.multiplierBasisPoints;
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 0xffffffff) {
    throw new InvalidArgument("multiplierBasisPoints is an integer", { multiplierBasisPoints: basisPoints });
  }
  return { kind: "multiplier", basisPoints };
}

function statisticsJson(statistics: FeeStatistics | undefined): string | undefined {
  if (statistics === undefined) {
    return undefined;
  }
  const figures: Record<string, { minimum: string; average: string; maximum: string }> = {};
  for (const entry of statistics.entries) {
    if (entry.kind !== "other") {
      figures[entry.kind] = {
        minimum: entry.min.toString(),
        average: entry.avg.toString(),
        maximum: entry.max.toString(),
      };
    }
  }
  return JSON.stringify(figures);
}

function basisPointsText(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

/** Control characters (C0, DEL, C1), line and paragraph separators, bidirectional formatting characters and the backslash. */
const UNSAFE_TEXT = /[\\\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu;

/**
 * `text` safe for one line of a review screen: every character of {@link UNSAFE_TEXT} is written as
 * a `\uXXXX` escape, and a backslash as `\\`, so the escapes cannot be mistaken for text.
 */
function displayText(text: string): string {
  return text.replace(UNSAFE_TEXT, (char) =>
    char === "\\" ? "\\\\" : `\\u${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
  );
}

function lines(summary: Omit<DraftSummary, "lines">, symbol: string, decimals: number): string[] {
  const amount = (value: BaseUnits) => `${Amount.format(value, decimals)} ${symbol}`;
  const operation = summary.operation;
  const out: string[] = [];
  switch (operation.kind) {
    case "transfer":
      for (const recipient of operation.to) {
        out.push(`Send ${amount(recipient.amount)} to ${String(recipient.address)}`);
      }
      break;
    case "vote":
      if (operation.entries.length === 0) {
        out.push("Withdraw the current vote");
      }
      for (const entry of operation.entries) {
        out.push(`Vote ${basisPointsText(entry.basisPoints)} for ${entry.validator}`);
      }
      break;
    case "burn":
      out.push(`Burn ${amount(operation.amount)}`);
      break;
    case "register-second-key":
      out.push(`Register the second key ${operation.publicKey}`);
      break;
    case "register-validator":
      out.push(`Register as the validator ${operation.name}`);
      break;
    case "resign-validator":
      out.push(
        operation.resignation === "revoke"
          ? "Revoke the temporary validator resignation"
          : `Resign as a validator (${operation.resignation})`,
      );
      break;
  }
  if (summary.memo !== undefined) {
    out.push(`Memo: ${summary.memo}`);
  }
  out.push(`Fee ${amount(summary.fee.amount)}`);
  // The memo, names, addresses and the token symbol all come from the transaction or the network.
  return out.map(displayText);
}

const drafts = new WeakMap<Draft, DraftHandle>();

/** A transaction built and checked against the rules in force at its height, ready to sign. */
export class Draft {
  /** The chain the draft is for. */
  readonly chain: Chain;
  /** What the review screen shows. */
  readonly summary: DraftSummary;

  private constructor(handle: DraftHandle, chain: Chain) {
    drafts.set(this, handle);
    this.chain = chain;
    const json = parse<DraftSummaryJson>(handle.summary());
    const amount = BigInt(json.amount);
    const fee: DraftFee = {
      amount: BigInt(json.fee.amount),
      source: json.fee.source,
      ...(json.fee.floor === null ? {} : { floor: BigInt(json.fee.floor) }),
    };
    const summary: Omit<DraftSummary, "lines"> = {
      profile: json.profile,
      networkByte: json.networkByte,
      nethash: json.nethash,
      height: json.height,
      kind: json.kind,
      operation: operationFromJson(json.operation),
      from: json.from,
      publicKey: json.publicKey,
      nonce: BigInt(json.nonce),
      fee,
      ...(json.memo === null ? {} : { memo: json.memo }),
      amount,
      total: amount + fee.amount,
      size: json.size,
      secondSignature: json.secondSignature,
    };
    this.summary = Object.freeze({
      ...summary,
      lines: Object.freeze(lines(summary, chain.token.symbol, chain.token.decimals)),
    });
  }

  /**
   * The draft of `request` on `chain`, with the `facts` the node reported. The node's fee
   * `statistics` are used only where a network's formats have no fee floor. Every rule is applied
   * before anything is signed; a refusal names the rule it breaks.
   */
  static build(chain: Chain, request: DraftRequest, facts: OnlineFacts, statistics?: FeeStatistics): Draft {
    const sender = typeof facts.sender === "string" ? facts.sender : facts.sender.publicKey;
    if (typeof facts.nonce !== "bigint" || facts.nonce < 0n) {
      throw new InvalidArgument("the nonce is a bigint, not negative", { nonce: String(facts.nonce) });
    }
    const requestJson = JSON.stringify({
      operation: operationJson(request.operation),
      memo: request.memo ?? null,
      fee: feeJson(request.fee),
    });
    const factsJson = JSON.stringify({
      sender,
      nonce: facts.nonce.toString(),
      height: checkHeight(facts.height),
      secondKey: facts.secondKey ?? null,
    });
    const handle = call((module) =>
      module.DraftHandle.build(chainHandleOf(chain), requestJson, factsJson, statisticsJson(statistics)),
    );
    return new Draft(handle, chain);
  }

  /**
   * The draft in `bytes` (from {@link Draft.serialize}), for the profile of `source`, whose network
   * hash must be pinned. A draft for another profile or network is refused with
   * `NetworkMismatch`, and the summary is computed again from the transaction's own fields: the
   * signing context shows what it signs, not what it was told. The fee floor is computed again
   * too, and the fee's source reads `"floor"` only when the fee equals it.
   */
  static deserialize(bytes: Uint8Array, source: ProfileSource): Draft {
    const profile = profileHandleOf(source);
    const handle = call((module) => module.DraftHandle.deserialize(bytes, profile));
    return new Draft(handle, Chain.fromHandle(handle.chain()));
  }

  /** The operation's kind. */
  get kind(): OperationKind {
    return this.summary.kind;
  }

  /** The fee in base units. */
  get fee(): BaseUnits {
    return this.summary.fee.amount;
  }

  /** The nonce. */
  get nonce(): bigint {
    return this.summary.nonce;
  }

  /** The size in bytes once signed. */
  get size(): number {
    return this.summary.size;
  }

  /** The height the draft was built for. */
  get height(): number {
    return this.summary.height;
  }

  /** The unsigned bytes: what the sender's key signs, after SHA-256. */
  get unsignedBytes(): Uint8Array {
    return call(() => handleOf(this).unsignedBytes());
  }

  /**
   * The draft as bytes, for signing in another context: versioned, with the profile id, the
   * network's identity and configuration, the height and the unsigned transaction.
   */
  serialize(): Uint8Array {
    return call(() => handleOf(this).serialize());
  }

  /**
   * Signs with the sender's `account`, and with `options.secondKey` when the sender registered a
   * second key. Each signature takes fresh randomness. A key the draft does not name is refused
   * with `WrongKey`.
   */
  sign(account: Account, options: SignOptions = {}): SignedTransaction {
    const handle = handleOf(this);
    const key = keyHandleOf(account);
    const second = options.secondKey;
    const signed = call(() =>
      second === undefined ? handle.sign(key) : handle.signWithSecond(key, keyHandleOf(second)),
    );
    return SignedTransaction.fromHandle(signed);
  }
}

/**
 * The Rust draft of `draft`.
 *
 * @internal
 */
export function handleOf(draft: Draft): DraftHandle {
  const handle = drafts.get(draft);
  if (handle === undefined) {
    throw new InvalidArgument("not a draft made by Draft.build or Draft.deserialize");
  }
  return handle;
}

/** What a signed transaction does. */
export interface SignedSummary {
  /** The transaction id. */
  readonly id: Hex;
  /** The operation's kind. */
  readonly kind: OperationKind;
  /** The operation. */
  readonly operation: OperationSummary;
  /** The sender's address. */
  readonly from: string;
  /** The sender's public key. */
  readonly publicKey: Hex;
  /** The nonce. */
  readonly nonce: bigint;
  /** The fee. */
  readonly fee: BaseUnits;
  /** The memo, if any. */
  readonly memo?: string;
  /** The amount the operation moves, without the fee. */
  readonly amount: BaseUnits;
  /** The size in bytes. */
  readonly size: number;
  /** The height the transaction was built or read for. */
  readonly height: number;
  /** Whether it carries a second signature. */
  readonly secondSignature: boolean;
}

interface SignedSummaryJson extends Omit<SignedSummary, "operation" | "nonce" | "fee" | "amount" | "memo"> {
  readonly operation: OperationJson;
  readonly nonce: string;
  readonly fee: string;
  readonly amount: string;
  readonly memo: string | null;
}

const signedHandles = new WeakMap<SignedTransaction, SignedHandle>();

/** A signed transaction, ready to submit. */
export class SignedTransaction {
  /** The transaction id: 64 lowercase hex digits. On today's devnet it is known only after signing. */
  readonly id: Hex;
  /** The transaction in the JSON form a node accepts and returns. */
  readonly json: Readonly<Record<string, unknown>>;
  /** What the transaction does. */
  readonly summary: SignedSummary;

  private constructor(handle: SignedHandle) {
    signedHandles.set(this, handle);
    this.id = handle.id();
    this.json = Object.freeze(parse<Record<string, unknown>>(handle.json()));
    const json = parse<SignedSummaryJson>(handle.summary());
    this.summary = Object.freeze({
      ...json,
      operation: operationFromJson(json.operation),
      nonce: BigInt(json.nonce),
      fee: BigInt(json.fee),
      amount: BigInt(json.amount),
      ...(json.memo === null ? {} : { memo: json.memo }),
    } as SignedSummary);
  }

  /** @internal */
  static fromHandle(handle: SignedHandle): SignedTransaction {
    return new SignedTransaction(handle);
  }

  /**
   * The signed transaction in `bytes` (from {@link SignedTransaction.serialize}), for the profile
   * of `source`, whose network hash must be pinned. It must verify.
   */
  static deserialize(bytes: Uint8Array, source: ProfileSource): SignedTransaction {
    const profile = profileHandleOf(source);
    return new SignedTransaction(call((module) => module.SignedHandle.deserialize(bytes, profile)));
  }

  /**
   * The transaction in the node's JSON form, read and checked under the rules of `chain` at
   * `height`. A bad signature does not refuse it: {@link SignedTransaction.verified} is then false.
   */
  static fromJson(chain: Chain, json: string | object, height: number): SignedTransaction {
    const text = typeof json === "string" ? json : JSON.stringify(json);
    return new SignedTransaction(
      call((module) => module.SignedHandle.fromJson(chainHandleOf(chain), text, checkHeight(height))),
    );
  }

  /**
   * The transaction in `bytes`, as a node sends them, read and checked under the rules of `chain`
   * at `height`. A bad signature does not refuse it: {@link SignedTransaction.verified} is then
   * false.
   */
  static decode(chain: Chain, bytes: Uint8Array, height: number): SignedTransaction {
    return new SignedTransaction(
      call((module) => module.SignedHandle.decode(chainHandleOf(chain), bytes, checkHeight(height))),
    );
  }

  /** The serialized transaction, as a node takes it. */
  get bytes(): Uint8Array {
    return call(() => signedHandleOf(this).bytes());
  }

  /** Whether the sender's signature verifies. */
  get verified(): boolean {
    return signedHandleOf(this).verified;
  }

  /** Whether the second signature verifies for the second key `publicKey` (hex). */
  verifySecondSignature(publicKey: Hex): boolean {
    return fromHex(publicKey) !== undefined && signedHandleOf(this).verifySecondSignature(publicKey);
  }

  /** The transaction as bytes, for the trip back from the context that signed it. */
  serialize(): Uint8Array {
    return call(() => signedHandleOf(this).serialize());
  }
}

/**
 * The Rust signed transaction of `signed`.
 *
 * @internal
 */
export function signedHandleOf(signed: SignedTransaction): SignedHandle {
  const handle = signedHandles.get(signed);
  if (handle === undefined) {
    throw new InvalidArgument("not a signed transaction made by the SDK");
  }
  return handle;
}

/** A node's answer to the submission of one transaction: `Network.submit` returns it. */
export type SubmitResult = SubmitOutcome;

/** How far to wait for a transaction. */
export type WaitUntil = "confirmed" | "final";
