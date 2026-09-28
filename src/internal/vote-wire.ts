// The vote library's constants and the JSON its functions read and write, shared by the
// WebAssembly entry and the Tauri plugin's entry: 64- and 128-bit integers travel as decimal
// strings and become `bigint`.

import type { NodeStatus, Page, PageOptions, TxFilter, TxRecord, ValidatorInfo } from "../client.js";
import { BadResponse, InvalidArgument } from "../errors.js";
import { InvalidSnapshot } from "../vote-errors.js";
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

/**
 * A record's production counts, which travel as JSON numbers: a count a JavaScript number cannot
 * hold exactly would reach the library changed when the snapshot goes back to it, so it is
 * refused with `InvalidSnapshot` (reason `inconsistent`, field `production`).
 */
function checkProduction(record: Wire): void {
  const production = record["production"] as Wire | null | undefined;
  if (production === null || production === undefined) {
    return;
  }
  for (const count of [production["forged"], production["assigned"]]) {
    if (typeof count === "number" && !Number.isSafeInteger(count)) {
      throw new InvalidSnapshot("a production count is larger than 2^53 - 1", {
        reason: "inconsistent",
        name: record["name"],
        field: "production",
      });
    }
  }
}

export function snapshotFromWire(wire: Wire): VoteSnapshot {
  return {
    ...(wire as unknown as VoteSnapshot),
    height: big(wire["height"], "height"),
    records: records(wire["records"], "records").map((record) => {
      checkProduction(record);
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

/** The page size of the listings `VoteSnapshot.fromNode` reads: the node API's largest. */
const PAGE_LIMIT = 100;

/** The most validators `VoteSnapshot.fromNode` reads; a network has 53 seats. */
const MAX_VALIDATORS = 2_000;

/** The most validator registrations `VoteSnapshot.fromNode` reads. */
const MAX_REGISTRATIONS = 10_000;

/**
 * Every item of a listing, read page by page with `PAGE_LIMIT` items per page, keeping the first
 * item of each key: an item that moved to the next page between two reads is kept once. The
 * listing ends at the last page, or at a page that adds nothing new. A page with more items than
 * asked for, or a listing of more than `max` items, is refused with `BadResponse` (reason
 * `page-too-long` or `too-many`), so a relay cannot keep the reading going.
 */
export async function allPages<T>(
  read: (page: number) => Promise<Page<T>>,
  key: (item: T) => string,
  what: string,
  max: number,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page += 1) {
    const listing = await read(page);
    if (listing.items.length > PAGE_LIMIT) {
      throw new BadResponse(`a page of ${what} has more than ${PAGE_LIMIT} items`, { reason: "page-too-long", page });
    }
    let added = 0;
    for (const item of listing.items) {
      const id = key(item);
      if (!seen.has(id)) {
        seen.add(id);
        items.push(item);
        added += 1;
      }
    }
    if (items.length > max) {
      throw new BadResponse(`the node lists more than ${max} ${what}`, { reason: "too-many", limit: max });
    }
    if (!listing.hasNext || added === 0) {
      return items;
    }
  }
}

/**
 * Whether `name` can be a validator's name on any network the SDK knows (the devnet's rule, which
 * IceRoot's lowercase letters also follow). Only such names are looked up and passed on, so a name
 * such as `__proto__` from a relay never becomes a key.
 */
function lookupName(name: string): boolean {
  return /^[a-z0-9!@$&_.]{1,20}$/.test(name) && !name.startsWith("_") && !/^[0-9]+$/.test(name);
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
  const validators = await allPages(
    (page) => net.validators.list({ page, limit: PAGE_LIMIT }),
    (validator) => validator.name,
    "validators",
    MAX_VALIDATORS,
  );
  // Keyed by names a relay chose: a Map, so no name reaches an object's prototype.
  const lookups = new Map<string, { registeredHeight?: string; firstForgedHeight?: string }>();
  const entry = (name: string) => {
    let found = lookups.get(name);
    if (found === undefined) {
      found = {};
      lookups.set(name, found);
    }
    return found;
  };
  if (options.registrations ?? true) {
    const registrations = await allPages(
      (page) => net.transactions.list({ kind: "register-validator", oldestFirst: true, page, limit: PAGE_LIMIT }),
      (record) => record.id,
      "validator registrations",
      MAX_REGISTRATIONS,
    );
    for (const record of registrations) {
      const details = record.details;
      if (record.block !== undefined && details.kind === "register-validator" && lookupName(details.name)) {
        entry(details.name).registeredHeight ??= String(record.block.height);
      }
    }
  }
  if (options.firstForged ?? true) {
    for (const validator of validators) {
      const produced = validator.production.produced;
      // A validator the snapshot leaves out (see VoteSnapshot.fromNode) needs no lookup.
      const leftOut = !validator.status.startsWith("resigned") && validator.version === undefined;
      if (produced === 0n || produced > 0xffffffffn || leftOut || !lookupName(validator.name)) {
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
  return { height, validators: toWire(validators), lookups: toWire(Object.fromEntries(lookups)) };
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
