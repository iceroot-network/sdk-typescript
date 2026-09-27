// The example wallet (examples/vite-react-wallet) against the devnet, in Chromium: its production
// build under its page policy, installed from the packed package as an app gets it. It creates a
// wallet and keeps it as a keystore, unlocks it after a reload and refuses a wrong password,
// restores an 18-word phrase and refuses 12 words, sends to two recipients through the review
// screen, votes in each of the four modes with every pick's reasons on the review screen (a mode
// that tops up says so), flags a validator that resigned when the vote is checked, and signs in to
// a website after checking its message.
//
// Run by run.mjs against the devnet the harness started, funded by one genesis wallet
// (ICEROOT_E2E_FUNDER, by default team-placeholder-1). Before the votes, a validator registers
// without running a node: it ranks within Diversity's pool, but a node refuses a vote naming it,
// so no selection may pick it. A genesis validator whose key is in the devnet's
// delegate-keys.json resigns for the check; the new validator keeps the seats filled.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { preview, type PreviewServer } from "vite";

import * as sdk from "../../dist/node/index.js";
import { MODE_NAMES, type Mode } from "../../dist/node/vote.js";
import { buildExample, EXAMPLE, prepareExample } from "../../scripts/example.mjs";
import { e2eEnvironment } from "./environment.mjs";

test.describe.configure({ mode: "serial" });

const ROOT_UNIT = 100_000_000n;
const PASSWORD = "example wallet password";
const WEBSITE = "https://validators.example";

let known: ReturnType<typeof e2eEnvironment> | undefined;
/** The devnet the harness started, read when a test first needs it. */
function env() {
  known ??= e2eEnvironment("team-placeholder-1");
  return known;
}

let net: sdk.Network;
let server: PreviewServer;
let url = "";
/** The wallet created in the page (context A) and the one restored (context B). */
const created = { context: undefined as BrowserContext | undefined, page: undefined as Page | undefined, address: "" };
const restored = { context: undefined as BrowserContext | undefined, page: undefined as Page | undefined, address: "", phrase: "" };
const errors: string[] = [];
/** The validator registered without a node. */
const NODELESS = "examplewallet";

/** The pages' requests to the node and their answers, printed when a test fails. */
const traffic: string[] = [];

async function openPage(browser: Browser, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => traffic.push(`${name} console ${message.type()}: ${message.text()}`));
  page.on("response", (response) => {
    if (response.url().startsWith(env().relay)) {
      traffic.push(`${new Date().toISOString()} ${name} ${response.request().method()} ${response.url().slice(env().relay.length)} ${response.status()}`);
    }
  });
  page.on("requestfailed", (request) => traffic.push(`${new Date().toISOString()} ${name} ${request.method()} ${request.url()} failed: ${request.failure()?.errorText}`));
  await page.goto(url);
  return { context, page };
}

test.afterEach(({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    console.log(`The pages' last requests to the node:\n${traffic.slice(-60).join("\n")}`);
  }
});

/** Waits until `id` is in a block. */
async function confirmed(signed: sdk.SignedTransaction) {
  const outcome = await net.submit(signed);
  expect(outcome.status, JSON.stringify(outcome)).toBe("accepted");
  const waited = await net.transactions.wait(signed.id, { until: "confirmed", timeoutMs: 120_000 });
  expect(waited.state).toBe("confirmed");
}

function units(amount: bigint): string {
  return `${sdk.Amount.format(amount, net.token.decimals, { grouping: true })} ${net.token.symbol}`;
}

/** Waits for the page to say the transaction is in a block; fails with the page's refusal when it says one. */
async function expectConfirmed(page: Page) {
  const confirmed = page.getByRole("status").filter({ hasText: "Confirmed in block" });
  const refused = page.getByRole("alert");
  await expect(confirmed.or(refused).first()).toBeVisible({ timeout: 180_000 });
  if (await refused.count()) {
    throw new Error(`the wallet reports: ${await refused.first().textContent()}`);
  }
  await expect(confirmed).toContainText("Not final");
}

