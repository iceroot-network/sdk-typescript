/**
 * Message signatures, made and checked in the plugin.
 *
 * @module
 */

import { toHex } from "../internal/hex.js";
import { signableMessage, verifiableMessage } from "../internal/hex.js";
import type { MessageSignature, SignedMessage } from "../messages.js";
import type { ProfileSource } from "../profiles.js";
import type { MessageAlgorithm } from "../types.js";
import { invoke } from "./invoke.js";
import { keyOf, type Account } from "./keys.js";
import { profileJson } from "./profiles.js";

export type { MessageSignature, SignedMessage } from "../messages.js";

/** The network name of message signatures on the network of `source`, such as `heartwood-devnet-v90`. */
export function messageNetworkOf(source: ProfileSource): Promise<string> {
  return invoke<string>("profile_message_network", { profile: profileJson(source) });
}

/** The algorithm of message signatures on the network of `source`, such as `secp256k1-bip340-sha256`. */
export function messageAlgorithmOf(source: ProfileSource): Promise<MessageAlgorithm> {
  return invoke<MessageAlgorithm>("profile_message_algorithm", { profile: profileJson(source) });
}

/** Signing and verifying messages. */
export const Messages = {
  /**
   * Signs `message` (text is signed as its UTF-8 bytes) with the key of `account`, in the plugin.
   * Bytes that begin with 0xff, as every transaction does, are refused with `InvalidArgument`
   * (reason `transaction-header`).
   */
  async sign(account: Account, message: string | Uint8Array): Promise<MessageSignature> {
    const key = keyOf(account);
    const bytes = signableMessage(message);
    const text = await invoke<string>("key_sign_message", { key, message: toHex(bytes) });
    return Object.freeze(JSON.parse(text) as MessageSignature);
  },

  /**
   * Whether `signed` is a valid signature. Resolves to false, never rejects, for a malformed key or
   * signature or an unknown algorithm, and for a message that begins with 0xff; the public key
   * must be a valid key. With `source`, the signature must also name that profile's network.
   */
  async verify(signed: SignedMessage, source?: ProfileSource): Promise<boolean> {
    const bytes = verifiableMessage(signed.message);
    if (bytes === undefined) {
      return false;
    }
    if (source !== undefined) {
      let network: string;
      try {
        network = await messageNetworkOf(source);
      } catch {
        return false;
      }
      if (signed.network !== network) {
        return false;
      }
    }
    return invoke<boolean>("message_verify", {
      message: toHex(bytes),
      publicKey: signed.publicKey,
      signature: signed.signature,
      algorithm: signed.algorithm,
    });
  },
} as const;
