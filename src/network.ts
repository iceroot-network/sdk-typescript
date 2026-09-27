/**
 * Connecting to a network: {@link connect} and the connected network it returns.
 *
 * `connect` reads the chain a node serves (`/node/configuration/crypto`) and the node's own
 * configuration (`/node/configuration`), checks both against the profile, and returns a
 * {@link Network}: the chain's rules and economics at the next block, every read of the node API,
 * builders that read a draft's facts from the node, submission within the pool's limits, and
 * waiting for a transaction to be included.
 *
 * Requests are built and answers decoded by the SDK's Rust client; this module only sends them
 * through the transport (`globalThis.fetch` unless another is given; Tauri apps pass the HTTP
 * plugin's `fetch`). It keeps to the node's request allowance and retries HTTP 429 with backoff.
 * An unavailable node is an error, never an empty answer.
 *
 * @module
 */

import { Address } from "./address.js";
import { AssetId, type TokenInfo } from "./amount.js";
import {
  Draft,
  signedHandleOf,
  type FeeChoice,
  type Operation,
  type Recipient,
  type Resignation,
  type SignedTransaction,
  type VoteEntry,
  type WaitUntil,
} from "./build.js";
import { Chain, handleOf as chainHandleOf, type Economics, type Rules } from "./chain.js";
import type {
  AccountInfo,
  BlockInfo,
  BlockRef,
  ConnectOptions,
  CryptoConfiguration,
  FeeStatistics,
  HistoryDirection,
  MissedSlot,
  NodeConfiguration,
  NodeStatus,
  Page,
  PageOptions,
  ResolvedName,
  RoundValidator,
  SubmitOutcome,
  SubmitReport,
  Supply,
  Transport,
  TxFilter,
  TxRecord,
  ValidatorInfo,
} from "./client.js";
import { InvalidArgument, NotFound, Timeout, UnsupportedOnNetwork } from "./errors.js";
import { call, parse, type ApiCall } from "./internal/bindings.js";
import { DEFAULT_RATE_LIMIT, DEFAULT_TIMEOUT_MS, Relays, now, sleep, type RequestJson } from "./internal/http.js";
import * as records from "./internal/records.js";
import type { Json } from "./internal/records.js";
import { Keys, type Account, type AccountOptions } from "./keys.js";
import { Messages, type MessageSignature } from "./messages.js";
import { capabilitiesOf, profileHandleOf, type Capabilities, type NetworkProfile } from "./profiles.js";
import type { BaseUnits, FormatStage, Hex } from "./types.js";

/** The balance of `asset` (ROOT unless given) in an account the node reported; 0 when it holds none. */
export function balanceOf(account: AccountInfo, asset: AssetId = AssetId.ROOT): BaseUnits {
  return account.balances.find((balance) => balance.asset === asset)?.amount ?? 0n;
}

/** The economics in force at the next block, and the supply the node reports. */
export interface NetworkEconomics extends Economics {
  /** The supply and the burned amounts at the node's tip. */
  supply(): Promise<Supply>;
}

/** Where a transaction stood at one poll of {@link Network.transactions}`.wait`. */
export interface TxProgress {
  /** The transaction id. */
  readonly id: Hex;
  /**
   * `pending`: in the node's pool. `confirmed`: in a block, with fewer confirmations than asked
   * for. `unknown`: neither in the pool nor in a block (yet).
   */
  readonly state: "pending" | "confirmed" | "unknown";
  /** Confirmations so far, when in a block. */
  readonly confirmations?: bigint;
  /** Milliseconds since the wait began. */
  readonly elapsedMs: number;
}

/** How a wait for a transaction ended. */
export type TxWaitResult =
  | {
      /** In a block with at least the confirmations asked for (or final, where finality exists). */
      readonly state: "confirmed" | "final";
      /** The transaction id. */
      readonly id: Hex;
      /** The transaction as the node reports it. */
      readonly record: TxRecord;
      /** Confirmations when the wait ended. */
      readonly confirmations: bigint;
    }
  | {
      /**
       * Neither in the node's pool nor in a block for `droppedAfterMs`: the pool dropped it (it
       * expired, or was evicted), or it never reached the pool. It is not on chain; build again.
       */
      readonly state: "dropped";
      /** The transaction id. */
      readonly id: Hex;
    };

