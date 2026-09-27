/**
 * Sign-in challenges.
 *
 * A website asks a wallet to sign a challenge message; the wallet checks it with `SignIn.parse`
 * before it asks the holder, and the website's server builds it with `SignIn.build`. Both sides
 * call the same code, so they cannot disagree. The functions arrive with the Rust core; this
 * module defines their types.
 *
 * @module
 */

import type { Hex } from "./types.js";

/** The fields of a sign-in challenge. */
export interface SignInFields {
  /** The website's origin, such as `https://example.com`. */
  readonly origin: string;
  /** The network name, such as `heartwood-devnet-v90`. */
  readonly network: string;
  /** The signer's public key, as hex. */
  readonly publicKey: Hex;
  /** The signer's address. */
  readonly address: string;
  /** 64 hex digits chosen by the website. */
  readonly nonce: Hex;
  /** When the challenge was issued. */
  readonly issuedAt: Date;
  /** When the challenge lapses; at most five minutes after `issuedAt`. */
  readonly expiresAt: Date;
}

/** What `SignIn.parse` checks the challenge against. */
export interface SignInExpectations {
  /** The origin of the page that asks. */
  readonly origin: string;
  /** The selected account's address. */
  readonly address: string;
  /** The selected account's public key, as hex. */
  readonly publicKey: Hex;
  /** The current time. */
  readonly now: Date;
}
