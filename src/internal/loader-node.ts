// Loader of the Node build (wasm-bindgen's `experimental-nodejs-module` target).
//
// The module is read from the package and instantiated synchronously when the build is imported,
// so `init()` and `initSync()` have nothing left to do.

import * as glue from "#glue/node";

import type { Bindings } from "./bindings.js";

/** The module, which importing this build instantiated. */
export function preloadedModule(): Bindings | undefined {
  return glue;
}

/** Returns the module, which was instantiated on import; `source` is not needed. */
export function loadModule(): Promise<Bindings> {
  return Promise.resolve(glue);
}

/** Returns the module, which was instantiated on import. */
export function loadModuleSync(): Bindings {
  return glue;
}
