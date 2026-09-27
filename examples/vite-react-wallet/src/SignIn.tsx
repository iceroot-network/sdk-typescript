// Signing in to a website, such as the validators portal, with a signed message. The website shows
// a sign-in message; the wallet checks it with the SDK (the website's origin, this account, the
// network and the times) before it offers to sign, and signs nothing else: a website never gets a
// transaction signed.

import { useState, type FormEvent } from "react";
import { IceRootError, Messages, SignIn, type Account, type SignInFields } from "@iceroot-network/sdk";

import { useNetwork } from "./network";

export function SignInPage({ account }: { account: Account }) {
  const net = useNetwork();
  const [origin, setOrigin] = useState("");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<SignInFields | null>(null);
  const [signature, setSignature] = useState("");
  const [refusal, setRefusal] = useState("");

  function checkMessage(): SignInFields | null {
    try {
      return SignIn.parse(message, net, {
        origin: origin.trim(),
        address: account.address,
        publicKey: account.publicKey,
        now: new Date(),
      });
    } catch (error) {
      setRefusal(
        error instanceof IceRootError
          ? `Do not sign this message: ${error.message}${typeof error.details["reason"] === "string" ? ` (${error.details["reason"]})` : ""}.`
          : "Do not sign this message.",
      );
      return null;
    }
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setRefusal("");
    setSignature("");
    setFields(checkMessage());
  }

  function sign() {
    // Checked again at the moment of signing: the message may have lapsed meanwhile.
    const checked = checkMessage();
    setFields(checked);
    if (checked === null) return;
    setSignature(JSON.stringify(Messages.sign(account, message)));
  }

  return (
    <section>
      <h2>Sign in to a website</h2>
      <p>A website that supports IceRoot sign-in asks for this account's public key, then shows a sign-in message. Paste the message here with the website's address as your browser shows it.</p>
      <label>
        Public key
        <input readOnly value={account.publicKey} aria-label="Public key" />
      </label>
      <form onSubmit={review}>
        <label>
          Website (origin)
          <input value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://validators.example" spellCheck={false} autoComplete="off" />
        </label>
        <label>
          Sign-in message
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={12} spellCheck={false} />
        </label>
        {refusal && <p role="alert">{refusal}</p>}
        <div className="actions">
          <button type="submit">Check the message</button>
        </div>
      </form>
      {fields !== null && signature === "" && (
        <div className="review" aria-label="Sign-in request">
          <dl className="facts">
            <dt>Website</dt>
            <dd>{fields.origin}</dd>
            <dt>Account</dt>
            <dd>{fields.address}</dd>
            <dt>Network</dt>
            <dd>{fields.network}</dd>
            <dt>Valid until</dt>
            <dd>{fields.expiresAt.toISOString()}</dd>
          </dl>
          <p>Signing proves to this website that you hold this account. It authorizes no transaction and costs no fee.</p>
          <button onClick={sign}>Sign in</button>
        </div>
      )}
      {signature !== "" && (
        <label>
          Signature for the website
          <textarea readOnly value={signature} rows={5} aria-label="Signature for the website" />
        </label>
      )}
    </section>
  );
}
