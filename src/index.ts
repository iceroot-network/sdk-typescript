/**
 * The IceRoot SDK.
 *
 * Call `await init()` once before anything else (the Node build needs no call), then use the
 * functions of each module. Every error is an `IceRootError` with a stable code.
 *
 * @module
 */

export { init, initSync, isInitialized } from "./init.js";
export type { WasmModuleBytes, WasmSource } from "./init.js";

export {
  DEVNET_NETWORK_BYTE,
  profileOf,
  profiles,
  type ApiEndpoints,
  type ChainIdentity,
  type DevnetOptions,
  type NetworkProfile,
  type ProfileSource,
} from "./profiles.js";

export { Account, Keys } from "./keys.js";
export { Address, type AddressCheck } from "./address.js";
export {
  Messages,
  messageNetworkOf,
  type MessageSignature,
  type SignedMessage,
} from "./messages.js";

export * from "./errors.js";
export type * from "./types.js";
export type * from "./amount.js";
export type * from "./build.js";
export type * from "./client.js";
export type * from "./signin.js";

export { VERSION, bindingsVersion } from "./internal/version.js";
