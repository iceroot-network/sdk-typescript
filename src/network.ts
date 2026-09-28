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
import { InvalidArgument, UnsupportedOnNetwork } from "./errors.js";
import { call, parse, type ApiCall } from "./internal/bindings.js";
import { connectSettings, Relays, type RequestJson } from "./internal/http.js";
import { readFacts, readers, waitFor, watchedAccount, watchedText, watchPolling } from "./internal/reads.js";
import * as records from "./internal/records.js";
import type { Json } from "./internal/records.js";
import { Keys, type Account, type AccountOptions, type KeystoreAccountOptions } from "./keys.js";
import { Messages, type MessageSignature } from "./messages.js";
import { capabilitiesOf, profileHandleOf, type Capabilities, type NetworkProfile } from "./profiles.js";
import type { BaseUnits, FormatStage, Hex } from "./types.js";

export { balanceOf } from "./internal/records.js";

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
   * An account whose new transactions, sent and received, are reported once they are in a block:
   * at most 50 per poll (see {@link Network.watch}). Without it, only new blocks are reported.
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
      /** A transaction of the watched account that is new in a block, oldest first; at most 50 per poll. */
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

function defaultTransport(): Transport {
  const fetch = globalThis.fetch as Transport | undefined;
  if (typeof fetch !== "function") {
    throw new InvalidArgument("this environment has no fetch: pass a transport to connect");
  }
  return (input, init) => fetch(input, init);
}

/**
 * Connects to the network of `profile`: reads the chain its first answering relay serves, checks
 * the chain's identity against the profile (a devnet profile without a pinned network hash is
 * pinned now; keep {@link Network.profile}), and reads the node's configuration and status. Any
 * other relay of the profile is asked for its chain's identity before the first answer from it is
 * used, and a relay of another chain is never used.
 *
 * Throws `NetworkMismatch` when the node serves another chain, `UnsupportedOnNetwork` for a
 * profile the SDK cannot connect to yet, `InvalidArgument` for options it cannot use (see
 * {@link ConnectOptions}), and `NodeUnavailable`, `Timeout` or `RateLimited` when no relay
 * answers. A relay that answers with a redirect is skipped like one that cannot be reached.
 */
