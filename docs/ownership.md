# Ownership proofs of Solar addresses

The Solar network no longer runs, but its holders still hold their keys. An ownership proof lets a holder show that they control a Solar mainnet address and name the IceRoot account its holding should be bound to, without any transaction: a fixed text message signed with the Solar key. `@iceroot-network/sdk/ownership` builds, signs, checks and reads these proofs with the SDK's Rust core, in exactly the format the IceRoot Legacy Signer signs (version 1). The Rust module is `iceroot_sdk::ownership`, specified in sdk-rust's `docs/ownership-proofs.md`.

- **What a proof does.** Nothing on its own: it moves nothing and authorizes no transaction. What it is accepted for, and how old it may be, is the rule of the process that asks for it.
- **Who uses it.** The Legacy Signer, a separate extension that holds Solar keys (a Solar key is never imported into an IceRoot wallet), and the services that check its proofs. An IceRoot wallet has no use for these functions.
- **No network.** The functions need no profile and no connection: the source network is always Solar mainnet (addresses of network byte 63, starting with `S`), and the IceRoot account is written as `ice1...` (mainnet) or `tice1...` (the public testnet).

## The message

A proof message has exactly nine lines of printable ASCII, so a Ledger can show every character:

<!-- sample: plain -->
```text
IceRoot migration ownership proof
Version: 1
Source network: solar-mainnet
Source address: SNAgA2XCRZDKfm5Vu9h4KR1bZw5xn9EiC3
IceRoot account: ice1q8y55x5z8dr5uepshat727uvt328lfkklzwvvmt4p42qlcrggxtsk8zw2r
Nonce: 7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e
Issued at: 2026-09-01T12:00:00.000Z
Statement: I control the source address above and ask for its holding to be bound to the IceRoot account above.
No transaction or transfer is authorized.
```

## Signing a proof

<!-- sample: verified 0.1.0 -->
```ts
import { IceRootAccount, OwnershipProof, SolarKey } from "@iceroot-network/sdk/ownership";

const key = SolarKey.fromPassphrase(solarPassphrase);    // the Solar wallet's 12-word phrase, words joined by single spaces
try {
  const account = IceRootAccount.parse(typedAccount);    // trims, reads all capitals as lowercase, checks the checksum
  const message = OwnershipProof.build({
    address: key.address,                                 // the key's Solar mainnet address, S...
    account: account.account,
    nonce: OwnershipProof.randomNonce(),                  // or the nonce the asking process issued
    issuedAt: new Date(),
  });
  showForReview(message);                                 // the holder reads the whole message before signing
  const proof = OwnershipProof.sign(key, message, new Date());
  copyToClipboard(OwnershipProof.toJson(proof));          // the proof's JSON, byte for byte as the Legacy Signer copies it
} finally {
  key.release();                                          // wipes the key
}
```

- `SolarKey.fromPassphrase` hashes the text exactly as given (the SHA-256 of its UTF-8 bytes, as Solar derives a passphrase key). Trim a typed phrase and join its words with single spaces first, as the Legacy Signer does. A passphrase given as a `Uint8Array` is overwritten with zeros.
- `OwnershipProof.sign` checks the message first (`OwnershipProof.parse` with the key's own address), signs with fresh randomness and checks the signature before it returns the proof.

## A key held on a Ledger

The device signs the message in its own app; the SDK checks what comes back before anything is shown as a proof.

<!-- sample: verified 0.1.0 -->
```ts
import { OwnershipProof, sourceAddress } from "@iceroot-network/sdk/ownership";

const address = sourceAddress(ledgerPublicKey);           // the address the device's key proves
const proof = OwnershipProof.fromSignature(message, ledgerPublicKey, ledgerSignature, new Date());
void [address, proof];
```

`fromSignature` refuses a message that names another address than the key's, and a signature that does not verify, with `InvalidProof`.

## Checking a proof

<!-- sample: verified 0.1.0 -->
```ts
import { InvalidProof, OwnershipProof } from "@iceroot-network/sdk/ownership";

try {
  const fields = OwnershipProof.verify(pastedProof, new Date());   // the JSON text, or a proof object
  fields.address;          // the Solar mainnet address it proves
  fields.account;          // the IceRoot account it names, in lowercase
  fields.accountNetwork;   // "mainnet" or "testnet"
  fields.nonce;            // compare with the nonce the process issued
  fields.issuedAtMs;       // apply the process's own age limit
} catch (error) {
  if (error instanceof InvalidProof) {
    showRefusal(`This proof is not valid (${error.reason}).`);
  } else {
    throw error;
  }
}
```

A proof verifies when its message passes every check and names the proof's address, the address is the Solar mainnet address of the public key, and the signature is a BIP340 signature of the message's SHA-256 for that key. A message issued more than five minutes ahead of the reader's clock is refused; a message issued long ago is not, since the age limit is the asking process's rule.

`OwnershipProof.parse(message, { address }, now)` runs the message checks alone and gives the same fields, for a signer that shows a message before signing it. `OwnershipProof.fromJson(text)` reads a proof's JSON without verifying it.

## Stricter than the Legacy Signer

The SDK refuses a few messages the Legacy Signer's own checks accept, where no correct signer is affected: a source address with a bad checksum or another network byte, an issue time that is not a real date and time (30 February, 29 February of a common year, 24:00:00, which JavaScript's `Date.parse` rolls over), and a typed IceRoot account with a character outside ASCII (such as the Kelvin sign, which JavaScript lowercases to `k`). No proof a correct signer makes for a real key at a real time is refused.

## Errors

Every refusal is an `InvalidProof`, exported by `@iceroot-network/sdk/ownership`, with `reason`:

| `reason` | The check that fails |
|---|---|
| `format` | Not a proof message of a supported version: its length (at most 1,024 characters), its characters, its number of lines or its fixed text |
| `field` | A field is missing its label |
| `source-network` | The source network is not Solar mainnet |
| `address` | The source address is not a Solar mainnet address |
| `account` | The IceRoot account has a typing error, or is not in lowercase in a message |
| `nonce` | The nonce is not 64 lowercase hex digits |
| `issued-at` | The issue time is malformed, not a real date and time, or more than five minutes ahead of the clock |
| `mismatch` | The message names another address than the one expected, or the address is not the public key's |
| `key` | The public key is not 33 bytes compressed in lowercase hex |
| `signature` | The signature is malformed or does not verify |
| `json` | Not a signed proof of a supported version |

Arguments of the wrong shape throw `InvalidArgument`; signing with a released key throws `KeyReleased`.

## In a classic script

The classic-script build carries these functions as the namespace `ownership` of its global: `IceRootSdk.ownership.OwnershipProof.verify(text, new Date())` and so on.