async function keepWallet(page: Page) {
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Keep the wallet" }).click();
}

test.beforeAll(async () => {
  test.setTimeout(10 * 60_000);
  prepareExample();
  await buildExample(env().relay);
  server = await preview({ root: EXAMPLE, configFile: join(EXAMPLE, "vite.config.ts"), logLevel: "warn", preview: { host: "127.0.0.1", port: 0 } });
  url = server.resolvedUrls?.local[0] ?? "";
  expect(url).not.toBe("");
  const html = await (await fetch(url)).text();
  expect(html).toContain("script-src &#39;self&#39; &#39;wasm-unsafe-eval&#39;");

  // The page and this test share the node's request allowance for one address.
  net = await sdk.connect(sdk.profiles.devnet({ relays: [env().relay] }), { rateLimit: { requests: 30, windowMs: 60_000 } });

  // An 18-word account to restore, and an account that registers as a validator without running
  // a node. It ranks just below the genesis validators, within Diversity's pool, but a node refuses
  // a vote naming it; it also keeps every seat filled when a genesis validator resigns for the
  // check. Both are funded now.
  restored.phrase = generateMnemonic(wordlist, 192);
  const restoredKey = net.keys.fromPhrase(restored.phrase, { account: 0, index: 0 });
  restored.address = restoredKey.address;
  restoredKey.release();
  const validator = net.keys.fromPhrase(sdk.Mnemonic.generate(), { account: 0, index: 0 });
  const funder = net.keys.fromLegacyPassphrase(env().funderPassphrase);
  try {
    const funding = await net.build.transfer({
      from: funder,
      to: [
        { address: restored.address, amount: 1_000n * ROOT_UNIT },
        { address: validator.address, amount: 100n * ROOT_UNIT },
      ],
      memo: "example wallet funding",
    });
    await confirmed(funding.sign(funder));
    const registration = await net.build.registerValidator({ from: validator, name: NODELESS });
    await confirmed(registration.sign(validator));
  } finally {
    funder.release();
    validator.release();
  }
});

test.afterAll(async () => {
  await created.context?.close();
  await restored.context?.close();
  await server?.close();
});

test("creates a wallet, keeps it as a keystore and unlocks it after a reload", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const { context, page } = await openPage(browser, "created");
  Object.assign(created, { context, page });
  await page.getByRole("button", { name: "Create a new wallet" }).click();
  const words = await page.getByRole("list", { name: "Recovery phrase" }).locator("li").allTextContents();
  expect(words).toHaveLength(24);
  await page.getByRole("button", { name: "I wrote the words down" }).click();
  // A wrong word is refused, then the right ones pass.
  const asked = await page.getByLabel(/^Word \d+$/).evaluateAll((inputs) => inputs.map((input) => input.parentElement?.textContent ?? ""));
  expect(asked).toHaveLength(2);
  for (const label of asked) {
    await page.getByLabel(label.trim()).fill("wrong");
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("do not match");
  for (const label of asked) {
    const position = Number(/\d+/.exec(label)?.[0]);
    await page.getByLabel(label.trim()).fill(words[position - 1] ?? "");
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await keepWallet(page);

  const phrase = words.join(" ");
  const key = net.keys.fromPhrase(phrase, { account: 0, index: 0 });
  created.address = key.address;
  key.release();
  await expect(page.getByLabel("Account address")).toHaveText(created.address, { timeout: 60_000 });
  await expect(page.getByLabel("Balance")).toHaveText(units(0n), { timeout: 60_000 });

  // Only the keystore is kept: no word sequence of the phrase, and the keystore opens with the
  // password to exactly this phrase.
  const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  const kept = JSON.parse(storage["iceroot.example.wallet"] ?? "{}");
  expect(kept.address).toBe(created.address);
  expect(kept.keystore).toMatch(/^irks:/);
  expect(JSON.stringify(storage)).not.toContain(words.slice(0, 2).join(" "));
  const keystore = await import("../../dist/node/keystore.js");
  const opened = keystore.decrypt(kept.keystore, PASSWORD);
  expect(new TextDecoder().decode(opened.phrase)).toBe(phrase);
  expect(keystore.inspect(kept.keystore).memoryKib).toBe(keystore.PRESETS.web.memoryKib);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Unlock your wallet" })).toBeVisible();
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password.", { timeout: 60_000 });
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByLabel("Account address")).toHaveText(created.address, { timeout: 60_000 });
});

