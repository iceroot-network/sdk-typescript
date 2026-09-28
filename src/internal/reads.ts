// A connected network's reads, waits, watches and draft facts, shared by the WebAssembly entry and
// the Tauri plugin's entry. Each entry supplies how one read of the node API client is made (the
// WebAssembly module's calls sent with the transport, or the plugin's own requests); everything
// else here is the same for both. Functions a context supplies may answer at once or with a
// promise.

/** An address as the reads take it: its text, or an `Address` of either entry. */
type AddressLike = string | { toString(): string };
import type {
  AccountInfo,
  BlockInfo,
  BlockRef,
  CryptoConfiguration,
  FeeStatistics,
  MissedSlot,
  NodeConfiguration,
  NodeStatus,
  Page,
  PageOptions,
  ResolvedName,
  RoundValidator,
  Supply,
  TxFilter,
  TxRecord,
  ValidatorInfo,
} from "../client.js";
import { InvalidArgument, NotFound, Timeout, UnsupportedOnNetwork } from "../errors.js";
import type {
  HistoryOptions,
  TxProgress,
  TxWaitResult,
  WaitOptions,
  WatchedAccount,
  WatchEvent,
  WatchOptions,
} from "../network.js";
import type { Hex } from "../types.js";
import { now, sleep } from "./http.js";
import * as records from "./records.js";
import type { Json } from "./records.js";

/** One read of the node API client: the operation, its arguments, and the answer's conversion. */
export type Read = <W, T>(operation: string, args: object, convert: (json: W) => T) => Promise<T>;

/** A value, or a promise of it. */
export type Answer<T> = T | Promise<T>;

/**
 * Transactions of the watched account read at each poll, newest first: the most a poll can report
 * (the node API's largest page is 100; one page keeps a poll to a few requests).
 */
const WATCH_HISTORY_LIMIT = 50;

/**
 * A block time in milliseconds for the default intervals and limits of waiting and watching:
 * the node's block time, kept within 1 to 600 seconds whatever the context reports.
 */
function blockMsOf(blockTime: number): number {
  const seconds = Number.isFinite(blockTime) ? Math.min(Math.max(blockTime, 1), 600) : 600;
  return seconds * 1000;
}

/** `value` milliseconds if it is positive, else `fallback` when absent. */
export function positive(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidArgument(`${name} is a positive number of milliseconds`, { [name]: value });
  }
  return value;
}

/** The page argument of a read. */
export function pageArg(options: PageOptions | undefined): object {
  if (options === undefined || (options.page === undefined && options.limit === undefined)) {
    return {};
  }
  return { page: { page: options.page ?? 1, limit: options.limit ?? 100 } };
}

/** The block argument of a read. */
export function blockArg(block: BlockRef): object {
  if (typeof block === "string") {
    return { block: { id: block } };
  }
  if (typeof block === "number" && !Number.isSafeInteger(block)) {
    throw new InvalidArgument("a block height is a whole number", { block });
  }
  return { block: { height: String(block) } };
}

/** The filter argument of a listing, without its absent fields. */
export function filterArg(filter: TxFilter): object {
  return Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined));
}

/** What the reads of a connected network need from its entry. */
export interface ReadContext {
  /** One read of the node API client. */
  readonly read: Read;
  /** Reads the node's status, and follows its height. */
  refresh(): Promise<NodeStatus>;
  /** Reads the node's configuration again, refusing a node that now serves another chain. */
  nodeConfiguration(): Promise<NodeConfiguration>;
  /** Waits for a transaction. */
  wait(id: Hex, options: WaitOptions): Promise<TxWaitResult>;
}

