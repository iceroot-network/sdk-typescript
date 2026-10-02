// What the wallet keeps in the browser: the keystore (the recovery phrase's entropy encrypted
// under the holder's password), the account's address, the pinned network identity and the last
// vote selection. None of it is secret without the password: the phrase itself and keys are never
// stored. A real wallet keeps the keystore where its platform keeps secrets best.

const PREFIX = "iceroot.example.";

/** A wallet kept in this browser. */
export interface StoredWallet {
  /** The keystore, in its `irks:` text form. */
  readonly keystore: string;
  /** The address of account 0, index 0, shown before unlocking. */
  readonly address: string;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  if (value === null) {
    localStorage.removeItem(PREFIX + key);
  } else {
    localStorage.setItem(PREFIX + key, value);
  }
}

export function loadWallet(): StoredWallet | null {
  const text = read("wallet");
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && "keystore" in value && "address" in value) {
      const { keystore, address } = value;
      if (typeof keystore === "string" && typeof address === "string") return { keystore, address };
    }
  } catch {
    // Not a wallet this page wrote.
  }
  return null;
}

/** Keeps the wallet. Throws when the browser refuses to store it, so the holder is told. */
export function saveWallet(wallet: StoredWallet): void {
  write("wallet", JSON.stringify(wallet));
}

export function removeWallet(address: string): void {
  write("wallet", null);
  write(`selection.${address}`, null);
}

/** The network identity pinned on first contact: public, not a secret. */
export function loadNethash(): string | undefined {
  return read("nethash") ?? undefined;
}

export function saveNethash(nethash: string): void {
  try {
    write("nethash", nethash);
  } catch {
    // Without storage the identity is pinned for this page only.
  }
}

export function forgetNethash(): void {
  try {
    write("nethash", null);
  } catch {
    // Nothing was stored.
  }
}

/** The last selection an account voted with, as `Selection.serialize` wrote it. */
export function loadSelection(address: string): string | null {
  return read(`selection.${address}`);
}

export function saveSelection(address: string, selection: string): void {
  try {
    write(`selection.${address}`, selection);
  } catch {
    // The check of a later visit is then unavailable; the vote itself is on chain.
  }
}