test("restores an 18-word phrase, and refuses a 12-word one", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const { context, page } = await openPage(browser, "restored");
  Object.assign(restored, { context, page });
  await page.getByRole("button", { name: "Restore from a recovery phrase" }).click();
  await page.getByLabel("Recovery phrase (18, 21 or 24 words)").fill(generateMnemonic(wordlist, 128));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("18, 21 or 24 words; this one has 12");
  expect(restored.phrase.split(" ")).toHaveLength(18);
  await page.getByLabel("Recovery phrase (18, 21 or 24 words)").fill(`  ${restored.phrase.replaceAll(" ", "\n")} `);
  await page.getByRole("button", { name: "Continue" }).click();
  await keepWallet(page);
  await expect(page.getByLabel("Account address")).toHaveText(restored.address, { timeout: 60_000 });
  await expect(page.getByLabel("Balance")).toHaveText(units(1_000n * ROOT_UNIT), { timeout: 60_000 });
});

test("sends to two recipients through the review screen", async () => {
  test.setTimeout(5 * 60_000);
  const page = restored.page!;
  const other = net.keys.fromPhrase(sdk.Mnemonic.generate(), { account: 0, index: 0 });
  const otherAddress = other.address;
  other.release();

  await page.getByRole("tab", { name: "Send" }).click();
  await page.getByRole("group", { name: "Recipient 1" }).getByLabel("Address").fill("dNotAnAddress");
  await page.getByRole("group", { name: "Recipient 1" }).getByLabel(/^Amount in /).fill("1");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("alert")).toContainText("Check the address of recipient 1");

  await page.getByRole("group", { name: "Recipient 1" }).getByLabel("Address").fill(created.address);
  await page.getByRole("group", { name: "Recipient 1" }).getByLabel(/^Amount in /).fill("12.5");
  await page.getByRole("button", { name: "Add a recipient" }).click();
  await page.getByRole("group", { name: "Recipient 2" }).getByLabel("Address").fill(otherAddress);
  await page.getByRole("group", { name: "Recipient 2" }).getByLabel(/^Amount in /).fill("0.75");
  await page.getByLabel("Memo (optional)").fill("example wallet e2e");
  await page.getByRole("button", { name: "Review" }).click();

  await expect(page.getByRole("heading", { name: "Review the transfer" })).toBeVisible({ timeout: 60_000 });
  const lines = page.getByRole("list", { name: "What you sign" });
  await expect(lines).toContainText(created.address);
  await expect(lines).toContainText(otherAddress);
  await expect(lines).toContainText("example wallet e2e");
  await page.getByRole("button", { name: "Sign and send" }).click();
  await expectConfirmed(page);

  expect(sdk.balanceOf(await net.accounts.get(created.address))).toBe(1_250_000_000n);
  expect(sdk.balanceOf(await net.accounts.get(otherAddress))).toBe(75_000_000n);
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("list", { name: "History" })).toContainText(`Sent ${units(1_325_000_000n)} to 2 recipients`, { timeout: 60_000 });

  // The created wallet sees what it received.
  const createdPage = created.page!;
  await createdPage.getByRole("button", { name: "Refresh" }).click();
  await expect(createdPage.getByLabel("Balance")).toHaveText(units(1_250_000_000n), { timeout: 60_000 });
  await expect(createdPage.getByRole("list", { name: "History" })).toContainText(`Received ${units(1_250_000_000n)} from ${restored.address}`);
});

