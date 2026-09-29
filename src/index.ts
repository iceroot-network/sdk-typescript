/**
 * The IceRoot SDK.
 *
 * Call `await init()` once before anything else (the Node build needs no call), then `connect` to a
 * network, or use the functions of each module offline. Every error is an `IceRootError` with a
 * stable code.
 *
 * @module
 */

export { init, initSync, isInitialized } from "./init.js";
export type { WasmModuleBytes, WasmSource } from "./init.js";

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

export * from "./errors.js";
export type * from "./types.js";
export type * from "./client.js";

export { VERSION, bindingsVersion } from "./internal/version.js";
