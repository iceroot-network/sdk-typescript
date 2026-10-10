import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// The devnet relay the wallet connects to, API base path included. Set VITE_ICEROOT_RELAY in the
// environment or in .env.local.
const DEFAULT_RELAY = "http://127.0.0.1:6003/api";

// The page policy of the production build: WebAssembly may be compiled ('wasm-unsafe-eval', which
// does not allow JavaScript eval), and the page talks to its own origin and the relay only. The
// development server injects an inline script for React's fast refresh, which this policy would
// block, so only the build gets it.
function contentSecurityPolicy(relay: string): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    `connect-src 'self' ${new URL(relay).origin}`,
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig(({ mode }) => {
  // The environment and the .env files of this directory; the environment wins.
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_");
  const relay = env["VITE_ICEROOT_RELAY"] || DEFAULT_RELAY;
  return {
    plugins: [react(), contentSecurityPolicy(relay)],
    // Pre-bundling would move the SDK's JavaScript away from its .wasm file.
    optimizeDeps: { exclude: ["@iceroot-network/sdk"] },
    build: { target: "es2022" },
  };
});
