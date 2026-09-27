// The second WebAssembly instance of the Chromium end-to-end test: a worker served with
// connect-src 'none', so it can sign but never reach the network, as a Manifest V3 sandbox page.
// It loads the classic-script build and the module's embedded bytes, as such a page does.
//
// Messages: { id, request: { draft, profile, phrase, account, index } } signs the serialized draft
// with the account of the phrase and answers { signed, lines }; { id, request: { probe: url } }
// answers { fetched } after trying to fetch the URL.

/* global IceRootSdk, IceRootSdkWasmBytes */
importScripts("/dist/iife/iceroot-sdk.js", "/dist/iife/iceroot-sdk-bytes.js");
IceRootSdk.initSync(IceRootSdkWasmBytes);

self.onmessage = async ({ data: { id, request } }) => {
  try {
    if (request.probe !== undefined) {
      let fetched = true;
      try {
        await fetch(request.probe);
      } catch {
        fetched = false;
      }
      self.postMessage({ id, result: { fetched } });
      return;
    }
    const { draft, profile, phrase, account, index } = request;
    const received = IceRootSdk.Draft.deserialize(draft, profile);
    const key = IceRootSdk.Keys.fromPhrase(phrase, profile, { account, index });
    try {
      const signed = received.sign(key);
      self.postMessage({ id, result: { signed: signed.serialize(), lines: received.summary.lines } });
    } finally {
      key.release();
    }
  } catch (error) {
    self.postMessage({ id, error: `${error.code ?? error.name}: ${error.message}` });
  }
};
