// A minimal node API client for the end-to-end test, over fetch.
//
// SEAM. The SDK's own node client (`connect`, which builds each request and decodes each answer
// in the Rust core) replaces this module. Every method here has the name and the result shape of
// that client (see src/client.ts: NodeStatus, NodeConfiguration, AccountInfo, TxRecord,
// ValidatorInfo, SubmitReport), limited to the fields the scenario reads, so switching is one
// change in `openNode`: return the connected client instead. The scenario (scenario.js) calls
// nothing else. The only method the client does not offer, `transactions.json`, reads a
// transaction in the node's own JSON form to compare it with what the SDK signed.
//
// It keeps to the node's request allowance (the reference implementation's default is 100
// requests a minute per client address, which every test on the machine shares) and waits out
// HTTP 429. It runs in Node and in browsers alike.

const ROOT_ASSET = "ROOT";
const TX_KINDS = {
  "1/6": "transfer",
  "2/2": "vote",
  "2/0": "burn",
  "1/1": "register-second-key",
  "1/2": "register-validator",
  "1/7": "resign-validator",
};
const RESIGNATIONS = ["temporary", "permanent", "revoke"];

/** The normalized reason of a node's refusal code, as the SDK's client reports it. */
export function rejectionReason(code, message) {
  switch (code) {
    case "ERR_LOW_FEE":
      return "low-fee";
    case "ERR_DUPLICATE":
    case "ERR_COOLDOWN":
      return "duplicate";
    case "ERR_TOO_LARGE":
      return "too-large";
    case "ERR_POOL_FULL":
    case "ERR_EXCEEDS_MAX_COUNT":
      return "pool-full";
    case "ERR_WRONG_NETWORK":
      return "wrong-network";
    case "ERR_BAD_DATA":
      return "invalid";
    case "ERR_APPLY":
      if (message.includes("Cannot apply a transaction with nonce")) {
        return "nonce";
      }
      if (message.includes("Insufficient balance")) {
        return "balance";
      }
      return "invalid";
    default:
      return "other";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whole basis points of a percentage the node reports (at most two decimals). */
function basisPoints(percent) {
  return Math.round(Number(percent) * 100);
}

function txRecord(t) {
  const kind = TX_KINDS[`${t.typeGroup ?? 1}/${t.type}`] ?? "other";
  const asset = t.asset ?? {};
  let details;
  switch (kind) {
    case "transfer":
      details = { kind, recipients: asset.transfers.map((p) => ({ address: p.recipientId, amount: BigInt(p.amount) })) };
      break;
    case "vote":
      details = {
        kind,
        entries: Object.entries(asset.votes).map(([validator, percent]) => ({ validator, basisPoints: basisPoints(percent) })),
      };
      break;
    case "burn":
      details = { kind, amount: BigInt(asset.burn?.amount ?? t.amount) };
      break;
    case "register-second-key":
      details = { kind, publicKey: asset.signature.publicKey };
      break;
    case "register-validator":
      details = { kind, name: asset.delegate.username };
      break;
    case "resign-validator":
      details = { kind, resignation: RESIGNATIONS[asset.resignationType ?? 0] };
      break;
    default:
      details = { kind: "other", typeGroup: t.typeGroup, typeId: t.type };
  }
  return {
    id: t.id,
    status: t.blockId === undefined ? "pending" : "confirmed",
    ...(t.blockId === undefined
      ? {}
      : { block: { id: t.blockId, height: BigInt(t.blockHeight), confirmations: BigInt(t.confirmations ?? 0) } }),
    sender: t.sender,
    senderPublicKey: t.senderPublicKey,
    nonce: BigInt(t.nonce),
    fee: BigInt(t.fee),
    ...(t.memo === undefined ? {} : { memo: t.memo }),
    // The transformed form names the second signature signSignature, the raw form secondSignature.
    secondSigned: t.signSignature !== undefined || t.secondSignature !== undefined,
    version: t.version,
    details,
  };
}

/**
 * The node behind `relay` (its URL with the API base path). `requestsPerMinute` is this client's
 * share of the node's allowance.
 */
export function openNode(relay, { transport = globalThis.fetch.bind(globalThis), requestsPerMinute = 40 } = {}) {
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

  /** The node's answer to one request: `{ status, body }`, after waiting out rate limits. */
  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      await spend();
      const response = await transport(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (response.status === 429 && attempt < 6) {
        const wait = Number(response.headers.get("retry-after") ?? "10");
        await sleep((Number.isFinite(wait) ? wait : 10) * 1000);
        continue;
      }
      return { status: response.status, body: text === "" ? null : JSON.parse(text) };
    }
  }

  async function data(path) {
    const { status, body } = await request("GET", path);
    if (status !== 200) {
      throw new Error(`GET ${path}: HTTP ${status}: ${JSON.stringify(body)}`);
    }
    return body.data;
  }

  async function optional(path) {
    const { status, body } = await request("GET", path);
    if (status === 404) {
      return undefined;
    }
    if (status !== 200) {
      throw new Error(`GET ${path}: HTTP ${status}: ${JSON.stringify(body)}`);
    }
    return body.data;
  }

  const node = {
    /** The relay URL. */
    relay: base,

    node: {
      /** NodeStatus. */
      async status() {
        const d = await data("/node/status");
        return { height: BigInt(d.now), synced: d.synced, blocksBehind: BigInt(d.blocksCount ?? 0), chainTime: BigInt(d.timestamp) };
      },

      /** NodeConfiguration: chain identity, seats, block time, pool limits and pool fees. */
      async configuration() {
        const d = await data("/node/configuration");
        const fees = d.pool.dynamicFees;
        const kinds = {
          transfer: "transfer",
          vote: "vote",
          burn: "burn",
          secondSignature: "register-second-key",
          delegateRegistration: "register-validator",
          delegateResignation: "resign-validator",
        };
        return {
          network: { nethash: d.nethash, networkByte: d.version, slip44: d.slip44, wif: d.wif },
          seats: d.constants.activeDelegates,
          blockTime: d.constants.blockTime,
          pool: {
            maxTransactionsPerRequest: d.pool.maxTransactionsPerRequest,
            maxTransactionBytes: d.pool.maxTransactionBytes,
          },
          poolFees: {
            dynamic: fees.enabled,
            minFeePool: BigInt(fees.minFeePool),
            minFeeBroadcast: BigInt(fees.minFeeBroadcast),
            addonBytes: Object.entries(fees.addonBytes)
              .filter(([key]) => key in kinds)
              .map(([key, bytes]) => ({ kind: kinds[key], bytes: BigInt(bytes) })),
          },
        };
      },

      /** The chain definition, as `Chain.load` takes it. */
      async cryptoConfiguration() {
        return data("/node/configuration/crypto");
      },
    },

    accounts: {
      /** AccountInfo; an address the chain has never seen is an empty account. */
      async get(address) {
        const w = await optional(`/wallets/${encodeURIComponent(address)}`);
        if (w === undefined) {
          return { address, nonce: 0n, balances: [{ asset: ROOT_ASSET, amount: 0n }], vote: [] };
        }
        const attributes = w.attributes ?? {};
        return {
          address: w.address,
          ...(w.publicKey ? { publicKey: w.publicKey } : {}),
          nonce: BigInt(w.nonce),
          balances: [{ asset: ROOT_ASSET, amount: BigInt(w.balance) }],
          vote: Object.entries(w.votingFor ?? {}).map(([validator, v]) => ({ validator, basisPoints: basisPoints(v.percent) })),
          ...(attributes.secondPublicKey ? { secondPublicKey: attributes.secondPublicKey } : {}),
          ...(attributes.delegate?.username ? { validatorName: attributes.delegate.username } : {}),
        };
      },
    },

    transactions: {
      /** TxRecord of a transaction in a block, else in the pool, else undefined. */
      async get(id) {
        const confirmed = await optional(`/transactions/${id}?transform=true`);
        if (confirmed !== undefined) {
          return txRecord(confirmed);
        }
        const pending = await optional(`/transactions/unconfirmed/${id}`);
        return pending === undefined ? undefined : txRecord(pending);
      },

      /** The node's own JSON of a transaction in a block (not a method of the SDK's client). */
      async json(id) {
        return optional(`/transactions/${id}?transform=false`);
      },

      /** Waits until the transaction is in a block: its TxRecord. */
      async wait(id, { until = "confirmed", timeoutMs = 90_000, pollMs = 3_000 } = {}) {
        if (until !== "confirmed") {
          throw new Error(`this devnet has no finality: wait until "confirmed", not "${until}"`);
        }
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const record = await optional(`/transactions/${id}?transform=true`);
          if (record !== undefined) {
            return txRecord(record);
          }
          if (Date.now() > deadline) {
            throw new Error(`${id} was not forged within ${timeoutMs} ms`);
          }
          await sleep(pollMs);
        }
      },
    },

    validators: {
      /** ValidatorInfo of the first page of validators, by rank. */
      async list() {
        const [configuration, page] = await Promise.all([node.node.configuration(), data("/delegates?page=1&limit=100")]);
        return page.map((d) => ({
          name: d.username,
          address: d.address,
          publicKey: d.publicKey,
          ...(d.rank === undefined ? {} : { rank: d.rank }),
          status: d.isResigned
            ? d.resignationType === "permanent"
              ? "resigned-permanent"
              : "resigned-temporary"
            : d.rank !== undefined && d.rank >= 1 && d.rank <= configuration.seats
              ? "active"
              : "standby",
          ...(d.version === undefined ? {} : { version: d.version }),
        }));
      },

      /** ValidatorInfo of one validator by name, or undefined. */
      async get(name) {
        const d = await optional(`/delegates/${encodeURIComponent(name)}`);
        return d === undefined
          ? undefined
          : {
              name: d.username,
              address: d.address,
              status: d.isResigned ? (d.resignationType === "permanent" ? "resigned-permanent" : "resigned-temporary") : "active",
            };
      },
    },

    /** Submits signed transactions: a SubmitReport, one outcome per transaction in order. */
    async submit(signed) {
      const list = Array.isArray(signed) ? signed : [signed];
      const { status, body } = await request("POST", "/transactions", { transactions: list.map((tx) => tx.json) });
      if (status !== 200 && status !== 422) {
        throw new Error(`POST /transactions: HTTP ${status}: ${JSON.stringify(body)}`);
      }
      const accepted = new Set(body?.data?.accept ?? []);
      const broadcast = new Set(body?.data?.broadcast ?? []);
      const errors = body?.errors ?? {};
      return {
        outcomes: list.map((tx) => {
          if (accepted.has(tx.id)) {
            return { id: tx.id, outcome: { status: "accepted", broadcast: broadcast.has(tx.id) } };
          }
          const error = errors[tx.id] ?? { type: "ERR_UNKNOWN", message: JSON.stringify(body) };
          return {
            id: tx.id,
            outcome: { status: "rejected", reason: rejectionReason(error.type, error.message), nodeCode: error.type, message: error.message },
          };
        }),
      };
    },
  };
  return node;
}
