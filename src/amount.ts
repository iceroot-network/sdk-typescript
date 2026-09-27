/**
 * Amounts and assets.
 *
 * Amounts are `bigint` base units everywhere; no function takes or returns a floating-point
 * amount. An asset is identified by its asset id, never by its symbol.
 *
 * @module
 */

import { InvalidAmount, InvalidArgument } from "./errors.js";
import { call } from "./internal/bindings.js";
import type { BaseUnits } from "./types.js";

/** An asset id: `ROOT` for the network's own asset, 64 hex digits for others (from the AC stage). */
export type AssetId = string & { readonly __assetId: unique symbol };

/** The number of fraction digits of an asset: 8 for ROOT on the devnets of today, 18 from ID. */
export type Decimals = number;

/** Options of amount formatting. */
export interface AmountFormatOptions {
  /** Show at most this many fraction digits, cutting further digits off (never rounding up). */
  readonly maxFraction?: number;
  /** Group the whole part in thousands with commas. */
  readonly grouping?: boolean;
}

/** The native token of a network, as a chain reports it. */
export interface TokenInfo {
  /** The asset id of ROOT. */
  readonly assetId: AssetId;
  /** The name the network's configuration gives it. */
  readonly name: string;
  /** The symbol the network's configuration gives it. */
  readonly symbol: string;
  /** Fraction digits. */
  readonly decimals: Decimals;
}

/** An amount of one asset. */
export interface AssetAmount {
  /** The asset. */
  readonly assetId: AssetId;
  /** The amount in base units. */
  readonly amount: BaseUnits;
}

/** Asset ids. */
export const AssetId = Object.freeze({
  /** The network's own asset, ROOT. */
  ROOT: "ROOT" as AssetId,
});

const MAX_DECIMALS = 38;
const MAX_UNITS = (1n << 128n) - 1n;

function checkDecimals(decimals: Decimals): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new InvalidArgument(`decimals are an integer from 0 to ${MAX_DECIMALS}`, { decimals });
  }
  return decimals;
}

/** Exact amounts: decimal text to base units and back. */
export const Amount = {
  /**
   * The base units of the decimal `text` of an asset with `decimals` fraction digits, such as
   * `Amount.parse("1.5", 8) === 150000000n`. Refuses signs, exponents, empty parts and more
   * fraction digits than the asset has.
   */
  parse(text: string, decimals: Decimals): BaseUnits {
    const places = checkDecimals(decimals);
    return BigInt(call((module) => module.parseAmount(text, places)));
  },

  /** `units` base units as decimal text with `decimals` fraction digits, such as `"1.5"`. */
  format(units: BaseUnits, decimals: Decimals, options: AmountFormatOptions = {}): string {
    const places = checkDecimals(decimals);
    if (typeof units !== "bigint" || units < 0n || units > MAX_UNITS) {
      throw new InvalidAmount("an amount is a bigint from 0 to 2^128 - 1", { units: String(units) });
    }
    const maxFraction = options.maxFraction;
    if (maxFraction !== undefined && (!Number.isInteger(maxFraction) || maxFraction < 0 || maxFraction > 255)) {
      throw new InvalidArgument("maxFraction is an integer from 0 to 255", { maxFraction });
    }
    return call((module) => module.formatAmount(units.toString(), places, maxFraction, options.grouping ?? false));
  },
} as const;
