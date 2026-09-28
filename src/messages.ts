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
import { call, parse } from "./internal/bindings.js";
import { signableMessage, verifiableMessage } from "./internal/hex.js";
import { profileHandleOf, type ProfileSource } from "./profiles.js";
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

/** The network name of message signatures on the network of `source`, such as `heartwood-devnet-v90`. */
export function messageNetworkOf(source: ProfileSource): string {
  return call(() => profileHandleOf(source).messageNetwork());
}

/** The algorithm of message signatures on the network of `source`, such as `secp256k1-bip340-sha256`. */
export function messageAlgorithmOf(source: ProfileSource): MessageAlgorithm {
  return call(() => profileHandleOf(source).messageAlgorithm()) as MessageAlgorithm;
}

/** Signing and verifying messages. */
export const Messages = {
  /**
   * Signs `message` (text is signed as its UTF-8 bytes) with the key of `account`.
   *
   * A message given as bytes must be UTF-8 text, or it is refused with `InvalidArgument`: in
   * today's format a message signature over a transaction's unsigned bytes would be a valid
   * signature of the transaction, and every transaction begins with the byte 0xff, which UTF-8
   * text never contains. Sign only messages the holder was shown as text.
   */
  sign(account: Account, message: string | Uint8Array): MessageSignature {
    const handle = keyHandleOf(account);
    const bytes = signableMessage(message);
    return Object.freeze(parse<MessageSignature>(call(() => handle.signMessage(bytes))));
  },

  /**
   * Whether `signed` is a valid signature. Returns false, never throws, for a malformed key or
   * signature or an unknown algorithm, and for a message given as bytes that are not UTF-8 text,
   * which no message signature covers (see {@link Messages.sign}); the public key must be a valid
   * key. With
   * `source`, the signature must also name that profile's network.
   *
   * The signature covers the message only: `network` and `algorithm` are labels beside it. A
   * protocol that must bind a message to one network names the network in the message's text,
   * as the sign-in message does.
   */
  verify(signed: SignedMessage, source?: ProfileSource): boolean {
    const bytes = verifiableMessage(signed.message);
    if (bytes === undefined) {
      return false;
    }
    if (source !== undefined) {
      let network: string;
      try {
        network = messageNetworkOf(source);
      } catch {
        return false;
      }
      if (signed.network !== network) {
        return false;
      }
    }
    return call((module) =>
      module.verifyMessage(bytes, signed.publicKey, signed.signature, signed.algorithm),
    );
  },
} as const;
