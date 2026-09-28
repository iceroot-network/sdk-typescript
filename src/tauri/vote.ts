/**
 * The vote selection library through the plugin, exported as `@iceroot-network/sdk/tauri/vote`:
 * the same functions as `@iceroot-network/sdk/vote`, computed by the same Rust library in the
 * plugin. Functions that compute return promises; the constants, and the snapshots' and
 * selections' text forms, need no call.
 *
 * @module
 */

import type { VoteEntry } from "../build.js";
import { InvalidArgument } from "../errors.js";
import type { ValidatorInfo } from "../client.js";
import {
  DEFAULT_PICKS,
  RULE_PRESETS,
  candidateFromWire,
  decode,
  findingFromWire,
  selectionFromWire,
  selectWire,
  snapshotFromWire,
  snapshotHeight,
  snapshotInputs,
  toWire,
  type Wire,
} from "../internal/vote-wire.js";
import type {
  Candidate,
  CheckedSelection,
  Finding,
  Mode,
  Problem,
  SelectRequest,
  Selection as SelectionType,
  SnapshotOptions,
  ValidatorLookup,
  Voter,
  VoteRules as VoteRulesType,
  VoteSnapshot as VoteSnapshotType,
} from "../vote.js";
import { Chain, chainOf } from "./chain.js";
import { invoke } from "./invoke.js";
import type { Network } from "./network.js";

export type { VoteEntry } from "../build.js";
export * from "../vote-errors.js";
export { DEFAULT_PICKS, LIBRARY_VERSION, MAX_PICKS, MIN_PICKS, MODE_NAMES, MODES } from "../internal/vote-wire.js";
export type {
  Candidate,
  CheckedSelection,
  Dimension,
  Finding,
  Mode,
  NameRule,
  Pick,
  PickSource,
  Problem,
  ProblemDetails,
  Reason,
  SelectRequest,
  Shortfall,
  SnapshotOptions,
  SnapshotSource,
  ValidatorLookup,
  ValidatorRecord,
  ValidatorStatus,
  Voter,
} from "../vote.js";

/** A network's vote rules, as the node enforces them. */
export type VoteRules = VoteRulesType;
/** The input of every selection: validator data at one height. */
export type VoteSnapshot = VoteSnapshotType;
/** A selection: the picks of one draw, with everything needed to reproduce and explain it. */
export type Selection = SelectionType;

/** One of the vote library's functions in the plugin. */
function voteCall(operation: string, first: string, second = "", third = ""): Promise<string> {
  return invoke<string>("vote_call", { operation, first, second, third });
}

/** The vote rules of a network. */
export const VoteRules = Object.freeze({
  /** IceRoot from its genesis: 20 to 53 entries of at most 500 basis points each, 1,280 bytes, lowercase names, no vote from a validator's account. */
  ICEROOT: RULE_PRESETS.ICEROOT,

  /** Today's devnet formats: 1 to 53 entries, any share, 1,024 bytes, the devnet's names, and validators may vote. */
  SOLAR_COMPATIBLE: RULE_PRESETS.SOLAR_COMPATIBLE,

  /**
   * The vote rules in force on a network: at the next block of `net`, or at `height` of `chain`.
   * Pass these to {@link select} and {@link validateVote} rather than writing rules by hand.
   */
  async of(source: Network | Chain, height?: number): Promise<VoteRules> {
    const isNetwork = !(source instanceof Chain);
    const chain = isNetwork ? source.chain : source;
    const at = height ?? (isNetwork ? source.nextHeight : undefined);
    if (at === undefined || !Number.isInteger(at) || at < 1 || at > 0xffffffff) {
      throw new InvalidArgument("the vote rules of a chain need a height from 1 to 4294967295", { height: at });
    }
    return Object.freeze(JSON.parse(await invoke<string>("vote_rules_at", { chain: chainOf(chain), height: at })) as VoteRules);
  },
});

