/**
 * The vote selection library, exported as `@iceroot-network/sdk/vote`.
 *
 * A vote names validators with a share of the account's vote weight each, so wallets offer to fill
 * a vote in one of four modes, or leave it to the holder:
 *
 * - `diversity`, the recommended default, spreads the vote across rank bands first and declared
 *   operators, hosting providers and regions second, among the seated validators and the next 10
 *   by rank that are in good health;
 * - `reliability` favours validators with a strong production record over a 30-day window;
 * - `maximum-rewards` favours the highest measured payouts per unit of vote weight, at most two
 *   picks per declared operator;
 * - `support-newcomers` favours healthy validators just above and below the seat cutoff, at most
 *   two picks per declared operator;
 * - manual voting has no mode: {@link validateVote} checks the holder's own vote.
 *
 * Every function is a pure function of its arguments, computed by the SDK's Rust core in
 * WebAssembly: no I/O, no clock, no floating point. Anyone with the same snapshot, account, mode,
 * number of picks, vote rules, draw number and library version gets the same selection. The
 * library never recasts a vote: {@link check} only reports the picks that no longer meet their
 * criteria, and a new selection is the holder's to review and sign.
 *
 * Heights, days since registration, vote weights, payouts and draw weights are `bigint`;
 * everything else is a `number`.
 *
 * @module
 */

import type { VoteEntry } from "./build.js";
import { handleOf as chainHandleOf, type Chain } from "./chain.js";
import type { Page, ValidatorInfo } from "./client.js";
import { InvalidArgument } from "./errors.js";
import { call, parse } from "./internal/bindings.js";
import type { Network } from "./network.js";

export type { VoteEntry } from "./build.js";
export * from "./vote-errors.js";

// ---- modes, rules and snapshots -------------------------------------------------------------

/** A vote mode: the preference an automatic selection follows. */
export type Mode = "diversity" | "reliability" | "maximum-rewards" | "support-newcomers";

/** Every mode, Diversity (the recommended default) first. */
export const MODES: readonly Mode[] = Object.freeze(["diversity", "reliability", "maximum-rewards", "support-newcomers"]);

/** Each mode's name as wallets show it. */
export const MODE_NAMES: Readonly<Record<Mode, string>> = Object.freeze({
  diversity: "Diversity",
  reliability: "Reliability",
  "maximum-rewards": "Maximum Rewards",
  "support-newcomers": "Support Newcomers",
});

/** The version of the selection rules, which every selection records. */
export const LIBRARY_VERSION = "iceroot-vote/1";
/** The fewest picks of a selection. */
export const MIN_PICKS = 20;
/** The most picks of a selection, as many as a vote can name. */
export const MAX_PICKS = 53;
/** The default number of picks: 500 basis points each. */
export const DEFAULT_PICKS = 20;

/** Which names a network accepts for validators. */
export type NameRule =
  /** 1 to 20 of `a-z`, `0-9` and `!@$&_.`, not starting with `_` and not only digits (today's devnet). */
  | "solar-compatible"
  /** 1 to 20 lowercase letters `a-z` (IceRoot's formats). */
  | "lowercase-letters";

/** A network's vote rules, as the node enforces them. */
export interface VoteRules {
  /** The fewest entries of a vote that is not empty. */
  readonly minEntries: number;
  /** The most entries of a vote. */
  readonly maxEntries: number;
  /** The largest share of one entry, in basis points. */
  readonly maxEntryBasisPoints: number;
  /** The largest vote contents in bytes: one count byte, then per entry a length byte, the name and two bytes of basis points. */
  readonly maxBytes: number;
  /** Which names are validator names. */
  readonly names: NameRule;
  /** Whether a validator's account may vote. */
  readonly validatorsMayVote: boolean;
}

