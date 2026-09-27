// Runs inside the container: a relay on 127.0.0.1 that answers the node API from the devnet answers
// recorded in sdk-rust's node API client fixtures, for the page's transport check.
//
//   node relay.mjs <fixtures directory> <port>

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const [directory, port] = process.argv.slice(2);
const index = JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));

function answer(method, url) {
  const path = url.pathname.slice("/api".length);
  const full = `${path}${url.search}`;
  const entry =
    index.find((each) => each.method === method && each.path === full) ??
    index.find((each) => each.method === method && each.path.split("?")[0] === path);
  if (entry === undefined) {
    return { status: 404, body: JSON.stringify({ statusCode: 404, error: "Not Found", message: `no recording of ${method} ${path}` }) };
  }
  return { status: entry.status, headers: entry.headers ?? {}, body: readFileSync(join(directory, entry.file)) };
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) {
    response.writeHead(404).end();
    return;
  }
  const { status, headers = {}, body } = answer(request.method ?? "GET", url);
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(body);
}).listen(Number(port), "127.0.0.1", () => console.log(`relay: listening on 127.0.0.1:${port}`));
