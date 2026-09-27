/**
 * Errors of the SDK.
 *
 * Every error the SDK throws is an {@link IceRootError} with a stable string `code`, a human
 * `message` and structured `details`. Each code has a subclass for `instanceof` checks. The codes
 * are part of the API: apps may branch on them, and they never change meaning. They are the codes
 * of the SDK's Rust crates, which the TypeScript, Rust and Go SDKs share, plus the two that only the
 * TypeScript wrapper raises (`InvalidArgument`, `WasmLoadFailed`). A code two crates give has the
 * same meaning and details in both.
 *
 * The classes of the vote library's codes are exported by `@iceroot-network/sdk/vote`, those of
 * the keystore's codes by `@iceroot-network/sdk/keystore`, and `InvalidProof` by
 * `@iceroot-network/sdk/ownership`, with the functions that raise them.
 *
 * @module
 */

/** Why an address was refused. */
export type AddressProblem = "checksum" | "length" | "wrong-network" | "format";

/** Every error code, grouped as in the documentation. */
export type ErrorCode =
  // Input
  | "InvalidPhrase"
  | "PhraseTooShort"
  | "InvalidPath"
  | "InvalidAddress"
  | "InvalidKey"
  | "InvalidAmount"
  | "MemoTooLong"
  | "NoRecipients"
  | "TooManyRecipients"
  | "InvalidVote"
  | "InvalidName"
  | "InvalidFee"
  | "InvalidDraft"
  | "InvalidTransaction"
  | "InvalidSignIn"
  | "InvalidProof"
  | "InvalidRequest"
  | "InvalidProfile"
  | "InvalidArgument"
  // Network
  | "NodeUnavailable"
  | "RateLimited"
  | "Timeout"
  | "BadResponse"
  | "NotFound"
  | "Refused"
  | "NetworkMismatch"
  // Submission
  | "TxRejected"
  | "StaleDraft"
  | "FeeUnavailable"
  // Support
  | "UnsupportedOnNetwork"
  | "SdkNotInitialized"
  | "WasmLoadFailed"
  // Crypto
  | "RandomnessUnavailable"
  | "SigningFailed"
  | "WrongKey"
  | "KeyReleased"
  // Vote selection (`@iceroot-network/sdk/vote`)
  | "InvalidPickCount"
  | "ValidatorCannotVote"
  | "InvalidSnapshot"
  | "NotEnoughValidators"
  | "DoesNotFit"
  | "BreaksRules"
  // Keystore (`@iceroot-network/sdk/keystore`)
  | "WrongPasswordOrCorrupt"
  | "Malformed"
  | "UnsupportedVersion"
  | "UnsupportedKdf"
  | "UnsupportedPayload"
  | "ParamsOutOfRange"
  | "InvalidPayload"
  | "InvalidPassword"
  | "OutOfMemory";

/** Structured details of an error. */
export type ErrorDetails = Readonly<Record<string, unknown>>;

/** The base class of every error the SDK throws. */
export class IceRootError extends Error {
  /** The stable code. */
  readonly code: ErrorCode;
  /** Structured details; each subclass documents its fields. */
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = code;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** A recovery phrase or passphrase was refused. `details.reason` says why. */
export class InvalidPhrase extends IceRootError {
  constructor(message = "the phrase was refused", details: ErrorDetails = {}) {
    super("InvalidPhrase", message, details);
  }
}

/** A recovery phrase has fewer words than keys accept (18). */
export class PhraseTooShort extends IceRootError {
  constructor(message = "a recovery phrase needs at least 18 words", details: ErrorDetails = {}) {
    super("PhraseTooShort", message, details);
  }
}

/** An account number or address index is out of range (below 2^31). */
export class InvalidPath extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidPath", message, details);
  }
}

/** An address was refused. `reason` says why; `position` points at a bad character when known. */
export class InvalidAddress extends IceRootError {
  /** Why the address was refused. */
  readonly reason: AddressProblem;
  /** The index of the first bad character, when the problem is one. */
  readonly position: number | undefined;

  constructor(reason: AddressProblem, message: string, position?: number, details: ErrorDetails = {}) {
    super("InvalidAddress", message, { ...details, reason, ...(position === undefined ? {} : { position }) });
    this.reason = reason;
    this.position = position;
  }
}

/** A public key, as bytes or hex, is not a valid key. */
export class InvalidKey extends IceRootError {
  constructor(message = "the key is not valid", details: ErrorDetails = {}) {
    super("InvalidKey", message, details);
  }
}

/** An amount was refused: negative, too large, or with more fraction digits than the asset has. */
export class InvalidAmount extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidAmount", message, details);
  }
}

/** A memo is longer than the network allows. */
export class MemoTooLong extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("MemoTooLong", message, details);
  }
}

/** A transfer has no recipient. */
export class NoRecipients extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("NoRecipients", message, details);
  }
}

/** A transfer has more recipients than the network allows. */
export class TooManyRecipients extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("TooManyRecipients", message, details);
  }
}

