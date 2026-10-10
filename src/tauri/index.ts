/**
 * The IceRoot SDK through its Tauri plugin: `@iceroot-network/sdk/tauri`.
 *
 * The same interface as `@iceroot-network/sdk`, run natively by the plugin
 * (`tauri-plugin-iceroot`) instead of by WebAssembly in the webview. Keys stay in the plugin,
 * drafts cross as serialized bytes, and the plugin makes every request to the network, so the
 * webview's content security policy needs neither `'wasm-unsafe-eval'` nor a node origin. An app
 * switches by its imports, and awaits the calls that compute: with the plugin they return
 * promises, since every call crosses Tauri's IPC. Values that need no call (profiles, a draft's
 * summary, an account's address, the rules at a connected network's next block) stay
 * synchronous. An app that awaits every call of the SDK runs on either entry.
 *
 * Register the plugin in the application (`tauri_plugin_iceroot::init()`), grant its
 * permissions and relays in a capability, and call `await init()` once to check it.
 *
 * @module
 */

export { init, isInitialized } from "./init.js";

export {
  DEVNET_NETWORK_BYTE,
  capabilitiesOf,
  profileOf,
  profiles,
  type ApiEndpoints,
  type Capabilities,
  type ChainIdentity,
  type DevnetOptions,
  type NetworkProfile,
  type ProfileSource,
} from "./profiles.js";

export {
  Account,
  Keys,
  Mnemonic,
  type AccountOptions,
  type KeystoreAccountOptions,
  type PhraseCheck,
  type PhraseProblem,
} from "./keys.js";
export { Address, type AddressCheck } from "./address.js";
export {
  Amount,
  AssetId,
  type AmountFormatOptions,
  type AssetAmount,
  type Decimals,
  type TokenInfo,
} from "./amount.js";
export { Chain, type Economics, type Rules } from "./chain.js";
export {
  Draft,
  SignedTransaction,
  type DraftFee,
  type DraftRequest,
  type DraftSummary,
  type FeeChoice,
  type FeeSource,
  type OnlineFacts,
  type Operation,
  type OperationKind,
  type OperationSummary,
  type Recipient,
  type Resignation,
  type SignOptions,
  type SignedSummary,
  type SubmitResult,
  type VoteEntry,
  type WaitUntil,
} from "./build.js";
export {
  Messages,
  messageAlgorithmOf,
  messageNetworkOf,
  type MessageSignature,
  type SignedMessage,
} from "./messages.js";
export { SignIn, type SignInExpectations, type SignInFields, type SignInRequest, type SignInSigning } from "./signin.js";
export {
  Network,
  balanceOf,
  connect,
  type BuildOptions,
  type Builders,
  type HistoryOptions,
  type NetworkEconomics,
  type TxProgress,
  type TxWaitResult,
  type WaitOptions,
  type WatchedAccount,
  type WatchEvent,
  type WatchFilter,
  type WatchOptions,
} from "./network.js";

export * from "../errors.js";
export type * from "../types.js";
export type * from "../client.js";

export { VERSION } from "../internal/version.js";
export { bindingsVersion } from "./init.js";