/** The vote rules of a network. */
export const VoteRules = Object.freeze({
  /** IceRoot from its genesis: 20 to 53 entries of at most 500 basis points each, 1,280 bytes, lowercase names, no vote from a validator's account. */
  ICEROOT: Object.freeze({
    minEntries: 20,
    maxEntries: 53,
    maxEntryBasisPoints: 500,
    maxBytes: 1280,
    names: "lowercase-letters",
    validatorsMayVote: false,
  }) as VoteRules,

  /** Today's devnet formats: 1 to 53 entries, any share, 1,024 bytes, the devnet's names, and validators may vote. */
  SOLAR_COMPATIBLE: Object.freeze({
    minEntries: 1,
    maxEntries: 53,
    maxEntryBasisPoints: 10_000,
    maxBytes: 1024,
    names: "solar-compatible",
    validatorsMayVote: true,
  }) as VoteRules,

  /**
   * The vote rules in force on a network: at the next block of `net`, or at `height` of `chain`.
   * The limits come from the milestone in force, the name rule and whether validators may vote
   * from the format stage. Pass these to {@link select} and {@link validateVote} rather than
   * writing rules by hand.
   */
  of(source: Network | Chain, height?: number): VoteRules {
    const isNetwork = "nextHeight" in source;
    const chain = isNetwork ? source.chain : source;
    const at = height ?? (isNetwork ? source.nextHeight : undefined);
    if (at === undefined || !Number.isInteger(at) || at < 1 || at > 0xffffffff) {
      throw new InvalidArgument("the vote rules of a chain need a height from 1 to 4294967295", { height: at });
    }
    const handle = chainHandleOf(chain);
    return Object.freeze(parse<VoteRules>(call((module) => module.voteRulesAt(handle, at))));
  },
});

/** A validator's registration status. */
export type ValidatorStatus = "active" | "standby" | "resigned-temporary" | "resigned-permanent";

/** Where a snapshot's data comes from. */
export type SnapshotSource =
  /** An indexer that keeps windowed production, penalties, declarations and measured payouts. */
  | "indexer"
  /** A node's API, which has lifetime counters only: see {@link VoteSnapshot.fromNode}. */
  | "relay-approximate";

/** What a selection knows about one validator. Fields a source cannot supply are `null`. */
export interface ValidatorRecord {
  /** The validator's name, which a vote names. */
  readonly name: string;
  /** The validator's account address. */
  readonly address: string;
  /** Rank by vote weight (1 is first), or `null` when it has none, as for a resigned validator. */
  readonly rank: number | null;
  /** Whether the validator holds a seat. */
  readonly seated: boolean;
  /** Registration status. */
  readonly status: ValidatorStatus;
  /** The height of the registration. */
  readonly registeredHeight: bigint | null;
  /** Days with a seat in the 30-day window. */
  readonly seatedDaysInWindow: number | null;
  /** Vote weight in base units. */
  readonly voteWeight: bigint;
  /** Number of voting accounts. */
  readonly voters: number;
  /** Slots forged against slots assigned over the window (lifetime counts in a relay snapshot). */
  readonly production: { readonly forged: number; readonly assigned: number } | null;
  /** Penalties from the chain's record. */
  readonly penalties: {
    readonly jailedInWindow: boolean;
    readonly equivocationInWindow: boolean;
    readonly ever: boolean;
  } | null;
  /** The validator's own declarations: statements, not verified facts. The region comes from the country. */
  readonly declarations: {
    readonly operator?: string | null;
    readonly hosting?: string | null;
    /** An ISO 3166-1 alpha-2 code. */
    readonly country?: string | null;
    /** Whether every required declaration is present. */
    readonly complete: boolean;
  } | null;
  /** Payouts to voters as the indexer measures them, never as declared, per unit of vote weight over the window. */
  readonly payouts: { readonly perUnitWeight: bigint; readonly intervals: number } | null;
  /** The share of the vote weight from accounts the validator's account funded directly, in basis points. */
  readonly selfFundedWeightBp: number | null;
}

/** The input of every selection: validator data at one height. */
export interface VoteSnapshot {
  /** The height the data describes. Rounded down to its election interval, it seeds the draw. */
  readonly height: bigint;
  /** The window of the windowed data, in days: always 30. */
  readonly windowDays: number;
  /** The number of seats. */
  readonly seats: number;
  /** The target block time, in seconds, to turn heights into days. */
  readonly blockTimeSeconds: number;
  /** Where the data comes from; every selection records it. */
  readonly source: SnapshotSource;
  /** One record per registered validator, in any order. */
  readonly records: readonly ValidatorRecord[];
}

