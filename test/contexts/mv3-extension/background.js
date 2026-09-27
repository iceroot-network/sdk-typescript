// The service worker: it loads the module synchronously from the embedded bytes when it starts,
// so the module is ready in every event handler. Synchronous compilation is allowed off the main
// thread.

"use strict";

importScripts(
  "vendor/iceroot-sdk.js",
  "vendor/iceroot-sdk-bytes.js",
  "vendor/vector-checks.js",
  "vendor/vectors.js",
);

let loadError;
try {
  IceRootSdk.initSync(IceRootSdkWasmBytes);
} catch (error) {
  loadError = error.code || String(error);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "run") {
    sendResponse(
      loadError === undefined
        ? IceRootVectorChecks.run(IceRootSdk, IceRootVectors, "mv3-service-worker")
        : { ok: false, loadError },
    );
  }
});
