import { useState, type FormEvent } from "react";
import type { Account } from "@iceroot-network/sdk";
import { WrongPasswordOrCorrupt } from "@iceroot-network/sdk/keystore";

import { afterPaint, problem } from "./format";
import { useNetwork } from "./network";
import type { StoredWallet } from "./storage";

export function Unlock({ wallet, onUnlocked, onRemove }: { wallet: StoredWallet; onUnlocked: (account: Account) => void; onRemove: () => void }) {
  const net = useNetwork();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [removing, setRemoving] = useState(false);

  function unlock(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setWorking(true);
    afterPaint(() => {
      // The account opens straight from the keystore: the phrase never reaches JavaScript, and the
      // password's bytes are overwritten with zeros once read.
      const account = net.keys.fromKeystore(wallet.keystore, new TextEncoder().encode(password), { account: 0, index: 0 });
      if (account.address !== wallet.address) {
        account.release();
        throw new Error("the keystore holds another account");
      }
      return account;
    }).then(
      (account) => {
        setPassword("");
        onUnlocked(account);
      },
      (error: unknown) => {
        setWorking(false);
        setMessage(error instanceof WrongPasswordOrCorrupt ? "Wrong password." : problem(error, "The wallet could not be opened"));
      },
    );
  }

  return (
    <main className="card">
      <h1>Unlock your wallet</h1>
      <p className="address">{wallet.address}</p>
      <form onSubmit={unlock}>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        {message && <p role="alert">{message}</p>}
        {working && <p role="status">Opening the keystore</p>}
        <div className="actions">
          <button type="submit" disabled={working}>
            Unlock
          </button>
        </div>
      </form>
      {removing ? (
        <div className="danger">
          <p>Remove the wallet from this browser? Only its recovery phrase can restore it.</p>
          <div className="actions">
            <button className="secondary" onClick={onRemove}>
              Remove it
            </button>
            <button onClick={() => setRemoving(false)}>Keep it</button>
          </div>
        </div>
      ) : (
        <button className="link" onClick={() => setRemoving(true)}>
          Remove this wallet from the browser
        </button>
      )}
    </main>
  );
}