/** What {@link VoteSnapshot.fromNode} looks up besides the validator list. */
export interface SnapshotOptions {
  /**
   * Look up each validator's first forged block, one request per validator that forged, which
   * gives its seated days (at most the 30-day window). Without it, a validator that forged has no
   * seated days and Reliability's pool is empty. `true` by default.
   */
  readonly firstForged?: boolean;
  /** Look up each validator's registration height from the registrations, a few paged requests. `true` by default. */
  readonly registrations?: boolean;
}

/** What an app looked up about one validator of a node's list. Heights are block heights. */
export interface ValidatorLookup {
  /** The height of the validator's registration. */
  readonly registeredHeight?: bigint;
  /** The height of the first block the validator forged. */
  readonly firstForgedHeight?: bigint;
}

/** Snapshots of validator data. */
export const VoteSnapshot = Object.freeze({
  /** The window of windowed data, in days. */
  WINDOW_DAYS: 30,

  /**
   * A snapshot of a node's validators at its last block, marked `relay-approximate`: every page of
   * `net.validators.list`, the registrations and each validator's first forged block (see
   * {@link SnapshotOptions}), with the seats and block time of the milestone in force.
   *
   * A node has lifetime counters only, so production is the lifetime produced blocks against
   * produced plus missed, seated days are the days since the first forged block (at most 30), and
   * there are no declarations, payouts or penalties. So Diversity works on rank bands alone,
   * Maximum Rewards and Support Newcomers top up from Diversity and say so, and on a young chain
   * Reliability's pool is empty until validators have 7 days of seated history. Every selection
   * records the source.
   */
  async fromNode(net: Network, options: SnapshotOptions = {}): Promise<VoteSnapshot> {
    const status = await net.refresh();
    const validators = await allPages((page) => net.validators.list({ page, limit: 100 }));
    const lookups: Record<string, { registeredHeight?: string; firstForgedHeight?: string }> = {};
    const entry = (name: string) => (lookups[name] ??= {});
    if (options.registrations ?? true) {
      const registrations = await allPages((page) =>
        net.transactions.list({ kind: "register-validator", oldestFirst: true, page, limit: 100 }),
      );
      for (const record of registrations) {
        const details = record.details;
        if (record.block !== undefined && details.kind === "register-validator") {
          entry(details.name).registeredHeight ??= String(record.block.height);
        }
      }
    }
    if (options.firstForged ?? true) {
      for (const validator of validators) {
        const produced = validator.production.produced;
        if (produced === 0n) {
          continue;
        }
        // Blocks come highest first, one per page: the page numbered by the blocks produced is the first.
        let page = await net.validators.blocks(validator.name, { page: Number(produced), limit: 1 });
        if (page.items.length === 0 && page.pageCount > 0) {
          page = await net.validators.blocks(validator.name, { page: page.pageCount, limit: 1 });
        }
        const first = page.items[0];
        if (first !== undefined) {
          entry(validator.name).firstForgedHeight = String(first.height);
        }
      }
    }
    const height = status.height > 0xffffffffn ? 0xffffffff : Math.max(1, Number(status.height));
    return snapshotFromWire(
      parse<Wire>(
        call((module) =>
          module.voteSnapshotFromValidators(chainHandleOf(net.chain), height, toWire(validators), toWire(lookups)),
        ),
      ),
    );
  },

  /**
   * A snapshot of validators an app read itself (every page of `net.validators.list`) at `height`
   * of `chain`, with what it looked up per validator name. See {@link VoteSnapshot.fromNode}.
   */
  fromValidators(
    chain: Chain,
    height: number | bigint,
    validators: readonly ValidatorInfo[],
    lookups: Readonly<Record<string, ValidatorLookup>> = {},
  ): VoteSnapshot {
    const at = typeof height === "bigint" ? Number(height) : height;
    if (!Number.isInteger(at) || at < 1 || at > 0xffffffff) {
      throw new InvalidArgument("a height is an integer from 1 to 4294967295", { height: String(height) });
    }
    const handle = chainHandleOf(chain);
    return snapshotFromWire(
      parse<Wire>(
        call((module) => module.voteSnapshotFromValidators(handle, at, toWire(validators), toWire(lookups))),
      ),
    );
  },

  /**
   * Checks a snapshot as every function of the library does before using it: a 30-day window,
   * seats and a block time, unique valid names and addresses, and consistent records. Throws
   * `InvalidSnapshot` with the problem.
   */
  validate(snapshot: VoteSnapshot): void {
    voteCall("validateSnapshot", toWire(snapshot));
  },

  /** The snapshot as JSON text, heights and weights as decimal strings, for storing or sending to a worker. */
  serialize(snapshot: VoteSnapshot): string {
    return toWire(snapshot);
  },

  /** A snapshot from {@link VoteSnapshot.serialize}'s text. Throws `InvalidArgument` for text of another shape. */
  deserialize(text: string): VoteSnapshot {
    return decode(text, "a vote snapshot", snapshotFromWire);
  },
});

