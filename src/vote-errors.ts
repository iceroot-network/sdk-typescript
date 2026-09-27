/**
 * The errors of the vote library, exported by `@iceroot-network/sdk/vote`. Each is an
 * `IceRootError` with the vote library's stable code and details, as the Rust and Go SDKs report
 * them.
 *
 * @module
 */

import { IceRootError, type ErrorDetails } from "./errors.js";
import type { ProblemDetails } from "./vote.js";

/** A selection's number of picks is outside 20 to 53, or below the rules' fewest entries. `details`: `count`, `minimum`, `maximum`. */
export class InvalidPickCount extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidPickCount", message, details);
  }
}

/** The account belongs to a validator that has not resigned for good, and validator accounts cannot vote. */
export class ValidatorCannotVote extends IceRootError {
  constructor(message = "a validator's account cannot vote", details: ErrorDetails = {}) {
    super("ValidatorCannotVote", message, details);
  }
}

/** Why a snapshot cannot be used. */
export type SnapshotProblem =
  | "window"
  | "no-seats"
  | "no-block-time"
  | "name"
  | "duplicate-name"
  | "duplicate-address"
  | "inconsistent";

/**
 * A snapshot cannot be used. `reason` says why; `details` has the values: `days`, `name`,
 * `address`, or `name` and `field` (the record's field, as this API names it) for an inconsistent
 * record.
 */
export class InvalidSnapshot extends IceRootError {
  /** Why the snapshot was refused. */
  readonly reason: SnapshotProblem;

  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidSnapshot", message, details);
    this.reason = details["reason"] as SnapshotProblem;
  }
}

/** The mode's pool and Diversity's together have fewer validators than requested. `details`: `requested`, `available`. */
export class NotEnoughValidators extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("NotEnoughValidators", message, details);
  }
}

/** Fewer picks than the minimum fit the vote rules' limits on entries and bytes. `details`: `fits`, `minimum`, `maxEntries`, `maxBytes`. */
export class DoesNotFit extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("DoesNotFit", message, details);
  }
}

/**
 * The selection is not a vote the rules accept: a name the rules' name rule refuses, or a share
 * above the largest share. The draw does not depend on these rules, so this means the rules do not
 * fit the snapshot's network (IceRoot's rules against today's devnet names, for example).
 */
export class BreaksRules extends IceRootError {
  /** What `validateVote` finds wrong with the selection's vote. */
  readonly problems: readonly ProblemDetails[];

  constructor(message: string, details: ErrorDetails = {}) {
    super("BreaksRules", message, details);
    const problems = details["problems"];
    this.problems = Array.isArray(problems) ? (problems as ProblemDetails[]) : [];
  }
}
