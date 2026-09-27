// Loads the browser build by URL (as a page without a bundler would), calls init() with no
// argument so the module is fetched from next to the build, and runs the vector checks.
// ?build=test loads the test build, which can also compare signature bytes.

const params = new URLSearchParams(location.search);
const build = params.get("build") === "test" ? "/build/test/dist/web/index.js" : "/dist/web/index.js";
const output = document.getElementById("report");

async function main() {
  const sdk = await import(build);
  const vectors = await (await fetch("/test/vectors/wasm-native.json")).json();
  try {
    await sdk.init();
  } catch (error) {
    return { ok: false, initError: error.code ?? String(error), cause: String(error.cause ?? "") };
  }
  return globalThis.IceRootVectorChecks.run(sdk, vectors, `chromium-${params.get("build") ?? "release"}`);
}

main().then(
  (report) => {
    output.textContent = JSON.stringify(report, null, 2);
    output.dataset.done = "true";
  },
  (error) => {
    output.textContent = JSON.stringify({ ok: false, error: String(error) });
    output.dataset.done = "true";
  },
);
