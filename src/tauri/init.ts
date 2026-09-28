/**
 * Checking that the plugin is there.
 *
 * The Tauri entry loads no WebAssembly module: every call goes to the plugin. `init()` checks
 * that the page runs in a Tauri webview whose application registered the plugin and allows it,
 * and rejects with `SdkNotInitialized` otherwise. Calls work without it; call it at start-up, as
 * with the WebAssembly entry, to fail early.
 *
 * @module
 */

import { invoke } from "./invoke.js";

let ready = false;
let seams = false;

/** Checks that the plugin answers. Resolves at once when it did before. */
export async function init(): Promise<void> {
  if (ready) {
    return;
  }
  const version = await invoke<{ plugin: string; testSeams: boolean }>("version");
  seams = version.testSeams;
  ready = true;
}

/** Whether `init()` found the plugin. */
export function isInitialized(): boolean {
  return ready;
}

/**
 * Whether the plugin is its test build (`init()` must have run).
 *
 * @internal
 */
export function pluginHasTestSeams(): boolean {
  return seams;
}

/** The version of the plugin the application registered. */
export async function bindingsVersion(): Promise<string> {
  return (await invoke<{ plugin: string }>("version")).plugin;
}
