import { useEffect, useState } from "react";
import { balanceOf, type AccountInfo, type Network, type TxRecord } from "@iceroot-network/sdk";

import { amount, problem, safeText } from "./format";
import { useNetwork } from "./network";

type Loaded = { readonly info: AccountInfo; readonly history: readonly TxRecord[] };

/** What a transaction did to this account, in one line. */
function describe(net: Network, tx: TxRecord, address: string): string {
  const details = tx.details;
  switch (details.kind) {
    case "transfer": {
      const paid = details.recipients.filter((payment) => tx.direction !== "received" || payment.address === address);
      const total = paid.reduce((sum, payment) => sum + payment.amount, 0n);
      const who = tx.direction === "received" ? `from ${safeText(tx.sender)}` : `to ${details.recipients.length === 1 ? safeText(details.recipients[0]!.address) : `${details.recipients.length} recipients`}`;
      return `${tx.direction === "received" ? "Received" : "Sent"} ${amount(net, total)} ${who}`;
    }
    case "vote":
      return details.entries.length === 0 ? "Withdrew the vote" : `Voted for ${details.entries.length} validators`;
    case "register-validator":
      return `Registered as validator ${safeText(details.name)}`;
    case "resign-validator":
      return `Validator resignation (${details.resignation})`;
    case "burn":
      return `Burned ${amount(net, details.amount)}`;
    case "register-second-key":
      return "Registered a second key";
    default:
      return "Other transaction";
  }
}

export function Overview({ address, version }: { address: string; version: number }) {
  const net = useNetwork();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([net.accounts.get(address), net.history.forAccount(address, { page: 1, limit: 20 })]).then(
      ([info, page]) => {
        if (!live) return;
        setLoaded({ info, history: page.items });
        setFailure("");
      },
      (error: unknown) => live && setFailure(problem(error, "The account could not be read")),
    );
    return () => {
      live = false;
    };
  }, [net, address, version, reload]);

  // Never show old figures as current: a failed read is an error with a retry.
  if (failure) {
    return (
      <section>
        <p role="alert">{failure}</p>
        <button onClick={() => setReload((value) => value + 1)}>Try again</button>
      </section>
    );
  }
  if (loaded === null) return <p role="status">Reading the account</p>;
  const { info, history } = loaded;
  return (
    <section>
      <h2>Balance</h2>
      <p className="balance" aria-label="Balance">
        {amount(net, balanceOf(info))}
      </p>
      <p>{info.vote.length === 0 ? "This account does not vote." : `This account votes for ${info.vote.length} validators.`}</p>
      <button className="secondary" onClick={() => setReload((value) => value + 1)}>
        Refresh
      </button>
      <h2>History</h2>
      {history.length === 0 ? (
        <p>No transactions yet.</p>
      ) : (
        <ul className="history" aria-label="History">
          {history.map((tx) => (
            <li key={tx.id}>
              <span>{describe(net, tx, address)}</span>
              {tx.memo && <span className="memo">{safeText(tx.memo)}</span>}
              <span className="meta">
                {tx.block ? `Block ${tx.block.height}` : "Pending"}
                {tx.direction !== "received" && ` · fee ${amount(net, tx.fee)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
