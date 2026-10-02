// Drafts and signed transactions in the JSON the bindings read and write, shared by the
// WebAssembly entry and the Tauri plugin's entry: the request and facts a draft is built from,
// and the summaries a draft and a signed transaction give, with the review screen's lines.

import type {
  DraftFee,
  DraftRequest,
  DraftSummary,
  FeeChoice,
  FeeSource,
  OnlineFacts,
  Operation,
  OperationKind,
  OperationSummary,
  Resignation,
  SignedSummary,
} from "../build.js";
import { InvalidArgument } from "../errors.js";
import type { BaseUnits } from "../types.js";
import { checkHeight } from "./chain-json.js";

/**
 * An operation with its recipients' addresses as either entry's `Address` or as text: the shape
 * both entries' `Operation` types have.
 */
export type OperationLike =
  | Exclude<Operation, { readonly kind: "transfer" }>
  | {
      readonly kind: "transfer";
      readonly to: readonly { readonly address: { toString(): string } | string; readonly amount: BaseUnits }[];
    };

/** A draft request of either entry. */
export interface DraftRequestLike extends Omit<DraftRequest, "operation"> {
  readonly operation: OperationLike;
}

export type OperationJson =
  | { kind: "transfer"; to: { address: string; amount: string }[] }
  | { kind: "vote"; entries: { validator: string; basisPoints: number }[] }
  | { kind: "burn"; amount: string }
  | { kind: "register-second-key"; publicKey: string }
  | { kind: "register-validator"; name: string }
  | { kind: "resign-validator"; resignation: Resignation };

export interface DraftSummaryJson {
  profile: string;
  networkByte: number;
  nethash: string;
  height: number;
  kind: OperationKind;
  operation: OperationJson;
  from: string;
  publicKey: string;
  nonce: string;
  fee: { amount: string; source: FeeSource; floor: string | null };
  memo: string | null;
  amount: string;
  size: number;
  secondSignature: boolean;
}

export function units(value: BaseUnits, name: string): string {
  if (typeof value !== "bigint" || value < 0n) {
    throw new InvalidArgument(`${name} is a bigint of base units, not negative`, { [name]: String(value) });
  }
  return value.toString();
}

export function operationJson(operation: OperationLike): OperationJson {
  switch (operation.kind) {
    case "transfer":
      return {
        kind: "transfer",
        to: operation.to.map((recipient, index) => ({
          address: String(recipient.address),
          amount: units(recipient.amount, `to[${index}].amount`),
        })),
      };
    case "vote":
      return {
        kind: "vote",
        entries: operation.entries.map(({ validator, basisPoints }) => ({ validator, basisPoints })),
      };
    case "burn":
      return { kind: "burn", amount: units(operation.amount, "amount") };
    case "register-second-key":
      return { kind: "register-second-key", publicKey: operation.publicKey };
    case "register-validator":
      return { kind: "register-validator", name: operation.name };
    case "resign-validator":
      return { kind: "resign-validator", resignation: operation.resignation };
    default:
      throw new InvalidArgument(`no operation is ${JSON.stringify((operation as { kind?: unknown }).kind)}`);
  }
}

export function operationFromJson(json: OperationJson): OperationSummary {
  switch (json.kind) {
    case "transfer":
      return {
        kind: "transfer",
        to: json.to.map(({ address, amount }) => ({ address, amount: BigInt(amount) })),
      };
    case "burn":
      return { kind: "burn", amount: BigInt(json.amount) };
    default:
      return json;
  }
}

export function feeJson(fee: FeeChoice | undefined): object {
  if (fee === undefined || fee === "minimum") {
    return { kind: "minimum" };
  }
  if (typeof fee === "bigint") {
    return { kind: "exact", amount: units(fee, "fee") };
  }
  const basisPoints = fee.multiplierBasisPoints;
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 0xffffffff) {
    throw new InvalidArgument("multiplierBasisPoints is an integer", { multiplierBasisPoints: basisPoints });
  }
  return { kind: "multiplier", basisPoints };
}

export function basisPointsText(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

/**
 * Control characters (C0, DEL, C1), line and paragraph separators, bidirectional formatting
 * characters, format characters (invisible ones such as zero-width spaces and joiners), every
 * space but the ASCII space, runs of two or more ASCII spaces, and the backslash.
 */
const UNSAFE_TEXT = /[\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Bidi_Control}]|(?! )\p{Zs}| {2,}/gu;