/** Whether an account may vote under rules that forbid validators to vote. */
export type Voter =
  /** An ordinary account, or a validator's account after it resigned for good. */
  | "ordinary"
  /** A validator's account, including one resigned for now. */
  | "validator";

/** Whether the account `address` may vote as `snapshot` shows it: `validator` when it belongs to a validator that has not resigned for good. */
export function voterOf(snapshot: VoteSnapshot, address: string): Voter {
  return voteCall("voter", toWire(snapshot), address) as Voter;
}

// ---- selections -----------------------------------------------------------------------------

/** A grouping that Diversity spreads a vote across. */
export type Dimension = "operator" | "hosting" | "region" | "rank-band";

type Described<K extends string, F = object> = { readonly kind: K } & { readonly [P in keyof F]: F[P] } & {
  /** The plain English sentence for the review screen. Declared names appear quoted, with control and invisible characters escaped. */
  readonly text: string;
};

/** One reason a validator was picked or meets a mode's criteria, with its values and a sentence. */
export type Reason =
  | Described<"drawn", { pool: Mode; step: number; candidates: number; weight: bigint; totalWeight: bigint }>
  | Described<"top-up", { mode: Mode; modePicks: number }>
  | Described<"status", { status: ValidatorStatus; rank: number | null; seated: boolean }>
  | Described<"production", { forged: number; assigned: number; approximate: boolean }>
  | Described<"no-production-record">
  | Described<"no-penalties-in-window">
  | Described<"no-penalties-ever">
  | Described<"no-penalty-record">
  | Described<"seated-days", { days: number }>
  /** Days since the registration: a `bigint`, as heights are. */
  | Described<"registered-days", { days: bigint }>
  | Described<"declarations-complete">
  | Described<"group", { dimension: Dimension; value: string | null; earlierPicks: number }>
  | Described<"measured-payouts", { perUnitWeight: bigint; intervals: number; ofBestPpm: number }>
  | Described<"operator-picks", { operator: string | null; picks: number; maximum: number }>
  | Described<"near-cutoff", { rank: number; seats: number }>
  | Described<"self-funded-weight", { basisPoints: number }>
  | Described<"chosen-by-holder">;

/** One criterion a validator fails, with its values and a sentence. */
export type Shortfall =
  | Described<"not-in-snapshot">
  | Described<"resigned", { status: ValidatorStatus }>
  | Described<"penalized-in-window", { jailed: boolean; equivocation: boolean }>
  | Described<"penalized-ever">
  | Described<"low-production", { forged: number; assigned: number; minimumBp: number }>
  | Described<"no-production-record">
  | Described<"too-few-seated-days", { days: number | null; minimum: number }>
  | Described<"registered-too-recently", { days: bigint | null; minimum: number }>
  | Described<"declarations-incomplete">
  | Described<"no-measured-payouts">
  | Described<"not-seated">
  | Described<"no-rank">
  | Described<"not-near-cutoff", { rank: number; seats: number }>
  | Described<"far-below-cutoff", { rank: number; seats: number; ranksBelow: number }>
  | Described<"operator-cap", { operator: string | null; maximum: number }>;

