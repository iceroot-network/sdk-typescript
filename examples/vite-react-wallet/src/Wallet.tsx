import { useState } from "react";
import type { Account } from "@iceroot-network/sdk";

import { Overview } from "./Overview";
import { Send } from "./Send";
import { SignInPage } from "./SignIn";
import { Vote } from "./Vote";

const TABS = ["Overview", "Send", "Vote", "Sign in"] as const;
type Tab = (typeof TABS)[number];

export function Wallet({ account, onLock }: { account: Account; onLock: () => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  // Bumped after each confirmed transaction, so the overview reads the account again.
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((value) => value + 1);

  return (
    <div className="wallet">
      <header>
        <div>
          <span className="label">Account</span>
          <p className="address" aria-label="Account address">
            {account.address}
          </p>
        </div>
        <button className="secondary" onClick={onLock}>
          Lock
        </button>
      </header>
      <nav role="tablist">
        {TABS.map((name) => (
          <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      <main>
        {tab === "Overview" && <Overview address={account.address} version={version} />}
        {tab === "Send" && <Send account={account} onChanged={changed} />}
        {tab === "Vote" && <Vote account={account} onChanged={changed} />}
        {tab === "Sign in" && <SignInPage account={account} />}
      </main>
    </div>
  );
}
