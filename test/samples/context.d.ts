// The names the documentation's fragments take from the text around them: what an earlier sample
// or the surrounding prose defines. scripts/check-samples.mjs compiles every fragment with these,
// so a fragment that uses an SDK call wrongly fails, while the reader's own variables resolve.

// The network, as `connect` returns it, and the values a page already holds.
declare const net: import("@iceroot-network/sdk").Network;
declare const profile: import("@iceroot-network/sdk").NetworkProfile;
declare const configuration: string;
declare const account: import("@iceroot-network/sdk").Account;
declare const secondAccount: import("@iceroot-network/sdk").Account;
declare const from: import("@iceroot-network/sdk").Account;
declare const draft: import("@iceroot-network/sdk").Draft;
declare const phrase: string;

// Values from the user or from storage.
declare const address: string;
declare const recipient: string;
declare const publicKey: string;
declare const text: string;
declare const message: string;
declare const userInput: string;
declare const amount: bigint;
declare const id: string;
declare const heightOrId: number | bigint | string;
declare const nameOrAddress: string;
declare const validatorName: string;
declare const roundNumber: number;
declare const relay: string;
declare const pinnedNethash: string;
declare const savedNethash: string | undefined;
declare const token: string;
declare const senderOrigin: string;
declare const nonce: string;
declare const issuedAt: Date;
declare const expiresAt: Date;
declare const wasmUrl: URL;
declare const bytes: Uint8Array;

// The app's own functions.
declare function loadPinnedNethash(): string | undefined;
declare function savePinnedNethash(nethash: string): void;
declare function showRefusal(reason: string): void;
declare function showForApproval(summary: import("@iceroot-network/sdk").DraftSummary): void;
declare function showRetry(message: string): void;

// The vote library's values an earlier sample made.
declare const snapshot: import("@iceroot-network/sdk/vote").VoteSnapshot;
declare const selection: import("@iceroot-network/sdk/vote").Selection;

// A keystore the app stored, and passwords the holder typed.
declare const stored: Uint8Array;
declare const password: Uint8Array;
declare const newPassword: Uint8Array;
