/**
 * Sign-in challenges, version 1, built and checked in the plugin.
 *
 * @module
 */

import { expectedWire, fieldsFromWire, requestWire, signingWire } from "../internal/signin-args.js";
import type { MessageSignature } from "../messages.js";
import type { ProfileSource } from "../profiles.js";
import type { SignInExpectations, SignInFields, SignInRequest, SignInSigning } from "../signin.js";
import { invoke } from "./invoke.js";
import { keyOf, type Account } from "./keys.js";
import { profileJson } from "./profiles.js";

export type { SignInExpectations, SignInFields, SignInRequest, SignInSigning } from "../signin.js";

/** Building, checking and signing sign-in challenges. */
export const SignIn = {
  /** The twelve-line sign-in message of `request` on the network of `source`, for a server. */
  async build(request: SignInRequest, source: ProfileSource): Promise<string> {
    const profile = profileJson(source);
    return invoke<string>("signin_build", { profile, request: requestWire(request) });
  },

  /**
   * The fields of the sign-in `message` on the network of `source`, after every check (see the
   * WebAssembly entry's `SignIn.parse`). A message that fails a check rejects with
   * `InvalidSignIn` and the reason in `details.reason`; a missing expected field with
   * `InvalidArgument`.
   */
  async parse(message: string, source: ProfileSource, expected: SignInExpectations): Promise<SignInFields> {
    const profile = profileJson(source);
    const { json, now } = expectedWire(expected);
    return fieldsFromWire(await invoke<string>("signin_parse", { profile, message, expected: json, nowMs: now }));
  },

  /**
   * Signs the sign-in `message` with the key of `account`, in the plugin, for the page of
   * `signing.origin`, at `signing.now`. The plugin checks the message first, as `SignIn.parse`
   * checks it, against that origin and the account's own public key and address, and signs only
   * if every check passes; a refusal rejects with `InvalidSignIn` and the reason in
   * `details.reason` (see the WebAssembly entry's `SignIn.sign`). Sign a website's sign-in
   * message this way, never with `Messages.sign` from a generic prompt.
   */
  async sign(account: Account, message: string, signing: SignInSigning): Promise<MessageSignature> {
    const key = keyOf(account);
    const args = signingWire(message, signing);
    const text = await invoke<string>("key_sign_sign_in", { key, message: args.message, origin: args.origin, nowMs: args.now });
    return Object.freeze(JSON.parse(text) as MessageSignature);
  },
} as const;
