/**
 * Connecting to a network through the plugin: {@link connect} and the connected network it
 * returns.
 *
 * The plugin makes every request, in Rust, with the SDK's node API client: the same request
 * builders and answer decoders as the WebAssembly entry, sent with reqwest to the relays the
 * application's capabilities allow and nowhere else (it follows no redirect: a relay that answers
 * with one counts as unavailable). The webview reaches no node, so its content security policy
 * needs no node origin. The reads, waits, watches and draft facts are the same code as the
 * WebAssembly entry's.
 *
 * @module
 */

import type { TokenInfo } from "../amount.js";
import type { Economics, Rules } from "../chain.js";
import type {
  AccountInfo,
  BlockInfo,
  BlockRef,
  ConnectOptions,
  CryptoConfiguration,
  FeeStatistics,
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
  TxFilter,
  TxRecord,
  ValidatorInfo,
} from "../client.js";
import { InvalidArgument, UnsupportedOnNetwork } from "../errors.js";
import { economicsFromJson, rulesFromJson } from "../internal/chain-json.js";
import { connectSettings } from "../internal/http.js";
import { readFacts, readers, waitFor, watchedAccount, watchedText, watchPolling } from "../internal/reads.js";
import * as records from "../internal/records.js";
import type { Json } from "../internal/records.js";
import type {
  HistoryOptions,
  NetworkEconomics,
  TxWaitResult,
  WaitOptions,
  WatchedAccount,
  WatchEvent,
  WatchOptions,
} from "../network.js";
import type { Capabilities, NetworkProfile } from "../profiles.js";
import type { BaseUnits, FormatStage, Hex } from "../types.js";
import { Address } from "./address.js";
import {
  Draft,
  sourceOf,
  type FeeChoice,
  type Operation,
  type Recipient,
  type Resignation,
  type SignedTransaction,
  type VoteEntry,
} from "./build.js";
import { Chain, chainOf, type ChainInfo } from "./chain.js";
import { dropWith, invoke } from "./invoke.js";
import { Keys, type Account, type AccountOptions, type KeystoreAccountOptions } from "./keys.js";
import type { KeystoreData } from "../keystore.js";
import { Messages, type MessageSignature } from "./messages.js";
import { capabilitiesOf, profileJson } from "./profiles.js";

export { balanceOf } from "../internal/records.js";
export type {
  HistoryOptions,
  NetworkEconomics,
  TxProgress,
  TxWaitResult,
  WaitOptions,
  WatchedAccount,
  WatchEvent,
  WatchOptions,
} from "../network.js";

/** What {@link Network.watch} follows. */
export interface WatchFilter {
  /**
   * An account whose new transactions, sent and received, are reported once they are in a block:
   * at most 50 per poll. Without it, only new blocks are reported.
   */
  readonly address?: Address | WatchedAccount | string;
}