/** Where a pick came from. */
export type PickSource =
  /** Drawn from the mode's pool. */
  | "mode"
  /** Drawn from Diversity's pool because the mode's pool was too small. */
  | "top-up"
  /** Chosen by the holder on the review screen; the library never makes such picks. {@link check} judges them by their registration only. */
  | "holder";

/** One pick of a selection. */
export interface Pick {
  /** The validator's name. */
  readonly validator: string;
  /** Its share, in basis points. */
  readonly basisPoints: number;
  /** Where it came from. */
  readonly source: PickSource;
  /** The step at which it was drawn, from 1. */
  readonly step: number;
  /** Why it was picked: the criteria it meets, its groups and its chance at the step it was drawn. */
  readonly reasons: readonly Reason[];
}

/** A selection: the picks of one draw, with everything needed to reproduce and explain it. */
export interface Selection {
  /** {@link LIBRARY_VERSION} at the time of the draw. */
  readonly libraryVersion: string;
  readonly mode: Mode;
  /** The voting account's address. */
  readonly account: string;
  /** The snapshot's height. */
  readonly snapshotHeight: bigint;
  /** The snapshot's source; `relay-approximate` means production figures are lifetime counts. */
  readonly snapshotSource: SnapshotSource;
  /** The draw number: 0 first, one more for each "draw again". */
  readonly draw: number;
  /** The number of picks requested; more than the entries when that many did not fit the vote rules. */
  readonly requested: number;
  /** The vote rules the selection keeps within. */
  readonly rules: VoteRules;
  /** The seed, 64 hex digits. */
  readonly seed: string;
  /** Validators that met the mode's criteria. */
  readonly pool: number;
  /** Picks added from Diversity because the mode's pool was too small. */
  readonly toppedUp: number;
  /** The picks, in the protocol's canonical order. */
  readonly entries: readonly Pick[];
  /** The vote to sign: the picks' names and shares, in the canonical order, for `net.build.vote`. */
  readonly vote: readonly VoteEntry[];
  /** The sentence to show when fewer picks than requested fit the vote rules, else `null`. */
  readonly sizeNotice: string | null;
  /** The sentence to show when the selection was topped up from Diversity, else `null`. */
  readonly topUpNotice: string | null;
}

/** What to select. */
export interface SelectRequest {
  readonly mode: Mode;
  /** The voting account's address; part of the seed. */
  readonly account: string;
  /** The network's vote rules, from {@link VoteRules.of}. */
  readonly rules: VoteRules;
  /** The number of picks, from 20 to 53; {@link DEFAULT_PICKS} by default. */
  readonly count?: number;
  /** The draw number: 0 by default, one more for each "draw again". */
  readonly draw?: number;
}

/**
 * A selection of `request.count` validators (20 by default) from `snapshot` in `request.mode`,
 * drawn one at a time from the mode's pool and seeded by the account, the mode, the snapshot's
 * election interval and the draw number. When the mode's pool is too small, the rest comes from
 * Diversity and `topUpNotice` says so; when long names do not all fit the rules' byte limit, the
 * selection keeps the longest start of the draw that fits and `sizeNotice` says so.
 *
 * Throws `InvalidPickCount`, `InvalidSnapshot`, `ValidatorCannotVote` (the account belongs to a
 * validator that has not resigned for good), `NotEnoughValidators`, `DoesNotFit` (fewer than the
 * minimum fit the rules) or `BreaksRules` (the rules do not fit the snapshot's names or shares).
 */
export function select(snapshot: VoteSnapshot, request: SelectRequest): Selection {
  const wire = {
    mode: request.mode,
    account: request.account,
    count: request.count ?? DEFAULT_PICKS,
    draw: request.draw ?? 0,
    rules: request.rules,
  };
  return selectionFromWire(parse<Wire>(voteCall("select", toWire(snapshot), toWire(wire))));
}

/** One validator judged by one mode. */
export interface Candidate {
  readonly validator: string;
  /** Whether it meets the mode's criteria. */
  readonly eligible: boolean;
  /** Its weight in the draw when eligible, else 0. Diversity's weight is before the spread, the same for every candidate. */
  readonly weight: bigint;
  /** The criteria it meets, with their values. */
  readonly reasons: readonly Reason[];
  /** The criteria it fails. */
  readonly shortfalls: readonly Shortfall[];
}

