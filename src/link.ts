/** Account links and revocations, checked by the Rust core. @module */
import { IceRootError, InvalidArgument, type ErrorDetails } from "./errors.js";
import { call, parse } from "./internal/bindings.js";
import { milliseconds, stringArg } from "./internal/ownership-args.js";
import { keyHandleOf, type Account } from "./keys.js";
import { profileHandleOf, type ProfileSource } from "./profiles.js";

/** The first check that refused a link. */
export type LinkProblem = "format" | "field" | "network" | "github-id" | "key" | "address" |
  "issued-at" | "future" | "ends-link" | "mismatch" | "json" | "record" | "signature" | "replay" | "unknown-link";
/** A link or revocation failed a check. */
export class InvalidLink extends IceRootError {
  /** The check that failed, also in details.reason. */
  readonly reason: LinkProblem;
  constructor(reason: LinkProblem, message = "the account link was refused", details: ErrorDetails = {}) {
    super("InvalidLink", message, { ...details, reason });
    this.reason = reason;
  }
}
/** A new message; dates are reduced to whole seconds. */
export interface LinkRequest {
  readonly githubId: number;
  readonly publicKey: string;
  readonly issuedAt: Date;
}
/** A revocation names the issue time of the link it ends. */
export interface LinkRevocationRequest extends LinkRequest {
  readonly endsLinkIssuedAt: Date;
}
/** Optional fields the reader already knows. */
export interface LinkExpectations {
  readonly kind?: "link" | "revocation";
  readonly githubId?: number;
  readonly publicKey?: string;
  readonly address?: string;
}
/** Checked fields, including canonical UTC text and milliseconds. */
export interface LinkFields {
  readonly kind: "link" | "revocation";
  readonly network: string;
  readonly githubId: number;
  readonly account: string;
  readonly publicKey: string;
  readonly issuedAt: string;
  readonly issuedAtMs: number;
  readonly endsLinkIssuedAt?: string;
  readonly endsLinkIssuedAtMs?: number;
}
/** The five members of the signed record, in canonical order. */
export interface LinkRecord {
  readonly message: string;
  readonly publicKey: string;
  readonly signature: string;
  readonly algorithm: string;
  readonly network: string;
}
/** A previously verified event; omit the record being checked again. */
export interface LinkHistoryEntry {
  readonly network: string;
  readonly githubId: number;
  readonly account: string;
  readonly event: "link" | "revocation" | "github-unlink";
  readonly at: number;
}

function checked<T>(f: () => T): T {
  try { return f(); } catch (error) {
    if (error instanceof IceRootError && error.code === "InvalidLink") {
      throw new InvalidLink(error.details["reason"] as LinkProblem, error.message, error.details);
    }
    throw error;
  }
}
function wire(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new InvalidArgument("a JSON value is required");
  return text;
}
function object<T>(value: T, what: string): T {
  if (typeof value !== "object" || value === null) throw new InvalidArgument(`${what} is an object`);
  return value;
}
function request(value: LinkRequest, kind: "link" | "revocation", ends?: Date): string {
  object(value, "a link request");
  if (!Number.isSafeInteger(value.githubId) || value.githubId < 1) throw new InvalidLink("github-id");
  return wire({ kind, githubId: value.githubId, publicKey: value.publicKey,
    issuedAt: Math.floor(milliseconds(value.issuedAt, "issuedAt") / 1000),
    ...(ends === undefined ? {} : { endsLinkIssuedAt: Math.floor(milliseconds(ends, "endsLinkIssuedAt") / 1000) }) });
}
function recordWire(value: LinkRecord | string): string { return typeof value === "string" ? value : wire(value); }

/** Build, inspect, sign and verify exact link text. No network access is needed. */
export const Link = {
  /** Build the nine-line link message. */
  build(value: LinkRequest, source: ProfileSource): string {
    return checked(() => call(m => m.buildLink(profileHandleOf(source), request(value, "link"))));
  },
  /** Build the ten-line revocation message. */
  buildRevocation(value: LinkRevocationRequest, source: ProfileSource): string {
    return checked(() => call(m => m.buildLink(profileHandleOf(source), request(value, "revocation", object(value, "a revocation request").endsLinkIssuedAt))));
  },
  /** Check exact text at the reader's clock. A revocation returns kind revocation. */
  parse(message: string, source: ProfileSource, expected: LinkExpectations, now: Date | number): LinkFields {
    return checked(() => Object.freeze(parse<LinkFields>(call(m => m.parseLink(profileHandleOf(source), stringArg(message, "message"), wire(expected), milliseconds(now, "now"))))));
  },
  /** Check the signature and fields. Pass raw JSON to preserve duplicate-member detection. */
  verify(record: LinkRecord | string, source: ProfileSource, expected: LinkExpectations, now: Date | number): LinkFields {
    return checked(() => Object.freeze(parse<LinkFields>(call(m => m.verifyLink(profileHandleOf(source), recordWire(record), wire(expected), milliseconds(now, "now"))))));
  },
  /** Sign only after checking the message against the account, network and signer clock. */
  sign(account: Account, message: string, signing: { readonly now: Date | number }): LinkRecord {
    return checked(() => Object.freeze(parse<LinkRecord>(call(() => keyHandleOf(account).signLink(stringArg(message, "message"), milliseconds(object(signing, "the signing time").now, "now"))))));
  },
  /** Read exactly five text members, each once. This does not verify a signature. */
  fromJson(record: string): LinkRecord {
    return checked(() => Object.freeze(parse<LinkRecord>(call(m => m.linkRecordJson(stringArg(record, "record"))))));
  },
  /** Write byte-identically to Rust, with canonical member order and escaping. */
  toJson(record: LinkRecord): string {
    return checked(() => call(m => m.linkRecordJson(wire(record))));
  },
  /** Apply the no-replay rule to previously verified events of this identity and network. */
  checkHistory(message: string, source: ProfileSource, history: readonly LinkHistoryEntry[], now: Date | number): void {
    checked(() => call(m => m.checkLinkHistory(profileHandleOf(source), stringArg(message, "message"), wire(history), milliseconds(now, "now"))));
  },
} as const;
