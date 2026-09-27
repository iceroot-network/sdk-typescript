// Entry of the classic-script build: the package's root, with the vote library and the keystore
// as the namespaces `vote` and `keystore` of the one global, `IceRootSdk`, for pages and workers
// without a bundler, such as a Manifest V3 extension's pages and service worker.

export * from "./index.js";
export * as vote from "./vote.js";
export * as keystore from "./keystore.js";
