// How the Tauri entry reads a refusal of Tauri itself, with the texts Tauri 2 writes: arguments
// Tauri cannot read for the command are InvalidArgument; a command the application does not allow,
// or a plugin it did not register, is SdkNotInitialized; a refusal of the plugin keeps its code.
// The page's IPC is replaced by one that refuses each call; test/contexts/tauri-plugin checks the
// same through a real Tauri webview.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as sdk from "../../dist/tauri/index.js";

/** Runs `use` with an IPC whose every call is refused with `refusal`. */
async function refusing(refusal, use) {
  const saved = globalThis.__TAURI_INTERNALS__;
  globalThis.__TAURI_INTERNALS__ = { invoke: async () => Promise.reject(refusal) };
  try {
    return await use();
  } finally {
    globalThis.__TAURI_INTERNALS__ = saved;
  }
}

const TAURI_REFUSALS = [
  // Error::InvalidArgs, when a command's arguments do not deserialize.
  ["invalid args `text` for command `address_parse`: invalid type: integer `12345`, expected a string", sdk.InvalidArgument],
  ["invalid args `key` for command `key_release`: missing field `key`", sdk.InvalidArgument],
  // The ACL, in a release build and in a debug build.
  ["Command plugin:iceroot|version not allowed by ACL", sdk.SdkNotInitialized],
  ["iceroot.version not allowed. Plugin not found", sdk.SdkNotInitialized],
  ["iceroot.version not allowed. Permissions associated with this command: iceroot:allow-version", sdk.SdkNotInitialized],
  ['iceroot.version not allowed on window "main", webview "main", URL: http://tauri.localhost/', sdk.SdkNotInitialized],
  // A plugin the application did not register, and a scope Tauri cannot read.
  ["Command plugin:iceroot|version not found", sdk.SdkNotInitialized],
  ["error deserializing scope: invalid type: string, expected a map", sdk.SdkNotInitialized],
];

test("Tauri's own refusals read as InvalidArgument or SdkNotInitialized", async () => {
  for (const [refusal, kind] of TAURI_REFUSALS) {
    await refusing(refusal, () =>
      assert.rejects(sdk.init(), (error) => {
        assert.ok(error instanceof kind, `${refusal}: ${error}`);
        assert.ok(error.message.includes(refusal), error.message);
        return true;
      }),
    );
  }
  assert.equal(sdk.isInitialized(), false);
});

test("a refusal of the plugin keeps its code and details", async () => {
  const refusal = { code: "InvalidProfile", message: "the relay is not allowed", details: { reason: "not-allowed" } };
  await refusing(refusal, () =>
    assert.rejects(sdk.init(), (error) => {
      assert.ok(error instanceof sdk.InvalidProfile, String(error));
      assert.equal(error.details.reason, "not-allowed");
      return true;
    }),
  );
});

test("outside a Tauri webview every call is SdkNotInitialized", async () => {
  const saved = globalThis.__TAURI_INTERNALS__;
  delete globalThis.__TAURI_INTERNALS__;
  try {
    await assert.rejects(sdk.init(), sdk.SdkNotInitialized);
  } finally {
    globalThis.__TAURI_INTERNALS__ = saved;
  }
});
