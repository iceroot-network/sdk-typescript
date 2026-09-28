/**
 * Amounts and assets.
 *
 * Amounts are `bigint` base units everywhere; no function takes or returns a floating-point
 * amount. An asset is identified by its asset id, never by its symbol.
 *
 * @module
 */

import { checkDecimals, formatArgs } from "./internal/amount-args.js";
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
    const args = formatArgs(units, decimals, options);
    return call((module) => module.formatAmount(args.units, args.decimals, args.maxFraction, args.grouping));
  },
} as const;