/** Options of {@link Network.transactions}`.wait`. */
export interface WaitOptions {
  /** `confirmed` (the default), or `final` where the network has finality. */
  readonly until?: WaitUntil;
  /** Confirmations to wait for; 1 by default (in a block). */
  readonly confirmations?: number;
  /** How long to wait in total, in milliseconds; 60,000 or ten blocks, whichever is longer. */
  readonly timeoutMs?: number;
  /** Milliseconds between polls; half a block time, and at least 1,000, by default. */
  readonly intervalMs?: number;
  /**
   * How long the transaction may be missing from both the pool and the chain before it counts as
   * dropped, in milliseconds; three block times, and at least 10,000, by default. A node removes
   * a transaction from its pool a moment before the block that holds it can be read, so this is
   * never shorter than a block.
   */
  readonly droppedAfterMs?: number;
  /** Cancels the wait: it then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
  /** Called after each poll that did not end the wait. */
  readonly onProgress?: (progress: TxProgress) => void;
}

/** Options of {@link Network.history}`.forAccount`. */
export interface HistoryOptions extends PageOptions {
  /** Everything (the default), only what the account sent, or only what it received. */
  readonly direction?: HistoryDirection;
}

/** A watch-only account: an address on the network, with no key. */
export interface WatchedAccount {
  /** The address, in its canonical form. */
  readonly address: string;
  /** Always `true`: there is no key, so nothing can be signed with it. */
  readonly watchOnly: true;
}

/** What {@link Network.watch} follows. */
export interface WatchFilter {
  /**
   * An account whose new transactions, sent and received, are reported once they are in a block.
   * Without it, only new blocks are reported.
   */
  readonly address?: Address | WatchedAccount | string;
}

/** An update of {@link Network.watch}. */
export type WatchEvent =
  | {
      /** The node's height moved: its latest block. Blocks in between are not listed; read them with `blocks.list`. */
      readonly type: "block";
      readonly block: BlockInfo;
    }
  | {
      /** A transaction of the watched account that is new in a block, oldest first. */
      readonly type: "transaction";
      readonly transaction: TxRecord;
    }
  | {
      /** A poll failed (for example `NodeUnavailable` or `RateLimited`); the watch goes on. */
      readonly type: "error";
      readonly error: unknown;
    };

/** Options of {@link Network.watch}. */
export interface WatchOptions {
  /** Milliseconds between polls; one block time by default (at least 1,000). */
  readonly intervalMs?: number;
  /** Stops the watch when aborted, as the function `watch` returns does. */
  readonly signal?: AbortSignal;
}

/** Transactions of the watched account read at each poll, newest first. */
const WATCH_HISTORY_LIMIT = 50;

/** What every builder takes. */
export interface BuildOptions {
  /**
   * The sender: its account, its public key as hex, or its address. An address works once the
   * account has sent a transaction, since the node learns the public key from it; a new account
   * builds from its `Account` or its public key.
   */
  readonly from: Account | Hex | string;
  /** A memo of at most `rules.memo.maxBytes` UTF-8 bytes. */
  readonly memo?: string;
  /** The fee; `"minimum"` by default. */
  readonly fee?: FeeChoice;
}

/** The builders of {@link Network.build}. */
export interface Builders {
  /** A transfer to 1 to 256 recipients. */
  transfer(request: BuildOptions & { readonly to: readonly Recipient[] }): Promise<Draft>;
  /** A vote of whole basis points; no entries withdraws the account's vote. */
  vote(request: BuildOptions & { readonly entries: readonly VoteEntry[] }): Promise<Draft>;
  /** A burn of the network's own asset. */
  burn(request: BuildOptions & { readonly amount: BaseUnits }): Promise<Draft>;
  /** The registration of a second key, which then co-signs everything. */
  registerSecondKey(request: BuildOptions & { readonly secondKey: Account | Hex }): Promise<Draft>;
  /** A validator registration under a name. */
  registerValidator(request: BuildOptions & { readonly name: string }): Promise<Draft>;
  /** A validator resignation, or the revoke of a temporary one. */
  resignValidator(request: BuildOptions & { readonly resignation: Resignation }): Promise<Draft>;
  /** A draft of any operation. */
  draft(operation: Operation, options: BuildOptions): Promise<Draft>;
}

