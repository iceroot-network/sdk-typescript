/**
 * Network profiles. A profile is the same plain, frozen object as with the WebAssembly entry:
 * `profiles.devnet` builds one without a call, and the plugin reads it on every call that needs it.
 *
 * @module
 */

import type { Capabilities, NetworkProfile, ProfileSource } from "../profiles.js";
import { profileOf } from "../profiles.js";
import type { Capability } from "../types.js";
import { invoke } from "./invoke.js";

export { DEVNET_NETWORK_BYTE, profileOf, profiles } from "../profiles.js";
export type {
  ApiEndpoints,
  Capabilities,
  ChainIdentity,
  DevnetOptions,
  NetworkProfile,
  ProfileSource,
} from "../profiles.js";

/**
 * The profile of `source` as the plugin reads it.
 *
 * @internal
 */
export function profileJson(source: ProfileSource): string {
  return JSON.stringify(profileOf(source));
}

/**
 * The capabilities of a list of names.
 *
 * @internal
 */
export function capabilitiesFrom(names: readonly string[]): Capabilities {
  const list = Object.freeze([...names] as Capability[]);
  const set: ReadonlySet<string> = new Set(list);
  return Object.freeze({
    has: (capability: Capability) => set.has(capability),
    list: () => list,
  });
}

/** The capabilities of the network of `source`. */
export async function capabilitiesOf(source: ProfileSource): Promise<Capabilities> {
  return capabilitiesFrom(await invoke<string[]>("profile_capabilities", { profile: profileJson(source) }));
}

/** A profile object from the plugin's JSON, frozen as `profiles.devnet` freezes one. */
export function profileFromJson(text: string): NetworkProfile {
  const profile = JSON.parse(text) as NetworkProfile;
  return Object.freeze({
    ...profile,
    api: Object.freeze({ ...profile.api, relays: Object.freeze([...profile.api.relays]) }),
    chain: Object.freeze({ ...profile.chain }),
  });
}
