/**
 * The node API client: its transport and the values it returns.
 *
 * The client is sans-IO: the Rust core (`iceroot-sdk-api`) builds each request and decodes each
 * answer, and the host performs the HTTP call through a transport with the signature of `fetch`.
 * Tauri apps pass the HTTP plugin's `fetch`, so requests leave from Rust. The types below are the
 * client's IceRoot-shaped values, the same in every language the SDK is built for (the Rust types
 * of `iceroot-sdk-api` are the contract): a validator is never a "delegate", a validator's name is
 * never a "username", shares are whole basis points and amounts are `bigint` base units. Integers
 * that can exceed 2^53 (amounts, nonces, heights, times, lifetime counters) are `bigint`; smaller
 * ones (ranks, basis points, page numbers, sizes) are numbers. An absent value is a missing
 * property.
 *
 * Addresses and public keys are the text the node reported; parse them against a profile with
 * `Address.parse` before trusting them.
 *
 * @module
 */

import type { AssetId } from "./amount.js";
import type { VoteEntry } from "./build.js";
import type { RejectionReason } from "./errors.js";
import type { BaseUnits, Hex } from "./types.js";

export type { Capabilities } from "./profiles.js";

/** A function with the signature of `fetch` that performs the SDK's HTTP requests. */
export type Transport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** A request allowance: at most `requests` per `windowMs` milliseconds. */
export interface RateLimit {
  /** Requests allowed per window: a whole number from 1 to 2^32 - 1. */
  readonly requests: number;
  /** The window in milliseconds, at most 2^31 - 1 (about 24.8 days). */
  readonly windowMs: number;
}

/** Options of `connect`. */
export interface ConnectOptions {
  /**
   * The transport; `globalThis.fetch` by default. The SDK asks it not to follow redirects
   * (`redirect: "manual"`, and `maxRedirections: 0` for the Tauri HTTP plugin's `fetch`) and skips
   * a relay that answers with one, so a request, its headers and its body reach the relays only.
   * A transport that follows redirects anyway sends them to the redirect's target. An answer is
   * read from the response's `body` stream where it has one, and refused with `BadResponse` once
   * it is larger than 8 MiB (the next relay is then asked). Only a streaming transport keeps that
   * bound before the body is in memory: a response without a `body` stream (some custom
   * transports, and fetch polyfills) is read whole with `arrayBuffer()` and checked afterwards,
   * unless its `content-length` already says it is too large.
   */
  readonly transport?: Transport;
  /**
   * Extra headers for every request, for a relay behind a proxy that needs a token. A name is an
   * HTTP token and a value is text of visible ASCII characters, spaces and tabs; `connect` refuses
   * anything else with `InvalidArgument`, naming the header and never showing its value.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * The request allowance to keep to. The default is the reference implementation's: 100 requests
   * per 60 seconds per client address. `false` sends requests without a budget, for a node that
   * allows more; HTTP 429 is still retried with backoff.
   */
  readonly rateLimit?: RateLimit | false;
  /** Time allowed for one request, in milliseconds, at most 2^31 - 1; 15,000 by default. */
  readonly timeoutMs?: number;
}

/** A point in chain time. */
export interface Timestamp {
  /** Seconds since the chain's epoch, as recorded in the block header. */
  readonly chain: bigint;
  /** Seconds since the Unix epoch. */
  readonly unix: bigint;
}

/** One page of a listing. */
export interface Page<T> {
  /** The items of this page, in the node's order. */
  readonly items: readonly T[];
  /** The page number, starting at 1. */
  readonly page: number;
  /** The number of pages the listing had when this page was served. */
  readonly pageCount: number;
  /** The number of items in the whole listing. */
  readonly total: bigint;
  /** Whether `total` is an estimate. */
  readonly totalIsEstimate: boolean;
  /** Whether a next page exists. */
  readonly hasNext: boolean;
}

/** A node's view of its own progress. */
export interface NodeStatus {
  /** Height of the node's last block. */
  readonly height: bigint;
  /** Whether the node considers itself in sync with its peers. */
  readonly synced: boolean;
  /** How many blocks the node's peers are ahead of it. */
  readonly blocksBehind: bigint;
  /** The node's chain time: seconds since the chain's epoch by the node's clock. */
  readonly chainTime: bigint;
}

/** The chain identity a node reports. */
export interface NetworkIdentity {
  /** The network hash. */
  readonly nethash: Hex;
  /** The address network byte. */
  readonly networkByte: number;
  /** The SLIP-44 coin type the network declares. */
  readonly slip44: number;
  /** The WIF prefix byte the network declares. */
  readonly wif: number;
}

/** The labels a node shows for the native token. Display only: the asset is `AssetId.ROOT`. */
export interface TokenLabels {
  /** The token's configured name. */
  readonly name: string;
  /** The token's configured symbol. */
  readonly symbol: string;
}

