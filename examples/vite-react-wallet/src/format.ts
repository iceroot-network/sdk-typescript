import { Amount, IceRootError, type Network } from "@iceroot-network/sdk";

/** An amount of the network's token, grouped, with its symbol. */
export function amount(net: Network, units: bigint): string {
  return `${Amount.format(units, net.token.decimals, { grouping: true })} ${net.token.symbol}`;
}

/**
 * Text from the chain or the node, made safe to show: a memo, a validator's name, an address in a
 * record, a node's message. Control characters, line and paragraph separators and bidirectional
 * formatting characters are written as `\uXXXX`, and a backslash as `\\`, as the SDK writes the
 * lines of `draft.summary`. React escapes HTML already; this stops text that reorders or splits
 * what the holder reads, such as a memo with U+202E that shows an address backwards.
 */
export function safeText(text: string): string {
  return text.replace(/[\\\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu, (char) =>
    char === "\\" ? "\\\\" : `\\u${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
  );
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
