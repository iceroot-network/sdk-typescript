// The SDK error of each code the Rust core reports.

import {
  BadResponse,
  FeeUnavailable,
  IceRootError,
  InvalidAddress,
  InvalidAmount,
  InvalidArgument,
  InvalidDraft,
  InvalidFee,
  InvalidKey,
  InvalidName,
  InvalidPath,
  InvalidPhrase,
  InvalidProfile,
  InvalidRequest,
  InvalidSignIn,
  InvalidTransaction,
  InvalidVote,
  KeyReleased,
  MemoTooLong,
  NetworkMismatch,
  NoRecipients,
  NodeUnavailable,
  NotFound,
  PhraseTooShort,
  RandomnessUnavailable,
  RateLimited,
  Refused,
  SdkNotInitialized,
  SigningFailed,
  StaleDraft,
  Timeout,
  TooManyRecipients,
  TxRejected,
  UnsupportedOnNetwork,
  WrongKey,
  type AddressProblem,
  type ErrorCode,
  type ErrorDetails,
  type RejectionReason,
} from "../errors.js";
import {
  InvalidPassword,
  InvalidPayload,
  Malformed,
  OutOfMemory,
  ParamsOutOfRange,
  UnsupportedKdf,
  UnsupportedPayload,
  UnsupportedVersion,
  WrongPasswordOrCorrupt,
} from "../keystore-errors.js";
import {
  BreaksRules,
  DoesNotFit,
  InvalidPickCount,
  InvalidSnapshot,
  NotEnoughValidators,
  ValidatorCannotVote,
} from "../vote-errors.js";

const ADDRESS_PROBLEMS: ReadonlySet<string> = new Set(["checksum", "length", "wrong-network", "format"]);
const REJECTION_REASONS: ReadonlySet<string> = new Set([
  "low-fee",
  "nonce",
  "balance",
  "duplicate",
  "invalid",
  "pool-full",
  "wrong-network",
  "too-large",
  "other",
]);

type Plain = new (message: string, details: ErrorDetails) => IceRootError;

const PLAIN: Readonly<Record<string, Plain>> = {
  InvalidPhrase,
  PhraseTooShort,
  InvalidPath,
  InvalidKey,
  InvalidAmount,
  MemoTooLong,
  NoRecipients,
  TooManyRecipients,
  InvalidVote,
  InvalidName,
  InvalidFee,
  InvalidDraft,
  InvalidTransaction,
  InvalidSignIn,
  InvalidRequest,
  InvalidProfile,
  InvalidArgument,
  NodeUnavailable,
  RateLimited,
  Timeout,
  BadResponse,
  NotFound,
  Refused,
  NetworkMismatch,
  StaleDraft,
  FeeUnavailable,
  SigningFailed,
  WrongKey,
  // The vote library.
  InvalidPickCount,
  ValidatorCannotVote,
  InvalidSnapshot,
  NotEnoughValidators,
  DoesNotFit,
  BreaksRules,
  // The keystore.
  WrongPasswordOrCorrupt,
  Malformed,
  UnsupportedVersion,
  UnsupportedKdf,
  UnsupportedPayload,
  ParamsOutOfRange,
  InvalidPayload,
  InvalidPassword,
  OutOfMemory,
};

/** The SDK error of a code, message and details, as the Rust core reports them. */
export function errorFromCode(code: string, message: string, details: ErrorDetails): IceRootError {
  switch (code) {
    case "InvalidAddress": {
      const reason = details["reason"];
      const position = details["position"];
      return new InvalidAddress(
        typeof reason === "string" && ADDRESS_PROBLEMS.has(reason) ? (reason as AddressProblem) : "format",
        message,
        typeof position === "number" ? position : undefined,
        details,
      );
    }
    case "TxRejected": {
      const reason = details["reason"];
      const nodeCode = details["nodeCode"];
      return new TxRejected(
        typeof reason === "string" && REJECTION_REASONS.has(reason) ? (reason as RejectionReason) : "other",
        message,
        typeof nodeCode === "string" ? nodeCode : undefined,
        details,
      );
    }
    case "UnsupportedOnNetwork": {
      const capability = details["capability"];
      return new UnsupportedOnNetwork(typeof capability === "string" ? capability : "unknown", message, details);
    }
    case "SdkNotInitialized":
      return new SdkNotInitialized();
    case "RandomnessUnavailable":
      return new RandomnessUnavailable(message);
    case "KeyReleased":
      return new KeyReleased(message);
    default: {
      const Class = PLAIN[code];
      // A code this wrapper does not know yet keeps its name on the base class.
      return Class === undefined ? new IceRootError(code as ErrorCode, message, details) : new Class(message, details);
    }
  }
}
