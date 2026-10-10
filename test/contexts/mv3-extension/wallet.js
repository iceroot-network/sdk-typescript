// The wallet page: an extension page that may fetch, so init() fetches the module from next to the
// script. It also asks the sandbox page and the service worker to run the same checks.

"use strict";

async function runWalletPage() {
  try {
    await IceRootSdk.init();
  } catch (error) {
    return { ok: false, loadError: error.code || String(error) };
  }
  return IceRootVectorChecks.run(IceRootSdk, IceRootVectors, "mv3-wallet-page");
}

function runSandbox() {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = "sandbox.html";
    frame.hidden = true;
    window.addEventListener("message", (event) => {
      if (event.source === frame.contentWindow && event.data && event.data.type === "report") {
        resolve(event.data.report);
      }
    });
    // The sandbox has an opaque origin, so messages to it cannot name a target origin.
    frame.addEventListener("load", () => frame.contentWindow.postMessage({ type: "run" }, "*"));
    document.body.append(frame);
  });
}

function runServiceWorker() {
  return chrome.runtime.sendMessage({ type: "run" });
}

async function main() {
  const [walletPage, sandbox, serviceWorker] = await Promise.all([
    runWalletPage().catch((error) => ({ ok: false, error: String(error) })),
    runSandbox(),
    runServiceWorker().catch((error) => ({ ok: false, error: String(error) })),
  ]);
  return { walletPage, sandbox, serviceWorker };
}

main().then((result) => {
  const output = document.getElementById("result");
  output.textContent = JSON.stringify(result, null, 2);
  output.dataset.done = "true";
});