function positive(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidArgument(`${name} is a positive number of milliseconds`, { [name]: value });
  }
  return value;
}

function defaultTransport(): Transport {
  const fetch = globalThis.fetch as Transport | undefined;
  if (typeof fetch !== "function") {
    throw new InvalidArgument("this environment has no fetch: pass a transport to connect");
  }
  return (input, init) => fetch(input, init);
}

function pageArg(options: PageOptions | undefined): object {
  if (options === undefined || (options.page === undefined && options.limit === undefined)) {
    return {};
  }
  return { page: { page: options.page ?? 1, limit: options.limit ?? 100 } };
}

function blockArg(block: BlockRef): object {
  if (typeof block === "string") {
    return { block: { id: block } };
  }
  if (typeof block === "number" && !Number.isSafeInteger(block)) {
    throw new InvalidArgument("a block height is a whole number", { block });
  }
  return { block: { height: String(block) } };
}

function filterArg(filter: TxFilter): object {
  return Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined));
}

/**
 * Connects to the network of `profile`: reads the chain its first answering relay serves, checks
 * the chain's identity against the profile (a devnet profile without a pinned network hash is
 * pinned now; keep {@link Network.profile}), and reads the node's configuration and status.
 *
 * Throws `NetworkMismatch` when the node serves another chain, `UnsupportedOnNetwork` for a
 * profile the SDK cannot connect to yet, and `NodeUnavailable`, `Timeout` or `RateLimited` when no
 * relay answers.
 */
export async function connect(profile: NetworkProfile, options: ConnectOptions = {}): Promise<Network> {
  if (!capabilitiesOf(profile).has("connect")) {
    throw new UnsupportedOnNetwork("connect", `the SDK cannot connect to the ${profile.id} network yet`, {
      profile: profile.id,
    });
  }
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  if (rateLimit !== false) {
    if (!Number.isInteger(rateLimit.requests) || rateLimit.requests < 1) {
      throw new InvalidArgument("rateLimit.requests is a whole number, at least 1", { requests: rateLimit.requests });
    }
    positive(rateLimit.windowMs, "windowMs", 1);
  }
  const relays = new Relays(
    profile.api.relays,
    options.transport ?? defaultTransport(),
    options.headers ?? {},
    rateLimit,
    positive(options.timeoutMs, "timeoutMs", DEFAULT_TIMEOUT_MS),
  );
  const profileHandle = profileHandleOf(profile);
  const chainHandle = await withCall(0, "cryptoConfiguration", {}, (prepared) =>
    relays.send(requestOf(prepared), (answer) =>
      call((module) => module.ChainHandle.fromNode(profileHandle, answer.status, answer.headers, answer.body)),
    ),
  );
  const chain = Chain.fromHandle(chainHandle);
  const configuration = records.nodeConfiguration(
    parse<Json<NodeConfiguration>>(
      await withCall(0, "nodeConfiguration", {}, (prepared) =>
        relays.send(requestOf(prepared), (answer) =>
          call(() => chainHandle.checkNode(answer.status, answer.headers, answer.body)),
        ),
      ),
    ),
  );
  const network = new Network(chain, configuration, relays);
  await network.refresh();
  return network;
}

/** Runs `use` with a prepared call, and frees the call afterwards. */
async function withCall<T>(
  seats: number,
  operation: string,
  args: object,
  use: (prepared: ApiCall) => Promise<T>,
): Promise<T> {
  const prepared = call((module) => module.ApiCall.prepare(seats, operation, JSON.stringify(args)));
  try {
    return await use(prepared);
  } finally {
    prepared.free();
  }
}

function requestOf(prepared: { request(): string }): RequestJson {
  return parse<RequestJson>(prepared.request());
}

/** A connected network. */
export class Network {
  /** The profile, with the chain's identity pinned. Keep it: pass it to `connect` next time. */
  readonly profile: NetworkProfile;
  /** The chain the network serves. */
  readonly chain: Chain;
  /** The network's own asset. */
  readonly token: TokenInfo;
  /** What the network offers. */
  readonly capabilities: Capabilities;
  /** The node's configuration when it was connected: pool limits, seats, block time. */
  readonly configuration: NodeConfiguration;