/** Every validator of `snapshot` judged by `mode`, in name order: for a screen that shows why a validator is or is not in a mode's pool. */
export function evaluate(snapshot: VoteSnapshot, mode: Mode): Candidate[] {
  return parse<Wire[]>(voteCall("evaluate", toWire(snapshot), mode)).map(candidateFromWire);
}

/** Whether one pick of a selection still meets its criteria. */
export interface Finding {
  readonly validator: string;
  readonly stillMeets: boolean;
  /** The criteria it meets. */
  readonly reasons: readonly Reason[];
  /** The criteria it no longer meets; empty when it still meets them. */
  readonly shortfalls: readonly Shortfall[];
  /** One line: what it no longer meets, or that it still meets its criteria. */
  readonly why: string;
}

/** The part of a selection {@link check} reads: its mode, and each pick's name, source and step. */
export interface CheckedSelection {
  readonly mode: Mode;
  readonly entries: readonly { readonly validator: string; readonly source: PickSource; readonly step: number }[];
}

/**
 * Each pick of an earlier selection checked against a newer snapshot, in the selection's order.
 * A mode pick is judged by the selection's mode, a top-up pick by Diversity, and a holder's pick by
 * its registration only. Nothing is changed: the wallet tells the holder which picks no longer
 * meet their criteria and may offer a new selection, which the holder reviews and signs.
 */
export function check(selection: CheckedSelection, snapshot: VoteSnapshot): Finding[] {
  const wire = {
    mode: selection.mode,
    entries: selection.entries.map(({ validator, source, step }) => ({ validator, source, step })),
  };
  return parse<Wire[]>(voteCall("check", toWire(wire), toWire(snapshot))).map(findingFromWire);
}

/** What is wrong with a vote: `reason` and its values. */
export type ProblemDetails =
  | { readonly reason: "validator-account" }
  | { readonly reason: "too-few-entries"; readonly count: number; readonly minimum: number }
  | { readonly reason: "too-many-entries"; readonly count: number; readonly maximum: number }
  | { readonly reason: "name" | "duplicate" | "zero-share"; readonly validator: string }
  | { readonly reason: "share-too-large"; readonly validator: string; readonly basisPoints: number; readonly maximum: number }
  | { readonly reason: "sum"; readonly basisPoints: number }
  | { readonly reason: "too-large"; readonly bytes: number; readonly maximum: number };

/** A problem of a vote, with its sentence. */
export type Problem = ProblemDetails & { readonly text: string };

/**
 * What is wrong with a vote under `rules` for a `voter`, in a fixed order (the voter, the entry
 * count, each entry in turn, the total and the size); empty for a valid vote. An empty vote, which
 * withdraws every vote, is valid unless the rules forbid the voter to vote.
 */
export function validateVote(entries: readonly VoteEntry[], rules: VoteRules, voter: Voter = "ordinary"): Problem[] {
  const wire = entries.map(({ validator, basisPoints }) => ({ validator, basisPoints }));
  return parse<Problem[]>(voteCall("validate", toWire(wire), toWire(rules), voter));
}

/**
 * 10,000 basis points shared among `validators` in whole basis points, as evenly as possible: the
 * remainder goes one basis point each to the first validators of the list, and the entries come in
 * the protocol's canonical order. For manual voting. More than 10,000 validators throw
 * `InvalidVote`.
 */
export function split(validators: readonly string[]): VoteEntry[] {
  return parse<VoteEntry[]>(voteCall("split", toWire(validators)));
}

/** Selections as text. */
export const Selection = Object.freeze({
  /** The selection as JSON text, for storing it until the next {@link check}. */
  serialize(selection: Selection): string {
    return toWire(selection);
  },

  /** A selection from {@link Selection.serialize}'s text. Throws `InvalidArgument` for text of another shape. */
  deserialize(text: string): Selection {
    return decode(text, "a selection", selectionFromWire);
  },
});

// ---- the JSON the module reads and writes ---------------------------------------------------

type Wire = Record<string, unknown>;

/** One of the vote library's functions in the module, which share one export. */
function voteCall(operation: string, first: string, second = "", third = ""): string {
  return call((module) => module.voteCall(operation, first, second, third));
}

