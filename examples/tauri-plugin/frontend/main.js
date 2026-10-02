// A page on the IceRoot SDK's Tauri plugin. It imports the SDK's Tauri entry, which has the same
// interface as the WebAssembly entry: the calls that compute return promises, since they cross
// Tauri's IPC into the plugin. The phrase is shown once to be written down; afterwards the account
// is opened from the keystore by the plugin, so the phrase never enters the page again.
//
// `vendor/iceroot-sdk/tauri/` is the package's dist/tauri, copied by prepare.mjs; an application
// imports "@iceroot-network/sdk/tauri" from its bundler instead.

import { Amount, Keys, Messages, Mnemonic, balanceOf, connect, init, profiles } from "./vendor/iceroot-sdk/tauri/index.js";
import * as keystore from "./vendor/iceroot-sdk/tauri/keystore.js";

const $ = (id) => document.getElementById(id);
const show = (id, value) => {
  $(id).textContent = typeof value === "string" ? value : JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2);
};

let net;
let stored;
let account;

async function guarded(action) {
  show("error", "");
  try {
    await action();
  } catch (error) {
    show("error", `${error.code ?? "Error"}: ${error.message}`);
  }
}

$("connect").addEventListener("click", () =>
  guarded(async () => {
    net = await connect(profiles.devnet({ relays: [$("relay").value] }));
    show("network", {
      nethash: net.profile.chain.nethash,
      height: net.height,
      stage: net.stage,
      maxRecipients: net.rules.transfer.maxRecipients,
      token: net.token.symbol,
    });
  }),
);

$("create").addEventListener("click", () =>
  guarded(async () => {
    const phrase = await Mnemonic.generate();
    show("phrase", `Write these 24 words down, then encrypt them:\n${phrase}`);
    $("create").dataset.phrase = phrase;
  }),
);

$("keep").addEventListener("click", () =>
  guarded(async () => {
    const phrase = $("create").dataset.phrase;
    if (phrase === undefined) {
      throw new Error("create a phrase first");
    }
    // The desktop preset: Argon2id with 256 MiB, run natively by the plugin.
    stored = await keystore.encrypt(phrase, $("password").value, "desktop");
    delete $("create").dataset.phrase;
    show("phrase", `Encrypted: ${(await keystore.armor(stored)).slice(0, 40)}...`);
  }),
);

$("open").addEventListener("click", () =>
  guarded(async () => {
    if (stored === undefined) {
      throw new Error("encrypt a phrase first");
    }
    const profile = net?.profile ?? profiles.devnet({ relays: [$("relay").value] });
    await account?.release();
    account = await Keys.fromKeystore(stored, $("password").value, profile, { account: 0, index: 0 });
    const facts = { address: account.address, path: account.path };
    if (net !== undefined) {
      const info = await net.accounts.get(account.address);
      facts.balance = `${await Amount.format(balanceOf(info), net.token.decimals)} ${net.token.symbol}`;
    }
    show("account", facts);
  }),
);

$("sign").addEventListener("click", () =>
  guarded(async () => {
    if (account === undefined) {
      throw new Error("open an account first");
    }
    const signature = await Messages.sign(account, $("message").value);
    show("signature", { ...signature, verifies: await Messages.verify({ ...signature, message: $("message").value }) });
  }),
);

init().catch((error) => show("error", `${error.code ?? "Error"}: ${error.message}`));
