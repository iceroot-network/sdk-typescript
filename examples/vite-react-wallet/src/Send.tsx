import { useState, type FormEvent } from "react";
import { Address, Amount, type Account, type Draft } from "@iceroot-network/sdk";

import { amount, problem } from "./format";
import { useNetwork } from "./network";
import { signAndSubmit, type Outcome } from "./submit";

type Row = { readonly key: number; readonly address: string; readonly amount: string };

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, address: "", amount: "" });

export function Send({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const net = useNetwork();
  const { decimals, symbol } = net.token;
  const maxRecipients = net.rules.transfer.maxRecipients;
  const maxMemoBytes = net.rules.memo.maxBytes;
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [memo, setMemo] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const update = (key: number, change: Partial<Row>) => setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  async function review(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setOutcome(null);
    const to = [];
    for (const [index, row] of rows.entries()) {
      const check = Address.check(row.address.trim(), net);
      if (!check.ok) return setMessage(`Check the address of recipient ${index + 1} (${check.reason}).`);
      let units: bigint;
      try {
        units = Amount.parse(row.amount.trim(), decimals);
      } catch {
        return setMessage(`Enter the amount of recipient ${index + 1} in ${symbol}, with at most ${decimals} decimal places.`);
      }
      to.push({ address: Address.parse(row.address.trim(), net), amount: units });
    }
    if (new TextEncoder().encode(memo).length > maxMemoBytes) return setMessage(`A memo holds at most ${maxMemoBytes} bytes.`);
    setWorking(true);
    try {
      // The builder reads the nonce and the fee floor from the network. It needs no key, only the
      // sender's public key; the key signs later, after the review.
      setDraft(await net.build.transfer({ from: account.publicKey, to, memo: memo.trim() }));
    } catch (error) {
      setMessage(problem(error, "The transfer could not be prepared"));
    } finally {
      setWorking(false);
    }
  }

  async function confirm() {
    if (draft === null) return;
    setWorking(true);
    setMessage("Signing and submitting.");
    const result = await signAndSubmit(net, draft, account, setMessage);
    setWorking(false);
    setMessage("");
    setOutcome(result);
    setDraft(null);
    if (result.ok) {
      setRows([emptyRow()]);
      setMemo("");
      onChanged();
    }
  }

  if (draft !== null) {
    const summary = draft.summary;
    return (
      <section>
        <h2>Review the transfer</h2>
        <p>This is exactly what you sign:</p>
        <ul className="lines" aria-label="What you sign">
          {summary.lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <dl className="facts">
          <dt>Fee</dt>
          <dd>{amount(net, draft.fee)}</dd>
          <dt>Total leaving the account</dt>
          <dd>{amount(net, summary.total)}</dd>
        </dl>
        {message && <p role="status">{message}</p>}
        <div className="actions">
          <button onClick={confirm} disabled={working}>
            Sign and send
          </button>
          <button className="secondary" onClick={() => setDraft(null)} disabled={working}>
            Edit
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2>Send {symbol}</h2>
      {outcome && <p role={outcome.ok ? "status" : "alert"}>{outcome.text}</p>}
      <form onSubmit={review}>
        {rows.map((row, index) => (
          <fieldset key={row.key}>
            <legend>Recipient {index + 1}</legend>
            <label>
              Address
              <input value={row.address} onChange={(event) => update(row.key, { address: event.target.value })} spellCheck={false} autoComplete="off" />
            </label>
            <label>
              Amount in {symbol}
              <input value={row.amount} onChange={(event) => update(row.key, { amount: event.target.value })} inputMode="decimal" autoComplete="off" />
            </label>
            {rows.length > 1 && (
              <button type="button" className="link" onClick={() => setRows(rows.filter((each) => each.key !== row.key))}>
                Remove recipient {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        {rows.length < maxRecipients && (
          <button type="button" className="link" onClick={() => setRows([...rows, emptyRow()])}>
            Add a recipient
          </button>
        )}
        <label>
          Memo (optional)
          <input value={memo} onChange={(event) => setMemo(event.target.value)} autoComplete="off" />
        </label>
        {message && <p role="alert">{message}</p>}
        <div className="actions">
          <button type="submit" disabled={working}>
            Review
          </button>
        </div>
      </form>
    </section>
  );
}
