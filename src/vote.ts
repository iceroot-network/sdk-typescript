/**
 * The vote selection library, exported as `@iceroot-network/sdk/vote`.
 *
 * Pure functions over validator data: no I/O, no clock, no floating point. Anyone with the same
 * snapshot, account, mode, draw number and library version gets the same selection. The functions
 * arrive with the Rust core; this module defines their types.
 *
 * @module
 */

/** A selection mode. */
export type Mode = "diversity" | "reliability" | "maximum-rewards" | "support-newcomers";

/** A validator's status. */
export type ValidatorStatus = "active" | "standby" | "resigned-temporary" | "resigned-permanent";

/** What the selection knows about one validator. Fields a network cannot supply are `null`. */
export interface ValidatorRecord {
  readonly name: string;
  readonly address: string;
  readonly rank: number | null;
  readonly seated: boolean;
  readonly status: ValidatorStatus;
  readonly registeredHeight: bigint;
  readonly seatedDaysInWindow: number | null;
  readonly voteWeight: bigint;
  readonly voters: number;
  /** Produced and assigned slots over the window. */
  readonly production: { readonly forged: number; readonly assigned: number } | null;
  readonly penalties: {
    readonly jailedInWindow: boolean;
    readonly equivocationInWindow: boolean;
    readonly ever: boolean;
  } | null;
  readonly declarations: {
    readonly operator?: string;
    readonly hosting?: string;
    readonly country?: string;
    readonly complete: boolean;
  } | null;
  readonly payouts: { readonly perUnitWeight: bigint; readonly intervals: number } | null;
  readonly selfFundedWeightBp: number | null;
}

/** Validator data at one height. */
export interface VoteSnapshot {
  readonly height: bigint;
  readonly windowDays: 30;
  readonly seats: number;
  readonly records: readonly ValidatorRecord[];
}

/** One entry of a vote: a validator's name and a share in basis points. */
export interface VoteEntry {
  readonly validator: string;
  readonly basisPoints: number;
}

/** A selection and everything needed to reproduce it. */
export interface Selection {
  readonly libraryVersion: number;
  readonly mode: Mode;
  readonly account: string;
  readonly snapshotHeight: bigint;
  readonly draw: number;
  readonly seed: string;
  readonly entries: readonly (VoteEntry & { readonly reasons: readonly string[] })[];
  /** How many picks came from Diversity because the mode's pool was too small. */
  readonly toppedUp: number;
}
