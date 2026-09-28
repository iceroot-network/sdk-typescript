import { Amount, IceRootError, type Network } from "@iceroot-network/sdk";

/** An amount of the network's token, grouped, with its symbol. */
export function amount(net: Network, units: bigint): string {
  return `${Amount.format(units, net.token.decimals, { grouping: true })} ${net.token.symbol}`;
}

/** A share of a vote: 500 basis points are 5%. */
export function share(basisPoints: number): string {
  return `${basisPoints / 100}%`;
}

/** A sentence for an error the holder should see. */
export function problem(error: unknown, fallback: string): string {
  if (error instanceof IceRootError) {
    switch (error.code) {
      case "NodeUnavailable":
      case "Timeout":
      case "BadResponse":
      case "RateLimited":
        return "The network is unavailable. Try again in a moment.";
      // The node's own text stays out of the wallet's words.
      case "Refused":
      case "NotFound":
        return `${fallback}: the network refused the request.`;
      case "NetworkMismatch":
        return `${fallback}: the network is not the one this wallet was set up for.`;
      default:
        return `${fallback} (${error.message}).`;
    }
  }
  return `${fallback}.`;
}

/** Runs `work` after the browser has painted, so a "working" message shows before a long computation. */
export function afterPaint<T>(work: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() =>
      setTimeout(() => {
        try {
          resolve(work());
        } catch (error) {
          reject(error);
        }
      }, 0),
    );
  });
}