/** The read namespaces of a connected network, the same in every entry. */
export function readers(context: ReadContext) {
  const read = context.read;
  const lookup = <W, T>(operation: string, args: object, convert: (json: W) => T): Promise<T | null> =>
    read(operation, args, records.orNull(convert));
  const address = (value: AddressLike) => ({ address: String(value) });
  return {
    node: {
      status: (): Promise<NodeStatus> => context.refresh(),
      configuration: (): Promise<NodeConfiguration> => context.nodeConfiguration(),
      cryptoConfiguration: (): Promise<CryptoConfiguration> =>
        read("cryptoConfiguration", {}, records.cryptoConfiguration),
    },
    fees: {
      statistics: (options: { readonly days?: number } = {}): Promise<FeeStatistics> =>
        read("feeStatistics", options.days === undefined ? {} : { days: options.days }, records.feeStatistics),
    },
    accounts: {
      get: (value: AddressLike): Promise<AccountInfo> => read("account", address(value), records.account),
    },
    history: {
      forAccount: (value: AddressLike, options: HistoryOptions = {}): Promise<Page<TxRecord>> =>
        read(
          "history",
          { ...address(value), direction: options.direction ?? "all", ...pageArg(options) },
          (json: Json<Page<TxRecord>>) => records.page(json, records.transaction),
        ),
      votes: (value: AddressLike, options?: PageOptions): Promise<Page<TxRecord>> =>
        read("accountVotes", { ...address(value), ...pageArg(options) }, (json: Json<Page<TxRecord>>) =>
          records.page(json, records.transaction),
        ),
    },
    transactions: {
      get: async (id: Hex): Promise<TxRecord | null> =>
        (await lookup("transaction", { id }, records.transaction)) ??
        (await lookup("unconfirmedTransaction", { id }, records.transaction)),
      confirmed: (id: Hex): Promise<TxRecord | null> => lookup("transaction", { id }, records.transaction),
      pending: (id: Hex): Promise<TxRecord | null> => lookup("unconfirmedTransaction", { id }, records.transaction),
      list: (filter: TxFilter & PageOptions = {}): Promise<Page<TxRecord>> => {
        const { page, limit, ...rest } = filter;
        return read(
          "transactions",
          {
            filter: filterArg(rest),
            ...pageArg({ ...(page === undefined ? {} : { page }), ...(limit === undefined ? {} : { limit }) }),
          },
          (json: Json<Page<TxRecord>>) => records.page(json, records.transaction),
        );
      },
      pool: (options?: PageOptions): Promise<Page<TxRecord>> =>
        read("unconfirmedTransactions", pageArg(options), (json: Json<Page<TxRecord>>) =>
          records.page(json, records.transaction),
        ),
      wait: (id: Hex, options?: WaitOptions): Promise<TxWaitResult> => context.wait(id, options ?? {}),
    },
    blocks: {
      latest: (): Promise<BlockInfo> => read("latestBlock", {}, records.block),
      genesis: (): Promise<BlockInfo> => read("genesisBlock", {}, records.block),
      get: (block: BlockRef): Promise<BlockInfo | null> => lookup("block", blockArg(block), records.block),
      list: (options?: PageOptions): Promise<Page<BlockInfo>> =>
        read("blocks", pageArg(options), (json: Json<Page<BlockInfo>>) => records.page(json, records.block)),
      transactions: (block: BlockRef, options?: PageOptions): Promise<Page<TxRecord>> =>
        read("blockTransactions", { ...blockArg(block), ...pageArg(options) }, (json: Json<Page<TxRecord>>) =>
          records.page(json, records.transaction),
        ),
      missed: (options?: PageOptions): Promise<Page<MissedSlot>> =>
        read("missedSlots", pageArg(options), (json: Json<Page<MissedSlot>>) => records.page(json, records.missedSlot)),
    },
    validators: {
      list: (options?: PageOptions): Promise<Page<ValidatorInfo>> =>
        read("validators", pageArg(options), (json: Json<Page<ValidatorInfo>>) => records.page(json, records.validator)),
      get: (id: string): Promise<ValidatorInfo | null> => lookup("validator", { id }, records.validator),
      voters: (id: string, options?: PageOptions): Promise<Page<AccountInfo>> =>
        read("voters", { id, ...pageArg(options) }, (json: Json<Page<AccountInfo>>) => records.page(json, records.account)),
      blocks: (id: string, options?: PageOptions): Promise<Page<BlockInfo>> =>
        read("validatorBlocks", { id, ...pageArg(options) }, (json: Json<Page<BlockInfo>>) =>
          records.page(json, records.block),
        ),
      missed: (id: string, options?: PageOptions): Promise<Page<MissedSlot>> =>
        read("validatorMissedSlots", { id, ...pageArg(options) }, (json: Json<Page<MissedSlot>>) =>
          records.page(json, records.missedSlot),
        ),
    },
    rounds: {
      validators: (round: number): Promise<readonly RoundValidator[]> => {
        if (!Number.isSafeInteger(round) || round < 1) {
          throw new InvalidArgument("rounds are numbered from 1", { round });
        }
        return read("roundValidators", { round }, (json: readonly Json<RoundValidator>[]) =>
          json.map(records.roundValidator),
        );
      },
    },
    names: {
      resolve: (name: string): Promise<ResolvedName | null> => lookup("resolveName", { name }, records.resolvedName),
    },
  };
}