/** The picks of the review screen, each with its reasons. */
async function reviewedPicks(page: Page) {
  const picks = page.getByRole("list", { name: "Picks" }).locator(":scope > li");
  return picks.evaluateAll((items) =>
    items.map((item) => ({
      validator: item.querySelector("strong")?.textContent ?? "",
      share: item.querySelector(".pick > span")?.textContent ?? "",
      source: item.querySelector(".pick > .meta")?.textContent ?? "",
      reasons: [...item.querySelectorAll("ul > li")].map((reason) => reason.textContent ?? ""),
    })),
  );
}

/**
 * Waits until the node has seen every genesis validator's node running and the validator
 * registered without a node has a rank (ranks are set when a round starts). A node refuses a vote
 * naming a validator that has not resigned and has no announced node version (ERR_OFFLINE), and
 * the snapshot leaves such validators out: on a fresh devnet that is every validator until its
 * node is seen, and the validator registered without a node for good.
 */
async function validatorsReady() {
  await expect(async () => {
    const listing = await net.validators.list({ page: 1, limit: 100 });
    const unseen = listing.items.filter((validator) => validator.status.startsWith("resigned") === false && validator.version === undefined);
    expect(unseen.map((validator) => validator.name)).toEqual([NODELESS]);
    // Within Diversity's pool by rank (the 53 seats and the next 10), so only the missing node
    // keeps it out of a selection.
    expect(unseen[0]?.rank ?? Infinity).toBeLessThanOrEqual(63);
  }).toPass({ timeout: 12 * 60_000, intervals: [8_000] });
}

