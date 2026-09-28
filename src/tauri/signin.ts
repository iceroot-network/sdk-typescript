/**
 * Sign-in challenges, version 1, built and checked in the plugin.
 *
 * @module
 */

import { expectedWire, fieldsFromWire, requestWire } from "../internal/signin-args.js";
import type { ProfileSource } from "../profiles.js";
import type { SignInExpectations, SignInFields, SignInRequest } from "../signin.js";
import { invoke } from "./invoke.js";
import { profileJson } from "./profiles.js";

export type { SignInExpectations, SignInFields, SignInRequest } from "../signin.js";

/** Building and checking sign-in challenges. */
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
} as const;
