import * as sdk from "@iceroot-network/sdk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// Load the WebAssembly module once, before the first render.
await sdk.init();

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
