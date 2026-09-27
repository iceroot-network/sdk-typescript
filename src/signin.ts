/**
 * Sign-in challenges, version 1.
 *
 * A website asks a wallet to sign a challenge message; the wallet checks it with `SignIn.parse`
 * before it asks the holder, and the website's server builds it with `SignIn.build` and checks it
 * again before it verifies the signature. Both sides call the same code in the SDK's Rust core,
 * so they cannot disagree.
 *
 * @module
 */

import { InvalidArgument } from "./errors.js";
import { call, parse } from "./internal/bindings.js";
import { profileHandleOf, type ProfileSource } from "./profiles.js";
import type { Hex } from "./types.js";

/** What a server puts in a new sign-in message. */
export interface SignInRequest {
  /** The website's origin, such as `https://validators.example`. */
  readonly origin: string;
  /** The signer's public key, as hex. */
  readonly publicKey: Hex;
  /** 64 lowercase hex digits from 32 random bytes, used once. */
  readonly nonce: Hex;
  /** When the challenge is issued (whole seconds are used). */
  readonly issuedAt: Date;
  /** When it lapses: at most five minutes after `issuedAt`. */
  readonly expiresAt: Date;
}

/** The fields of a checked sign-in challenge. */
export interface SignInFields {
  /** The website's origin. */
  readonly origin: string;
  /** The origin's `/login`. */
  readonly uri: string;
  /** The network name, such as `heartwood-devnet-v90`. */
  readonly network: string;
  /** The signer's public key, as lowercase hex. */
  readonly publicKey: Hex;
  /** The signer's address. */
  readonly address: string;
  /** The nonce. */
  readonly nonce: Hex;
  /** When the challenge was issued. */
  readonly issuedAt: Date;
  /** When the challenge lapses. */
  readonly expiresAt: Date;
}

/**
 * What `SignIn.parse` checks the challenge against. Every field is required: without the origin
 * and the identity, a challenge made for another website or another account would pass. A context
 * that knows only the public key derives the address with `Address.fromPublicKey`.
 */
export interface SignInExpectations {
  /** The origin of the page that asks, as the browser reports it; never one the page claims. */
  readonly origin: string;
  /** The selected account's address. */
  readonly address: string;
  /** The selected account's public key, as hex. */
  readonly publicKey: Hex;
  /** The current time. */
  readonly now: Date;
}

const EXPECTED_FIELDS = ["origin", "address", "publicKey"] as const;

function seconds(date: Date, name: string): number {
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  if (!Number.isFinite(time)) {
    throw new InvalidArgument(`${name} is not a valid date`);
  }
  return Math.floor(time / 1000);
}

/** Building and checking sign-in challenges. */
export const SignIn = {
  /** The twelve-line sign-in message of `request` on the network of `source`, for a server. */
  build(request: SignInRequest, source: ProfileSource): string {
    const profile = profileHandleOf(source);
    const json = JSON.stringify({
      origin: request.origin,
      publicKey: request.publicKey,
      nonce: request.nonce,
      issuedAt: seconds(request.issuedAt, "issuedAt"),
      expiresAt: seconds(request.expiresAt, "expiresAt"),
    });
    return call((module) => module.buildSignIn(profile, json));
  },

  /**
   * The fields of the sign-in `message` on the network of `source`, after every check: the fixed
   * lines, a secure origin with `URI` its `/login`, the network, the forms of the key, address and
   * nonce, that the address is the key's, the expected origin, public key and address, and the
   * times. A message that fails a check throws `InvalidSignIn` with the reason in
   * `details.reason`; a missing expected field throws `InvalidArgument`.
   */
  parse(message: string, source: ProfileSource, expected: SignInExpectations): SignInFields {
    const profile = profileHandleOf(source);
    for (const name of EXPECTED_FIELDS) {
      const value: unknown = expected[name];
      if (typeof value !== "string" || value === "") {
        throw new InvalidArgument(`the expected ${name} is required`, { field: name });
      }
    }
    const now = expected.now instanceof Date ? expected.now.getTime() : Number.NaN;
    if (!Number.isFinite(now)) {
      throw new InvalidArgument("now is not a valid date");
    }
    const json = JSON.stringify({
      origin: expected.origin,
      publicKey: expected.publicKey,
      address: expected.address,
    });
    const fields = parse<Omit<SignInFields, "issuedAt" | "expiresAt"> & { issuedAtMs: number; expiresAtMs: number }>(
      call((module) => module.parseSignIn(profile, message, json, now)),
    );
    const { issuedAtMs, expiresAtMs, ...rest } = fields;
    return Object.freeze({ ...rest, issuedAt: new Date(issuedAtMs), expiresAt: new Date(expiresAtMs) });
  },
} as const;