  /** The node's status: height, sync state and chain time. */
  readonly node: {
    /** Reads the node's status; the network's height follows it. */
    status(): Promise<NodeStatus>;
    /** Reads the node's configuration again, refusing a node that now serves another chain. */
    configuration(): Promise<NodeConfiguration>;
    /** The chain definition the node serves, as the node's JSON text. */
    cryptoConfiguration(): Promise<CryptoConfiguration>;
  };
  /** Fees the node saw recently. */
  readonly fees: {
    /** Fee figures per transaction kind, over the last `days` days (1 to 30) or the recent ones. */
    statistics(options?: { readonly days?: number }): Promise<FeeStatistics>;
  };
  /** Accounts. */
  readonly accounts: {
    /** An account's balances, nonce, vote, second key and validator name. An address the chain has never seen is an empty account. */
    get(address: Address | string): Promise<AccountInfo>;
  };
  /** Account histories, newest first. */
  readonly history: {
    /** What an account sent and received, each record with its direction. */
    forAccount(address: Address | string, options?: HistoryOptions): Promise<Page<TxRecord>>;
    /** The votes an account cast. */
    votes(address: Address | string, options?: PageOptions): Promise<Page<TxRecord>>;
  };
  /** Transactions. */
  readonly transactions: {
    /** A transaction in a block, or else in the node's pool; `null` when the node has neither. */
    get(id: Hex): Promise<TxRecord | null>;
    /** A transaction in a block, or `null`. */
    confirmed(id: Hex): Promise<TxRecord | null>;
    /** A transaction in the node's pool, or `null`. */
    pending(id: Hex): Promise<TxRecord | null>;
    /** Confirmed transactions matching `filter`, newest first unless `oldestFirst`. */
    list(filter?: TxFilter & PageOptions): Promise<Page<TxRecord>>;
    /** The node's pool, highest priority first. */
    pool(options?: PageOptions): Promise<Page<TxRecord>>;
    /**
     * Polls until the transaction is in a block with the confirmations asked for (`until:
     * "final"` needs a network with finality), or is dropped. Throws `Timeout` when the time runs
     * out first, with the last state in `details`.
     */
    wait(id: Hex, options?: WaitOptions): Promise<TxWaitResult>;
  };
  /** Blocks. */
  readonly blocks: {
    /** The node's last block. */
    latest(): Promise<BlockInfo>;
    /** The genesis block. */
    genesis(): Promise<BlockInfo>;
    /** A block by height or id, or `null`. */
    get(block: BlockRef): Promise<BlockInfo | null>;
    /** Blocks, highest first. */
    list(options?: PageOptions): Promise<Page<BlockInfo>>;
    /** A block's transactions, in block order. */
    transactions(block: BlockRef, options?: PageOptions): Promise<Page<TxRecord>>;
    /** Slots every validator missed, newest first. */
    missed(options?: PageOptions): Promise<Page<MissedSlot>>;
  };
  /** Validators. */
  readonly validators: {
    /** Registered validators in rank order. */
    list(options?: PageOptions): Promise<Page<ValidatorInfo>>;
    /** A validator by name, address or public key, or `null`. */
    get(nameOrAddress: string): Promise<ValidatorInfo | null>;
    /** The accounts voting for a validator. */
    voters(nameOrAddress: string, options?: PageOptions): Promise<Page<AccountInfo>>;
    /** The blocks a validator produced, highest first. */
    blocks(nameOrAddress: string, options?: PageOptions): Promise<Page<BlockInfo>>;
    /** The slots a validator missed, newest first. */
    missed(nameOrAddress: string, options?: PageOptions): Promise<Page<MissedSlot>>;
  };
  /** Rounds. */
  readonly rounds: {
    /** The validators seated in a round (rounds are numbered from 1). */
    validators(round: number): Promise<readonly RoundValidator[]>;
  };
  /** Names. */
  readonly names: {
    /** A name resolved to its account, or `null`. Today only validators have names. */
    resolve(name: string): Promise<ResolvedName | null>;
  };
  /** Accounts from keys, on this network. */
  readonly keys: {
    /** As `Keys.fromPhrase`, on this network. */
    fromPhrase(phrase: string | Uint8Array, options?: AccountOptions): Account;
    /** As `Keys.fromLegacyPassphrase`, on this network. */
    fromLegacyPassphrase(passphrase: string | Uint8Array): Account;
    /**
     * A watch-only account for an address of this network: no key, so it can be read and watched
     * but never sign. Throws `InvalidAddress` for text that is not an address of this network.
     */
    watch(address: Address | string): WatchedAccount;
  };
  /** Message signatures. */
  readonly messages: {
    /** As `Messages.sign`. */
    sign(account: Account, message: string | Uint8Array): MessageSignature;
  };
  /**
   * Builders: each reads the sender's account, the node's status and, when the fee is resolved
   * from them, the node's fee statistics, then builds a draft checked against every rule of the
   * next block. Sign the draft with `draft.sign`.
   */
  readonly build: Builders;

