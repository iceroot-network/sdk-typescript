// What only the Tauri plugin's entry has: the plugin itself answers, relays are limited to the
// application's capabilities, a keystore's account opens inside the plugin, released keys are gone
// from it, drafts are read again from their bytes, and the page reaches no node.

const RELAY = "http://127.0.0.1:4003/api";
const LOW = { memoryKib: 19_456, iterations: 2, parallelism: 1 };

export default function suite(test, env) {
  const { sdk, keystore, assert } = env;
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(`plugin:iceroot|${command}`, args);

  test("init finds the plugin, which reports its version", async () => {
    await sdk.init();
    assert.equal(sdk.isInitialized(), true);
    assert.equal(await sdk.bindingsVersion(), "0.1.0");
  });

  test("a relay the application's capabilities do not allow is refused before any request", async () => {
    await assert.rejects(
      sdk.connect(sdk.profiles.devnet({ relays: ["http://192.0.2.1/api"] }), { rateLimit: false }),
      (error) => error instanceof sdk.InvalidProfile && error.details.reason === "not-allowed" && error.details.relay === "http://192.0.2.1/api",
    );
  });

  test("the page's own fetch cannot reach a node: its policy has no node origin", async () => {
    const node = await env.node();
    await assert.rejects(fetch(`${node.relay}/node/status`), TypeError);
    assert.equal((await node.requests()).length, 0);
  });

  test("the plugin opens a keystore's account without the phrase entering the page", async () => {
    // Keys.fromKeystore is one call into the plugin: the page sends the keystore and the password,
    // and receives the account's public facts only (the shared keystore suite checks the account).
    const profile = sdk.profiles.devnet({ relays: [RELAY] });
    const stored = await keystore.encrypt(await sdk.Mnemonic.generate(), "correct horse", LOW);
    const hex = Array.from(stored, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const password = Array.from(new TextEncoder().encode("correct horse"));
    const info = await invoke("key_from_keystore", {
      profile: JSON.stringify(profile),
      keystore: hex,
      password,
      account: 0,
      index: 0,
      passphrase: [],
      maxMemoryKib: null,
    });
    assert.deepEqual(Object.keys(info).sort(), ["address", "algorithm", "key", "legacy", "path", "publicKey"]);
    assert.equal(info.path, "m/44'/1'/0'/0'/0'");
    await invoke("key_release", { key: info.key });
  });

  test("a released key is gone from the plugin", async () => {
    const account = await sdk.Keys.fromLegacyPassphrase("released in the plugin", sdk.profiles.devnet({ relays: [RELAY] }));
    await sdk.Messages.sign(account, "before");
    await account.release();
    await assert.rejects(async () => sdk.Messages.sign(account, "after"), sdk.KeyReleased);
    // A key number the plugin never gave out reaches no key.
    for (const key of [0, 2 ** 40, Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(invoke("key_sign_message", { key, message: "00" }), (error) => error.code === "KeyReleased");
    }
  });

  test("the plugin signs what it reads from a draft's bytes", async () => {
    const configuration = await env.read("ts/wasm/examples/devnet-configuration.json");
    const chain = await sdk.Chain.load(sdk.profiles.devnet({ relays: [RELAY] }), configuration);
    const account = await sdk.Keys.fromLegacyPassphrase("draft bytes", chain);
    const draft = await sdk.Draft.build(
      chain,
      { operation: { kind: "burn", amount: 2_000_000n }, fee: 0n },
      { sender: account, nonce: 1n, height: 2 },
    );
    const bytes = draft.serialize();
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    // The plugin reads the bytes before it looks for a key: bytes cut short are refused as such.
    const signed = await invoke("draft_sign", { bytes: hex, profile: JSON.stringify(chain.profile), key: 0, secondKey: null }).catch((error) => error);
    assert.equal(signed.code, "KeyReleased", "a key number the page never got");
    const good = await draft.sign(account);
    assert.equal(good.verified, true);
    await assert.rejects(
      invoke("draft_sign", { bytes: hex.slice(0, -2), profile: JSON.stringify(chain.profile), key: 0, secondKey: null }),
      (error) => typeof error.code === "string" && error.code !== "KeyReleased",
    );
    await account.release();
  });
}
