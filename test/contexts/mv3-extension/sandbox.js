// The sandbox page, where keys live while signing. Its policy keeps connect-src 'none', so it
// never reaches the network; it loads the module synchronously from the embedded bytes.

"use strict";

// Whether the policy blocks a request to the network: the browser reports a connect-src violation.
function networkRequestBlocked() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.effectiveDirective === "connect-src") {
        clearTimeout(timer);
        resolve(true);
      }
    });
    fetch("http://127.0.0.1:9/").catch(() => {});
  });
}

window.addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "run") {
    return;
  }
  const extra = { networkBlocked: await networkRequestBlocked() };
  let report;
  try {
    IceRootSdk.initSync(IceRootSdkWasmBytes);
    report = await IceRootVectorChecks.run(IceRootSdk, IceRootVectors, "mv3-sandbox");
  } catch (error) {
    report = { ok: false, loadError: error.code || String(error) };
  }
  event.source.postMessage({ type: "report", report: Object.assign(report, extra) }, "*");
});