/**
 * A vote breaks the network's vote rules, or cannot be made (a split among more than 10,000
 * validators). `details.reason` names the rule.
 */
export class InvalidVote extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidVote", message, details);
  }
}

/** A name was refused. */
export class InvalidName extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidName", message, details);
  }
}

/** A fee choice is not valid. */
export class InvalidFee extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidFee", message, details);
  }
}

/** A serialized draft or signed transaction is malformed. */
export class InvalidDraft extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidDraft", message, details);
  }
}

/** A transaction's bytes or JSON are refused. */
export class InvalidTransaction extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidTransaction", message, details);
  }
}

/** A sign-in message fails a check. `details.reason` names the check. */
export class InvalidSignIn extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidSignIn", message, details);
  }
}

/** A request to a node could not be built from its arguments. */
export class InvalidRequest extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidRequest", message, details);
  }
}

/** A network profile is incomplete or malformed, such as a network hash that is not 64 hex digits. */
export class InvalidProfile extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidProfile", message, details);
  }
}

/** A function was called with arguments of the wrong shape, for example from JavaScript. */
export class InvalidArgument extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidArgument", message, details);
  }
}

/** No relay of the profile answered. */
export class NodeUnavailable extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}, options?: ErrorOptions) {
    super("NodeUnavailable", message, details, options);
  }
}

/** The node refused the request because of its rate limit. */
export class RateLimited extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("RateLimited", message, details);
  }
}

/** A request or a wait ran out of time. */
export class Timeout extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("Timeout", message, details);
  }
}

/** A node's response did not have the expected shape. */
export class BadResponse extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("BadResponse", message, details);
  }
}

/** The node has no such resource, where the request needs one. */
export class NotFound extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("NotFound", message, details);
  }
}

/** The node refused the request with an error status. `details.status` is the HTTP status. */
export class Refused extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("Refused", message, details);
  }
}

/** A node or data belongs to another chain than the profile's. */
export class NetworkMismatch extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("NetworkMismatch", message, details);
  }
}

/** Why a node refused a transaction. */
export type RejectionReason =
  | "low-fee"
  | "nonce"
  | "balance"
  | "duplicate"
  | "invalid"
  | "pool-full"
  | "wrong-network"
  | "too-large"
  | "other";

/** A node refused a transaction. */
export class TxRejected extends IceRootError {
  /** The normalized reason. */
  readonly reason: RejectionReason;
  /** The node's own error code, such as `ERR_LOW_FEE`. */
  readonly nodeCode: string | undefined;

  constructor(reason: RejectionReason, message: string, nodeCode?: string, details: ErrorDetails = {}) {
    super("TxRejected", message, { ...details, reason, ...(nodeCode === undefined ? {} : { nodeCode }) });
    this.reason = reason;
    this.nodeCode = nodeCode;
  }
}

/** The nonce, fee or milestone changed since the draft was built. */
export class StaleDraft extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("StaleDraft", message, details);
  }
}

/**
 * No minimum fee can be resolved for the operation: the milestone in force has no enabled dynamic
 * fee table, so no fee floor is in force and the node's pool applies settings of its own, or the
 * floor is above the largest fee a transaction can carry. An exact fee still works.
 */
export class FeeUnavailable extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("FeeUnavailable", message, details);
  }
}

/** The network does not offer this operation. `capability` names what is missing. */
export class UnsupportedOnNetwork extends IceRootError {
  /** The missing capability. */
  readonly capability: string;

  constructor(capability: string, message: string, details: ErrorDetails = {}) {
    super("UnsupportedOnNetwork", message, { ...details, capability });
    this.capability = capability;
  }
}

/** A function was called before `init()` or `initSync()` loaded the WebAssembly module. */
export class SdkNotInitialized extends IceRootError {
  constructor() {
    super(
      "SdkNotInitialized",
      "the SDK is not initialized: call init() or initSync() before any other function",
    );
  }
}

/**
 * The WebAssembly module could not be fetched, compiled or instantiated. The platform's error is
 * the `cause`; a common one is a content security policy without `'wasm-unsafe-eval'`.
 */
export class WasmLoadFailed extends IceRootError {
  constructor(message: string, cause: unknown) {
    super("WasmLoadFailed", message, {}, { cause });
  }
}

/** No random bytes were available for signing, or for a keystore's salt and nonce; nothing was made. */
export class RandomnessUnavailable extends IceRootError {
  constructor(message = "no random bytes are available") {
    super("RandomnessUnavailable", message);
  }
}

/** No signature could be made. */
export class SigningFailed extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("SigningFailed", message, details);
  }
}

/** A draft was signed with a key it does not name, or without a key it needs. */
export class WrongKey extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("WrongKey", message, details);
  }
}

/** The key was released and can no longer sign. */
export class KeyReleased extends IceRootError {
  constructor(message = "the key was released") {
    super("KeyReleased", message);
  }
}
