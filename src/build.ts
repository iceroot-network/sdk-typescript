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
import { Chain, checkHeight, connectionOf, handleOf as chainHandleOf, type OperationKind } from "./chain.js";
import type { SubmitOutcome } from "./client.js";
import { InvalidArgument } from "./errors.js";
import { call, parse, type DraftHandle, type SignedHandle } from "./internal/bindings.js";
import {
  checkNonce,
  factsJson,
  requestJson,
  signedSummaryFromJson,
  signsDraft,
  summaryFromJson,
  type DraftSummaryJson,
  type SignedSummaryJson,
} from "./internal/drafts.js";
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
 * size, computed with the node's own function. Where no floor is in force (the milestone has no
 * enabled dynamic fee table, `rules.fees.floorAvailable` is false), the node's pool applies
 * settings of its own: `"minimum"` and multipliers then throw `FeeUnavailable`, and the draft
 * needs an exact fee. A draft never falls back to a fixed or guessed fee.
 */
export type FeeChoice = "minimum" | BaseUnits | { readonly multiplierBasisPoints: number };

/**
 * Where a draft's fee comes from:
 *
 * - `"floor"`: the fee equals the exact fee floor of the milestone in force, under a network
 *   configuration the signer holds itself: the chain the draft was built on, or the connected
 *   network a serialized draft was read on (`Draft.deserialize(bytes, net)`), where the floor at
 *   the draft's height is also the floor at the network's next block.
 * - `"explicit"`: a fee the caller set (an exact amount, or a multiple of the minimum above the
 *   floor). A deserialized draft also reads `"explicit"` whenever its fee is not the floor
 *   computed again, whatever source its bytes claim.
 * - `"unverified"`: a serialized draft whose bytes call the fee the floor and whose fee equals the
 *   floor at the draft's height, where that floor is not known to be the network's: read with a
 *   profile alone, it is the floor of the network configuration the bytes carry, which the pinned
 *   network hash does not cover, so whoever built the draft chose it; read on a connected
 *   network, a change of the fee table lies between the draft's height, which its builder chose,
 *   and the network's next block. Show the fee as an amount; never call it "the network
 *   minimum". The floor beside it is for display only.
 */
export type FeeSource = "floor" | "explicit" | "unverified";

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
   * The exact fee floor of the milestone in force for the transaction's type and size; absent
   * where no floor is in force (the milestone has no enabled dynamic fee table). For a draft
   * deserialized with a profile alone, it is the floor of the configuration the draft carries,
   * for display only.
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
   * paragraph separators, bidirectional formatting and other invisible format characters, every
   * space but the ASCII space and every space of a run of two or more ASCII spaces are written as
   * `\uXXXX` escapes, and a backslash as `\\`, so no text from the transaction or the network can
   * start a line of its own, hide in blank space or reorder what the screen shows. The token
   * symbol is 1 to 10 ASCII letters and digits: a network configuration with any other symbol
   * does not load.
   *
   * A line can still be as long as the memo the network allows (`rules.memo.maxBytes`). Show each
   * line as one line, unwrapped (scrolling sideways) or cut with a visible mark and the whole line
   * on request, or wrap it with the continuation indented: a renderer that wraps a long line flush
   * left can make its end look like a line of its own.
   */
  readonly lines: readonly string[];
}

/** How to sign a draft. */
export interface SignOptions {
  /** The sender's second key, when the sender registered one. */
  readonly secondKey?: Account;
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
    const decimals = chain.token.decimals;
    this.summary = summaryFromJson(parse<DraftSummaryJson>(handle.summary()), chain.token.symbol, (units) =>
      Amount.format(units, decimals),
    );
  }

  /**
   * The draft of `request` on `chain`, with the `facts` the node reported. Every rule is applied
   * before anything is signed; a refusal names the rule it breaks. The default fee is the exact
   * fee floor; where no floor is in force it throws `FeeUnavailable` (see {@link FeeChoice}).
   */
  static build(chain: Chain, request: DraftRequest, facts: OnlineFacts): Draft {
    const sender = typeof facts.sender === "string" ? facts.sender : facts.sender.publicKey;
    checkNonce(facts);
    const request_ = requestJson(request);
    const facts_ = factsJson(facts, sender);
    const handle = call((module) => module.DraftHandle.build(chainHandleOf(chain), request_, facts_));
    return new Draft(handle, chain);
  }

  /**
   * The draft in `bytes` (from {@link Draft.serialize}), for the profile of `source`, whose network
   * hash must be pinned. A draft for another profile or network is refused with
   * `NetworkMismatch`, and the summary is computed again from the transaction's own fields: the
   * signing context shows what it signs, not what it was told. The fee floor is computed again
   * too.
   *
   * When `source` is a network `connect` returned, the draft is read on that network's chain at
   * its next block (`net.nextHeight`): the floor, the rules and the token's symbol are the ones
   * the signer's own connection loaded, and a draft built under another network configuration
   * (another fee table, say) is refused with `NetworkMismatch` (`details.reason`:
   * `"configuration"`). A draft built just before the network changed its milestones is refused
   * too: build it again. The floor is computed at the draft's height (`summary.height`), which the
   * builder chose, so the fee's source reads `"floor"` when the fee equals that floor and the
   * floor at the network's next block is the same, and `"unverified"` when a change of the fee
   * table lies between the two heights (the floor of the draft's height kept for display).
   *
   * With any other `source`, such as a profile in a context with no network, the floor, the
   * rules and the token's symbol come from the network configuration the bytes carry, which the
   * draft was built under. The pinned network hash identifies the chain but does not cover that
   * configuration's milestones or labels, so a fee the bytes call the floor and that equals that
   * floor reads `"unverified"`, never `"floor"`: show it as an amount, never as "the network
   * minimum".
   */
  static deserialize(bytes: Uint8Array, source: ProfileSource): Draft {
    const connection = connectionOf(source);
    if (connection !== undefined) {
      const { chain } = connection;
      const height = connection.nextHeight();
      const handle = call((module) => module.DraftHandle.deserializeAt(bytes, chainHandleOf(chain), height));
      return new Draft(handle, chain);
    }
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
    this.summary = signedSummaryFromJson(parse<SignedSummaryJson>(handle.summary()));
  }

  /** @internal */
  static fromHandle(handle: SignedHandle): SignedTransaction {
    return new SignedTransaction(handle);
  }

  /**
   * The signed transaction in `bytes` (from {@link SignedTransaction.serialize}), for the profile
   * of `source`, whose network hash must be pinned. The sender's signature must verify. A second
   * signature is not checked here, since that needs the account's second public key: check it with
   * {@link SignedTransaction.verifySecondSignature} (a node refuses a transaction whose second
   * signature does not verify).
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

  /**
   * Whether this is `draft`, signed: the transaction's bytes are the draft's unsigned bytes and
   * its signatures, at the draft's height. Check it before submitting a transaction that came back
   * from the context that signed it, so a mix-up of requests submits nothing else.
   */
  matches(draft: Draft): boolean {
    return signsDraft(this.bytes, this.summary.height, draft.unsignedBytes, draft.height);
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
