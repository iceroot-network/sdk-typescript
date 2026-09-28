/**
 * Transactions: drafts and signing, in the plugin.
 *
 * A draft crosses into the webview as its serialized bytes, with what the review screen shows.
 * Signing sends the bytes back: the plugin reads the draft again under the network's pinned
 * profile and signs what it read with keys it holds, so a page can neither see a key nor get a
 * signature over bytes other than the draft's.
 *
 * @module
 */

import type {
  DraftRequest as WasmDraftRequest,
  DraftSummary,
  OnlineFacts as WasmOnlineFacts,
  Operation as WasmOperation,
  OperationKind,
  SignedSummary,
  SignOptions as WasmSignOptions,
} from "../build.js";
import { InvalidArgument } from "../errors.js";
import {
  checkNonce,
  factsJson,
  requestJson,
  signedSummaryFromJson,
  signsDraft,
  summaryFromJson,
  type DraftSummaryJson,
  type SignedSummaryJson,
} from "../internal/drafts.js";
import { checkHeight } from "../internal/chain-json.js";
import type { ProfileSource } from "../profiles.js";
import { profileOf } from "../profiles.js";
import type { BaseUnits, Hex } from "../types.js";
import { Chain, chainOf, type ChainInfo } from "./chain.js";
import type { Address } from "./address.js";
import { bytesOf, hex, invoke } from "./invoke.js";
import { keyOf, type Account } from "./keys.js";
import { profileJson } from "./profiles.js";

export type {
  DraftFee,
  DraftSummary,
  FeeChoice,
  FeeSource,
  OperationKind,
  OperationSummary,
  Resignation,
  SignedSummary,
  SubmitResult,
  VoteEntry,
  WaitUntil,
} from "../build.js";

/** One recipient of a transfer. */
export interface Recipient {
  /** The recipient's address. */
  readonly address: Address | string;
  /** The amount in base units. */
  readonly amount: BaseUnits;
}

/** What a draft does: the operations of the network's formats (see the WebAssembly entry's `Operation`). */
export type Operation =
  | Exclude<WasmOperation, { readonly kind: "transfer" }>
  /** A transfer to 1 to 256 recipients. */
  | { readonly kind: "transfer"; readonly to: readonly Recipient[] };

/** What to build: the operation, the memo and the fee. */
export interface DraftRequest extends Omit<WasmDraftRequest, "operation"> {
  /** The operation. */
  readonly operation: Operation;
}

/** The facts a draft needs from the node, read when it is built. */
export interface OnlineFacts extends Omit<WasmOnlineFacts, "sender"> {
  /** The sender: its account, or its public key as hex. */
  readonly sender: Account | Hex;
}

/** How to sign a draft. */
export interface SignOptions extends Omit<WasmSignOptions, "secondKey"> {
  /** The sender's second key, when the sender registered one. */
  readonly secondKey?: Account;
}

/** A draft as the plugin describes it. */
interface DraftInfo {
  readonly bytes: string;
  readonly summary: string;
  readonly unsignedBytes: string;
  readonly amounts: Readonly<Record<string, string>>;
  readonly chain?: ChainInfo;
}

/**
 * A signed transaction as the plugin describes it.
 *
 * @internal
 */
export interface SignedInfo {
  readonly serialized: string;
  readonly transaction: string;
  readonly id: Hex;
  readonly json: string;
  readonly summary: string;
  readonly verified: boolean;
  readonly height: number;
}

/** A transaction built and checked against the rules in force at its height, ready to sign. */
export class Draft {
  /** The chain the draft is for. */
  readonly chain: Chain;
  /** What the review screen shows. */
  readonly summary: DraftSummary;
  readonly #bytes: Uint8Array;
  readonly #unsigned: Uint8Array;

