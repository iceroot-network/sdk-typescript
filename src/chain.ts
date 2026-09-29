/**
 * A network's loaded configuration: the chain a profile is bound to.
 *
 * {@link Chain.load} reads the crypto configuration a node reports (the `data` object of the relay
 * API's `/node/configuration/crypto`: the network description, the milestones and the genesis
 * block) and checks it against the profile: the network byte always, the network hash when the
 * profile has one pinned. A devnet profile without a pinned hash is pinned by the first load;
 * keep {@link Chain.profile}, and a later load of another chain is refused with `NetworkMismatch`.
 *
 * A chain answers what depends on the milestone in force: the rules and the economics at a
 * height, and the format stage. Drafts are built against a chain.
 *
 * @module
 */

import type { TokenInfo } from "./amount.js";
import { BadResponse, InvalidArgument } from "./errors.js";
import { call, type ChainHandle } from "./internal/bindings.js";
import { checkHeight, economicsFromJson, rulesFromJson, tokenFromJson } from "./internal/chain-json.js";
import {
  capabilitiesOf,
  profileFromHandle,
  profileHandleOf,
  type Capabilities,
  type NetworkProfile,
  type ProfileSource,
} from "./profiles.js";
import type { BaseUnits, FormatStage } from "./types.js";

/** An operation kind of today's formats. */
export type OperationKind =
  | "transfer"
  | "vote"
  | "burn"
  | "register-second-key"
  | "register-validator"
  | "resign-validator";

/** The rules in force at one height. */
export interface Rules {
  /** The height the rules are for. */
  readonly height: number;
  /** The format stage at that height. */
  readonly stage: FormatStage;
  /** Transfers: recipients per transfer and the smallest amount per recipient. */
  readonly transfer: {
    readonly minRecipients: number;
    readonly maxRecipients: number;
    readonly minAmount: BaseUnits;
  };
  /** Memos: the longest memo in UTF-8 bytes. */
  readonly memo: { readonly maxBytes: number };
  /** Votes. A vote with no entries withdraws the account's vote. */
  readonly vote: {
    readonly minEntries: number;
    readonly maxEntries: number;
    readonly totalBasisPoints: number;
    readonly maxBasisPointsPerEntry: number;
    readonly maxBytes: number;
  };
  /** Validator names. */
  readonly name: { readonly minLength: number; readonly maxLength: number; readonly characters: string };
  /** Burns: the smallest amount. */
  readonly burn: { readonly minAmount: BaseUnits };
  /** Fees: the milestone's dynamic fee table, and whether the exact fee floor is in force. */
  readonly fees: {
    readonly dynamic: {
      readonly enabled: boolean;
      readonly minFee: number;
      readonly addonBytes: Readonly<Partial<Record<OperationKind, number>>>;
    } | null;
    /**
     * Whether the exact fee floor is in force: the milestone has a dynamic fee table and it is
     * enabled. Only then does fee `"minimum"` (or a multiplier) resolve; otherwise a draft needs an
     * exact fee, and `"minimum"` throws `FeeUnavailable`.
     */
    readonly floorAvailable: boolean;
  };
  /** Resignations: blocks a temporary resignation lasts before it may be revoked. */
  readonly resignation: { readonly blocksBeforeRevoke: number | null };
  /** The largest transaction in bytes. */
  readonly maxTransactionBytes: number;
  /** The largest amount any amount field carries. */
  readonly maxAmount: BaseUnits;
}

/** The economics in force at one height. Display and estimates only; nothing here is signed. */
export interface Economics {
  /** The height. */
  readonly height: number;
  /** Validator seats per round. */
  readonly seats: number;
  /** Seconds per block. */
  readonly blockTimeSeconds: number;
  /** The block reward of each seated rank; `null` where the milestone gives none. */
  readonly rewardsByRank: readonly { readonly rank: number; readonly reward: BaseUnits | null }[];
  /** The reward of ranks outside the reward table, if any. */
  readonly secondaryReward: BaseUnits | null;
  /** Donations: shares of every block reward. */
  readonly donations: readonly {
    readonly address: string;
    readonly basisPoints: number;
    readonly purpose: string | null;
  }[];
  /** The share of each fee that is burned, in basis points. */
  readonly feeBurnBasisPoints: number;
  /** The smallest amount a burn may burn. */
  readonly minBurn: BaseUnits;
}

