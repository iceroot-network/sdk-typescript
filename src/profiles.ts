/**
 * Network profiles: which chain the SDK talks to and how.
 *
 * A profile binds the SDK to one chain. Addresses are always parsed against a profile, keys are
 * derived with the profile's scheme, and a node that reports another chain identity is refused.
 * A profile is a plain, frozen object, so it can be stored, compared and passed to another context
 * with `postMessage`.
 *
 * @module
 */

import { InvalidProfile } from "./errors.js";
import { call, type ProfileHandle } from "./internal/bindings.js";
import type { Backend, Capability, KeyScheme } from "./types.js";

/** The relays and, from the ID stage, the indexer of a network. */
export interface ApiEndpoints {
  /** Relay URLs including the API base path, for example `http://127.0.0.1:4003/api`. */
  readonly relays: readonly string[];
  /** The indexer URL, from the ID stage on. */
  readonly indexer?: string;
}

/** The identity of a chain. Which fields apply depends on the format stage. */
export interface ChainIdentity {
  /** S1 and PQ: the address network byte (90 on devnets). */
  readonly networkByte?: number;
  /** ID: the Bech32m prefix of addresses. */
  readonly hrp?: "ice" | "tice";
  /** S1 and PQ: the network hash, pinned after first contact on devnets. */
  readonly nethash?: string;
  /** ID: the chain id, compiled in for the public networks. */
  readonly chainId?: string;
  /** ID: the genesis hash, compiled in for the public networks. */
  readonly genesisHash?: string;
}

/** A network profile. Built-in profiles come from {@link profiles}. */
export interface NetworkProfile {
  /** `"devnet"`, `"testnet"`, `"mainnet"` or a custom id. */
  readonly id: string;
  /** The backend that speaks to this network. */
  readonly backend: Backend;
  /** Where to reach the network. */
  readonly api: ApiEndpoints;
  /** The chain's identity. */
  readonly chain: ChainIdentity;
  /** How keys are derived from recovery phrases. */
  readonly keyScheme: KeyScheme;
  /** The SLIP-44 coin type of the derivation path: 1 on devnets and the public testnet. */
  readonly coinType?: number;
}

/** A profile, or an object that carries one (such as a loaded chain or a connected network). */
export type ProfileSource = NetworkProfile | { readonly profile: NetworkProfile };

/** Options of {@link profiles.devnet}. */
export interface DevnetOptions {
  /** Relay URLs including the API base path, for example `http://127.0.0.1:4003/api`. */
  readonly relays: readonly string[];
  /** A network hash to pin now instead of on first contact. */
  readonly nethash?: string;
  /** The address network byte; 90 unless the devnet was generated with another. */
  readonly networkByte?: number;
}

/** The capabilities of a profile. */
export interface Capabilities {
  /** Whether the network offers `capability`. */
  has(capability: Capability): boolean;
  /** Every capability the network offers. */
  list(): readonly Capability[];
}

/** The address network byte of the S1 devnets. */
export const DEVNET_NETWORK_BYTE = 90;

function checkRelays(relays: readonly string[]): string[] {
  if (relays.length === 0) {
    throw new InvalidProfile("a profile needs at least one relay URL");
  }
  return relays.map((relay) => {
    let url: URL;
    try {
      url = new URL(relay);
    } catch {
      throw new InvalidProfile(`the relay URL ${JSON.stringify(relay)} is not a URL`, { relay });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new InvalidProfile(`the relay URL ${JSON.stringify(relay)} is not http or https`, {
        relay,
      });
    }
    // Route paths are appended to the relay URL, which includes the API base path.
    return relay.replace(/\/+$/, "");
  });
}

function checkNetworkByte(networkByte: number): number {
  if (!Number.isInteger(networkByte) || networkByte < 0 || networkByte > 255) {
    throw new InvalidProfile("a network byte is an integer from 0 to 255", { networkByte });
  }
  return networkByte;
}

function checkNethash(nethash: string): string {
  if (!/^[0-9a-f]{64}$/.test(nethash)) {
    throw new InvalidProfile("a network hash is 64 lowercase hex digits", { nethash });
  }
  return nethash;
}

/** A deeply frozen copy of `profile`. */
function freeze(profile: NetworkProfile): NetworkProfile {
  return Object.freeze({
    ...profile,
    api: Object.freeze({ ...profile.api, relays: Object.freeze([...profile.api.relays]) }),
    chain: Object.freeze({ ...profile.chain }),
  });
}

/** The built-in profiles. */
export const profiles = {
  /**
   * A local or private devnet with the Solar-compatible formats and API of the reference
   * implementation. Its network hash is pinned on first contact unless given here.
   */
  devnet(options: DevnetOptions): NetworkProfile {
    const chain: ChainIdentity = {
      networkByte: checkNetworkByte(options.networkByte ?? DEVNET_NETWORK_BYTE),
      ...(options.nethash === undefined ? {} : { nethash: checkNethash(options.nethash) }),
    };
    return freeze({
      id: "devnet",
      backend: "solar-compat",
      api: { relays: checkRelays(options.relays) },
      chain,
      keyScheme: "bip32-secp256k1",
      coinType: 1,
    });
  },
} as const;

/** The profile of `source`. */
export function profileOf(source: ProfileSource): NetworkProfile {
  return "profile" in source ? source.profile : source;
}

// The Rust profile of each frozen profile object. A frozen object cannot change, so its profile is
// read once; any other object is read again on every call.
const handles = new WeakMap<NetworkProfile, ProfileHandle>();

/**
 * The Rust core's profile for `source`.
 *
 * @internal
 */
export function profileHandleOf(source: ProfileSource): ProfileHandle {
  const profile = profileOf(source);
  const cached = handles.get(profile);
  if (cached !== undefined) {
    return cached;
  }
  const handle = call((module) => module.ProfileHandle.fromJson(JSON.stringify(profile)));
  if (Object.isFrozen(profile) && Object.isFrozen(profile.chain) && Object.isFrozen(profile.api)) {
    handles.set(profile, handle);
  }
  return handle;
}

/**
 * The frozen profile object of a Rust profile, such as a chain's pinned profile.
 *
 * @internal
 */
export function profileFromHandle(handle: ProfileHandle): NetworkProfile {
  const profile = freeze(JSON.parse(handle.toJson()) as NetworkProfile);
  handles.set(profile, handle);
  return profile;
}

/** The capabilities of the network of `source`. */
export function capabilitiesOf(source: ProfileSource): Capabilities {
  const list = Object.freeze(call(() => profileHandleOf(source).capabilities()) as Capability[]);
  const set: ReadonlySet<string> = new Set(list);
  return Object.freeze({
    has: (capability: Capability) => set.has(capability),
    list: () => list,
  });
}
