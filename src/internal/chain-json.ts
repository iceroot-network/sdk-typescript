// A chain's rules, economics and token in the JSON the bindings write, shared by the WebAssembly
// entry and the Tauri plugin's entry.

import type { AssetId, TokenInfo } from "../amount.js";
import type { Economics, Rules } from "../chain.js";
import { BadResponse, InvalidArgument } from "../errors.js";

export interface RulesJson extends Omit<Rules, "transfer" | "burn" | "maxAmount"> {
  readonly transfer: Omit<Rules["transfer"], "minAmount"> & { readonly minAmount: string };
  readonly burn: { readonly minAmount: string };
  readonly maxAmount: string;
}

export interface EconomicsJson extends Omit<Economics, "rewardsByRank" | "secondaryReward" | "minBurn"> {
  readonly rewardsByRank: readonly { readonly rank: number; readonly reward: string | null }[];
  readonly secondaryReward: string | null;
  readonly minBurn: string;
}

/** The rules in the bindings' JSON text. */
export function rulesFromJson(text: string): Rules {
  const json = JSON.parse(text) as RulesJson;
  return {
    ...json,
    transfer: { ...json.transfer, minAmount: BigInt(json.transfer.minAmount) },
    burn: { minAmount: BigInt(json.burn.minAmount) },
    maxAmount: BigInt(json.maxAmount),
  };
}

/** The economics in the bindings' JSON text. */
export function economicsFromJson(text: string): Economics {
  const json = JSON.parse(text) as EconomicsJson;
  return {
    ...json,
    rewardsByRank: json.rewardsByRank.map(({ rank, reward }) => ({
      rank,
      reward: reward === null ? null : BigInt(reward),
    })),
    secondaryReward: json.secondaryReward === null ? null : BigInt(json.secondaryReward),
    minBurn: BigInt(json.minBurn),
  };
}

/**
 * The token's labels the SDK shows, as the Rust SDK checks them: a symbol of 1 to 10 ASCII letters
 * and digits, and a name of 1 to 32 ASCII letters, digits, `-` and `.`, with single spaces between
 * words. They come from the network configuration a relay serves or a draft carries, which the
 * pinned network hash does not cover, and the symbol is written into every amount of a draft's
 * review lines.
 */
const TOKEN_SYMBOL = /^[A-Za-z0-9]{1,10}$/;
const TOKEN_NAME = /^[A-Za-z0-9.-]+( [A-Za-z0-9.-]+)*$/;

/** The token in the bindings' JSON text. Labels other than those above are refused with `BadResponse`. */
export function tokenFromJson(text: string): TokenInfo {
  const token = JSON.parse(text) as { assetId: string; name: string; symbol: string; decimals: number };
  if (typeof token.symbol !== "string" || !TOKEN_SYMBOL.test(token.symbol)) {
    const reason = "the token symbol is not 1 to 10 ASCII letters and digits";
    throw new BadResponse(reason, { reason });
  }
  if (typeof token.name !== "string" || token.name.length > 32 || !TOKEN_NAME.test(token.name)) {
    const reason = "the token name is not 1 to 32 ASCII letters, digits, '-' and '.', with single spaces between words";
    throw new BadResponse(reason, { reason });
  }
  return Object.freeze({ ...token, assetId: token.assetId as AssetId });
}

/** `height` if it is a block height the SDK accepts. */
export function checkHeight(height: number): number {
  if (!Number.isInteger(height) || height < 1 || height > 0xffffffff) {
    throw new InvalidArgument("a height is an integer from 1 to 4294967295", { height });
  }
  return height;
}
