import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The policy a wallet page sets. Only the production build gets it: the development server injects
// an inline script for React's fast refresh, which this policy would block.
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'";

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  // Pre-bundling would move the SDK's JavaScript away from its .wasm file.
  optimizeDeps: { exclude: ["@iceroot-network/sdk"] },
  build: { target: "es2022" },
});
