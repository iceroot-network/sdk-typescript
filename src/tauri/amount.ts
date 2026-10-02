/**
 * Exact amounts, parsed and written by the plugin. Amounts are `bigint` base units everywhere.
 *
 * @module
 */

import type { AmountFormatOptions, Decimals } from "../amount.js";
import { checkDecimals, formatArgs } from "../internal/amount-args.js";
import type { BaseUnits } from "../types.js";
import { invoke } from "./invoke.js";

export { AssetId } from "../amount.js";
export type { AmountFormatOptions, AssetAmount, Decimals, TokenInfo } from "../amount.js";

/** Exact amounts: decimal text to base units and back. */
export const Amount = {
  /**
   * The base units of the decimal `text` of an asset with `decimals` fraction digits, such as
   * `await Amount.parse("1.5", 8) === 150000000n`. Refuses signs, exponents, empty parts and more
   * fraction digits than the asset has.
   */
  async parse(text: string, decimals: Decimals): Promise<BaseUnits> {
    const places = checkDecimals(decimals);
    return BigInt(await invoke<string>("amount_parse", { text, decimals: places }));
  },

  /** `units` base units as decimal text with `decimals` fraction digits, such as `"1.5"`. */
  async format(units: BaseUnits, decimals: Decimals, options: AmountFormatOptions = {}): Promise<string> {
    const args = formatArgs(units, decimals, options);
    return invoke<string>("amount_format", {
      units: args.units,
      decimals: args.decimals,
      maxFraction: args.maxFraction ?? null,
      grouping: args.grouping,
    });
  },
} as const;
