// Loads the published browser build and the test build (two separate module instances) with
// init() and no argument, as a Vite app in a Tauri webview does, and runs the vector checks on each.

async function check(path, name) {
  try {
    const sdk = await import(path);
    await sdk.init();
    return globalThis.IceRootVectorChecks.run(sdk, globalThis.IceRootVectors, name);
  } catch (error) {
    return { ok: false, loadError: error.code ?? String(error), cause: String(error.cause ?? "") };
  }
}

const report = {
  userAgent: navigator.userAgent,
  published: await check("./vendor/sdk/index.js", "tauri-published"),
  test: await check("./vendor/sdk-test/index.js", "tauri-test"),
};
const output = document.getElementById("report");
output.textContent = JSON.stringify(report);
output.dataset.done = "true";
