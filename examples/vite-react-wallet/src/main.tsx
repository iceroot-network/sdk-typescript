import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IceRootError } from "@iceroot-network/sdk";

import { App } from "./App";
import { NetworkContext, openNetwork, RELAY } from "./network";
import { forgetNethash } from "./storage";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

function start(): void {
  root.render(<p className="notice">Connecting to the devnet at {RELAY}</p>);
  openNetwork().then(
    (net) =>
      root.render(
        <StrictMode>
          <NetworkContext.Provider value={net}>
            <App />
          </NetworkContext.Provider>
        </StrictMode>,
      ),
    (error: unknown) => {
      if (error instanceof IceRootError && error.code === "NetworkMismatch") {
        // A reset devnet is a new chain: ask before pinning it.
        root.render(
          <main className="card">
            <h1>The devnet changed</h1>
            <p role="alert">The devnet at {RELAY} is not the network this wallet was used with. It was probably reset.</p>
            <button
              onClick={() => {
                forgetNethash();
                start();
              }}
            >
              Use the new devnet
            </button>
          </main>,
        );
      } else {
        root.render(
          <main className="card">
            <p role="alert">The network is unavailable at {RELAY}.</p>
            <button onClick={start}>Try again</button>
          </main>,
        );
      }
    },
  );
}

start();