/** What waiting for a transaction needs from its network. */
export interface WaitContext {
  /** A transaction in a block, or `null`. */
  confirmed(id: Hex): Promise<TxRecord | null>;
  /** A transaction in the node's pool, or `null`. */
  pending(id: Hex): Promise<TxRecord | null>;
  /** Whether the network has finality. */
  readonly finality: boolean;
  /** The profile id, for the refusal of `until: "final"`. */
  readonly profileId: string;
  /** Seconds per block. */
  readonly blockTime: number;
}

/**
 * Polls until the transaction is in a block with the confirmations asked for, or is dropped;
 * throws `Timeout` when the time runs out first.
 */
export async function waitFor(id: Hex, options: WaitOptions, context: WaitContext): Promise<TxWaitResult> {
  const until = options.until ?? "confirmed";
  if (until === "final" && !context.finality) {
    throw new UnsupportedOnNetwork("finality", `the ${context.profileId} network has no finality`, {
      profile: context.profileId,
    });
  }
  const wanted = options.confirmations ?? 1;
  if (!Number.isSafeInteger(wanted) || wanted < 1) {
    throw new InvalidArgument("confirmations is a whole number, at least 1", { confirmations: wanted });
  }
  const blockMs = blockMsOf(context.blockTime);
  const timeoutMs = positive(options.timeoutMs, "timeoutMs", Math.max(60_000, 10 * blockMs));
  const intervalMs = positive(options.intervalMs, "intervalMs", Math.max(1_000, blockMs / 2));
  const droppedAfterMs = positive(options.droppedAfterMs, "droppedAfterMs", Math.max(10_000, 3 * blockMs));
  const started = now();
  let missingSince: number | undefined;
  for (;;) {
    options.signal?.throwIfAborted();
    let progress: TxProgress;
    const confirmed = await context.confirmed(id);
    if (confirmed?.block !== undefined) {
      missingSince = undefined;
      const confirmations = confirmed.block.confirmations;
      if (confirmations >= BigInt(wanted)) {
        return { state: "confirmed", id, record: confirmed, confirmations };
      }
      progress = { id, state: "confirmed", confirmations, elapsedMs: now() - started };
    } else if ((await context.pending(id)) !== null) {
      missingSince = undefined;
      progress = { id, state: "pending", elapsedMs: now() - started };
    } else {
      missingSince ??= now();
      if (now() - missingSince >= droppedAfterMs) {
        return { state: "dropped", id };
      }
      progress = { id, state: "unknown", elapsedMs: now() - started };
    }
    options.onProgress?.(progress);
    const remaining = started + timeoutMs - now();
    if (remaining <= 0) {
      throw new Timeout(`transaction ${id} was not ${until} within ${timeoutMs} ms`, {
        id,
        state: progress.state,
      });
    }
    await sleep(Math.min(intervalMs, remaining), options.signal);
  }
}

/** The address text a watch filter names, if any. */
export function watchedText(filter: { readonly address?: AddressLike | WatchedAccount }): string | undefined {
  const watched = filter.address;
  if (watched === undefined) {
    return undefined;
  }
  return typeof watched === "object" && "watchOnly" in watched ? watched.address : String(watched);
}

/** What watching needs from its network. */
export interface WatchContext {
  /** Reads the node's status, and follows its height. */
  refresh(): Promise<NodeStatus>;
  /** The node's last block. */
  latest(): Promise<BlockInfo>;
  /** A page of an account's history. */
  history(address: string, options: HistoryOptions): Promise<Page<TxRecord>>;
  /** Seconds per block. */
  readonly blockTime: number;
}

/**
 * Follows the network by polling the node (see `Network.watch`). `address` is the watched
 * account's canonical address, or a promise of it: a promise that rejects is reported as an
 * `error` event and ends the watch. Returns the function that stops the watch.
 */
