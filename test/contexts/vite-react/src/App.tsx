import * as sdk from "@iceroot-network/sdk";
import { useEffect, useMemo, useState } from "react";

import vectors from "../../../vectors/wasm-native.json";
import "../../../shared/vector-checks.js";

declare global {
  var IceRootVectorChecks: {
    run(module: typeof sdk, data: typeof vectors, context: string): { ok: boolean };
  };
}

const devnet = sdk.profiles.devnet({ relays: ["http://127.0.0.1:4003/api"] });

export function App() {
  const [passphrase, setPassphrase] = useState("");
  const [account, setAccount] = useState<sdk.Account | null>(null);
  const [message, setMessage] = useState("");
  const [signed, setSigned] = useState<sdk.MessageSignature | null>(null);
  const [error, setError] = useState("");

  // The same vector checks as every other context, run once in this page.
  const report = useMemo(() => globalThis.IceRootVectorChecks.run(sdk, vectors, "vite-react"), []);

  // Wipe the key when the account changes or the page unmounts.
  useEffect(() => () => account?.release(), [account]);

  function importAccount() {
    try {
      setError("");
      setSigned(null);
      setAccount(sdk.Keys.fromLegacyPassphrase(passphrase, devnet));
    } catch (caught) {
      setError(caught instanceof sdk.IceRootError ? caught.code : String(caught));
    }
  }

  function sign() {
    if (account !== null) {
      setSigned(sdk.Messages.sign(account, message));
    }
  }

  const verified = signed !== null && sdk.Messages.verify({ ...signed, message }, devnet);

  return (
    <main>
      <h1>IceRoot SDK</h1>
      <p>
        Module version <span id="bindings">{sdk.bindingsVersion()}</span>
      </p>
      <label>
        Devnet passphrase{" "}
        <input id="passphrase" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
      </label>
      <button id="import" onClick={importAccount}>
        Import
      </button>
      {error !== "" && <p id="error">{error}</p>}
      {account !== null && (
        <section>
          <p>
            Address <code id="address">{account.address}</code>
          </p>
          <label>
            Message <input id="message" value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <button id="sign" onClick={sign}>
            Sign
          </button>
          {signed !== null && (
            <p>
              Signature <code id="signature">{signed.signature}</code>{" "}
              <span id="verified">{verified ? "verified" : "not verified"}</span>
            </p>
          )}
        </section>
      )}
      <pre id="report" data-ok={String(report.ok)}>
        {JSON.stringify(report, null, 2)}
      </pre>
    </main>
  );
}
