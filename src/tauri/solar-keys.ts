// The plugin's numbers of the Solar keys the page holds, shared by the ownership entry (which
// makes and releases the keys) and the test entry (which signs with them through a seam). No
// public entry exports this module.

import { InvalidArgument, KeyReleased } from "../errors.js";

const handles = new WeakMap<object, number>();
const made = new WeakSet<object>();

/** Records the plugin's number of a new Solar key. */
export function holdSolarKey(key: object, handle: number): void {
  made.add(key);
  handles.set(key, handle);
}

/** Forgets the number of `key`, and returns it; `undefined` when it was released already. */
export function forgetSolarKey(key: object): number | undefined {
  const handle = handles.get(key);
  handles.delete(key);
  return handle;
}

/** Whether `key` still has its number. */
export function solarKeyHeld(key: object): boolean {
  return handles.has(key);
}

/** The plugin's number of `key`: `KeyReleased` for a released key, `InvalidArgument` for anything that is not a `SolarKey`. */
export function solarKeyOf(key: unknown): number {
  const handle = typeof key === "object" && key !== null ? handles.get(key) : undefined;
  if (handle === undefined) {
    throw typeof key === "object" && key !== null && made.has(key)
      ? new KeyReleased()
      : new InvalidArgument("the key is not a SolarKey");
  }
  return handle;
}
