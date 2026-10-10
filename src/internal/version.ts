// Versions of the package and of the WebAssembly bindings.

import { call } from "./bindings.js";

declare const __ICEROOT_SDK_VERSION__: string | undefined;

/** The version of this package. */
export const VERSION: string =
  typeof __ICEROOT_SDK_VERSION__ === "string" ? __ICEROOT_SDK_VERSION__ : "0.0.0-dev";

/** The version of the WebAssembly bindings inside this package. */
export function bindingsVersion(): string {
  return call((module) => module.bindingsVersion());
}
