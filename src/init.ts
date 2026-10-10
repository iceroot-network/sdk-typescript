/**
 * Loading the WebAssembly module.
 *
 * Browsers and bundlers call `await init()` once at start-up. Contexts that cannot fetch the
 * module, such as a Manifest V3 sandbox page or service worker, pass its bytes to `initSync`
 * (the classic-script build ships them in `iceroot-sdk-bytes.js`). The Node build loads the module
 * when it is imported, so both calls return at once there. Both are idempotent.
 *
 * @module
 */

import { WasmLoadFailed } from "./errors.js";
import { isReady, setBindings } from "./internal/bindings.js";
import { loadModule, loadModuleSync, preloadedModule } from "./internal/loader.js";
import type { WasmModuleBytes, WasmSource } from "./internal/source.js";

export type { WasmModuleBytes, WasmSource } from "./internal/source.js";

let pending: Promise<void> | undefined;

const preloaded = preloadedModule();
if (preloaded !== undefined) {
  setBindings(preloaded);
}

/**
 * Loads the WebAssembly module. Without `source`, the `.wasm` file shipped next to the build is
 * fetched; `source` may instead be a URL, a `Request`, a `Response`, the module's bytes or a
 * compiled module, for hosts that serve the file elsewhere.
 *
 * Resolves at once when the module is already loaded. Rejects with `WasmLoadFailed` when the
 * module cannot be fetched or compiled (for example under a content security policy without
 * `'wasm-unsafe-eval'`), after which `init` may be called again.
 */
export function init(source?: WasmSource): Promise<void> {
  if (isReady()) {
    return Promise.resolve();
  }
  pending ??= loadModule(source).then(
    (bindings) => {
      setBindings(bindings);
    },
    (error: unknown) => {
      pending = undefined;
      throw new WasmLoadFailed(`the WebAssembly module could not be loaded: ${describe(error)}`, error);
    },
  );
  return pending;
}

/**
 * Loads the WebAssembly module synchronously from its bytes or a compiled module. For workers,
 * service workers and pages that cannot fetch the module. Returns at once when the module is
 * already loaded.
 *
 * Browsers refuse to compile large modules synchronously on a page's main thread; this module is
 * well below that limit.
 */
export function initSync(module: WasmModuleBytes): void {
  if (isReady()) {
    return;
  }
  try {
    setBindings(loadModuleSync(module));
  } catch (error) {
    throw new WasmLoadFailed(`the WebAssembly module could not be loaded: ${describe(error)}`, error);
  }
}

/** Whether the WebAssembly module is loaded. */
export function isInitialized(): boolean {
  return isReady();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
