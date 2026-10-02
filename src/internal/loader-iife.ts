// Loader of the classic-script build (wasm-bindgen's `no-modules` target).
//
// The build script places wasm-bindgen's classic-script glue and this bundle in one function
// scope, where the glue defines `wasm_bindgen`. Without a source, the glue fetches the `.wasm` file
// named after the script (`iceroot-sdk.js` loads `iceroot-sdk_bg.wasm`).

import type * as Glue from "#glue/web";

import type { Bindings } from "./bindings.js";
import type { WasmModuleBytes, WasmSource } from "./source.js";

type NoModulesGlue = Bindings & {
  (input?: { module_or_path: WasmSource }): Promise<unknown>;
  initSync: typeof Glue.initSync;
};

declare const wasm_bindgen: NoModulesGlue;

/** The module when loading the script already instantiated it; never in this build. */
export function preloadedModule(): Bindings | undefined {
  return undefined;
}

/** Fetches, compiles and instantiates the module. */
export async function loadModule(source?: WasmSource): Promise<Bindings> {
  await (source === undefined ? wasm_bindgen() : wasm_bindgen({ module_or_path: source }));
  return wasm_bindgen;
}

/** Compiles and instantiates the module synchronously from its bytes or a compiled module. */
export function loadModuleSync(module: WasmModuleBytes): Bindings {
  wasm_bindgen.initSync({ module });
  return wasm_bindgen;
}
