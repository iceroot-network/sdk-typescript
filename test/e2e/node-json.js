// The node's own JSON of a forged transaction, for the end-to-end test.
//
// Everything else the scenario reads goes through the SDK's node client (`connect`). The client
// decodes answers into the SDK's records and has no call for a transaction in the node's raw form,
// which the test compares with what the SDK signed; this helper reads it over fetch.
//
// It keeps to a small share of the node's request allowance (the reference implementation's
// default is 100 requests a minute per client address, which every test on the machine shares)
// and waits out HTTP 429. It runs in Node and in browsers alike.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A reader of the node behind `relay` (its URL with the API base path). `requestsPerMinute` is
 * this reader's share of the node's allowance.
 */
export function nodeJson(relay, { transport = globalThis.fetch.bind(globalThis), requestsPerMinute = 10 } = {}) {
  const base = relay.replace(/\/+$/, "");
  const sent = [];

  async function spend() {
    for (;;) {
      const now = Date.now();
      while (sent.length > 0 && sent[0] < now - 60_000) {
        sent.shift();
      }
      if (sent.length < requestsPerMinute) {
        sent.push(now);
        return;
      }
      await sleep(sent[0] + 60_000 - now + 50);
    }
  }

  return {
    /** The node's own JSON of the transaction `id` in a block, or undefined. */
    async transaction(id) {
      const path = `/transactions/${encodeURIComponent(id)}?transform=false`;
      for (let attempt = 0; ; attempt++) {
        await spend();
        const response = await transport(`${base}${path}`, { headers: { accept: "application/json" } });
        const text = await response.text();
        if (response.status === 429 && attempt < 6) {
          const wait = Number(response.headers.get("retry-after") ?? "10");
          await sleep((Number.isFinite(wait) ? wait : 10) * 1000);
          continue;
        }
        if (response.status === 404) {
          return undefined;
        }
        if (response.status !== 200) {
          throw new Error(`GET ${path}: HTTP ${response.status}: ${text}`);
        }
        return JSON.parse(text).data;
      }
    },
  };
}