/** What every builder takes. */
export interface BuildOptions {
  /**
   * The sender: its account, its public key as hex, or its address. An address works once the
   * account has sent a transaction, since the node learns the public key from it.
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

/** The node's height, and the chain's rules at the next block, as the plugin reports them. */
interface AtNext {
  readonly height: string;
  readonly nextHeight: number;
  readonly stage: FormatStage;
  readonly rules: string;
  readonly economics: string;
}

/** A read's answer as the plugin reports it. */
interface ReadAnswer {
  readonly answer: string;
  readonly height: string;
  readonly at?: AtNext;
}

/** A connection as the plugin describes it. */
interface Connection {
  readonly session: number;
  readonly chain: ChainInfo;
  readonly configuration: string;
  readonly status: string;
  readonly at: AtNext;
}

/**
 * Connects to the network of `profile` through the plugin: reads the chain its first answering
 * relay serves, checks the chain's identity against the profile (a devnet profile without a pinned
 * network hash is pinned now; keep {@link Network.profile}), and reads the node's configuration
 * and status. Each relay must be allowed by the application's capabilities (the scope of the
 * plugin's `allow-net-connect`).
 *
 * `options.transport` is not used: the plugin makes every request. The headers, the request
 * allowance and the timeout are checked and apply as with the WebAssembly entry.
 *
 * Throws `NetworkMismatch` when the node serves another chain, `UnsupportedOnNetwork` for a
 * profile the SDK cannot connect to yet, `InvalidProfile` for a relay the application does not
 * allow, `InvalidArgument` for options it cannot use (see {@link ConnectOptions}), and
 * `NodeUnavailable`, `Timeout` or `RateLimited` when no relay answers. A relay that answers with
 * a redirect is skipped like one that cannot be reached.
 */
export async function connect(profile: NetworkProfile, options: ConnectOptions = {}): Promise<Network> {
  if (!(await capabilitiesOf(profile)).has("connect")) {
    throw new UnsupportedOnNetwork("connect", `the SDK cannot connect to the ${profile.id} network yet`, {
      profile: profile.id,
    });
  }
  const { headers, rateLimit, timeoutMs } = connectSettings(options);
  // The plugin reads whole milliseconds: a fraction is rounded up.
  const connection = await invoke<Connection>("net_connect", {
    profile: profileJson(profile),
    options: {
      headers: Object.entries(headers),
      rateLimit: rateLimit === false ? false : { requests: rateLimit.requests, windowMs: Math.ceil(rateLimit.windowMs) },
      timeoutMs: Math.ceil(timeoutMs),
    },
  });
  return new Network(connection);
}

/** A connected network, whose requests the plugin makes. */
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
    status(): Promise<NodeStatus>;
    configuration(): Promise<NodeConfiguration>;
    cryptoConfiguration(): Promise<CryptoConfiguration>;
  };
  /** Fees the node saw recently. */
  readonly fees: { statistics(options?: { readonly days?: number }): Promise<FeeStatistics> };
  /** Accounts. */
  readonly accounts: { get(address: Address | string): Promise<AccountInfo> };
  /** Account histories, newest first. */
  readonly history: {
    forAccount(address: Address | string, options?: HistoryOptions): Promise<Page<TxRecord>>;
    votes(address: Address | string, options?: PageOptions): Promise<Page<TxRecord>>;
  };
  /** Transactions. */
  readonly transactions: {
    get(id: Hex): Promise<TxRecord | null>;
    confirmed(id: Hex): Promise<TxRecord | null>;
    pending(id: Hex): Promise<TxRecord | null>;
    list(filter?: TxFilter & PageOptions): Promise<Page<TxRecord>>;
    pool(options?: PageOptions): Promise<Page<TxRecord>>;
    wait(id: Hex, options?: WaitOptions): Promise<TxWaitResult>;
  };
  /** Blocks. */
  readonly blocks: {
    latest(): Promise<BlockInfo>;
    genesis(): Promise<BlockInfo>;
    get(block: BlockRef): Promise<BlockInfo | null>;
    list(options?: PageOptions): Promise<Page<BlockInfo>>;
    transactions(block: BlockRef, options?: PageOptions): Promise<Page<TxRecord>>;
    missed(options?: PageOptions): Promise<Page<MissedSlot>>;
  };
  /** Validators. */
  readonly validators: {
    list(options?: PageOptions): Promise<Page<ValidatorInfo>>;
    get(nameOrAddress: string): Promise<ValidatorInfo | null>;
    voters(nameOrAddress: string, options?: PageOptions): Promise<Page<AccountInfo>>;
    blocks(nameOrAddress: string, options?: PageOptions): Promise<Page<BlockInfo>>;
    missed(nameOrAddress: string, options?: PageOptions): Promise<Page<MissedSlot>>;
  };
  /** Rounds. */
  readonly rounds: { validators(round: number): Promise<readonly RoundValidator[]> };
  /** Names. */
  readonly names: { resolve(name: string): Promise<ResolvedName | null> };
  /** Accounts from keys, on this network; the keys are held by the plugin. */
  readonly keys: {
    /** As `Keys.fromPhrase`, on this network. */
    fromPhrase(phrase: string | Uint8Array, options?: AccountOptions): Promise<Account>;
    /** As `Keys.fromLegacyPassphrase`, on this network. */
    fromLegacyPassphrase(passphrase: string | Uint8Array): Promise<Account>;
    /** As `Keys.fromKeystore`, on this network: the phrase never enters the webview. */
    fromKeystore(keystore: KeystoreData, password: string | Uint8Array, options?: KeystoreAccountOptions): Promise<Account>;
    /**
     * A watch-only account for an address of this network: no key, so it can be read and watched
     * but never sign. Rejects with `InvalidAddress` for text that is not an address of this network.
     */
    watch(address: Address | string): Promise<WatchedAccount>;
  };
  /** Message signatures. */
  readonly messages: { sign(account: Account, message: string | Uint8Array): Promise<MessageSignature> };
  /**
   * Builders: each reads the sender's account and the node's status, then builds a draft checked
   * against every rule of the next block. Sign the draft with `draft.sign`.
   */
  readonly build: Builders;

  readonly #session: number;
  #height: bigint;
  #at: AtNext;
  #cache: { height: string; rules: Rules; economics: Economics } | undefined;

  /** @internal */
  constructor(connection: Connection) {
    // First, so that the plugin closes the session even when what it describes is refused below.
    dropWith(this, "net_close", { session: connection.session });
    this.#session = connection.session;
    this.chain = Chain.fromInfo(connection.chain, true);
    this.profile = this.chain.profile;
    this.token = this.chain.token;
    this.capabilities = this.chain.capabilities;
    this.configuration = records.nodeConfiguration(JSON.parse(connection.configuration) as Json<NodeConfiguration>);
    this.#at = connection.at;
    this.#height = BigInt(connection.at.height);

    const namespaces = readers({
      read: (operation, args, convert) => this.#read(operation, args, convert),
      refresh: () => this.refresh(),
      nodeConfiguration: () => this.#nodeConfiguration(),
      wait: (id, options) => this.#wait(id, options),
      addressOf: async (publicKey) => (await Address.fromPublicKey(publicKey, this.profile)).toString(),
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
      watch: async (address) => watchedAccount((await Address.parse(String(address), this.profile)).toString()),
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
    return this.#height;
  }

  /** The height of the next block, which the rules and economics below are for. */
  get nextHeight(): number {
    const next = this.height + 1n;
    return next > 0xffffffffn ? 0xffffffff : Number(next);
  }

  /** The format stage of the next block: `s1` on today's devnet. */
  get stage(): FormatStage {
    return this.#at.stage;
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
    return this.#read("nodeStatus", {}, records.nodeStatus);
  }

  /**
   * Follows the network by polling the node, as the network has no pushed events yet (see the
   * WebAssembly entry's `Network.watch`). With the plugin, the watched address is checked by the
   * plugin once the watch starts: an address of another network is reported as an `error` event
   * and ends the watch. Returns a function that stops the watch; aborting `options.signal` does
   * the same.
   */
  watch(filter: WatchFilter, handler: (event: WatchEvent) => void, options: WatchOptions = {}): () => void {
    const text = watchedText(filter);
    const address = text === undefined ? undefined : Address.parse(text, this.profile).then((parsed) => parsed.toString());
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
   * Submits signed transactions in as few requests as the pool's limits allow (see the
   * WebAssembly entry's `Network.submitAll`); the plugin sends them.
   */
  async submitAll(transactions: readonly SignedTransaction[]): Promise<SubmitReport> {
    const sources = transactions.map(sourceOf);
    const answer = await this.#call<ReadAnswer>("net_submit", { transactions: sources });
    return records.submitReport(JSON.parse(answer.answer) as Json<SubmitReport>);
  }

  #atNextHeight(): { rules: Rules; economics: Economics } {
    const at = this.#at;
    if (this.#cache === undefined || this.#cache.height !== at.height) {
      this.#cache = { height: at.height, rules: rulesFromJson(at.rules), economics: economicsFromJson(at.economics) };
    }
    return this.#cache;
  }

  /** Calls a command of this connection, and follows the height it reports. */
  async #call<T extends ReadAnswer>(command: string, args: Record<string, unknown>): Promise<T> {
    const answer = await invoke<T>(command, { session: this.#session, knownHeight: this.#at.height, ...args });
    const height = BigInt(answer.height);
    if (answer.at !== undefined && height >= BigInt(this.#at.height)) {
      this.#at = answer.at;
    }
    if (height > this.#height) {
      this.#height = height;
    }
    return answer;
  }

  async #read<W, T>(operation: string, args: object, convert: (json: W) => T): Promise<T> {
    const answer = await this.#call<ReadAnswer>("net_read", { operation, args: JSON.stringify(args) });
    return convert(JSON.parse(answer.answer) as W);
  }

  async #nodeConfiguration(): Promise<NodeConfiguration> {
    const answer = await this.#call<ReadAnswer>("net_node_configuration", {});
    return records.nodeConfiguration(JSON.parse(answer.answer) as Json<NodeConfiguration>);
  }

  async #build(operation: Operation, options: BuildOptions): Promise<Draft> {
    const facts = await readFacts(options.from, {
      read: (name, args, convert) => this.#read(name, args, convert),
      noteHeight: (height) => {
        if (height > this.#height) {
          this.#height = height;
        }
      },
      parseAddress: async (text) => (await Address.parse(text, this.profile)).toString(),
      addressOf: async (publicKey) => (await Address.fromPublicKey(publicKey, this.profile)).toString(),
      onlineFacts: (publicKey, account, status) =>
        invoke<string>("draft_online_facts", {
          chain: chainOf(this.chain),
          sender: publicKey,
          account: account ?? null,
          status,
        }),
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
