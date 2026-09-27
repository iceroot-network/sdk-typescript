import { useEffect, useState } from "react";
import type { Account } from "@iceroot-network/sdk";

import { Create, Restore, Welcome } from "./Setup";
import { Unlock } from "./Unlock";
import { Wallet } from "./Wallet";
import { loadWallet, removeWallet, type StoredWallet } from "./storage";

export function App() {
  const [wallet, setWallet] = useState<StoredWallet | null>(loadWallet);
  const [account, setAccount] = useState<Account | null>(null);
  const [setup, setSetup] = useState<"create" | "restore" | null>(null);

  // The key lives in WebAssembly memory while the wallet is unlocked; locking, a new account or
  // closing the page wipes it.
  useEffect(() => () => account?.release(), [account]);

  function opened(account: Account) {
    setWallet(loadWallet());
    setSetup(null);
    setAccount(account);
  }

  if (account !== null && wallet !== null) {
    return <Wallet account={account} onLock={() => setAccount(null)} />;
  }
  if (wallet !== null) {
    return (
      <Unlock
        wallet={wallet}
        onUnlocked={opened}
        onRemove={() => {
          removeWallet(wallet.address);
          setWallet(null);
        }}
      />
    );
  }
  if (setup === "create") return <Create onCreated={opened} onCancel={() => setSetup(null)} />;
  if (setup === "restore") return <Restore onRestored={opened} onCancel={() => setSetup(null)} />;
  return <Welcome onCreate={() => setSetup("create")} onRestore={() => setSetup("restore")} />;
}