/** Snapshots of validator data. */
export const VoteSnapshot = Object.freeze({
  /** The window of windowed data, in days. */
  WINDOW_DAYS: 30,

  /**
   * A snapshot of a node's validators at its last block, marked `relay-approximate`, read through
   * the plugin (see the WebAssembly entry's `VoteSnapshot.fromNode`).
   */
  async fromNode(net: Network, options: SnapshotOptions = {}): Promise<VoteSnapshot> {
    const inputs = await snapshotInputs(net, options);
    const text = await invoke<string>("vote_snapshot_from_validators", {
      chain: chainOf(net.chain),
      height: inputs.height,
      validators: inputs.validators,
      lookups: inputs.lookups,
    });
    return snapshotFromWire(JSON.parse(text) as Wire);
  },

  /**
   * A snapshot of validators an app read itself at `height` of `chain`, with what it looked up per
   * validator name (see the WebAssembly entry's `VoteSnapshot.fromValidators`).
   */
  async fromValidators(
    chain: Chain,
    height: number | bigint,
    validators: readonly ValidatorInfo[],
    lookups: Readonly<Record<string, ValidatorLookup>> = {},
  ): Promise<VoteSnapshot> {
    const at = snapshotHeight(height);
    const text = await invoke<string>("vote_snapshot_from_validators", {
      chain: chainOf(chain),
      height: at,
      validators: toWire(validators),
      lookups: toWire(lookups),
    });
    return snapshotFromWire(JSON.parse(text) as Wire);
  },

  /** Checks a snapshot as every function of the library does before using it; rejects with `InvalidSnapshot`. */
  async validate(snapshot: VoteSnapshot): Promise<void> {
    await voteCall("validateSnapshot", toWire(snapshot));
  },

  /** The snapshot as JSON text, heights and weights as decimal strings. */
  serialize(snapshot: VoteSnapshot): string {
    return toWire(snapshot);
  },

  /** A snapshot from {@link VoteSnapshot.serialize}'s text. Throws `InvalidArgument` for text of another shape. */
  deserialize(text: string): VoteSnapshot {
    return decode(text, "a vote snapshot", snapshotFromWire);
  },
});

/** Whether the account `address` may vote as `snapshot` shows it. */
export async function voterOf(snapshot: VoteSnapshot, address: string): Promise<Voter> {
  return (await voteCall("voter", toWire(snapshot), address)) as Voter;
}

/**
 * A selection of `request.count` validators (20 by default) from `snapshot` in `request.mode`
 * (see the WebAssembly entry's `select`).
 */
export async function select(snapshot: VoteSnapshot, request: SelectRequest): Promise<Selection> {
  return selectionFromWire(JSON.parse(await voteCall("select", toWire(snapshot), selectWire(request, DEFAULT_PICKS))) as Wire);
}

/** Every validator of `snapshot` judged by `mode`, in name order. */
export async function evaluate(snapshot: VoteSnapshot, mode: Mode): Promise<Candidate[]> {
  return (JSON.parse(await voteCall("evaluate", toWire(snapshot), mode)) as Wire[]).map(candidateFromWire);
}

/** Each pick of an earlier selection checked against a newer snapshot, in the selection's order. Nothing is changed. */
export async function check(selection: CheckedSelection, snapshot: VoteSnapshot): Promise<Finding[]> {
  const wire = {
    mode: selection.mode,
    entries: selection.entries.map(({ validator, source, step }) => ({ validator, source, step })),
  };
  return (JSON.parse(await voteCall("check", toWire(wire), toWire(snapshot))) as Wire[]).map(findingFromWire);
}

/** What is wrong with a vote under `rules` for a `voter`, in a fixed order; empty for a valid vote. */
export async function validateVote(entries: readonly VoteEntry[], rules: VoteRules, voter: Voter = "ordinary"): Promise<Problem[]> {
  const wire = entries.map(({ validator, basisPoints }) => ({ validator, basisPoints }));
  return JSON.parse(await voteCall("validate", toWire(wire), toWire(rules), voter)) as Problem[];
}

/** 10,000 basis points shared among `validators` in whole basis points, in the protocol's canonical order. */
export async function split(validators: readonly string[]): Promise<VoteEntry[]> {
  return JSON.parse(await voteCall("split", toWire(validators))) as VoteEntry[];
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
