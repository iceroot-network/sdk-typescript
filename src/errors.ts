/**
 * Errors of the SDK.
 *
 * Every error the SDK throws is an {@link IceRootError} with a stable string `code`, a human
 * `message` and structured `details`. Each code has a subclass for `instanceof` checks. The codes
 * are part of the API: apps may branch on them, and they never change meaning.
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
  | "InvalidAddress"
  | "InvalidPublicKey"
  | "InvalidAmount"
  | "MemoTooLong"
  | "TooManyRecipients"
  | "InvalidVote"
  | "InvalidName"
  | "InvalidProfile"
  // Network
  | "NodeUnavailable"
  | "RateLimited"
  | "Timeout"
  | "BadResponse"
  | "NetworkMismatch"
  // Submission
  | "TxRejected"
  | "StaleDraft"
  // Support
  | "UnsupportedOnNetwork"
  | "SdkNotInitialized"
  | "WasmLoadFailed"
  // Crypto
  | "RandomnessUnavailable"
  | "SigningFailed"
  | "KeyReleased";

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

/** A recovery phrase or passphrase was refused. */
export class InvalidPhrase extends IceRootError {
  constructor(message = "the phrase was refused", details: ErrorDetails = {}) {
    super("InvalidPhrase", message, details);
  }
}

/** A recovery phrase has fewer words than new keys accept (18). */
export class PhraseTooShort extends IceRootError {
  constructor(message = "a recovery phrase needs at least 18 words", details: ErrorDetails = {}) {
    super("PhraseTooShort", message, details);
  }
}

/** An address was refused. `reason` says why; `position` points at a bad character when known. */
export class InvalidAddress extends IceRootError {
  /** Why the address was refused. */
  readonly reason: AddressProblem;
  /** The index of the first bad character, when the problem is one. */
  readonly position: number | undefined;

  constructor(reason: AddressProblem, message: string, position?: number) {
    super("InvalidAddress", message, position === undefined ? { reason } : { reason, position });
    this.reason = reason;
    this.position = position;
  }
}

/** A public key was refused. */
export class InvalidPublicKey extends IceRootError {
  constructor(message = "the bytes are not a public key", details: ErrorDetails = {}) {
    super("InvalidPublicKey", message, details);
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

/** A transfer has more recipients than the network allows. */
export class TooManyRecipients extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("TooManyRecipients", message, details);
  }
}

/** A vote breaks the network's vote rules. */
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

/** A network profile is incomplete or malformed. */
export class InvalidProfile extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidProfile", message, details);
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

/** A node belongs to another chain than the profile's. */
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

  constructor(reason: RejectionReason, message: string, nodeCode?: string) {
    super("TxRejected", message, nodeCode === undefined ? { reason } : { reason, nodeCode });
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

/** The network does not offer this operation. `capability` names what is missing. */
export class UnsupportedOnNetwork extends IceRootError {
  /** The missing capability. */
  readonly capability: string;

  constructor(capability: string, message: string) {
    super("UnsupportedOnNetwork", message, { capability });
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

/** No random bytes were available for signing; nothing was signed. */
export class RandomnessUnavailable extends IceRootError {
  constructor(message = "no random bytes are available for signing") {
    super("RandomnessUnavailable", message);
  }
}

/** No signature could be made. */
export class SigningFailed extends IceRootError {
  constructor(message: string) {
    super("SigningFailed", message);
  }
}

/** The key was released and can no longer sign. */
export class KeyReleased extends IceRootError {
  constructor(message = "the key was released") {
    super("KeyReleased", message);
  }
}