test("votes in each of the four modes, with every pick's reasons, and a mode that tops up says so", async () => {
  test.setTimeout(25 * 60_000);
  await validatorsReady();
  const page = restored.page!;
  await page.getByRole("tab", { name: "Vote" }).click();
  await expect(page.getByText(/validators at height \d+/)).toBeVisible({ timeout: 180_000 });

  const modes: Mode[] = ["reliability", "maximum-rewards", "support-newcomers", "diversity"];
  for (const mode of modes) {
    const name = MODE_NAMES[mode];
    await page.getByRole("radio", { name: new RegExp(`^${name} `) }).check();
    await page.getByRole("button", { name: "Select validators" }).click();
    await expect(page.getByRole("heading", { name: `Review your vote: ${name}` })).toBeVisible({ timeout: 60_000 });

    let picks = await reviewedPicks(page);
    expect(picks).toHaveLength(20);
    expect(picks.map((pick) => pick.validator)).not.toContain(NODELESS);
    for (const pick of picks) {
      expect(pick.share).toBe("5%");
      expect(pick.reasons.length, `${mode}: ${pick.validator}`).toBeGreaterThan(1);
      expect(pick.reasons.some((reason) => /^Drawn at step \d+ /.test(reason)), JSON.stringify(pick)).toBe(true);
    }
    const notice = page.getByRole("note", { name: "Top-up notice" });
    if (mode === "diversity") {
      // The recommended mode needs no top-up; drawing again gives other picks.
      await expect(notice).toHaveCount(0);
      expect(picks.every((pick) => pick.source === "From Diversity")).toBe(true);
      const first = picks.map((pick) => pick.validator).sort();
      await page.getByRole("button", { name: "Draw again" }).click();
      await expect(async () => {
        picks = await reviewedPicks(page);
        expect(picks.map((pick) => pick.validator).sort()).not.toEqual(first);
      }).toPass({ timeout: 30_000 });
      expect(picks.map((pick) => pick.validator)).not.toContain(NODELESS);
    } else {
      // Today's devnet has no payouts, declarations or 7 days of seats: these modes top up from
      // Diversity, and the review screen says so.
      await expect(notice).toContainText("Diversity");
      expect(picks.some((pick) => pick.source === "Top-up from Diversity")).toBe(true);
    }
    await expect(page.getByText(/^Signing replaces your current vote with these 20 validators\. Fee: /)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Sign and submit vote" }).click();
    await expectConfirmed(page);

    // The vote on chain is exactly the one reviewed.
    const onChain = (await net.accounts.get(restored.address)).vote;
    expect(onChain.map((entry) => entry.validator).sort()).toEqual(picks.map((pick) => pick.validator).sort());
    expect(onChain.every((entry) => entry.basisPoints === 500)).toBe(true);
  }
  await expect(page.getByRole("region", { name: "Your vote" })).toContainText("Diversity, 20 validators");
});

test("a check flags a validator of the vote that resigned", async () => {
  test.setTimeout(8 * 60_000);
  const page = restored.page!;
  const vote = (await net.accounts.get(restored.address)).vote.map((entry) => entry.validator);
  const delegates: { username: string; passphrase: string }[] = JSON.parse(
    readFileSync(join(dirname(process.env.ICEROOT_E2E_WALLETS ?? ""), "delegate-keys.json"), "utf8"),
  ).delegates;
  const resigning = delegates.find((delegate) => vote.includes(delegate.username));
  expect(resigning, `a genesis validator among ${vote.join(", ")}`).toBeDefined();
  // The validator registered without a node keeps every seat filled: a resignation that would
  // leave a seat empty is refused.
  const key = net.keys.fromLegacyPassphrase(resigning!.passphrase);
  try {
    const resignation = await net.build.resignValidator({ from: key, resignation: "temporary" });
    await confirmed(resignation.sign(key));
  } finally {
    key.release();
  }

  await page.getByRole("button", { name: "Check my vote" }).click();
  const result = page.getByLabel("Check result");
  await expect(result.getByRole("status")).toHaveText("19 of 20 validators still meet their criteria.", { timeout: 180_000 });
  const flagged = page.getByRole("list", { name: "No longer meet their criteria" });
  await expect(flagged.locator("li")).toHaveCount(1);
  await expect(flagged).toContainText(`${resigning!.username}: `);
  await expect(flagged).toContainText("resigned");
  // Nothing was recast: the vote on chain is unchanged.
  expect((await net.accounts.get(restored.address)).vote.map((entry) => entry.validator)).toEqual(vote);
});

test("signs in to a website only after checking its message", async () => {
  test.setTimeout(3 * 60_000);
  const page = restored.page!;
  await page.getByRole("tab", { name: "Sign in" }).click();
  const publicKey = await page.getByLabel("Public key").first().inputValue();
  const now = new Date();
  const message = sdk.SignIn.build(
    {
      origin: WEBSITE,
      publicKey,
      nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60_000),
    },
    net,
  );

  // A message for another website is refused before anything is offered for signing.
  await page.getByLabel("Website (origin)").fill("https://elsewhere.example");
  await page.getByLabel("Sign-in message").fill(message);
  await page.getByRole("button", { name: "Check the message" }).click();
  await expect(page.getByRole("alert")).toContainText("Do not sign this message");
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);

  await page.getByLabel("Website (origin)").fill(WEBSITE);
  await page.getByRole("button", { name: "Check the message" }).click();
  await expect(page.getByLabel("Sign-in request")).toContainText(WEBSITE);
  await expect(page.getByLabel("Sign-in request")).toContainText(restored.address);
  await page.getByRole("button", { name: "Sign in" }).click();
  const signed = JSON.parse(await page.getByLabel("Signature for the website").inputValue());
  expect(signed.publicKey).toBe(publicKey);
  // The website's side: the same checks, and the signature verifies for the message.
  const fields = sdk.SignIn.parse(message, net, { origin: WEBSITE, address: restored.address, publicKey, now: new Date() });
  expect(fields.address).toBe(restored.address);
  expect(sdk.Messages.verify({ ...signed, message }, net)).toBe(true);
  expect(sdk.Messages.verify({ ...signed, message: `${message} ` }, net)).toBe(false);
  expect(errors).toEqual([]);
});