const chains = new WeakMap<Chain, ChainHandle>();

/**
 * The most validator seats a chain may have. The economics list a reward per seat, and the seat
 * count comes from milestones the pinned network hash does not cover, so a relay could otherwise
 * make every read of the economics allocate billions of entries. IceRoot has 53 seats.
 */
const MAX_SEATS = 1000n;

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

  private constructor(handle: ChainHandle) {
    const seats = handle.mostSeats();
    if (seats > MAX_SEATS) {
      const reason = `a milestone has ${seats} seats; at most ${MAX_SEATS} are accepted`;
      throw new BadResponse(reason, { reason });
    }
    chains.set(this, handle);
    this.profile = profileFromHandle(handle.profile());
    this.nethash = handle.nethash();
    this.networkByte = handle.networkByte();
    this.token = tokenFromJson(handle.token());
  }

  /**
   * The chain of the crypto configuration a node reports, for the profile of `source`:
   * `/node/configuration/crypto`'s `data` object, as JSON text or as the parsed object. A
   * configuration whose token symbol is not 1 to 10 ASCII letters and digits, whose token name is
   * not 1 to 32 ASCII letters, digits, `-` and `.` with single spaces between words, or that names
   * more than 1,000 validator seats, is refused with `BadResponse`.
   */
  static load(source: ProfileSource, configuration: string | object): Chain {
    const profile = profileHandleOf(source);
    const text = typeof configuration === "string" ? configuration : JSON.stringify(configuration);
    return new Chain(call((module) => module.ChainHandle.load(profile, text)));
  }

  /** @internal */
  static fromHandle(handle: ChainHandle): Chain {
    return new Chain(handle);
  }

  /** The capabilities of the chain's profile. */
  get capabilities(): Capabilities {
    return capabilitiesOf(this.profile);
  }

  /** The format stage of blocks at `height`. */
  stageAt(height: number): FormatStage {
    return call(() => handleOf(this).stageAt(checkHeight(height))) as FormatStage;
  }

  /** The rules in force at `height`: pass the next block's height. */
  rules(height: number): Rules {
    return rulesFromJson(call(() => handleOf(this).rules(checkHeight(height))));
  }

  /** The economics in force at `height`. */
  economics(height: number): Economics {
    return economicsFromJson(call(() => handleOf(this).economics(checkHeight(height))));
  }
}

/**
 * A network `connect` returned: the chain its relays serve, and the height of its next block.
 *
 * @internal
 */
export interface ConnectionOf {
  readonly chain: Chain;
  readonly nextHeight: () => number;
}

/** The networks `connect` returned, with the chain their relays serve and their next height. */
const connections = new WeakMap<object, ConnectionOf>();

/**
 * Records `network`, which `connect` returned, with the chain its relays serve and the height of
 * its next block as it follows the node.
 *
 * @internal
 */
export function noteConnection(network: object, chain: Chain, nextHeight: () => number): void {
  connections.set(network, { chain, nextHeight });
}

/**
 * The connection of `source` when it is a network `connect` returned: the configuration the
 * signer's own connection loaded, which a draft read on it is judged by, and the height it is
 * judged at. `undefined` for anything else, such as a profile, a chain from `Chain.load` or a
 * deserialized draft's chain.
 *
 * @internal
 */
export function connectionOf(source: unknown): ConnectionOf | undefined {
  return typeof source === "object" && source !== null ? connections.get(source) : undefined;
}

/**
 * The Rust chain of `chain`.
 *
 * @internal
 */
export function handleOf(chain: Chain): ChainHandle {
  const handle = chains.get(chain);
  if (handle === undefined) {
    throw new InvalidArgument("not a chain made by Chain.load");
  }
  return handle;
}

/**
 * `height` if it is a block height the SDK accepts.
 *
 * @internal
 */
export { checkHeight };
