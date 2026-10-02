// Creating a wallet (a new 24-word recovery phrase) or restoring one (18, 21 or 24 words), then
// keeping it as a keystore: the phrase's entropy encrypted under the holder's password with the
// SDK's keystore format and its preset for WebAssembly in a browser.

import { useState, type FormEvent } from "react";
import { Mnemonic, type Account, type Network, type PhraseCheck } from "@iceroot-network/sdk";
import { armor, encrypt } from "@iceroot-network/sdk/keystore";

import { afterPaint, problem } from "./format";
import { useNetwork } from "./network";
import { saveWallet } from "./storage";

export function Welcome({ onCreate, onRestore }: { onCreate: () => void; onRestore: () => void }) {
  return (
    <main className="card">
      <h1>IceRoot example wallet</h1>
      <p>A wallet for today's devnet, built on the IceRoot SDK. Devnet tokens have no value.</p>
      <div className="actions">
        <button onClick={onCreate}>Create a new wallet</button>
        <button className="secondary" onClick={onRestore}>
          Restore from a recovery phrase
        </button>
      </div>
    </main>
  );
}

/** Encrypts the phrase under the password, keeps the keystore, and opens account 0, index 0. */
async function keepWallet(net: Network, phrase: string, password: string): Promise<Account> {
  const keystore = await afterPaint(() => armor(encrypt(phrase, password, "web")));
  const account = net.keys.fromPhrase(phrase, { account: 0, index: 0 });
  try {
    saveWallet({ keystore, address: account.address });
  } catch (error) {
    account.release();
    throw error;
  }
  return account;
}

/** Two different word positions, from 1, for the holder to confirm. */
function positionsToConfirm(words: number): [number, number] {
  const random = crypto.getRandomValues(new Uint32Array(2));
  const first = (random[0]! % words) + 1;
  const second = ((first - 1 + 1 + (random[1]! % (words - 1))) % words) + 1;
  return first < second ? [first, second] : [second, first];
}

export function Create({ onCreated, onCancel }: { onCreated: (account: Account) => void; onCancel: () => void }) {
  const net = useNetwork();
  const [phrase] = useState(() => Mnemonic.generate());
  const words = phrase.split(" ");
  const [positions] = useState(() => positionsToConfirm(words.length));
  const [step, setStep] = useState<"write" | "confirm" | "password">("write");
  const [answers, setAnswers] = useState(["", ""]);
  const [wrong, setWrong] = useState(false);

  if (step === "write") {
    return (
      <main className="card">
        <h1>Your recovery phrase</h1>
        <p>Write these {words.length} words down, in order, and keep them offline. Anyone with them controls the wallet; without them a lost password cannot be recovered.</p>
        <ol className="phrase" aria-label="Recovery phrase">
          {words.map((word, index) => (
            <li key={index}>{word}</li>
          ))}
        </ol>
        <div className="actions">
          <button onClick={() => setStep("confirm")}>I wrote the words down</button>
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </main>
    );
  }

  if (step === "confirm") {
    function confirm(event: FormEvent) {
      event.preventDefault();
      const ok = positions.every((position, index) => answers[index]!.trim().toLowerCase() === words[position - 1]);
      setWrong(!ok);
      if (ok) setStep("password");
    }
    return (
      <main className="card">
        <h1>Confirm your recovery phrase</h1>
        <form onSubmit={confirm}>
          {positions.map((position, index) => (
            <label key={position}>
              Word {position}
              <input
                value={answers[index]}
                onChange={(event) => setAnswers(answers.map((answer, at) => (at === index ? event.target.value : answer)))}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ))}
          {wrong && <p role="alert">These words do not match your recovery phrase. Check what you wrote down.</p>}
          <div className="actions">
            <button type="submit">Continue</button>
            <button type="button" className="secondary" onClick={() => setStep("write")}>
              Show the words again
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <SetPassword
      title="Protect your wallet"
      onPassword={(password) => keepWallet(net, phrase, password).then(onCreated)}
      onCancel={onCancel}
    />
  );
}

/** What the holder is told about a phrase that is not one keys are made from. */
function phraseProblem(check: PhraseCheck): string {
  switch (check.reason) {
    case "too-short":
      return `A recovery phrase has 18, 21 or 24 words; this one has ${check.words}. Shorter phrases are not accepted.`;
    case "unknown-word":
      return `Word ${check.position ?? ""} is not a recovery phrase word. Check its spelling.`;
    case "word-count":
      return `A recovery phrase has 18, 21 or 24 words; this one has ${check.words}.`;
    case "checksum":
      return "These words are not a valid recovery phrase. Check each word and their order.";
    default:
      return "Enter your recovery phrase.";
  }
}

export function Restore({ onRestored, onCancel }: { onRestored: (account: Account) => void; onCancel: () => void }) {
  const net = useNetwork();
  const [text, setText] = useState("");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  function next(event: FormEvent) {
    event.preventDefault();
    const typed = text.trim().split(/\s+/).join(" ");
    const check = Mnemonic.check(typed);
    if (!check.ok) return setMessage(phraseProblem(check));
    setMessage("");
    setText("");
    setPhrase(typed);
  }

  if (phrase !== null) {
    return (
      <SetPassword
        title="Protect your wallet"
        onPassword={(password) => keepWallet(net, phrase, password).then(onRestored)}
        onCancel={onCancel}
      />
    );
  }
  return (
    <main className="card">
      <h1>Restore a wallet</h1>
      <form onSubmit={next}>
        <label>
          Recovery phrase (18, 21 or 24 words)
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} autoComplete="off" spellCheck={false} />
        </label>
        {message && <p role="alert">{message}</p>}
        <div className="actions">
          <button type="submit">Continue</button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}

const MIN_PASSWORD = 8;

/** Asks for a new password twice, then runs `onPassword`, showing its failure. */
function SetPassword({ title, onPassword, onCancel }: { title: string; onPassword: (password: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setMessage(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== again) return setMessage("The two passwords differ.");
    setMessage("");
    setWorking(true);
    onPassword(password).catch((error: unknown) => {
      setWorking(false);
      setMessage(problem(error, "The wallet could not be kept in this browser"));
    });
  }

  return (
    <main className="card">
      <h1>{title}</h1>
      <p>The password encrypts your recovery phrase in this browser. You need it to unlock the wallet here; the recovery phrase restores it anywhere.</p>
      <form onSubmit={submit}>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </label>
        <label>
          Password again
          <input type="password" value={again} onChange={(event) => setAgain(event.target.value)} autoComplete="new-password" />
        </label>
        {message && <p role="alert">{message}</p>}
        {working && <p role="status">Encrypting the recovery phrase</p>}
        <div className="actions">
          <button type="submit" disabled={working}>
            Keep the wallet
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={working}>
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
