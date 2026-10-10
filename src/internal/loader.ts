// Loader of the browser and bundler build (wasm-bindgen's `web` target).
//
// The Node build and the classic-script build replace this file with loader-node.ts and
// loader-iife.ts at bundle time; all three export the same names.

import initGlue, { initSync as initGlueSync } from "#glue/web";
import * as glue from "#glue/web";

import type { Bindings } from "./bindings.js";
import type { WasmModuleBytes, WasmSource } from "./source.js";

/** The module when importing the build already instantiated it; never in this build. */
export function preloadedModule(): Bindings | undefined {
  return undefined;
}

/**
 * Fetches, compiles and instantiates the module. Without `source`, the `.wasm` file next to the
 * build's JavaScript is fetched.
 */
export async function loadModule(source?: WasmSource): Promise<Bindings> {
  await (source === undefined ? initGlue() : initGlue({ module_or_path: source }));
  return glue;
}

/** Compiles and instantiates the module synchronously from its bytes or a compiled module. */
export function loadModuleSync(module: WasmModuleBytes): Bindings {
  initGlueSync({ module });
  return glue;
}
