// Loads the published browser build and the test build (two separate module instances) with
// init() and no argument, as a Vite app in a Tauri webview does, and runs the vector checks on each;
// then connects through the HTTP plugin's fetch.

async function check(path, name) {
  try {
    const sdk = await import(path);
    await sdk.init();
    return globalThis.IceRootVectorChecks.run(sdk, globalThis.IceRootVectors, name);
  } catch (error) {
    return { ok: false, loadError: error.code ?? String(error), cause: String(error.cause ?? "") };
  }
}

// Connects to the relay the check runs next to the application, with the HTTP plugin's fetch as the
// transport: the requests leave from Rust. The page's own policy has no connect-src for the relay,
// so the webview's fetch must be refused.
async function transport(path) {
  const relay = "http://127.0.0.1:6003/api";
  try {
    const sdk = await import(path);
    await sdk.init();
    let webviewFetch = "refused";
    try {
      await fetch(`${relay}/node/status`);
      webviewFetch = "reached";
    } catch {
      // The content security policy refused it, as it should.
    }
    const net = await sdk.connect(sdk.profiles.devnet({ relays: [relay] }), { transport: window.__TAURI__.http.fetch });
    const validators = await net.validators.list();
    const account = await net.accounts.get("dZ1W1GsDCSyhR148oMhuHy3PkhnnSGCqVn");
    return {
      ok: true,
      webviewFetch,
      nethash: net.profile.chain.nethash,
      height: String(net.height),
      validators: validators.items.length,
      balance: String(sdk.balanceOf(account)),
    };
  } catch (error) {
    return { ok: false, error: error.code ?? String(error), cause: String(error.cause ?? "") };
  }
}

const report = {
  userAgent: navigator.userAgent,
  published: await check("./vendor/sdk/index.js", "tauri-published"),
  test: await check("./vendor/sdk-test/index.js", "tauri-test"),
  transport: await transport("./vendor/sdk/index.js"),
};
const output = document.getElementById("report");
output.textContent = JSON.stringify(report);
output.dataset.done = "true";
