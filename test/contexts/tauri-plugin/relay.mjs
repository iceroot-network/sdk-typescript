// Runs inside the container, next to the application: the recorded devnet nodes the plugin reaches
// over HTTP, and the control server the test page uses (the page never reaches a node).
//
//   node relay.mjs <sdk-typescript> <sdk-rust> [relay port] [control port]
//
// Relay (127.0.0.1:6003): /n/<id>/api/... answers as recorded node <id> (test/suites/recorded-node.js),
// and /api/... as recorded node 0, which the example's own page reaches with its default relay;
// each request is recorded. Control (127.0.0.1:6010), for the page:
//   POST /node {routes, vars}            a new recorded node: {id, relay}
//   POST /node/<id>/route {key, value}   one route of it
//   POST /node/<id>/set {values}         variables of its behaviors
//   GET  /node/<id>/requests             its requests
//   GET  /file?path=ts/...|rs/...        a file of sdk-typescript or sdk-rust, for the suites
//   GET  /config                         what the page runs: the JSON object in the file
//                                        ICEROOT_TAURI_CHECK_FILE names, read at each request
//   POST /proxy {url}                    a GET from here, for the end-to-end test's raw node JSON
//   POST /log {line}                     a line for the container's output

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize } from "node:path";

import { recordedNode } from "./recorded-node.js";

const [typescript, rust, relayPort = "6003", controlPort = "6010"] = process.argv.slice(2);
const FIXTURES = join(rust, "crates", "iceroot-sdk-api", "tests", "fixtures", "devnet");
const fixtures = {
  index: JSON.parse(readFileSync(join(FIXTURES, "index.json"), "utf8")),
  text: (file) => readFileSync(join(FIXTURES, file), "utf8"),
};
const nodes = new Map();
let next = 0;
// Node 0: the example page's default relay, http://127.0.0.1:6003/api.
nodes.set("0", recordedNode(fixtures));
nodes.get("0").reset({}, {});

function body(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${relayPort}`);
  const match = /^(?:\/n\/(\d+))?\/api(\/.*)$/.exec(url.pathname);
  const node = match === null ? undefined : nodes.get(match[1] ?? "0");
  if (node === undefined) {
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ statusCode: 404, error: "Not Found", message: "no such node" }));
    return;
  }
  const answer = node.answer({
    url: `http://127.0.0.1:${relayPort}${url.pathname}${url.search}`,
    method: request.method ?? "GET",
    path: match[2],
    query: url.searchParams,
    headers: request.headers,
    body: request.method === "POST" ? await body(request) : undefined,
  });
  if (answer.hang) {
    return;
  }
  response.writeHead(answer.status, { "content-type": "application/json", ...(answer.headers ?? {}) });
  response.end(answer.status === 204 ? undefined : answer.body);
}).listen(Number(relayPort), "127.0.0.1", () => console.log(`relay: listening on 127.0.0.1:${relayPort}`));

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };

function send(response, status, value, type = "application/json") {
  response.writeHead(status, { "content-type": type, ...cors });
  response.end(type === "application/json" ? JSON.stringify(value) : value);
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors).end();
    return;
  }
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${controlPort}`);
  try {
    if (request.method === "POST" && url.pathname === "/node") {
      const { routes = {}, vars = {} } = JSON.parse(await body(request));
      const id = String(++next);
      const node = recordedNode(fixtures);
      node.reset(routes, vars);
      nodes.set(id, node);
      send(response, 200, { id, relay: `http://127.0.0.1:${relayPort}/n/${id}/api` });
      return;
    }
    const nodeMatch = /^\/node\/(\d+)\/(route|set|requests)$/.exec(url.pathname);
    if (nodeMatch !== null) {
      const node = nodes.get(nodeMatch[1]);
      if (node === undefined) {
        send(response, 404, { error: "no such node" });
      } else if (nodeMatch[2] === "requests") {
        send(response, 200, node.requests());
      } else {
        const data = JSON.parse(await body(request));
        if (nodeMatch[2] === "route") {
          node.route(data.key, data.value);
        } else {
          node.set(data.values);
        }
        send(response, 200, {});
      }
      return;
    }
    if (url.pathname === "/file") {
      const path = url.searchParams.get("path") ?? "";
      const base = path.startsWith("ts/") ? typescript : path.startsWith("rs/") ? rust : undefined;
      const relative = normalize(path.slice(3));
      if (base === undefined || relative.startsWith("..")) {
        send(response, 400, { error: "a file is ts/... or rs/..." });
        return;
      }
      send(response, 200, readFileSync(join(base, relative), "utf8"), "text/plain; charset=utf-8");
      return;
    }
    if (url.pathname === "/config") {
      const file = process.env.ICEROOT_TAURI_CHECK_FILE;
      send(response, 200, file === undefined ? {} : JSON.parse(readFileSync(file, "utf8")));
      return;
    }
    if (request.method === "POST" && url.pathname === "/proxy") {
      const { url: target } = JSON.parse(await body(request));
      const answer = await fetch(target, { headers: { accept: "application/json" } });
      send(response, 200, { status: answer.status, retryAfter: answer.headers.get("retry-after"), body: await answer.text() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/log") {
      console.log(`page: ${JSON.parse(await body(request)).line}`);
      send(response, 200, {});
      return;
    }
    send(response, 404, { error: "not found" });
  } catch (error) {
    send(response, 500, { error: String(error?.stack ?? error) });
  }
}).listen(Number(controlPort), "127.0.0.1", () => console.log(`control: listening on 127.0.0.1:${controlPort}`));