/** The transaction pool's limits, which bound what one submission may carry. */
export interface PoolLimits {
  /** Transactions the pool holds at most. */
  readonly maxTransactionsInPool: number;
  /** Transactions one sender may have in the pool at most. */
  readonly maxTransactionsPerSender: number;
  /** Transactions one submission request may carry at most. */
  readonly maxTransactionsPerRequest: number;
  /** Age in blocks after which a pooled transaction expires. */
  readonly maxTransactionAge: number;
  /** Serialized size in bytes above which the pool refuses a transaction. */
  readonly maxTransactionBytes: number;
}

/** A transaction kind as the client reports it. */
export type TxKind =
  | "transfer"
  | "vote"
  | "burn"
  | "register-second-key"
  | "register-validator"
  | "resign-validator"
  | "other";

/**
 * A transaction kind with, for `other`, the wire type it stands for. Records that name a kind
 * carry these fields among their own.
 */
export interface KindFields {
  /** The kind. */
  readonly kind: TxKind;
  /** For `other`: the wire type group. */
  readonly typeGroup?: number;
  /** For `other`: the wire type within the group. */
  readonly typeId?: number;
}

/** The pool's dynamic fee settings. */
export interface PoolFees {
  /** Whether dynamic fees are enabled. */
  readonly dynamic: boolean;
  /** Fee per byte-unit the pool requires to admit a transaction (0 when dynamic fees are off). */
  readonly minFeePool: bigint;
  /** Fee per byte-unit the node requires to broadcast a transaction (0 when dynamic fees are off). */
  readonly minFeeBroadcast: bigint;
  /** Extra byte-units per transaction kind, in wire type order. */
  readonly addonBytes: readonly (KindFields & { readonly bytes: bigint })[];
}

/** A node's configuration: chain identity, token labels, the milestone in force and pool limits. */
export interface NodeConfiguration {
  /** Version of the node software. */
  readonly coreVersion: string;
  /** The chain identity. */
  readonly network: NetworkIdentity;
  /** The native token's labels. */
  readonly token: TokenLabels;
  /** The explorer URL the network declares, if any. */
  readonly explorer?: string;
  /** Validator seats per round at the node's tip. */
  readonly seats: number;
  /**
   * Block time in seconds at the node's tip: 1 to 600. A node that reports another block time is
   * refused with `BadResponse`, since waiting and watching take their default intervals from it.
   */
  readonly blockTime: number;
  /** The milestone in force at the node's tip, as the node's JSON text. */
  readonly milestoneJson: string;
  /** The pool's limits. */
  readonly pool: PoolLimits;
  /** The pool's fee settings. */
  readonly poolFees: PoolFees;
}

/** The chain definition a node serves, as the node's JSON text, ready for `Chain.load`. */
export interface CryptoConfiguration {
  /** The network hash. */
  readonly nethash: Hex;
  /** The address network byte. */
  readonly networkByte: number;
  /** The network description. */
  readonly networkJson: string;
  /** The milestone list. */
  readonly milestonesJson: string;
  /** The genesis block. */
  readonly genesisBlockJson: string;
  /** The exceptions, when the node sends them. */
  readonly exceptionsJson?: string;
}

/** Burned amounts since genesis. */
export interface Burned {
  /** Burned by the fee burn share. */
  readonly fees: BaseUnits;
  /** Burned by burn transactions. */
  readonly transactions: BaseUnits;
  /** The sum of both. */
  readonly total: BaseUnits;
}

/** The native token's supply at a block. */
export interface Supply {
  /** Height of the block the figures belong to. */
  readonly height: bigint;
  /** Id of that block. */
  readonly blockId: Hex;
  /** The circulating supply. */
  readonly supply: BaseUnits;
  /** What has been burned. */
  readonly burned: Burned;
}

/** Fee figures of one transaction kind over the requested window. */
export interface FeeStatistic extends KindFields {
  /** Average fee, rounded by the node. */
  readonly avg: BaseUnits;
  /** Smallest fee. */
  readonly min: BaseUnits;
  /** Largest fee. */
  readonly max: BaseUnits;
  /** Sum of fees. */
  readonly sum: BaseUnits;
  /** Sum of burned fee shares. */
  readonly burned: BaseUnits;
}

/**
 * A node's fee statistics (`/node/fees`): the fees transactions paid recently, for display only.
 * A draft's fee never comes from them.
 */
export interface FeeStatistics {
  /** The window in days, when one was requested. */
  readonly days?: number;
  /** One entry per transaction kind the node reports. */
  readonly entries: readonly FeeStatistic[];
}

/** A balance of one asset. */
export interface Balance {
  /** The asset. */
  readonly asset: AssetId;
  /** The amount in base units. */
  readonly amount: BaseUnits;
}