  private constructor(info: DraftInfo, chain: Chain) {
    this.chain = chain;
    this.#bytes = bytesOf(info.bytes);
    this.#unsigned = bytesOf(info.unsignedBytes);
    // The plugin writes each amount of the summary with the token's decimals.
    this.summary = summaryFromJson(JSON.parse(info.summary) as DraftSummaryJson, chain.token.symbol, (units) => {
      const text = info.amounts[units.toString()];
      if (text === undefined) {
        throw new InvalidArgument("the plugin did not write an amount of the draft");
      }
      return text;
    });
  }

  /**
   * The draft of `request` on `chain`, with the `facts` the node reported. Every rule is applied
   * before anything is signed; a refusal names the rule it breaks. The default fee is the exact
   * fee floor; where no floor is in force it throws `FeeUnavailable`.
   */
  static async build(chain: Chain, request: DraftRequest, facts: OnlineFacts): Promise<Draft> {
    const sender = typeof facts.sender === "string" ? facts.sender : facts.sender.publicKey;
    checkNonce(facts);
    const requestText = requestJson(request);
    const factsText = factsJson(facts, sender);
    const info = await invoke<DraftInfo>("draft_build", { chain: chainOf(chain), request: requestText, facts: factsText });
    return new Draft(info, chain);
  }

  /**
   * The draft in `bytes` (from {@link Draft.serialize}), for the profile of `source`, whose network
   * hash must be pinned. A draft for another profile or network is refused with
   * `NetworkMismatch`, and the summary is computed again from the transaction's own fields.
   */
  static async deserialize(bytes: Uint8Array, source: ProfileSource): Promise<Draft> {
    const info = await invoke<DraftInfo>("draft_deserialize", { bytes: hex(bytes, "a draft"), profile: profileJson(source) });
    if (info.chain === undefined) {
      throw new InvalidArgument("the plugin did not describe the draft's chain");
    }
    return new Draft(info, Chain.fromInfo(info.chain, true));
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
    return this.#unsigned.slice();
  }

  /**
   * The draft as bytes, for signing in another context: versioned, with the profile id, the
   * network's identity and configuration, the height and the unsigned transaction.
   */
  serialize(): Uint8Array {
    return this.#bytes.slice();
  }

  /**
   * Signs with the sender's `account`, and with `options.secondKey` when the sender registered a
   * second key, in the plugin. Each signature takes fresh randomness. A key the draft does not
   * name is refused with `WrongKey`.
   */
  async sign(account: Account, options: SignOptions = {}): Promise<SignedTransaction> {
    return signWith(this, account, options.secondKey, (args) => invoke<SignedInfo>("draft_sign", args));
  }
}

/**
 * Signs `draft` with `account` (and `second`) through `sign`, which calls the plugin.
 *
 * @internal
 */
export async function signWith(
  draft: Draft,
  account: Account,
  second: Account | undefined,
  sign: (args: Record<string, unknown>) => Promise<SignedInfo>,
): Promise<SignedTransaction> {
  const info = await sign({
    bytes: hex(draft.serialize(), "a draft"),
    profile: profileJson(draft.chain.profile),
    key: keyOf(account),
    secondKey: second === undefined ? null : keyOf(second),
  });
  return SignedTransaction.fromInfo(info, draft.chain, draft.chain.profile);
}

/** A signed transaction, ready to submit. */
export class SignedTransaction {
  /** The transaction id: 64 lowercase hex digits. On today's devnet it is known only after signing. */
  readonly id: Hex;
  /** The transaction in the JSON form a node accepts and returns. */
  readonly json: Readonly<Record<string, unknown>>;
  /** What the transaction does. */
  readonly summary: SignedSummary;
  readonly #serialized: Uint8Array;
  readonly #transaction: Uint8Array;
  readonly #verified: boolean;
  readonly #height: number;
  readonly #chain: Chain | undefined;
  readonly #profile: string;

  private constructor(info: SignedInfo, chain: Chain | undefined, source: ProfileSource) {
    this.id = info.id;
    this.json = Object.freeze(JSON.parse(info.json) as Record<string, unknown>);
    this.summary = signedSummaryFromJson(JSON.parse(info.summary) as SignedSummaryJson);
    this.#serialized = bytesOf(info.serialized);
    this.#transaction = bytesOf(info.transaction);
    this.#verified = info.verified;
    this.#height = info.height;
    this.#chain = chain;
    this.#profile = profileJson(profileOf(source));
  }