export async function connect(profile: NetworkProfile, options: ConnectOptions = {}): Promise<Network> {
  if (!capabilitiesOf(profile).has("connect")) {
    throw new UnsupportedOnNetwork("connect", `the SDK cannot connect to the ${profile.id} network yet`, {
      profile: profile.id,
    });
  }
  const settings = connectSettings(options);
  const relays = new Relays(
    profile.api.relays,
    options.transport ?? defaultTransport(),
    settings.headers,
    settings.rateLimit,
    settings.timeoutMs,
  );
  const profileHandle = profileHandleOf(profile);
  const chainHandle = await withCall(0, "cryptoConfiguration", {}, (prepared) =>
    relays.send(requestOf(prepared), (answer) =>
      call((module) => module.ChainHandle.fromNode(profileHandle, answer.status, answer.headers, answer.body)),
    ),
  );
  const chain = Chain.fromHandle(chainHandle);
  // Every other relay answers only once it showed the same chain's identity.
  relays.requireIdentity(relays.answered, (relay) =>
    withCall(0, "nodeConfiguration", {}, (prepared) =>
      relays.sendTo(relay, requestOf(prepared), (answer) => {
        call(() => chainHandle.checkNode(answer.status, answer.headers, answer.body));
      }),
    ),
  );
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

/**
 * Runs `use` with a prepared call, and frees the call afterwards. When `use` failed, its error is
 * the one thrown, even if freeing the call fails too (as it does after the module trapped).
 */
async function withCall<T>(
  seats: number,
  operation: string,
  args: object,
  use: (prepared: ApiCall) => Promise<T>,
): Promise<T> {
  const prepared = call((module) => module.ApiCall.prepare(seats, operation, JSON.stringify(args)));
  let result: T;
  try {
    result = await use(prepared);
  } catch (error) {
    try {
      prepared.free();
    } catch {
      // The original error says what went wrong.
    }
    throw error;
  }
  prepared.free();
  return result;
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
    /** As `Keys.fromKeystore`, on this network: the phrase never reaches JavaScript. */
    fromKeystore(keystore: Uint8Array | string, password: string | Uint8Array, options?: KeystoreAccountOptions): Account;
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
   * Builders: each reads the sender's account and the node's status, then builds a draft checked
   * against every rule of the next block. Sign the draft with `draft.sign`.
   */
  readonly build: Builders;

  readonly #relays: Relays;
  #height: bigint;
  #rules: { height: bigint; rules: Rules } | undefined;
  #economics: { height: bigint; economics: Economics } | undefined;

  /** @internal */
  constructor(chain: Chain, configuration: NodeConfiguration, relays: Relays) {
    this.chain = chain;
    this.profile = chain.profile;
    this.token = chain.token;
    this.capabilities = chain.capabilities;
    this.configuration = configuration;
    this.#relays = relays;
    this.#height = 0n;

    const namespaces = readers({
      read: (operation, args, convert) => this.#read(operation, args, convert),
      refresh: () => this.refresh(),
      nodeConfiguration: () => this.#nodeConfiguration(),
      wait: (id, options) => this.#wait(id, options),
    });
    this.node = namespaces.node;
    this.fees = namespaces.fees;
    this.accounts = namespaces.accounts;
    this.history = namespaces.history;
    this.transactions = namespaces.transactions;
    this.blocks = namespaces.blocks;
    this.validators = namespaces.validators;
    this.rounds = namespaces.rounds;
    this.names = namespaces.names;
    this.keys = {
      fromPhrase: (phrase, options) => Keys.fromPhrase(phrase, this.profile, options),
      fromLegacyPassphrase: (passphrase) => Keys.fromLegacyPassphrase(passphrase, this.profile),
      fromKeystore: (keystore, password, options) => Keys.fromKeystore(keystore, password, this.profile, options),
      watch: (address) => watchedAccount(Address.parse(String(address), this.profile).toString()),
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
    const height = this.height;
    if (this.#rules?.height !== height) {
      this.#rules = { height, rules: this.chain.rules(this.nextHeight) };
    }
    return this.#rules.rules;
  }

  /**
   * The economics in force at the next block, and the supply the node reports. Computed when read,
   * not with the rules.
   */
  get economics(): NetworkEconomics {
    const height = this.height;
    if (this.#economics?.height !== height) {
      this.#economics = { height, economics: this.chain.economics(this.nextHeight) };
    }
    return {
      ...this.#economics.economics,
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
   * stops the watch; aborting `options.signal` does the same.
   *
   * Each poll reads the node's status; when the height moved it also reads the latest block and,
   * with an address, the first page of the account's history, within the request allowance.
   * Polling has two limits:
   *
   * - One `block` event per poll, for the latest block. Blocks produced between two polls are not
   *   listed; read them with `blocks.list`.
   * - At most 50 new transactions per poll for the address: the newest 50 of its history. When
   *   more arrive between two polls, the older ones are not reported; read them with
   *   `history.forAccount`, or poll more often with `intervalMs`.
   */
  watch(filter: WatchFilter, handler: (event: WatchEvent) => void, options: WatchOptions = {}): () => void {
    const text = watchedText(filter);
    const address = text === undefined ? undefined : Address.parse(text, this.profile).toString();
    return watchPolling(address, handler, options, {
      refresh: () => this.refresh(),
      latest: () => this.blocks.latest(),
      history: (account, page) => this.history.forAccount(account, page),
      blockTime: this.configuration.blockTime,
    });
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

  async #build(operation: Operation, options: BuildOptions): Promise<Draft> {
    const facts = await readFacts(options.from, {
      read: (name, args, convert) => this.#read(name, args, convert),
      noteHeight: (height) => {
        if (height > this.#height) {
          this.#height = height;
        }
      },
      parseAddress: (text) => Address.parse(text, this.profile).toString(),
      addressOf: (publicKey) => Address.fromPublicKey(publicKey, this.profile).toString(),
      onlineFacts: (publicKey, account, status) =>
        call((module) => module.onlineFacts(chainHandleOf(this.chain), publicKey, account, status)),
    });
    return Draft.build(
      this.chain,
      {
        operation,
        ...(options.memo === undefined ? {} : { memo: options.memo }),
        ...(options.fee === undefined ? {} : { fee: options.fee }),
      },
      {
        sender: typeof options.from === "string" ? facts.publicKey : options.from,
        nonce: facts.nonce,
        height: facts.height,
        ...(facts.secondKey === undefined ? {} : { secondKey: facts.secondKey }),
      },
    );
  }

  #wait(id: Hex, options: WaitOptions): Promise<TxWaitResult> {
    return waitFor(id, options, {
      confirmed: (tx) => this.transactions.confirmed(tx),
      pending: (tx) => this.transactions.pending(tx),
      finality: this.capabilities.has("finality"),
      profileId: this.profile.id,
      blockTime: this.configuration.blockTime,
    });
  }
}