/** An account as the node sees it. */
export interface AccountInfo {
  /** The account's address. */
  readonly address: string;
  /** The account's public key, once the account has sent a transaction. */
  readonly publicKey?: Hex;
  /** The nonce of the account's last transaction (0 for a fresh account). */
  readonly nonce: bigint;
  /** Balances per asset. On today's devnet there is exactly one entry, ROOT. */
  readonly balances: readonly Balance[];
  /** The account's current vote, empty when it does not vote. */
  readonly vote: readonly VoteEntry[];
  /** The registered second public key, if any. */
  readonly secondPublicKey?: Hex;
  /** The account's validator name, when the account is a registered validator. */
  readonly validatorName?: string;
}

/** One recipient of a transfer, as the node reported it. */
export interface Payment {
  /** The recipient's address. */
  readonly address: string;
  /** The amount in base units. */
  readonly amount: BaseUnits;
}

/** The kind-specific content of a transaction. */
export type TxDetails =
  | { readonly kind: "transfer"; readonly recipients: readonly Payment[] }
  | { readonly kind: "vote"; readonly entries: readonly VoteEntry[] }
  | { readonly kind: "burn"; readonly amount: BaseUnits }
  | { readonly kind: "register-second-key"; readonly publicKey: Hex }
  | { readonly kind: "register-validator"; readonly name: string }
  | { readonly kind: "resign-validator"; readonly resignation: "temporary" | "permanent" | "revoke" }
  | {
      readonly kind: "other";
      readonly typeGroup: number;
      readonly typeId: number;
      readonly assetJson?: string;
    };

/** Where a transaction stands. Where finality exists, it is reported separately. */
export type TxStatus = "pending" | "confirmed";

/** A transaction's direction relative to one account. */
export type TxDirection = "sent" | "received" | "to-self" | "other";

/** The block that holds a confirmed transaction. */
export interface TxBlock {
  /** Block id. */
  readonly id: Hex;
  /** Block height. */
  readonly height: bigint;
  /** Confirmations when the node answered (1 in the node's last block). */
  readonly confirmations: bigint;
  /** The block's time, when the node reported it. */
  readonly time?: Timestamp;
}

/** A transaction as the client reports it in histories, lookups and listings. */
export interface TxRecord {
  /** Transaction id. */
  readonly id: Hex;
  /** Pending or confirmed. */
  readonly status: TxStatus;
  /** The block, when confirmed. */
  readonly block?: TxBlock;
  /** Direction relative to the account a history was requested for. */
  readonly direction?: TxDirection;
  /** The sender's address. */
  readonly sender: string;
  /** The sender's public key. */
  readonly senderPublicKey: Hex;
  /** The sender's nonce for this transaction. */
  readonly nonce: bigint;
  /** The fee in base units. */
  readonly fee: BaseUnits;
  /** The burned share of the fee, when the node reported it. */
  readonly burnedFee?: BaseUnits;
  /** The memo, if any. */
  readonly memo?: string;
  /** Whether the transaction carries a second signature. */
  readonly secondSigned: boolean;
  /** Wire format version. */
  readonly version: number;
  /** Kind-specific content. */
  readonly details: TxDetails;
}

/** A validator's name resolved to its account. Always carries the address, never a bare name. */
export interface ResolvedName {
  /** The name. */
  readonly name: string;
  /** The account the name points at. */
  readonly address: string;
  /** The account's public key. */
  readonly publicKey: Hex;
}

/** A validator's standing. */
export type ValidatorStatus = "active" | "standby" | "resigned-temporary" | "resigned-permanent";

/** A validator's lifetime production counters. */
export interface Production {
  /** Blocks produced. */
  readonly produced: bigint;
  /** Slots missed. */
  readonly missed: bigint;
  /** Produced against assigned slots in basis points, when the node reports it. */
  readonly productivityBasisPoints?: number;
  /** The last block produced, if any. */
  readonly lastBlock?: { readonly id: Hex; readonly height?: bigint; readonly time?: Timestamp };
}

/** What a validator has earned since registration. */
export interface Earnings {
  /** Block rewards. */
  readonly rewards: BaseUnits;
  /** Fees collected. */
  readonly fees: BaseUnits;
  /** The burned share of those fees. */
  readonly burnedFees: BaseUnits;
  /** Donations paid out of rewards. */
  readonly donations: BaseUnits;
  /** Rewards plus fees, minus burned fees and donations. */
  readonly total: BaseUnits;
}

