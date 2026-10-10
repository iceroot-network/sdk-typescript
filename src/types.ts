/**
 * Types shared by several modules.
 *
 * @module
 */

/** Which implementation of the network's formats and API a profile uses. */
export type Backend = "solar-compat" | "iceroot";

/** The transaction and address formats in force, chosen by the chain's milestones. */
export type FormatStage = "s1" | "pq" | "id";

/** How keys are derived from a recovery phrase. Both schemes use hardened steps only. */
export type KeyScheme = "bip32-secp256k1" | "slip10-mldsa65";

/** A signature algorithm of account keys. */
export type Algorithm = "secp256k1-bip340" | "ml-dsa-65";

/** The algorithm name of a message signature. */
export type MessageAlgorithm = "secp256k1-bip340-sha256" | "ml-dsa-65";

/**
 * An optional feature of a network. A backend declares the capabilities it has; an operation it
 * lacks throws `UnsupportedOnNetwork` with the capability's name.
 */
export type Capability =
  | "connect"
  | "phrase-accounts"
  | "transfer"
  | "burn"
  | "vote"
  | "validator-registration"
  | "validator-resignation"
  | "second-key"
  | "key-rotation"
  | "multisig"
  | "validator-names"
  | "names"
  | "share-declare"
  | "assets"
  | "swaps"
  | "htlc"
  | "time-locks"
  | "finality"
  | "history-search"
  | "live-events"
  | "transaction-id-before-signing"
  | "message-signing"
  | "migration-exit"
  | "legacy-passphrase-import";

/** Lowercase hexadecimal text. */
export type Hex = string;

/** An amount in base units of an asset. */
export type BaseUnits = bigint;