/** JSON text of `value`, `bigint`s as decimal strings, as the module reads it. */
function toWire(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item));
  } catch (error) {
    throw new InvalidArgument(`the value cannot be passed to the vote library: ${String(error)}`);
  }
}

function big(value: unknown, what: string): bigint {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new InvalidArgument(`${what} is not a decimal integer`);
  }
  return BigInt(value);
}

function optionalBig(value: unknown, what: string): bigint | null {
  return value === null || value === undefined ? null : big(value, what);
}

function records(value: unknown, what: string): Wire[] {
  if (!Array.isArray(value)) {
    throw new InvalidArgument(`${what} is not a list`);
  }
  return value as Wire[];
}

function decode<T>(text: string, what: string, convert: (wire: Wire) => T): T {
  let wire: unknown;
  try {
    wire = JSON.parse(text);
  } catch {
    throw new InvalidArgument(`the text is not ${what} in JSON`);
  }
  if (typeof wire !== "object" || wire === null) {
    throw new InvalidArgument(`the text is not ${what} in JSON`);
  }
  return convert(wire as Wire);
}

function snapshotFromWire(wire: Wire): VoteSnapshot {
  return {
    ...(wire as unknown as VoteSnapshot),
    height: big(wire["height"], "height"),
    records: records(wire["records"], "records").map((record) => {
      const payouts = record["payouts"] as Wire | null | undefined;
      return {
        ...(record as unknown as ValidatorRecord),
        registeredHeight: optionalBig(record["registeredHeight"], "registeredHeight"),
        voteWeight: big(record["voteWeight"], "voteWeight"),
        payouts:
          payouts === null || payouts === undefined
            ? null
            : { ...(payouts as unknown as { intervals: number }), perUnitWeight: big(payouts["perUnitWeight"], "perUnitWeight") },
      };
    }),
  };
}

/** A reason or shortfall, its 64- and 128-bit values as `bigint`. */
function reasonFromWire<T extends { readonly kind: string }>(wire: Wire): T {
  switch (wire["kind"]) {
    case "drawn":
      return { ...wire, weight: big(wire["weight"], "weight"), totalWeight: big(wire["totalWeight"], "totalWeight") } as unknown as T;
    case "measured-payouts":
      return { ...wire, perUnitWeight: big(wire["perUnitWeight"], "perUnitWeight") } as unknown as T;
    case "registered-days":
    case "registered-too-recently":
      return { ...wire, days: optionalBig(wire["days"], "days") } as unknown as T;
    default:
      return wire as unknown as T;
  }
}

function reasons(value: unknown): Reason[] {
  return records(value, "reasons").map((reason) => reasonFromWire<Reason>(reason));
}

function shortfalls(value: unknown): Shortfall[] {
  return records(value, "shortfalls").map((shortfall) => reasonFromWire<Shortfall>(shortfall));
}

function selectionFromWire(wire: Wire): Selection {
  const entries: Pick[] = records(wire["entries"], "entries").map((pick) => ({
    ...(pick as unknown as Pick),
    reasons: reasons(pick["reasons"]),
  }));
  return {
    ...(wire as unknown as Selection),
    snapshotHeight: big(wire["snapshotHeight"], "snapshotHeight"),
    entries,
    // The entries come in the protocol's canonical order, so their names and shares are the vote.
    vote: entries.map(({ validator, basisPoints }) => ({ validator, basisPoints })),
  };
}

function candidateFromWire(wire: Wire): Candidate {
  return {
    ...(wire as unknown as Candidate),
    weight: big(wire["weight"], "weight"),
    reasons: reasons(wire["reasons"]),
    shortfalls: shortfalls(wire["shortfalls"]),
  };
}

function findingFromWire(wire: Wire): Finding {
  return { ...(wire as unknown as Finding), reasons: reasons(wire["reasons"]), shortfalls: shortfalls(wire["shortfalls"]) };
}

async function allPages<T>(read: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const listing = await read(page);
    items.push(...listing.items);
    if (!listing.hasNext || listing.items.length === 0) {
      return items;
    }
  }
}