/** A registered validator. */
export interface ValidatorInfo {
  /** The validator's name. */
  readonly name: string;
  /** The validator's account address. */
  readonly address: string;
  /** The validator's account public key. */
  readonly publicKey: Hex;
  /** Rank by vote weight (1 is first), when ranked. */
  readonly rank?: number;
  /** Active, standby or resigned. */
  readonly status: ValidatorStatus;
  /** Total vote weight in base units. */
  readonly voteWeight: BaseUnits;
  /** Vote weight as a share of the supply, in basis points, rounded by the node. */
  readonly voteShareBasisPoints: number;
  /** Number of voting accounts. */
  readonly voters: bigint;
  /** Production counters. */
  readonly production: Production;
  /** Earnings since registration. */
  readonly earnings: Earnings;
  /** The node software version the validator last announced, if any. */
  readonly version?: string;
}

/** A block. */
export interface BlockInfo {
  /** Block id. */
  readonly id: Hex;
  /** Height. */
  readonly height: bigint;
  /** Block format version. */
  readonly version: number;
  /** Id of the previous block (absent for the genesis block). */
  readonly previous?: Hex;
  /** The producing validator's name, when it has one. */
  readonly producerName?: string;
  /** The producer's public key. */
  readonly producerPublicKey: Hex;
  /** Block reward. */
  readonly reward: BaseUnits;
  /** Donations paid out of the reward, sorted by address. */
  readonly donations: readonly Donation[];
  /** Sum of fees. */
  readonly totalFee: BaseUnits;
  /** Burned share of the fees. */
  readonly burnedFee: BaseUnits;
  /** Sum of amounts moved by the block's transactions. */
  readonly totalAmount: BaseUnits;
  /** What the producer keeps. */
  readonly producerEarned: BaseUnits;
  /** Number of transactions. */
  readonly transactionCount: number;
  /** Payload hash. */
  readonly payloadHash: Hex;
  /** Payload length in bytes. */
  readonly payloadLength: number;
  /** The block signature. */
  readonly signature: Hex;
  /** Blocks on top of this one when the node answered. */
  readonly confirmations: bigint;
  /** The block's time. */
  readonly time: Timestamp;
}

/** One donation paid out of a block reward. */
export interface Donation {
  /** The receiving address. */
  readonly address: string;
  /** The amount in base units. */
  readonly amount: BaseUnits;
}

/** A slot a validator missed. */
export interface MissedSlot {
  /** The height the block would have had. */
  readonly height: bigint;
  /** The slot's time. */
  readonly time: Timestamp;
  /** The validator that missed it. */
  readonly validator: string;
}

/** One seat of a round's validator set. */
export interface RoundValidator {
  /** The validator's public key. */
  readonly publicKey: Hex;
  /** Its vote weight when the round was built. */
  readonly voteWeight: BaseUnits;
}

/** The result of submitting one transaction. */
export type SubmitStatus =
  | {
      readonly status: "accepted";
      /** Whether the node also relays it to its peers. */
      readonly broadcast: boolean;
    }
  | {
      readonly status: "rejected";
      /** The normalized reason. */
      readonly reason: RejectionReason;
      /**
       * The node's own code (for example `ERR_LOW_FEE`); `ERR_TOO_LARGE` when the SDK refused it.
       * Escaped and cut to 200 characters, as `message` is.
       */
      readonly nodeCode: string;
      /**
       * The node's message: text the node chose, with control, separator and invisible characters
       * written as escapes (`\u{202e}`) and cut to 200 characters, then `…`. Show it, if at all,
       * as the node's words, never as the wallet's.
       */
      readonly message: string;
    };

/** One transaction's outcome within a submission: its id, and accepted or rejected. */
export type SubmitOutcome = { readonly id: Hex } & SubmitStatus;

/** The outcomes of a submission, one per transaction, in submission order. */
export interface SubmitReport {
  /** The outcomes. */
  readonly outcomes: readonly SubmitOutcome[];
}

/** Which page of a listing to read: page 1 of 100 items when absent. */
export interface PageOptions {
  /** The page, from 1. */
  readonly page?: number;
  /** Items per page, 1 to 100. */
  readonly limit?: number;
}

/** A block by height or by id. */
export type BlockRef = bigint | number | Hex;

/** Which way to list an account's history. */
export type HistoryDirection = "all" | "sent" | "received";

/** Filters of a transaction listing. Every field narrows it. */
export interface TxFilter {
  /** Only transactions from this address. */
  readonly sender?: string;
  /** Only transactions whose primary recipient is this address. */
  readonly recipient?: string;
  /** Only this kind (`other` needs `typeGroup` and `typeId`). */
  readonly kind?: TxKind;
  /** For `kind: "other"`: the wire type group. */
  readonly typeGroup?: number;
  /** For `kind: "other"`: the wire type within the group. */
  readonly typeId?: number;
  /** Only transactions of this block. */
  readonly blockId?: Hex;
  /** Oldest first instead of newest first. */
  readonly oldestFirst?: boolean;
}
