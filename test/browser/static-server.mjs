// A static file server for the browser tests, with the content security policy the SDK documents
// for pages: script-src 'self' 'wasm-unsafe-eval'. Paths under /no-wasm-eval/ are served with the
// same policy without 'wasm-unsafe-eval', to show that the module needs it. Paths under
// /sandboxed/ are served with a policy that allows no network access at all (connect-src 'none'),
// as a Manifest V3 sandbox page has.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".css": "text/css",
};

export const PAGE_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'";
export const PAGE_CSP_WITHOUT_WASM = "default-src 'self'; script-src 'self'; object-src 'none'";
export const SANDBOX_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'";

/**
 * Serves `directory` on a free local port; resolves to { url, close }. `connect` lists other
 * origins the pages may fetch from, such as a devnet's API.
 */
export function serve(directory, { connect = [] } = {}) {
  const base = resolve(directory);
  const pageCsp =
    connect.length === 0 ? PAGE_CSP : PAGE_CSP.replace("; object-src", `; connect-src 'self' ${connect.join(" ")}; object-src`);
  const server = createServer((request, response) => {
    let path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    let csp = pageCsp;
    if (path.startsWith("/no-wasm-eval/")) {
      path = path.slice("/no-wasm-eval".length);
      csp = PAGE_CSP_WITHOUT_WASM;
    } else if (path.startsWith("/sandboxed/")) {
      path = path.slice("/sandboxed".length);
      csp = SANDBOX_CSP;
    }
    const file = normalize(join(base, path));
    if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": csp,
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolvePromise({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
