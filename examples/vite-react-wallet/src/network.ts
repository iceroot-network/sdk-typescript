import { createContext, useContext } from "react";
import { connect, init, profiles, type Network } from "@iceroot-network/sdk";

import { loadNethash, saveNethash } from "./storage";

/** The devnet relay, API base path included. */
export const RELAY = import.meta.env.VITE_ICEROOT_RELAY ?? "http://127.0.0.1:6003/api";

/**
 * Loads the SDK's WebAssembly module and connects to the devnet. The network's identity is pinned
 * on first contact; a devnet that was reset since then is refused with `NetworkMismatch`.
 */
export async function openNetwork(): Promise<Network> {
  await init();
  const net = await connect(profiles.devnet({ relays: [RELAY], nethash: loadNethash() }));
  saveNethash(net.chain.nethash);
  return net;
}

export const NetworkContext = createContext<Network | null>(null);

export function useNetwork(): Network {
  const net = useContext(NetworkContext);
  if (net === null) throw new Error("useNetwork outside NetworkContext");
  return net;
}
