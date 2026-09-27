/**
 * Message signatures.
 *
 * On the devnets of today a message signature is BIP340 over the SHA-256 of the message's exact
 * UTF-8 bytes, which is the reference implementation's message signing. The message is always
 * hashed first, including a message of exactly 32 bytes.
 *
 * @module
 */

import { keyHandleOf, type Account } from "./keys.js";
import { call } from "./internal/bindings.js";
import { fromHex, messageBytes, toHex } from "./internal/hex.js";
import { networkByteOf, profileOf, type NetworkProfile, type ProfileSource } from "./profiles.js";
import type { Hex, MessageAlgorithm } from "./types.js";

/** A signed message, in the shape the wallets and the validator portal exchange. */
export interface MessageSignature {
  /** The signer's public key, as lowercase hex. */
  readonly publicKey: Hex;
  /** The signature, as lowercase hex. */
  readonly signature: Hex;
  /** The signature algorithm. */
  readonly algorithm: MessageAlgorithm;
  /** The network the signature was made for, such as `heartwood-devnet-v90`. */
  readonly network: string;
}

/** What {@link Messages.verify} checks. */
export interface SignedMessage {
  /** The message, as text (signed as its UTF-8 bytes) or as bytes. */
  readonly message: string | Uint8Array;
  /** The signer's public key, as hex. */
  readonly publicKey: Hex;
  /** The signature, as hex. */
  readonly signature: Hex;
  /** The signature algorithm. */
  readonly algorithm: string;
  /** The network the signature was made for. */
  readonly network: string;
}

const S1_ALGORITHM: MessageAlgorithm = "secp256k1-bip340-sha256";

/** The network name of message signatures on `profile`, such as `heartwood-devnet-v90`. */
export function messageNetworkOf(profile: NetworkProfile): string {
  return `heartwood-${profile.id}-v${networkByteOf(profile, "message-signing")}`;
}

/** Signing and verifying messages. */
export const Messages = {
  /** Signs `message` (text is signed as its UTF-8 bytes) with the key of `account`. */
  sign(account: Account, message: string | Uint8Array): MessageSignature {
    const network = messageNetworkOf(account.profile);
    const handle = keyHandleOf(account);
    const signature = call(() => handle.signMessage(messageBytes(message)));
    return {
      publicKey: account.publicKey,
      signature: toHex(signature),
      algorithm: S1_ALGORITHM,
      network,
    };
  },

  /**
   * Whether `signed` is a valid signature. Returns false, never throws, for a malformed key or
   * signature or an unknown algorithm. With `source`, the signature must also name that
   * profile's network.
   */
  verify(signed: SignedMessage, source?: ProfileSource): boolean {
    if (signed.algorithm !== S1_ALGORITHM) {
      return false;
    }
    if (source !== undefined && signed.network !== messageNetworkOf(profileOf(source))) {
      return false;
    }
    const publicKey = fromHex(signed.publicKey);
    const signature = fromHex(signed.signature);
    if (publicKey === undefined || signature === undefined) {
      return false;
    }
    return call((module) => module.verifyMessage(messageBytes(signed.message), publicKey, signature));
  },
} as const;