/** `char` as a `\uXXXX` escape. */
function escaped(char: string): string {
  return `\\u${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * `text` safe for one line of a review screen: every character of {@link UNSAFE_TEXT} is written as
 * a `\uXXXX` escape, every space of a run of two or more ASCII spaces as `\u0020` (so no stretch
 * of blank space sets text apart), and a backslash as `\\`, so the escapes cannot be mistaken for
 * text.
 */
export function displayText(text: string): string {
  return text.replace(UNSAFE_TEXT, (match) =>
    match === "\\" ? "\\\\" : match.startsWith(" ") ? escaped(" ").repeat(match.length) : escaped(match),
  );
}

/**
 * Whether `signed` (a signed transaction's bytes, at `signedHeight`) is the transaction whose
 * unsigned bytes are `unsigned`, at `height`: the signatures follow the unsigned bytes.
 */
export function signsDraft(signed: Uint8Array, signedHeight: number, unsigned: Uint8Array, height: number): boolean {
  if (signedHeight !== height || signed.length <= unsigned.length) {
    return false;
  }
  return unsigned.every((byte, index) => signed[index] === byte);
}

export function lines(summary: Omit<DraftSummary, "lines">, symbol: string, format: (units: BaseUnits) => string): string[] {
  const amount = (value: BaseUnits) => `${format(value)} ${symbol}`;
  const operation = summary.operation;
  const out: string[] = [];
  switch (operation.kind) {
    case "transfer":
      for (const recipient of operation.to) {
        out.push(`Send ${amount(recipient.amount)} to ${String(recipient.address)}`);
      }
      break;
    case "vote":
      if (operation.entries.length === 0) {
        out.push("Withdraw the current vote");
      }
      for (const entry of operation.entries) {
        out.push(`Vote ${basisPointsText(entry.basisPoints)} for ${entry.validator}`);
      }
      break;
    case "burn":
      out.push(`Burn ${amount(operation.amount)}`);
      break;
    case "register-second-key":
      out.push(`Register the second key ${operation.publicKey}`);
      break;
    case "register-validator":
      out.push(`Register as the validator ${operation.name}`);
      break;
    case "resign-validator":
      out.push(
        operation.resignation === "revoke"
          ? "Revoke the temporary validator resignation"
          : `Resign as a validator (${operation.resignation})`,
      );
      break;
  }
  if (summary.memo !== undefined) {
    out.push(`Memo: ${summary.memo}`);
  }
  out.push(`Fee ${amount(summary.fee.amount)}`);
  // The memo, names, addresses and the token symbol all come from the transaction or the network.
  return out.map(displayText);
}


export interface SignedSummaryJson extends Omit<SignedSummary, "operation" | "nonce" | "fee" | "amount" | "memo"> {
  readonly operation: OperationJson;
  readonly nonce: string;
  readonly fee: string;
  readonly amount: string;
  readonly memo: string | null;
}


/**
 * The summary of a draft from the bindings' JSON, with the review screen's lines: amounts are
 * written by `format` (the token's decimals) and followed by `symbol`.
 */
export function summaryFromJson(json: DraftSummaryJson, symbol: string, format: (units: BaseUnits) => string): DraftSummary {
  const amount = BigInt(json.amount);
  const fee: DraftFee = {
    amount: BigInt(json.fee.amount),
    source: json.fee.source,
    ...(json.fee.floor === null ? {} : { floor: BigInt(json.fee.floor) }),
  };
  const summary: Omit<DraftSummary, "lines"> = {
    profile: json.profile,
    networkByte: json.networkByte,
    nethash: json.nethash,
    height: json.height,
    kind: json.kind,
    operation: operationFromJson(json.operation),
    from: json.from,
    publicKey: json.publicKey,
    nonce: BigInt(json.nonce),
    fee,
    ...(json.memo === null ? {} : { memo: json.memo }),
    amount,
    total: amount + fee.amount,
    size: json.size,
    secondSignature: json.secondSignature,
  };
  return Object.freeze({ ...summary, lines: Object.freeze(lines(summary, symbol, format)) });
}

/** The summary of a signed transaction from the bindings' JSON. */
export function signedSummaryFromJson(json: SignedSummaryJson): SignedSummary {
  return Object.freeze({
    ...json,
    operation: operationFromJson(json.operation),
    nonce: BigInt(json.nonce),
    fee: BigInt(json.fee),
    amount: BigInt(json.amount),
    ...(json.memo === null ? {} : { memo: json.memo }),
  } as SignedSummary);
}

/** The request of `Draft.build` in the bindings' JSON. */
export function requestJson(request: DraftRequestLike): string {
  return JSON.stringify({
    operation: operationJson(request.operation),
    memo: request.memo ?? null,
    fee: feeJson(request.fee),
  });
}

/** Refuses a nonce that is not a `bigint` of zero or more. */
export function checkNonce(facts: Pick<OnlineFacts, "nonce">): void {
  if (typeof facts.nonce !== "bigint" || facts.nonce < 0n) {
    throw new InvalidArgument("the nonce is a bigint, not negative", { nonce: String(facts.nonce) });
  }
}

/** The facts of `Draft.build` in the bindings' JSON, the sender given by its public key. */
export function factsJson(facts: Omit<OnlineFacts, "sender">, sender: string): string {
  return JSON.stringify({
    sender,
    nonce: facts.nonce.toString(),
    height: checkHeight(facts.height),
    secondKey: facts.secondKey ?? null,
  });
}

// Kept for the declarations of the types above.
export type { FeeChoice, FeeSource, Operation, OperationKind, OperationSummary, Resignation };
