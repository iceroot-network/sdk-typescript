// The WebAssembly handles of Solar keys, kept apart from the ownership entry point so the test
// build can sign with a key's handle without the published entry exporting it.

import type { SolarKeyHandle } from "./bindings.js";

export type { SolarKeyHandle };

/** Each live `SolarKey`'s handle; a released key has none. */
export const solarKeyHandles = new WeakMap<object, SolarKeyHandle>();
