import { IceRootError, type Account, type Draft, type Network } from "@iceroot-network/sdk";

import { problem, safeText } from "./format";

/** How a submission ended, in a sentence for the holder. */
export type Outcome = { readonly ok: boolean; readonly text: string };

/**
 * Signs the draft the holder reviewed, submits it and follows it into a block. Says "confirmed",
 * never "final", on a network without finality.
 */
export async function signAndSubmit(net: Network, draft: Draft, account: Account, progress: (text: string) => void): Promise<Outcome> {
  try {
    const signed = draft.sign(account);
    const result = await net.submit(signed);
    if (result.status !== "accepted") {
      return {
        ok: false,
        text:
          result.reason === "nonce"
            ? "The account sent another transaction meanwhile. Review it again."
            : `The network refused it (${result.reason}, ${safeText(result.nodeCode)}): ${safeText(result.message)}`,
      };
    }
    progress("Submitted. Waiting for a block.");
    const outcome = await net.transactions.wait(signed.id, { until: "confirmed" });
    if (outcome.state === "dropped") return { ok: false, text: "The network dropped it. Review it again." };
    const finality = net.capabilities.has("finality") ? "" : " Not final: this devnet has no finality.";
    return { ok: true, text: `Confirmed in block ${outcome.record.block?.height ?? "?"}.${finality}` };
  } catch (error) {
    if (error instanceof IceRootError && error.code === "Timeout") {
      return { ok: false, text: "No block has included it yet. Check the history later." };
    }
    return { ok: false, text: problem(error, "It could not be sent") };
  }
}
