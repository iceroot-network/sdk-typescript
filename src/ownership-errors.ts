/**
 * The error of ownership proofs, exported by `@iceroot-network/sdk/ownership`. It is an
 * `IceRootError` with the Rust core's stable code and details, as the Rust SDK reports it.
 *
 * @module
 */

import { IceRootError, type ErrorDetails } from "./errors.js";

/** The check an ownership proof, its message or an IceRoot account fails. */
export type ProofProblem =
  /** Not a proof message of a supported version: its length, its characters (printable ASCII lines only), its number of lines or its fixed text. */
  | "format"
  /** A field is missing its label. */
  | "field"
  /** The source network is not Solar mainnet. */
  | "source-network"
  /** The source address is not a Solar mainnet address (its form, checksum or network byte 63). */
  | "address"
  /** The IceRoot account has a typing error, is not an `ice1` or `tice1` account, or is not in lowercase in a message. */
  | "account"
  /** The nonce is not 64 lowercase hex digits. */
  | "nonce"
  /** The issue time is malformed, not a real date and time, or more than five minutes ahead of the reader's clock. */
  | "issued-at"
  /** The message names another source address than the one expected, or the address is not the public key's. */
  | "mismatch"
  /** The public key is not 33 bytes compressed in lowercase hex. */
  | "key"
  /** The signature is malformed or does not verify. */
  | "signature"
  /** The JSON is not a signed proof of a supported version. */
  | "json";

/** An ownership proof, its message or an IceRoot account is refused. `reason` names the check. */
export class InvalidProof extends IceRootError {
  /** The check it fails. */
  readonly reason: ProofProblem;

  constructor(message: string, details: ErrorDetails = {}) {
    super("InvalidProof", message, details);
    this.reason = details["reason"] as ProofProblem;
  }
}
