// The keystore's constants and argument checks, shared by the WebAssembly entry and the Tauri
// plugin's entry.

import { InvalidArgument } from "../errors.js";
import type { DecryptOptions, KeystoreParams, Preset } from "../keystore.js";

/** The presets' parameters. Presets may rise in later releases; a keystore always opens with the parameters it was written with. */
export const PRESETS: Readonly<Record<Preset, KeystoreParams>> = Object.freeze({
  desktop: Object.freeze({ memoryKib: 262_144, iterations: 3, parallelism: 4 }),
  mobile: Object.freeze({ memoryKib: 131_072, iterations: 3, parallelism: 4 }),
  web: Object.freeze({ memoryKib: 65_536, iterations: 4, parallelism: 4 }),
});

/**
 * The range every keystore's parameters must lie in, when written and when read: the floor
 * refuses weak keystores, the ceilings stop a crafted keystore from demanding gigabytes of memory
 * or minutes of work. `maxWork` bounds memory in KiB times iterations.
 */
export const BOUNDS = Object.freeze({
  floor: Object.freeze({ memoryKib: 19_456, iterations: 2, parallelism: 1 }) as KeystoreParams,
  ceiling: Object.freeze({ memoryKib: 524_288, iterations: 16, parallelism: 16 }) as KeystoreParams,
  maxWork: 2_097_152,
});

/** The longest password, in UTF-8 bytes as given, before its Unicode NFKD normalization. */
export const MAX_PASSWORD_BYTES = 1024;

/** Whether `value` is a `Uint8Array`, also one made in another realm (a frame, a worker's copy). */
export function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || Object.prototype.toString.call(value) === "[object Uint8Array]";
}

export function paramsWire(params: Preset | KeystoreParams): string {
  if (typeof params === "string") {
    if (!Object.hasOwn(PRESETS, params)) {
      throw new InvalidArgument(`${JSON.stringify(params)} is not a preset: desktop, mobile or web`);
    }
    return JSON.stringify(PRESETS[params]);
  }
  if (typeof params !== "object" || params === null) {
    throw new InvalidArgument("parameters are a preset (desktop, mobile or web) or { memoryKib, iterations, parallelism }");
  }
  return JSON.stringify({ memoryKib: params.memoryKib, iterations: params.iterations, parallelism: params.parallelism });
}

export function memoryLimit(options: DecryptOptions): number | undefined {
  const limit = options.maxMemoryKib;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > 0xffffffff)) {
    throw new InvalidArgument("maxMemoryKib is a whole number of KiB", { maxMemoryKib: limit });
  }
  return limit;
}

