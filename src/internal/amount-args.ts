// The arguments of amount parsing and formatting, checked the same way by the WebAssembly entry and
// the Tauri plugin's entry.

import type { AmountFormatOptions, Decimals } from "../amount.js";
import { InvalidAmount, InvalidArgument } from "../errors.js";
import type { BaseUnits } from "../types.js";

const MAX_DECIMALS = 38;
const MAX_UNITS = (1n << 128n) - 1n;

/** `decimals` if it is a number of fraction digits an asset may have. */
export function checkDecimals(decimals: Decimals): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new InvalidArgument(`decimals are an integer from 0 to ${MAX_DECIMALS}`, { decimals });
  }
  return decimals;
}

/** The arguments of `Amount.format`, checked, as the bindings take them. */
export function formatArgs(
  units: BaseUnits,
  decimals: Decimals,
  options: AmountFormatOptions,
): { units: string; decimals: number; maxFraction: number | undefined; grouping: boolean } {
  const places = checkDecimals(decimals);
  if (typeof units !== "bigint" || units < 0n || units > MAX_UNITS) {
    throw new InvalidAmount("an amount is a bigint from 0 to 2^128 - 1", { units: String(units) });
  }
  const maxFraction = options.maxFraction;
  if (maxFraction !== undefined && (!Number.isInteger(maxFraction) || maxFraction < 0 || maxFraction > 255)) {
    throw new InvalidArgument("maxFraction is an integer from 0 to 255", { maxFraction });
  }
  return { units: units.toString(), decimals: places, maxFraction, grouping: options.grouping ?? false };
}
