// Voting with the SDK's vote library: a snapshot of the validators, a selection in one of the four
// modes, a review screen with every pick's reasons, the vote signed as the holder reviewed it,
// and later a check of the kept selection against the validators as they are then. The wallet
// never changes a vote by itself: a check only reports.

import { useEffect, useState } from "react";
import { IceRootError, type Account, type Draft } from "@iceroot-network/sdk";
import {
  DEFAULT_PICKS,
  MAX_PICKS,
  MIN_PICKS,
  MODE_NAMES,
  MODES,
  Selection,
  VoteRules,
  VoteSnapshot,
  check,
  select,
  type Finding,
  type Mode,
} from "@iceroot-network/sdk/vote";

import { amount, problem, safeText, share } from "./format";
import { useNetwork } from "./network";
import { loadSelection, saveSelection } from "./storage";
import { signAndSubmit, type Outcome } from "./submit";

/** What each mode prefers, in the words the review screen uses. */
const MODE_TEXT: Record<Mode, string> = {
  diversity: "Recommended. Spreads your vote across rank bands, and across declared operators, hosting providers and regions.",
  reliability: "Validators with a strong production record over the last 30 days.",
  "maximum-rewards": "The highest payouts to voters as measured on chain, at most two per operator. Past payouts are not a promise.",
  "support-newcomers": "Healthy validators near or just below the last seat.",
};

/** A sentence for a selection the library refused. */
function refusal(error: unknown): string {
  if (error instanceof IceRootError) {
    switch (error.code) {
      case "NotEnoughValidators": {
        const available = Number(error.details["available"]);
        return available >= MIN_PICKS
          ? `Only ${available} validators can be picked for ${String(error.details["requested"])} picks. Choose ${available} or fewer.`
          : `Only ${available} validators can be picked now, fewer than a vote needs. Read the validators again later.`;
      }
      case "DoesNotFit":
        return "Not enough picks fit in one vote under the network's rules.";
      case "ValidatorCannotVote":
        return "A validator's account cannot vote.";
      case "BreaksRules":
      case "InvalidPickCount":
      case "InvalidSnapshot":
        return `The selection is not possible: ${error.message}.`;
    }
  }
  return problem(error, "The selection failed");
}

