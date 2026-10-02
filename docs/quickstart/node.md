# Quickstart: Node script

A script that connects to a local devnet, creates an account, funds it from a devnet test account and sends a transfer with a memo. It ends with the transfer confirmed in a block. Use it to check that the SDK and the devnet work before wiring an app.

Requirements: Node.js 22 or later, a running devnet (see [Devnet](../devnet.md)) and the passphrase of one of its funded test accounts.

## 1. Create the project

<!-- sample: pending; needs: release-tarball -->
```sh
mkdir iceroot-node-quickstart && cd iceroot-node-quickstart
npm init -y
npm pkg set type=module
npm install https://github.com/iceroot-network/sdk-typescript/releases/download/v0.1.0/iceroot-network-sdk-0.1.0.tgz
```

## 2. Write the script

Save as `transfer.mjs`:

<!-- sample: verified 0.1.0 -->
```js
import { init, connect, profiles, Mnemonic, Amount, IceRootError, balanceOf } from "@iceroot-network/sdk";

const relay = process.env.ICEROOT_RELAY ?? "http://127.0.0.1:6003/api";
const fundingPassphrase = process.env.DEVNET_FUNDING_PASSPHRASE;
if (!fundingPassphrase) throw new Error("Set DEVNET_FUNDING_PASSPHRASE to a funded devnet test account's passphrase.");

await init();
const net = await connect(profiles.devnet({ relays: [relay] }));
const { decimals, symbol } = net.token;
const show = (units) => `${Amount.format(units, decimals)} ${symbol}`;
console.log(`Connected: stage ${net.stage}, network ${net.profile.chain.nethash}`);

// A devnet test account (legacy passphrase key, devnet only) and a new 24-word account.
const funder = net.keys.fromLegacyPassphrase(fundingPassphrase);
const phrase = Mnemonic.generate();
const alice = net.keys.fromPhrase(phrase, { account: 0, index: 0 });
console.log(`New account ${alice.address}. Devnet only: keep the phrase out of logs in real code.`);

async function send(from, to, amountText, memo) {
  const draft = await net.build.transfer({
    from,                                   // an Account here, since the script holds the keys; its public key works too, its address only once it has sent a transaction
    to: [{ address: to, amount: Amount.parse(amountText, decimals) }],
    memo,
    fee: "minimum",
  });
  console.log("Review:", draft.summary, "fee", show(draft.fee));
  const signed = draft.sign(from);
  const result = await net.submit(signed);
  if (result.status !== "accepted") throw new Error(`Refused: ${result.reason} (${result.nodeCode})`);
  const outcome = await net.transactions.wait(signed.id, { until: "confirmed", timeoutMs: 120_000 });
  if (outcome.state === "dropped") throw new Error(`${signed.id} was dropped from the pool`);
  console.log(`${signed.id} ${outcome.state} with ${outcome.confirmations} confirmation(s)`);
}

try {
  await send(funder, alice.address, "100", "quickstart funding");
  await send(alice, funder.address, "1.5", "hello from the SDK");
  const info = await net.accounts.get(alice.address);
  console.log(`Balance of the new account: ${show(balanceOf(info))}`);
} catch (error) {
  if (error instanceof IceRootError) console.error(`${error.code}: ${error.message}`, error.details);
  throw error;
} finally {
  funder.release();
  alice.release();
}
```

## 3. Run it

<!-- sample: plain -->
```sh
DEVNET_FUNDING_PASSPHRASE='<twelve words of a funded devnet test account>' node transfer.mjs
```

The output ends with two transaction ids, each `confirmed`, and the new account's balance: 100 received, minus 1.5 sent, minus the fee shown in the second review. Amounts show the token's symbol as the network configures it, `dRT` on today's devnet.

## What to notice

- `connect` pinned the devnet's identity. A real app stores `net.profile.chain.nethash` and passes it back as `nethash` next time.
- `net.build.transfer` read the sender's nonce from the node and the next block's height, and checked the transfer against that block's rules before anything was signed.
- Amounts are `bigint` base units from `Amount.parse`, and the fee comes from the draft. Nothing in the script knows the decimals or the fee.
- `draft.summary` is what a review screen shows. A script prints it; an app renders it.
- The status is `confirmed`, not `final`: today's devnet has no finality.

## Next steps

- Send to several recipients: pass up to 256 entries in `to`. One transaction pays them all, with one id and one memo.
- Vote: `net.build.vote({ from, entries })`, with entries from `net.validators.list()`.
- Wire an app: see the [integration guides](../README.md#reading-order).
