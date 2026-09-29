// The arguments and answers of the sign-in functions, shared by the WebAssembly entry and the
// Tauri plugin's entry.

import { InvalidArgument } from "../errors.js";
import type { SignInExpectations, SignInFields, SignInRequest, SignInSigning } from "../signin.js";

const EXPECTED_FIELDS = ["origin", "address", "publicKey"] as const;

function seconds(date: Date, name: string): number {
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  if (!Number.isFinite(time)) {
    throw new InvalidArgument(`${name} is not a valid date`);
  }
  return Math.floor(time / 1000);
}

/** The request of `SignIn.build` in the bindings' JSON: times in whole seconds. */
export function requestWire(request: SignInRequest): string {
  return JSON.stringify({
    origin: request.origin,
    publicKey: request.publicKey,
    nonce: request.nonce,
    issuedAt: seconds(request.issuedAt, "issuedAt"),
    expiresAt: seconds(request.expiresAt, "expiresAt"),
  });
}

/** The expected fields of `SignIn.parse` in the bindings' JSON, and the current time in milliseconds. */
export function expectedWire(expected: SignInExpectations): { json: string; now: number } {
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
  return { json, now };
}

/**
 * The arguments of `SignIn.sign` in the bindings' form: the message, which must be text, the
 * origin, which is required, and the current time in milliseconds.
 */
export function signingWire(message: string, signing: SignInSigning): { message: string; origin: string; now: number } {
  if (typeof message !== "string") {
    throw new InvalidArgument("a sign-in message is signed as text", { field: "message" });
  }
  const origin: unknown = signing?.origin;
  if (typeof origin !== "string" || origin === "") {
    throw new InvalidArgument("the origin of the page that asks is required", { field: "origin" });
  }
  const now = signing.now instanceof Date ? signing.now.getTime() : Number.NaN;
  if (!Number.isFinite(now)) {
    throw new InvalidArgument("now is not a valid date", { field: "now" });
  }
  return { message, origin, now };
}

/** The checked fields of a sign-in message from the bindings' JSON. */
export function fieldsFromWire(text: string): SignInFields {
  const fields = JSON.parse(text) as Omit<SignInFields, "issuedAt" | "expiresAt"> & { issuedAtMs: number; expiresAtMs: number };
  const { issuedAtMs, expiresAtMs, ...rest } = fields;
  return Object.freeze({ ...rest, issuedAt: new Date(issuedAtMs), expiresAt: new Date(expiresAtMs) });
}