  readonly #relays: Relays;
  #height: bigint;
  #cache: { height: bigint; rules: Rules; economics: Economics } | undefined;

  /** @internal */
  constructor(chain: Chain, configuration: NodeConfiguration, relays: Relays) {
    this.chain = chain;
    this.profile = chain.profile;
    this.token = chain.token;
    this.capabilities = chain.capabilities;
    this.configuration = configuration;
    this.#relays = relays;
    this.#height = 0n;

    const read = <W, T>(operation: string, args: object, convert: (json: W) => T): Promise<T> =>
      this.#read(operation, args, convert);
    const lookup = <W, T>(operation: string, args: object, convert: (json: W) => T): Promise<T | null> =>
      this.#read(operation, args, records.orNull(convert));
    const address = (value: Address | string) => ({ address: String(value) });

    this.node = {
      status: () => this.refresh(),
      configuration: () => this.#nodeConfiguration(),
      cryptoConfiguration: () => read("cryptoConfiguration", {}, records.cryptoConfiguration),
    };
    this.fees = {
      statistics: (options = {}) =>
        read("feeStatistics", options.days === undefined ? {} : { days: options.days }, records.feeStatistics),
    };
    this.accounts = {
      get: (value) => read("account", address(value), records.account),
    };
    this.history = {
      forAccount: (value, options = {}) =>
        read(
          "history",
          { ...address(value), direction: options.direction ?? "all", ...pageArg(options) },
          (json: Json<Page<TxRecord>>) => records.page(json, records.transaction),
        ),
      votes: (value, options) =>
        read("accountVotes", { ...address(value), ...pageArg(options) }, (json: Json<Page<TxRecord>>) =>
          records.page(json, records.transaction),
        ),
    };
    this.transactions = {
      get: async (id) =>
        (await lookup("transaction", { id }, records.transaction)) ??
        (await lookup("unconfirmedTransaction", { id }, records.transaction)),
      confirmed: (id) => lookup("transaction", { id }, records.transaction),
      pending: (id) => lookup("unconfirmedTransaction", { id }, records.transaction),
      list: (filter = {}) => {
        const { page, limit, ...rest } = filter;
        return read(
          "transactions",
          { filter: filterArg(rest), ...pageArg({ ...(page === undefined ? {} : { page }), ...(limit === undefined ? {} : { limit }) }) },
          (json: Json<Page<TxRecord>>) => records.page(json, records.transaction),
        );
      },
      pool: (options) =>
        read("unconfirmedTransactions", pageArg(options), (json: Json<Page<TxRecord>>) =>
          records.page(json, records.transaction),
        ),
      wait: (id, options) => this.#wait(id, options ?? {}),
    };
    this.blocks = {
      latest: () => read("latestBlock", {}, records.block),
      genesis: () => read("genesisBlock", {}, records.block),
      get: (block) => lookup("block", blockArg(block), records.block),
      list: (options) =>
        read("blocks", pageArg(options), (json: Json<Page<BlockInfo>>) => records.page(json, records.block)),
      transactions: (block, options) =>
        read("blockTransactions", { ...blockArg(block), ...pageArg(options) }, (json: Json<Page<TxRecord>>) =>
          records.page(json, records.transaction),
        ),
      missed: (options) =>
        read("missedSlots", pageArg(options), (json: Json<Page<MissedSlot>>) =>
          records.page(json, records.missedSlot),
        ),
    };
    this.validators = {
      list: (options) =>
        read("validators", pageArg(options), (json: Json<Page<ValidatorInfo>>) =>
          records.page(json, records.validator),
        ),
      get: (id) => lookup("validator", { id }, records.validator),
      voters: (id, options) =>
        read("voters", { id, ...pageArg(options) }, (json: Json<Page<AccountInfo>>) =>
          records.page(json, records.account),
        ),
      blocks: (id, options) =>
        read("validatorBlocks", { id, ...pageArg(options) }, (json: Json<Page<BlockInfo>>) =>
          records.page(json, records.block),
        ),
      missed: (id, options) =>
        read("validatorMissedSlots", { id, ...pageArg(options) }, (json: Json<Page<MissedSlot>>) =>
          records.page(json, records.missedSlot),
        ),
    };
    this.rounds = {
      validators: (round) => {
        if (!Number.isSafeInteger(round) || round < 1) {
          throw new InvalidArgument("rounds are numbered from 1", { round });
        }
        return read("roundValidators", { round }, (json: readonly Json<RoundValidator>[]) =>
          json.map(records.roundValidator),
        );
      },
    };
    this.names = {
      resolve: (name) => lookup("resolveName", { name }, records.resolvedName),
    };
    this.keys = {
      fromPhrase: (phrase, options) => Keys.fromPhrase(phrase, this.profile, options),
      fromLegacyPassphrase: (passphrase) => Keys.fromLegacyPassphrase(passphrase, this.profile),
      watch: (address) =>
        Object.freeze({ address: Address.parse(String(address), this.profile).toString(), watchOnly: true as const }),
    };
    this.messages = {
      sign: (account, message) => Messages.sign(account, message),
    };
    const draft = (operation: Operation, options: BuildOptions) => this.#build(operation, options);
    this.build = {
      transfer: ({ to, ...options }) => draft({ kind: "transfer", to }, options),
      vote: ({ entries, ...options }) => draft({ kind: "vote", entries }, options),
      burn: ({ amount, ...options }) => draft({ kind: "burn", amount }, options),
      registerSecondKey: ({ secondKey, ...options }) =>
        draft(
          { kind: "register-second-key", publicKey: typeof secondKey === "string" ? secondKey : secondKey.publicKey },
          options,
        ),
      registerValidator: ({ name, ...options }) => draft({ kind: "register-validator", name }, options),
      resignValidator: ({ resignation, ...options }) => draft({ kind: "resign-validator", resignation }, options),
      draft,
    };
  }

