// A node that answers the node API from the devnet answers recorded in sdk-rust's node API client
// fixtures (crates/iceroot-sdk-api/tests/fixtures/devnet), for the test suites.
//
// The same answers serve two transports: in Node, the WebAssembly entry's transport calls
// `answer` in the process (env-node.mjs); for the Tauri plugin, whose requests leave from Rust, an
// HTTP relay in the test's container serves them (test/contexts/tauri-plugin/relay.mjs). So the
// routes a test sets are data, never functions:
//
// - a fixture's name, or an answer `{ status, headers?, body }` (body as text);
// - under the key `*`, a route for every request (a relay that is busy, or that never answers);
// - `{ sequence: [route, ...] }`: one route per request, the last one repeated;
// - `{ behavior: name }`: one of the behaviors below, which read the node's variables (`vars`).
//
// Without a route, a request gets the first recording of its method and path, an empty account
// for a well-formed address the recordings do not have, or 404.

/** An answer: status, headers and body text. */
export const json = (status, body, headers = {}) => ({ status, headers, body: JSON.stringify(body) });

/**
 * A recorded node over `fixtures`: `{ index, text(file) }`, the fixtures' index and a reader of
 * their files.
 */
export function recordedNode(fixtures) {
  const { index, text } = fixtures;
  let routes = {};
  let vars = {};
  let requests = [];
  const counters = new Map();

  function fixture(name) {
    const entry = index.find((each) => each.name === name);
    if (entry === undefined) {
      throw new Error(`no fixture ${name}`);
    }
    return { status: entry.status, headers: entry.headers ?? {}, body: text(entry.file) };
  }

  const behaviors = {
    // Accepts every transaction posted, as a pool with room would.
    "accept-all": (request) => {
      const ids = JSON.parse(request.body).transactions.map((tx) => tx.id);
      return json(200, { data: { accept: ids, broadcast: [], excess: [], invalid: [] } });
    },
    // Never answers.
    hang: () => ({ hang: true }),
    // The node's status at `vars.height`, or a server error while `vars.failing`.
    "watch-status": () =>
      vars.failing
        ? json(503, { statusCode: 503, error: "Service Unavailable", message: "down" })
        : json(200, { data: { synced: true, now: vars.height, blocksCount: 0, timestamp: 634 } }),
    // An account's history in which the two newest transactions are in a block only once the
    // height moved past 80.
    "watch-history": () => {
      const history = JSON.parse(fixture("wallet-transactions").body);
      return json(200, vars.height === 80 ? { ...history, data: history.data.slice(2) } : history);
    },
    // Every validator registration on one page.
    "vote-registrations": () => {
      const registrations = JSON.parse(text("transactions-validator-registration.json"));
      const body = { ...registrations, meta: { ...registrations.meta, pageCount: 1, totalCount: registrations.data.length, next: null } };
      return json(200, body);
    },
    // The blocks of a validator, one per page: the first it forged is at height 10 plus its rank.
    "vote-first-forged": (request) => {
      const validators = JSON.parse(text("delegates-page.json")).data;
      const name = decodeURIComponent(request.path.split("/")[2]);
      const validator = validators.find((each) => each.username === name);
      const page = Number(request.query.get("page"));
      const produced = validator.blocks.produced;
      const blocks = JSON.parse(text("delegate-blocks.json"));
      const block = { ...blocks.data[0], height: page === produced ? 10 + (validator.rank ?? 60) : 1000 };
      const meta = { ...blocks.meta, count: 1, pageCount: produced, totalCount: produced, next: null };
      return json(200, { meta, data: [block] });
    },
  };

  function resolve(route, request, key) {
    if (typeof route === "string") {
      return fixture(route);
    }
    if (route.sequence !== undefined) {
      const used = counters.get(key) ?? 0;
      counters.set(key, used + 1);
      return resolve(route.sequence[Math.min(used, route.sequence.length - 1)], request, key);
    }
    if (route.behavior !== undefined) {
      const behavior = behaviors[route.behavior];
      if (behavior === undefined) {
        throw new Error(`no behavior ${route.behavior}`);
      }
      return behavior(request);
    }
    return route;
  }

  /**
   * The answer to `request`: `{ method, path, query, headers, body, url }`, the path without the
   * API base path and the query a URLSearchParams. Every request is recorded.
   */
  function answer(request) {
    const headers = {};
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      headers[name.toLowerCase()] = String(value);
    }
    requests.push({
      url: request.url,
      method: request.method,
      path: request.path,
      query: request.query.toString(),
      headers,
      body: request.body,
    });
    const key = `${request.method} ${request.path}`;
    const route = routes["*"] ?? routes[key] ?? routeByPattern(key);
    if (route !== undefined) {
      return resolve(route, request, key);
    }
    const entry = index.find((each) => each.method === request.method && each.path.split("?")[0] === request.path);
    if (entry !== undefined) {
      return fixture(entry.name);
    }
    const wallet = /^\/wallets\/(d[1-9A-HJ-NP-Za-km-z]{33})$/.exec(request.path);
    return wallet
      ? json(200, { data: { address: wallet[1], balance: "0", nonce: "0", attributes: {}, votingFor: {} } })
      : json(404, { statusCode: 404, error: "Not Found", message: `no recording of ${request.method} ${request.path}` });
  }

  /** A route whose key has a `*` for one variable part of the path, such as `GET /delegates/*` + `/blocks`. */
  function routeByPattern(key) {
    for (const [pattern, route] of Object.entries(routes)) {
      if (pattern.includes("*") && matches(pattern.split("*"), key)) {
        return route;
      }
    }
    return undefined;
  }

  /** Whether `key` is the `parts` joined by one path segment each. */
  function matches(parts, key) {
    let rest = key;
    for (const [i, part] of parts.entries()) {
      if (!rest.startsWith(part)) {
        return false;
      }
      rest = rest.slice(part.length);
      if (i < parts.length - 1) {
        const segment = /^[^/]+/.exec(rest);
        if (segment === null) {
          return false;
        }
        rest = rest.slice(segment[0].length);
      }
    }
    return rest === "";
  }

  return {
    fixture,
    answer,
    /** Replaces the routes and variables, and forgets the requests and sequences. */
    reset(newRoutes = {}, newVars = {}) {
      routes = { ...newRoutes };
      vars = { ...newVars };
      requests = [];
      counters.clear();
    },
    /** Sets one route; a sequence starts again. */
    route(key, value) {
      routes = { ...routes, [key]: value };
      counters.delete(key);
    },
    /** Sets variables of the behaviors. */
    set(values) {
      vars = { ...vars, ...values };
    },
    /**
   * The requests so far, each `{ url, method, path, query, headers, body }`: the query as text,
   * the headers' names in lowercase.
   */
    requests() {
      return requests;
    },
  };
}
