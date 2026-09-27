// Compiled against the published declarations (dist/web/*.d.ts) through the package's exports, as
// an app sees them. Nothing here runs; the compiler checks the public types.

import {
  Account,
  Address,
  IceRootError,
  InvalidAddress,
  Keys,
  Messages,
  init,
  initSync,
  profiles,
  type AddressCheck,
  type Draft,
  type ErrorCode,
  type MessageSignature,
  type NetworkProfile,
  type Transport,
} from "@iceroot-network/sdk";
import type { Mode, Selection, VoteSnapshot } from "@iceroot-network/sdk/vote";

export async function example(bytes: Uint8Array, transport: Transport): Promise<string> {
  await init();
  await init(new URL("https://example.com/iceroot_sdk_bg.wasm"));
  initSync(bytes);

  const devnet: NetworkProfile = profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });
  const account: Account = Keys.fromLegacyPassphrase("passphrase", devnet);
  const signed: MessageSignature = Messages.sign(account, "hello");
  const valid: boolean = Messages.verify({ ...signed, message: "hello" }, devnet);
  const check: AddressCheck = Address.check(account.address, { profile: devnet });
  account.release();

  try {
    Address.parse("d...", devnet);
  } catch (error) {
    if (error instanceof InvalidAddress) {
      const reason: "checksum" | "length" | "wrong-network" | "format" = error.reason;
      return reason;
    }
    if (error instanceof IceRootError) {
      const code: ErrorCode = error.code;
      return code;
    }
  }
  void transport;
  return `${valid} ${check.ok}`;
}

export type Uses = [Draft, Mode, Selection, VoteSnapshot];