  /** The height of the node's last block, as last read (by `node.status()` or any answer). */
  get height(): bigint {
    const seen = this.#relays.latestHeight;
    return seen !== undefined && seen > this.#height ? seen : this.#height;
  }

  /** The height of the next block, which the rules and economics below are for. */
  get nextHeight(): number {
    const next = this.height + 1n;
    return next > 0xffffffffn ? 0xffffffff : Number(next);
  }

  /** The format stage of the next block: `s1` on today's devnet. */
  get stage(): FormatStage {
    return this.chain.stageAt(this.nextHeight);
  }

  /** The rules in force at the next block. Follows the chain as its height is read. */
  get rules(): Rules {
    return this.#atNextHeight().rules;
  }

  /** The economics in force at the next block, and the supply the node reports. */
  get economics(): NetworkEconomics {
    return {
      ...this.#atNextHeight().economics,
      supply: () => this.#read("supply", {}, records.supply),
    };
  }

  /** Reads the node's status, and follows its height. */
  async refresh(): Promise<NodeStatus> {
    const status = await this.#read("nodeStatus", {}, records.nodeStatus);
    if (status.height > this.#height) {
      this.#height = status.height;
    }
    return status;
  }

  /**
   * Follows the network by polling the node, as the network has no pushed events yet: after each
   * block, `handler` gets the latest block and, with `filter.address`, each transaction of that
   * account that is new in a block since the watch began (sent or received, oldest first). A poll
   * that fails is reported as an `error` event and the watch goes on. Returns a function that
   * stops the watch.
   *
   * Each poll reads the node's status; when the height moved it also reads the latest block and,
   * with an address, the first page of the account's history, within the request allowance.
   */
  watch(filter: WatchFilter, handler: (event: WatchEvent) => void, options: WatchOptions = {}): () => void {
    const blockMs = this.configuration.blockTime * 1000;
    const intervalMs = positive(options.intervalMs, "intervalMs", Math.max(1_000, blockMs));
    const watched = filter.address;
    const text =
      watched === undefined ? undefined : typeof watched === "object" && "watchOnly" in watched ? watched.address : String(watched);
    const address = text === undefined ? undefined : Address.parse(text, this.profile).toString();
    const stopper = new AbortController();
    const stop = () => stopper.abort();
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) {
      stop();
    }
    const signal = stopper.signal;
    let height: bigint | undefined;
    let seen: Set<Hex> | undefined;
    const poll = async (): Promise<void> => {
      const status = await this.refresh();
      if (signal.aborted || (height !== undefined && status.height <= height)) {
        return;
      }
      const first = height === undefined;
      height = status.height;
      const [block, history] = await Promise.all([
        first ? Promise.resolve(undefined) : this.blocks.latest(),
        address === undefined
          ? Promise.resolve(undefined)
          : this.history.forAccount(address, { page: 1, limit: WATCH_HISTORY_LIMIT }),
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
      while (!signal.aborted) {
        try {
          await poll();
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

  /** Submits one signed transaction. A refusal is an outcome with its reason, not an error. */
  async submit(transaction: SignedTransaction): Promise<SubmitOutcome> {
    const report = await this.submitAll([transaction]);
    const outcome = report.outcomes[0];
    if (outcome === undefined) {
      throw new InvalidArgument("the node reported no outcome for the transaction", { id: transaction.id });
    }
    return outcome;
  }

  /**
   * Submits signed transactions in as few requests as the pool's limits allow: at most
   * `configuration.pool.maxTransactionsPerRequest` per request, and a transaction larger than
   * `maxTransactionBytes` is refused with reason `too-large` without being sent. The report holds
   * one outcome per transaction, in submission order.
   *
   * When a request fails (the node cannot be reached), the error is thrown; transactions of earlier
   * requests may have reached the pool, so look them up before submitting them again.
   */
  async submitAll(transactions: readonly SignedTransaction[]): Promise<SubmitReport> {
    const pool = this.configuration.pool;
    const plan = call(
      (module) => new module.SubmitPlanHandle(pool.maxTransactionsPerRequest, pool.maxTransactionBytes),
    );
    try {
      for (const transaction of transactions) {
        call(() => plan.add(signedHandleOf(transaction)));
      }
      const count = call(() => plan.plan());
      for (let index = 0; index < count; index += 1) {
        const request = parse<RequestJson>(call(() => plan.request(index)));
        await this.#relays.send(request, (answer) =>
          call(() => plan.decode(index, answer.status, answer.headers, answer.body)),
        );
      }
      return records.submitReport(parse<Json<SubmitReport>>(call(() => plan.finish())));
    } finally {
      plan.free();
    }
  }

  #atNextHeight(): { rules: Rules; economics: Economics } {
    const height = this.height;
    if (this.#cache === undefined || this.#cache.height !== height) {
      const next = this.nextHeight;
      this.#cache = { height, rules: this.chain.rules(next), economics: this.chain.economics(next) };
    }
    return this.#cache;
  }

  async #read<W, T>(operation: string, args: object, convert: (json: W) => T): Promise<T> {
    const text = await withCall(this.configuration.seats, operation, args, (prepared) =>
      this.#relays.send(requestOf(prepared), (answer) =>
        call(() => prepared.decode(answer.status, answer.headers, answer.body)),
      ),
    );
    return convert(parse<W>(text));
  }

  async #nodeConfiguration(): Promise<NodeConfiguration> {
    const chain = chainHandleOf(this.chain);
    const text = await withCall(0, "nodeConfiguration", {}, (prepared) =>
      this.#relays.send(requestOf(prepared), (answer) =>
        call(() => chain.checkNode(answer.status, answer.headers, answer.body)),
      ),
    );
    return records.nodeConfiguration(parse<Json<NodeConfiguration>>(text));
  }

  /** The sender's account in the client's JSON form, or undefined for an address the node does not know. */
  async #accountJson(address: string): Promise<string | undefined> {
    try {
      return await this.#read("account", { address }, (json: unknown) => JSON.stringify(json));
    } catch (error) {
      if (error instanceof NotFound) {
        return undefined;
      }
      throw error;
    }
  }

  /** The sender's public key, and its account when reading the key needed it. */
  async #sender(from: Account | Hex | string): Promise<{ publicKey: Hex; account?: string | undefined }> {
    if (typeof from !== "string") {
      return { publicKey: from.publicKey };
    }
    if (/^0[23][0-9a-fA-F]{64}$/.test(from)) {
      return { publicKey: from.toLowerCase() };
    }
    const address = Address.parse(from, this.profile).toString();
    const account = await this.#accountJson(address);
    const known = account === undefined ? undefined : (JSON.parse(account) as { publicKey?: Hex }).publicKey;
    if (known === undefined) {
      throw new InvalidArgument(
        "the node does not know this address's public key until the account sends a transaction: build with the account or its public key",
        { address },
      );
    }
    return { publicKey: known, account };
  }

  async #build(operation: Operation, options: BuildOptions): Promise<Draft> {
    const sender = await this.#sender(options.from);
    const publicKey = sender.publicKey;
    const address = Address.fromPublicKey(publicKey, this.profile).toString();
    const statisticsNeeded = typeof options.fee !== "bigint" && !this.rules.fees.floorAvailable;
    const [account, status, statistics] = await Promise.all([
      sender.account === undefined ? this.#accountJson(address) : Promise.resolve(sender.account),
      this.#read("nodeStatus", {}, (json: Json<NodeStatus>) => json),
      statisticsNeeded ? this.fees.statistics() : Promise.resolve(undefined),
    ]);
    const height = BigInt(status.height);
    if (height > this.#height) {
      this.#height = height;
    }
    const facts = parse<{ sender: Hex; nonce: string; height: number; secondKey: Hex | null }>(
      call((module) =>
        module.onlineFacts(chainHandleOf(this.chain), publicKey, account, JSON.stringify(status)),
      ),
    );
    return Draft.build(
      this.chain,
      {
        operation,
        ...(options.memo === undefined ? {} : { memo: options.memo }),
        ...(options.fee === undefined ? {} : { fee: options.fee }),
      },
      {
        sender: typeof options.from === "string" ? publicKey : options.from,
        nonce: BigInt(facts.nonce),
        height: facts.height,
        ...(facts.secondKey === null ? {} : { secondKey: facts.secondKey }),
      },
      statistics,
    );
  }

  async #wait(id: Hex, options: WaitOptions): Promise<TxWaitResult> {
    const until = options.until ?? "confirmed";
    if (until === "final" && !this.capabilities.has("finality")) {
      throw new UnsupportedOnNetwork("finality", `the ${this.profile.id} network has no finality`, {
        profile: this.profile.id,
      });
    }
    const wanted = options.confirmations ?? 1;
    if (!Number.isSafeInteger(wanted) || wanted < 1) {
      throw new InvalidArgument("confirmations is a whole number, at least 1", { confirmations: wanted });
    }
    const blockMs = this.configuration.blockTime * 1000;
    const timeoutMs = positive(options.timeoutMs, "timeoutMs", Math.max(60_000, 10 * blockMs));
    const intervalMs = positive(options.intervalMs, "intervalMs", Math.max(1_000, blockMs / 2));
    const droppedAfterMs = positive(options.droppedAfterMs, "droppedAfterMs", Math.max(10_000, 3 * blockMs));
    const started = now();
    let missingSince: number | undefined;
    for (;;) {
      options.signal?.throwIfAborted();
      let progress: TxProgress;
      const confirmed = await this.transactions.confirmed(id);
      if (confirmed?.block !== undefined) {
        missingSince = undefined;
        const confirmations = confirmed.block.confirmations;
        if (confirmations >= BigInt(wanted)) {
          return { state: "confirmed", id, record: confirmed, confirmations };
        }
        progress = { id, state: "confirmed", confirmations, elapsedMs: now() - started };
      } else if ((await this.transactions.pending(id)) !== null) {
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
}
