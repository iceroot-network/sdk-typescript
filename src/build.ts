/**
 * Transactions: drafts and signing.
 *
 * A build call resolves everything online (nonce, fee, the milestone in force) and returns a
 * draft; signing is a separate step, so a review screen shows exactly what will be signed. A draft
 * serializes, so it can be built where the network is and signed where the key is. The builders
 * arrive with the Rust core; this module defines their types.
 *
 * @module
 */

import type { Address } from "./address.js";
import type { BaseUnits, Hex } from "./types.js";

/** The fee of a draft: the exact floor, a fixed amount, or a multiple of the floor. */
export type FeeChoice = "minimum" | BaseUnits | { readonly multiplier: number };

/** One recipient of a transfer. */
export interface Recipient {
  /** The recipient's address. */
  readonly address: Address | string;
  /** The amount in base units. */
  readonly amount: BaseUnits;
}

/** A transfer to 1 to 256 recipients with one memo. */
export interface TransferParams {
  /** The sender's address. */
  readonly from: Address | string;
  /** The recipients. */
  readonly to: readonly Recipient[];
  /** At most 255 bytes of UTF-8. */
  readonly memo?: string;
  /** The fee; the exact floor by default. */
  readonly fee?: FeeChoice;
}

/** What a review screen shows for a draft. */
export interface DraftSummary {
  /** The operation, such as `transfer` or `vote`. */
  readonly kind: string;
  /** The sender's address. */
  readonly from: string;
  /** The total leaving the sender, fee included, in base units. */
  readonly total: BaseUnits;
  /** One line per effect, in the order the transaction applies them. */
  readonly lines: readonly string[];
}

/** An unsigned transaction with its fee and nonce resolved. */
export interface Draft {
  /** The fee in base units. */
  readonly fee: BaseUnits;
  /** The sender's next nonce. */
  readonly nonce: bigint;
  /** The size in bytes once signed. */
  readonly size: number;
  /** The height the draft was built for. */
  readonly height: bigint;
  /** What the review screen shows. */
  readonly summary: DraftSummary;
}

/** A signed transaction, ready to submit. */
export interface SignedTransaction {
  /** The transaction id, as lowercase hex. */
  readonly id: Hex;
  /** The transaction as the node's API takes it. */
  readonly json: Readonly<Record<string, unknown>>;
  /** The serialized transaction. */
  readonly bytes: Uint8Array;
}

/** A node's answer to a submission. */
export type SubmitResult =
  | { readonly status: "accepted" }
  | { readonly status: "rejected"; readonly reason: string; readonly nodeCode?: string };

/** How far to wait for a transaction. */
export type WaitUntil = "confirmed" | "final";
