/**
 * Amounts and assets.
 *
 * Amounts are `bigint` base units everywhere; no function takes or returns a floating-point
 * amount. An asset is identified by its asset id, never by its symbol. Parsing and formatting
 * arrive with the Rust core; this module defines the types they use.
 *
 * @module
 */

import type { BaseUnits } from "./types.js";

/** An asset id. ROOT has a reserved id. */
export type AssetId = string & { readonly __assetId: unique symbol };

/** The number of fraction digits of an asset: 8 for ROOT on the devnets of today, 18 from ID. */
export type Decimals = number;

/** Options of amount formatting. */
export interface AmountFormatOptions {
  /** Show at most this many fraction digits, rounding towards zero. */
  readonly maxFraction?: number;
  /** Group the whole part in thousands. */
  readonly grouping?: boolean;
}

/** The native token of a network, as `net.token` reports it. */
export interface TokenInfo {
  /** The asset id of ROOT. */
  readonly assetId: AssetId;
  /** `ROOT`. */
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
