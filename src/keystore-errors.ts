/**
 * The errors of the keystore, exported by `@iceroot-network/sdk/keystore`. Each is an
 * `IceRootError` with the keystore's stable code and details, as the Rust SDK reports them. A
 * failing generator raises the core's `RandomnessUnavailable`.
 *
 * @module
 */

import { IceRootError, type ErrorDetails } from "./errors.js";

/**
 * The password is wrong, or the keystore was changed or damaged after it was written. The two
 * cannot be told apart, by design.
 */
export class WrongPasswordOrCorrupt extends IceRootError {
  constructor(message = "wrong password, or the keystore was changed or damaged", details: ErrorDetails = {}) {
    super("WrongPasswordOrCorrupt", message, details);
  }
}

/** Why bytes or text are not a keystore. */
export type MalformedReason =
  | "magic"
  | "truncated"
  | "payload-length"
  | "length"
  | "armor-prefix"
  | "armor-encoding"
  | "armor-length";

/** The bytes or text are not a keystore of a known layout. `reason` says why. */
export class Malformed extends IceRootError {
  /** What is wrong with it. */
  readonly reason: MalformedReason;

  constructor(message: string, details: ErrorDetails = {}) {
    super("Malformed", message, details);
    this.reason = details["reason"] as MalformedReason;
  }
}

/** The keystore's format version is not one this release reads. `details.version`. */
export class UnsupportedVersion extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("UnsupportedVersion", message, details);
  }
}

/** The keystore names a key derivation function this release does not know. `details.kdf`. */
export class UnsupportedKdf extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("UnsupportedKdf", message, details);
  }
}

/** The payload kind is unknown, or reserved for a later release. `details.kind`, the kind's byte. */
export class UnsupportedPayload extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("UnsupportedPayload", message, details);
  }
}

/**
 * A key derivation parameter is outside the bounds: below the floor (a weak keystore) or above the
 * ceiling (one that would demand too much memory or time). `details`: `param` (`memory`,
 * `iterations`, `parallelism` or `work`), `value`, `minimum`, `maximum`.
 */
export class ParamsOutOfRange extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("ParamsOutOfRange", message, details);
  }
}

/** Secret material of the wrong length for its payload kind. `details`: `kind`, `length`. */
export class InvalidPayload extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidPayload", message, details);
  }
}

/** The password cannot be used: `details.reason` is `empty`, or `too-long` with `bytes` and `maximum`. */
export class InvalidPassword extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidPassword", message, details);
  }
}

/** The memory the key derivation needs could not be allocated. `details.memoryKib`. */
export class OutOfMemory extends IceRootError {
  constructor(message: string, details: ErrorDetails = {}) {
    super("OutOfMemory", message, details);
  }
}
