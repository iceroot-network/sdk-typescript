/**
 * A network's loaded configuration, held by the plugin: the chain a profile is bound to.
 *
 * @module
 */

import type { TokenInfo } from "../amount.js";
import type { Economics, Rules } from "../chain.js";
import { InvalidArgument } from "../errors.js";
import { checkHeight, economicsFromJson, rulesFromJson, tokenFromJson } from "../internal/chain-json.js";
import type { Capabilities, NetworkProfile, ProfileSource } from "../profiles.js";
import type { FormatStage } from "../types.js";
import { dropWith, invoke } from "./invoke.js";
import { capabilitiesFrom, profileFromJson, profileJson } from "./profiles.js";

export type { Economics, OperationKind, Rules } from "../chain.js";

/**
 * A chain the plugin holds, as it describes it.
 *
 * @internal
 */
export interface ChainInfo {
  readonly chain: number;
  readonly profile: string;
  readonly nethash: string;
  readonly networkByte: number;
  readonly token: string;
  readonly capabilities: readonly string[];
}

const handles = new WeakMap<Chain, number>();

/** A network's loaded configuration, bound to a profile. */
export class Chain {
  /** The profile, with the network hash pinned. Keep it for the next contact. */
  readonly profile: NetworkProfile;
  /** The network hash (64 lowercase hex digits). */
  readonly nethash: string;
  /** The address network byte. */
  readonly networkByte: number;
  /** The network's own asset. */
  readonly token: TokenInfo;
  /** The capabilities of the chain's profile. */
  readonly capabilities: Capabilities;

  private constructor(info: ChainInfo, owned: boolean) {
    // First, so that the plugin's chain is freed even when the description below is refused.
    if (owned) {
      dropWith(this, "chain_free", { chain: info.chain });
    }
    handles.set(this, info.chain);
    this.profile = profileFromJson(info.profile);
    this.nethash = info.nethash;
    this.networkByte = info.networkByte;
    this.token = tokenFromJson(info.token);
    this.capabilities = capabilitiesFrom(info.capabilities);
  }

  /**
   * The chain of the crypto configuration a node reports, for the profile of `source`:
   * `/node/configuration/crypto`'s `data` object, as JSON text or as the parsed object.
   */
  static async load(source: ProfileSource, configuration: string | object): Promise<Chain> {
    const text = typeof configuration === "string" ? configuration : JSON.stringify(configuration);
    return new Chain(await invoke<ChainInfo>("chain_load", { profile: profileJson(source), configuration: text }), true);
  }

  /**
   * A chain the plugin described. `owned`: the chain is freed when this object is collected (a
   * connection's chain is freed with the connection instead).
   *
   * @internal
   */
  static fromInfo(info: ChainInfo, owned: boolean): Chain {
    return new Chain(info, owned);
  }

  /** The format stage of blocks at `height`. */
  async stageAt(height: number): Promise<FormatStage> {
    return invoke<FormatStage>("chain_stage_at", { chain: chainOf(this), height: checkHeight(height) });
  }

  /** The rules in force at `height`: pass the next block's height. */
  async rules(height: number): Promise<Rules> {
    return rulesFromJson(await invoke<string>("chain_rules", { chain: chainOf(this), height: checkHeight(height) }));
  }

  /** The economics in force at `height`. */
  async economics(height: number): Promise<Economics> {
    return economicsFromJson(await invoke<string>("chain_economics", { chain: chainOf(this), height: checkHeight(height) }));
  }
}

/** The networks `connect` returned: the plugin's number of each one's connection, and its chain. */
const connections = new WeakMap<object, { readonly session: number; readonly chain: Chain }>();

/**
 * Records `network`, which `connect` returned, with its connection's number and chain.
 *
 * @internal
 */
export function noteConnection(network: object, session: number, chain: Chain): void {
  connections.set(network, { session, chain });
}

/**
 * The connection and chain of `source` when it is a network `connect` returned, which the plugin
 * reads a draft on; `undefined` for anything else, such as a profile or a chain.
 *
 * @internal
 */
export function connectionOf(source: unknown): { readonly session: number; readonly chain: Chain } | undefined {
  return typeof source === "object" && source !== null ? connections.get(source) : undefined;
}

/**
 * The plugin's number of `chain`.
 *
 * @internal
 */
export function chainOf(chain: Chain): number {
  const handle = chain instanceof Chain ? handles.get(chain) : undefined;
  if (handle === undefined) {
    throw new InvalidArgument("not a chain made by Chain.load");
  }
  return handle;
}
