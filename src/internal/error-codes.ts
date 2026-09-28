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
import { InvalidProof } from "../ownership-errors.js";
import {
  BreaksRules,
  DoesNotFit,
  InvalidPickCount,
  InvalidSnapshot,
  NotEnoughValidators,
  ValidatorCannotVote,
} from "../vote-errors.js";
import { displayText } from "./drafts.js";

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
  // Ownership proofs.
  InvalidProof,
};

/** The longest text of a node's own that an error's details keep. */
const MAX_NODE_TEXT = 200;

/** The longest message, and the longest text of any detail, an error keeps. */
const MAX_TEXT = 500;

/** `text` cut to `max` characters, with `...` when it was longer. */
function shortened(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  // Never end on the first half of a surrogate pair.
  const cut = /[\uD800-\uDBFF]$/.test(text.slice(0, max)) ? max - 1 : max;
  return `${text.slice(0, cut)}...`;
}

/** `details` with every text shortened to {@link MAX_TEXT} characters. */
function shortenedDetails(details: ErrorDetails): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, typeof value === "string" ? shortened(value, MAX_TEXT) : value]),
  );
}

/**
 * The text a node sent with a refusal, for `details.message`: shortened, and on one line with its
 * control, separator and invisible characters escaped as a review line escapes them.
 */
function nodeText(details: Record<string, unknown>): Record<string, unknown> {
  const text = details["message"];
  return typeof text === "string" ? { ...details, message: shortened(displayText(text), MAX_NODE_TEXT) } : details;
}

/**
 * The SDK error of a code, message and details, as the Rust core reports them.
 *
 * Text a node chose never becomes the message, which apps show as it is: a refusal's message
 * names its HTTP status and the node's own text is in `details.message`, shortened to 200
 * characters; an answer that could not be read says so, with what was wrong in `details.reason`.
 * Every message and every text of the details is at most 500 characters.
 */
export function errorFromCode(code: string, rawMessage: string, rawDetails: ErrorDetails): IceRootError {
  const details = shortenedDetails(rawDetails);
  const message = shortened(rawMessage, MAX_TEXT);
  switch (code) {
    case "Refused": {
      const status = details["status"];
      const statusText = typeof status === "number" ? ` with HTTP ${status}` : "";
      return new Refused(`the node refused the request${statusText}`, nodeText(details));
    }
    case "NotFound":
      return new NotFound("the node has no such record", nodeText(details));
    case "BadResponse":
      return new BadResponse("the answer does not have the expected shape; details.reason says why", details);
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