  /** @internal */
  static fromInfo(info: SignedInfo, chain: Chain | undefined, source: ProfileSource): SignedTransaction {
    return new SignedTransaction(info, chain, source);
  }

  /**
   * The signed transaction in `bytes` (from {@link SignedTransaction.serialize}), for the profile
   * of `source`, whose network hash must be pinned. The sender's signature must verify. A second
   * signature is not checked here, since that needs the account's second public key: check it with
   * {@link SignedTransaction.verifySecondSignature} (a node refuses a transaction whose second
   * signature does not verify).
   */
  static async deserialize(bytes: Uint8Array, source: ProfileSource): Promise<SignedTransaction> {
    const info = await invoke<SignedInfo>("signed_deserialize", {
      bytes: hex(bytes, "a signed transaction"),
      profile: profileJson(source),
    });
    return new SignedTransaction(info, undefined, source);
  }

  /**
   * The transaction in the node's JSON form, read and checked under the rules of `chain` at
   * `height`. A bad signature does not refuse it: {@link SignedTransaction.verified} is then false.
   */
  static async fromJson(chain: Chain, json: string | object, height: number): Promise<SignedTransaction> {
    const text = typeof json === "string" ? json : JSON.stringify(json);
    const info = await invoke<SignedInfo>("signed_from_json", { chain: chainOf(chain), json: text, height: checkHeight(height) });
    return new SignedTransaction(info, chain, chain.profile);
  }

  /**
   * The transaction in `bytes`, as a node sends them, read and checked under the rules of `chain`
   * at `height`. A bad signature does not refuse it: {@link SignedTransaction.verified} is then
   * false.
   */
  static async decode(chain: Chain, bytes: Uint8Array, height: number): Promise<SignedTransaction> {
    const info = await invoke<SignedInfo>("signed_decode", {
      chain: chainOf(chain),
      bytes: hex(bytes, "a transaction"),
      height: checkHeight(height),
    });
    return new SignedTransaction(info, chain, chain.profile);
  }

  /** The serialized transaction, as a node takes it. */
  get bytes(): Uint8Array {
    return this.#transaction.slice();
  }

  /** Whether the sender's signature verifies. */
  get verified(): boolean {
    return this.#verified;
  }

  /** Whether the second signature verifies for the second key `publicKey` (hex). */
  async verifySecondSignature(publicKey: Hex): Promise<boolean> {
    return invoke<boolean>("signed_verify_second_signature", { source: sourceOf(this), publicKey });
  }

  /** The transaction as bytes, for the trip back from the context that signed it. */
  serialize(): Uint8Array {
    return this.#serialized.slice();
  }

  /**
   * Whether this is `draft`, signed: the transaction's bytes are the draft's unsigned bytes and
   * its signatures, at the draft's height. Check it before submitting a transaction that came back
   * from the context that signed it, so a mix-up of requests submits nothing else.
   */
  matches(draft: Draft): boolean {
    return signsDraft(this.#transaction, this.summary.height, draft.unsignedBytes, draft.height);
  }

  /** @internal */
  source(): Record<string, unknown> {
    // A transaction read under a chain the page holds is read again under it; one that came as
    // bytes for a profile is read again from them (it verified when it came).
    return this.#chain === undefined
      ? { kind: "serialized", serialized: hex(this.#serialized, "a signed transaction"), profile: this.#profile }
      : { kind: "decoded", chain: chainOf(this.#chain), transaction: hex(this.#transaction, "a transaction"), height: this.#height };
  }
}

/**
 * How the plugin finds `signed` again.
 *
 * @internal
 */
export function sourceOf(signed: SignedTransaction): Record<string, unknown> {
  if (!(signed instanceof SignedTransaction)) {
    throw new InvalidArgument("not a signed transaction made by the SDK's Tauri entry");
  }
  return signed.source();
}