export function watchPolling(
  address: Answer<string | undefined>,
  handler: (event: WatchEvent) => void,
  options: WatchOptions,
  context: WatchContext,
): () => void {
  const blockMs = blockMsOf(context.blockTime);
  const intervalMs = positive(options.intervalMs, "intervalMs", Math.max(1_000, blockMs));
  const stopper = new AbortController();
  const outer = options.signal;
  // Stopping, by the returned function or by the caller's signal, also removes the listener
  // from that signal, so a long-lived signal keeps no reference to a watch that ended.
  const stop = () => {
    outer?.removeEventListener("abort", stop);
    stopper.abort();
  };
  if (outer?.aborted) {
    stop();
  } else {
    outer?.addEventListener("abort", stop, { once: true });
  }
  const signal = stopper.signal;
  let height: bigint | undefined;
  let seen: Set<Hex> | undefined;
  const poll = async (watched: string | undefined): Promise<void> => {
    const status = await context.refresh();
    if (signal.aborted || (height !== undefined && status.height <= height)) {
      return;
    }
    const first = height === undefined;
    height = status.height;
    const [block, history] = await Promise.all([
      first ? Promise.resolve(undefined) : context.latest(),
      watched === undefined
        ? Promise.resolve(undefined)
        : context.history(watched, { page: 1, limit: WATCH_HISTORY_LIMIT }),
    ]);
    if (signal.aborted) {
      return;
    }
    if (block !== undefined) {
      handler({ type: "block", block });
    }
    if (history !== undefined) {
      const confirmed = history.items.filter((record) => record.block !== undefined);
      if (seen !== undefined) {
        for (const transaction of [...confirmed].reverse()) {
          if (!seen.has(transaction.id) && !signal.aborted) {
            handler({ type: "transaction", transaction });
          }
        }
      }
      seen = new Set(confirmed.map((record) => record.id));
    }
  };
  void (async () => {
    let watched: string | undefined;
    try {
      watched = await address;
    } catch (error) {
      if (!signal.aborted) {
        handler({ type: "error", error });
      }
      stop();
      return;
    }
    while (!signal.aborted) {
      try {
        await poll(watched);
      } catch (error) {
        if (!signal.aborted) {
          handler({ type: "error", error });
        }
      }
      try {
        await sleep(intervalMs, signal);
      } catch {
        return;
      }
    }
  })();
  return stop;
}

/** What reading a draft's facts needs from its network. */
export interface FactsContext {
  /** One read of the node API client. */
  readonly read: Read;
  /** Records a height the node reported. */
  noteHeight(height: bigint): void;
  /** The canonical text of an address of the network. */
  parseAddress(text: string): Answer<string>;
  /** The address of a public key on the network. */
  addressOf(publicKey: Hex): Answer<string>;
  /** The facts of a draft by `publicKey` from the node's account (client JSON) and status. */
  onlineFacts(publicKey: Hex, account: string | undefined, status: string): Answer<string>;
}

/** The facts a draft is built with, as the node reported them. */
export interface ReadFacts {
  readonly publicKey: Hex;
  readonly nonce: bigint;
  readonly height: number;
  readonly secondKey?: Hex;
}

/** The sender's account in the client's JSON form, or undefined for an address the node does not know. */
async function accountJson(read: Read, address: string): Promise<string | undefined> {
  try {
    return await read("account", { address }, (json: unknown) => JSON.stringify(json));
  } catch (error) {
    if (error instanceof NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Reads the facts of a draft by `from` from the node: the sender's public key (its account's,
 * when `from` is an address), its next nonce and second key, and the next block's height.
 */
export async function readFacts(from: { readonly publicKey: Hex } | Hex | string, context: FactsContext): Promise<ReadFacts> {
  let publicKey: Hex;
  let account: string | undefined;
  let looked = false;
  if (typeof from !== "string") {
    publicKey = from.publicKey;
  } else if (/^0[23][0-9a-fA-F]{64}$/.test(from)) {
    publicKey = from.toLowerCase();
  } else {
    const address = await context.parseAddress(from);
    account = await accountJson(context.read, address);
    looked = true;
    const known = account === undefined ? undefined : (JSON.parse(account) as { publicKey?: Hex }).publicKey;
    if (known === undefined) {
      throw new InvalidArgument(
        "the node does not know this address's public key until the account sends a transaction: build with the account or its public key",
        { address },
      );
    }
    publicKey = known;
  }
  const address = await context.addressOf(publicKey);
  const [senderAccount, status] = await Promise.all([
    looked ? Promise.resolve(account) : accountJson(context.read, address),
    context.read("nodeStatus", {}, (json: Json<NodeStatus>) => json),
  ]);
  context.noteHeight(BigInt(status.height));
  const facts = JSON.parse(await context.onlineFacts(publicKey, senderAccount, JSON.stringify(status))) as {
    sender: Hex;
    nonce: string;
    height: number;
    secondKey: Hex | null;
  };
  return {
    publicKey,
    nonce: BigInt(facts.nonce),
    height: facts.height,
    ...(facts.secondKey === null ? {} : { secondKey: facts.secondKey }),
  };
}

/** A watch-only account for an address already in its canonical form. */
export function watchedAccount(address: string): WatchedAccount {
  return Object.freeze({ address, watchOnly: true as const });
}
