/**
 * Checking that the plugin is there.
 *
 * The Tauri entry loads no WebAssembly module: every call goes to the plugin. `init()` checks
 * that the page runs in a Tauri webview whose application registered the plugin and allows it,
 * and that the plugin is of this package's release, and rejects with `SdkNotInitialized`
 * otherwise. Calls work without it; call it at start-up, as with the WebAssembly entry, to fail
 * early.
 *
 * @module
 */

import { SdkNotInitialized } from "../errors.js";
import { VERSION } from "../internal/version.js";
import { invoke } from "./invoke.js";

let ready = false;
let seams = false;

/** The release a version belongs to: `0.1` for 0.1.x, `1` for 1.x.y. */
function release(version: string): string {
  const [major = "", minor = ""] = version.split(".");
  return major === "0" ? `0.${minor}` : major;
}

/**
 * Checks that the plugin answers, and that it is of this package's release (0.1.x with 0.1.x):
 * the two exchange the same arguments and answers only within a release. Resolves at once when it
 * did before.
 */
export async function init(): Promise<void> {
  if (ready) {
    return;
  }
  const version = await invoke<{ plugin: string; testSeams: boolean }>("version");
  if (typeof version?.plugin !== "string" || release(version.plugin) !== release(VERSION)) {
    throw new SdkNotInitialized(
      `the Tauri plugin iceroot is version ${String(version?.plugin)}, and this package (${VERSION}) needs the plugin of its release`,
    );
  }
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