export function Vote({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const net = useNetwork();
  const [snapshot, setSnapshot] = useState<VoteSnapshot | null>(null);
  const [reading, setReading] = useState(false);
  const [mode, setMode] = useState<Mode>("diversity");
  const [count, setCount] = useState(DEFAULT_PICKS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saved, setSaved] = useState(() => loadSelection(account.address));
  const [findings, setFindings] = useState<readonly Finding[] | null>(null);
  const maxPicks = Math.min(MAX_PICKS, net.rules.vote.maxEntries);

  /** Reads the validators at the node's last block. On today's devnet that is a request per validator that has forged. */
  async function readSnapshot(): Promise<VoteSnapshot | null> {
    setReading(true);
    try {
      const fresh = await VoteSnapshot.fromNode(net);
      setSnapshot(fresh);
      return fresh;
    } catch (error) {
      setMessage(problem(error, "The validators could not be read"));
      return null;
    } finally {
      setReading(false);
    }
  }

  // Read once when the page opens; "Read again" refreshes.
  useEffect(() => {
    void readSnapshot();
  }, []);

  async function choose(draw: number) {
    if (snapshot === null) return;
    setMessage("");
    setOutcome(null);
    setDraft(null);
    let picked: Selection;
    try {
      // The rules in force at the next block; never written by hand.
      picked = select(snapshot, { mode, account: account.address, rules: VoteRules.of(net), count, draw });
    } catch (error) {
      setSelection(null);
      return setMessage(refusal(error));
    }
    setSelection(picked);
    setWorking(true);
    try {
      setDraft(await net.build.vote({ from: account.publicKey, entries: picked.vote }));
    } catch (error) {
      setMessage(problem(error, "The vote could not be prepared"));
    } finally {
      setWorking(false);
    }
  }

  async function submit() {
    if (selection === null || draft === null) return;
    setWorking(true);
    setMessage("Signing and submitting.");
    const result = await signAndSubmit(net, draft, account, setMessage);
    setWorking(false);
    setMessage("");
    setOutcome(result);
    if (result.ok) {
      // Kept for the next check; the vote itself is on chain.
      const text = Selection.serialize(selection);
      saveSelection(account.address, text);
      setSaved(text);
      setFindings(null);
      setSelection(null);
      setDraft(null);
      onChanged();
    }
  }

  async function checkSaved() {
    if (saved === null) return;
    setMessage("");
    setFindings(null);
    const fresh = await readSnapshot();
    if (fresh !== null) setFindings(check(Selection.deserialize(saved), fresh));
  }

  if (selection !== null) {
    return (
      <section>
        <h2>Review your vote: {MODE_NAMES[selection.mode]}</h2>
        {selection.topUpNotice && (
          <p className="notice" role="note" aria-label="Top-up notice">
            {safeText(selection.topUpNotice)}
          </p>
        )}
        {selection.sizeNotice && (
          <p className="notice" role="note">
            {safeText(selection.sizeNotice)}
          </p>
        )}
        {selection.snapshotSource === "relay-approximate" && (
          <p className="meta">Validator data from the node at height {String(selection.snapshotHeight)}: production counts are lifetime figures, and no declarations or payouts are known yet.</p>
        )}
        <ol className="picks" aria-label="Picks">
          {selection.entries.map((pick) => (
            <li key={pick.validator}>
              <div className="pick">
                <strong>{safeText(pick.validator)}</strong>
                <span>{share(pick.basisPoints)}</span>
                <span className="meta">{pick.source === "top-up" ? "Top-up from Diversity" : `From ${MODE_NAMES[selection.mode]}`}</span>
              </div>
              <ul aria-label={`Why ${safeText(pick.validator)}`}>
                {pick.reasons.map((reason, index) => (
                  <li key={index}>{safeText(reason.text)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {draft !== null && (
          <>
            <p>
              Signing replaces your current vote with these {selection.entries.length} validators. Fee: {amount(net, draft.fee)}.
            </p>
            <details>
              <summary>Everything you sign</summary>
              <ul className="lines">
                {draft.summary.lines.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </details>
          </>
        )}
        {message && <p role="status">{message}</p>}
        {outcome && !outcome.ok && <p role="alert">{outcome.text}</p>}
        <div className="actions">
          <button onClick={submit} disabled={working || draft === null}>
            Sign and submit vote
          </button>
          <button className="secondary" onClick={() => void choose(selection.draw + 1)} disabled={working}>
            Draw again
          </button>
          <button className="secondary" onClick={() => setSelection(null)} disabled={working}>
            Back
          </button>
        </div>
      </section>
    );
  }

  const kept = saved === null ? null : Selection.deserialize(saved);
  const flagged = findings?.filter((finding) => !finding.stillMeets) ?? [];
  return (
    <section>
      <h2>Vote for validators</h2>
      {outcome && <p role={outcome.ok ? "status" : "alert"}>{outcome.text}</p>}
      <p className="meta">
        {reading
          ? "Reading the validators"
          : snapshot === null
            ? "No validator data yet."
            : `${snapshot.records.length} validators at height ${String(snapshot.height)}.`}{" "}
        <button className="link" onClick={() => void readSnapshot()} disabled={reading}>
          Read again
        </button>
      </p>
      <fieldset>
        <legend>How should the wallet choose?</legend>
        {MODES.map((each) => (
          <label key={each} className="choice">
            <input type="radio" name="mode" value={each} checked={mode === each} onChange={() => setMode(each)} />
            <span>
              <strong>{MODE_NAMES[each]}</strong> {MODE_TEXT[each]}
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        Number of validators ({MIN_PICKS} to {maxPicks})
        <input
          type="number"
          min={MIN_PICKS}
          max={maxPicks}
          value={count}
          onChange={(event) => setCount(Math.min(maxPicks, Math.max(MIN_PICKS, Number(event.target.value) || DEFAULT_PICKS)))}
        />
      </label>
      {message && <p role="alert">{message}</p>}
      <div className="actions">
        <button onClick={() => void choose(0)} disabled={snapshot === null || reading || working}>
          Select validators
        </button>
      </div>

      {kept !== null && (
        <section className="check" aria-label="Your vote">
          <h2>Your vote</h2>
          <p>
            {MODE_NAMES[kept.mode]}, {kept.entries.length} validators, selected at height {String(kept.snapshotHeight)}.
          </p>
          <button className="secondary" onClick={() => void checkSaved()} disabled={reading}>
            Check my vote
          </button>
          {findings !== null && (
            <div aria-label="Check result">
              <p role="status">
                {findings.length - flagged.length} of {findings.length} validators still meet their criteria.
              </p>
              {flagged.length > 0 && (
                <>
                  <ul className="flagged" aria-label="No longer meet their criteria">
                    {flagged.map((finding) => (
                      <li key={finding.validator}>
                        <strong>{safeText(finding.validator)}</strong>: {safeText(finding.why)}
                      </li>
                    ))}
                  </ul>
                  <p>Your vote stays as it is until you sign a new one. Make a new selection above to replace it.</p>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
