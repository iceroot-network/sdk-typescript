// The vote library's constants and the JSON its functions read and write, shared by the
// WebAssembly entry and the Tauri plugin's entry: 64- and 128-bit integers travel as decimal
// strings and become `bigint`.

import type { NodeStatus, Page, PageOptions, TxFilter, TxRecord, ValidatorInfo } from "../client.js";
import { InvalidArgument } from "../errors.js";
import type {
  Candidate,
  Finding,
  Mode,
  Pick,
  Reason,
  Selection,
  Shortfall,
  SnapshotOptions,
  ValidatorRecord,
  VoteRules,
  VoteSnapshot,
} from "../vote.js";

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

/** IceRoot's vote rules and today's devnet's, as `VoteRules.ICEROOT` and `VoteRules.SOLAR_COMPATIBLE`. */
export const RULE_PRESETS = Object.freeze({
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
});

/** A JSON object as the module writes it. */
export type Wire = Record<string, unknown>;

/** JSON text of `value`, `bigint`s as decimal strings, as the module reads it. */
export function toWire(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item));
  } catch (error) {
    throw new InvalidArgument(`the value cannot be passed to the vote library: ${String(error)}`);
  }
}

export function big(value: unknown, what: string): bigint {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new InvalidArgument(`${what} is not a decimal integer`);
  }
  return BigInt(value);
}

export function optionalBig(value: unknown, what: string): bigint | null {
  return value === null || value === undefined ? null : big(value, what);
}

export function records(value: unknown, what: string): Wire[] {
  if (!Array.isArray(value)) {
    throw new InvalidArgument(`${what} is not a list`);
  }
  return value as Wire[];
}

export function decode<T>(text: string, what: string, convert: (wire: Wire) => T): T {
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

export function snapshotFromWire(wire: Wire): VoteSnapshot {
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
export function reasonFromWire<T extends { readonly kind: string }>(wire: Wire): T {
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

export function reasons(value: unknown): Reason[] {
  return records(value, "reasons").map((reason) => reasonFromWire<Reason>(reason));
}

export function shortfalls(value: unknown): Shortfall[] {
  return records(value, "shortfalls").map((shortfall) => reasonFromWire<Shortfall>(shortfall));
}

export function selectionFromWire(wire: Wire): Selection {
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

export function candidateFromWire(wire: Wire): Candidate {
  return {
    ...(wire as unknown as Candidate),
    weight: big(wire["weight"], "weight"),
    reasons: reasons(wire["reasons"]),
    shortfalls: shortfalls(wire["shortfalls"]),
  };
}

export function findingFromWire(wire: Wire): Finding {
  return { ...(wire as unknown as Finding), reasons: reasons(wire["reasons"]), shortfalls: shortfalls(wire["shortfalls"]) };
}

export async function allPages<T>(read: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const listing = await read(page);
    items.push(...listing.items);
    if (!listing.hasNext || listing.items.length === 0) {
      return items;
    }
  }
}

/** What `VoteSnapshot.fromNode` reads from a network. */
export interface SnapshotReads {
  refresh(): Promise<NodeStatus>;
  readonly validators: { list(options?: PageOptions): Promise<Page<ValidatorInfo>>; blocks(name: string, options?: PageOptions): Promise<Page<{ height: bigint }>> };
  readonly transactions: { list(filter?: TxFilter & PageOptions): Promise<Page<TxRecord>> };
}

/**
 * What `VoteSnapshot.fromNode` hands to the library: the node's height, every validator of its
 * list and the lookups per validator name, as the module reads them.
 */
export async function snapshotInputs(
  net: SnapshotReads,
  options: SnapshotOptions,
): Promise<{ height: number; validators: string; lookups: string }> {
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
      // A validator the snapshot leaves out (see VoteSnapshot.fromNode) needs no lookup.
      const leftOut = !validator.status.startsWith("resigned") && validator.version === undefined;
      if (produced === 0n || leftOut) {
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
  return { height, validators: toWire(validators), lookups: toWire(lookups) };
}

/** The request of `select` in the module's JSON. */
export function selectWire(request: { mode: Mode; account: string; rules: VoteRules; count?: number; draw?: number }, defaultCount: number): string {
  return toWire({
    mode: request.mode,
    account: request.account,
    count: request.count ?? defaultCount,
    draw: request.draw ?? 0,
    rules: request.rules,
  });
}

/** A height of `VoteSnapshot.fromValidators`, checked. */
export function snapshotHeight(height: number | bigint): number {
  const at = typeof height === "bigint" ? Number(height) : height;
  if (!Number.isInteger(at) || at < 1 || at > 0xffffffff) {
    throw new InvalidArgument("a height is an integer from 1 to 4294967295", { height: String(height) });
  }
  return at;
}

// Kept for the declarations of the types above.
export type { Candidate, Finding, Pick, Reason, Selection, Shortfall, ValidatorRecord, VoteSnapshot };
