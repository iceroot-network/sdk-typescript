// The quickstarts of the documentation, assembled from their samples and run against the devnet:
// the Node script, the Manifest V3 extension (wallet page, sandbox and service worker), the Vite and
// React wallet, and the Next.js routes and client component (a webpack production build, and the
// Turbopack development server). Each installs the package from its packed tarball, as an app
// does, and must end where its page says it ends.
//
// Run by run.mjs after the Node and Chromium scenarios, against the devnet the harness started.
// The quickstarts are funded from one genesis wallet (ICEROOT_E2E_FUNDER, by default
// team-placeholder-1), one after the other.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, expect, test } from "@playwright/test";
import { build, preview } from "vite";

import * as sdk from "../../dist/node/index.js";
import { installPackedPackage, ROOT } from "../browser/install-package.mjs";
import { e2eEnvironment } from "./environment.mjs";
import { assembleQuickstart, samples } from "./quickstarts.mjs";

test.describe.configure({ mode: "serial" });

let known: ReturnType<typeof e2eEnvironment> | undefined;
/** The devnet the harness started, read when a test first needs it. */
function env() {
  known ??= e2eEnvironment("team-placeholder-1");
  return known;
}
const PROJECTS = join(ROOT, "build", "quickstarts");
const ROOT_UNIT = 100_000_000n;

/** The connected devnet, for funding the quickstarts' accounts and checking what they did. */
async function devnet() {
  return sdk.connect(sdk.profiles.devnet({ relays: [env().relay] }), { rateLimit: { requests: 30, windowMs: 60_000 } });
}

/** A new 24-word account funded with `amount` from the genesis wallet: its phrase and address. */
async function fundedPhrase(amount: bigint) {
  const net = await devnet();
  const funder = net.keys.fromLegacyPassphrase(env().funderPassphrase);
  const phrase = sdk.Mnemonic.generate();
  const account = net.keys.fromPhrase(phrase, { account: 0, index: 0 });
  try {
    const draft = await net.build.transfer({ from: funder, to: [{ address: account.address, amount }], memo: "quickstart funding" });
    const signed = draft.sign(funder);
    const outcome = await net.submit(signed);
    expect(outcome.status).toBe("accepted");
    const waited = await net.transactions.wait(signed.id, { until: "confirmed", timeoutMs: 120_000 });
    expect(waited.state).toBe("confirmed");
    return { phrase, address: account.address };
  } finally {
    funder.release();
    account.release();
  }
}

/** A fresh address to send to, and its balance as the node reports it. */
async function recipient() {
  const net = await devnet();
  const key = net.keys.fromPhrase(sdk.Mnemonic.generate(), { account: 0, index: 0 });
  const address = key.address;
  key.release();
  return { address, balance: async () => sdk.balanceOf(await net.accounts.get(address)) };
}

test("the Node quickstart sends two transfers", async () => {
  test.setTimeout(10 * 60_000);
  const project = join(PROJECTS, "node");
  rmSync(project, { recursive: true, force: true });
  assembleQuickstart("docs/quickstart/node.md", project, { relay: env().relay, unnamed: { js: ["transfer.mjs"] } });
  writeFileSync(join(project, "package.json"), `${JSON.stringify({ name: "iceroot-node-quickstart", private: true, type: "module" }, null, 2)}\n`);
  installPackedPackage(project);

  const run = spawnSync(process.execPath, ["transfer.mjs"], {
    cwd: project,
    encoding: "utf8",
    timeout: 8 * 60_000,
    env: { ...process.env, ICEROOT_RELAY: env().relay, DEVNET_FUNDING_PASSPHRASE: env().funderPassphrase },
  });
  console.log(run.stdout);
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  expect(run.stdout).toContain("Connected: stage s1");
  expect(run.stdout.match(/^[0-9a-f]{64} confirmed with [1-9][0-9]* confirmation\(s\)$/gm)).toHaveLength(2);
  const { symbol } = (await devnet()).token;
  expect(run.stdout).toMatch(new RegExp(`Balance of the new account: 98\\.[0-9]+ ${symbol}\n`));
});

test("the Manifest V3 quickstart signs in its sandbox and sends a transfer", async () => {
  test.setTimeout(10 * 60_000);
  const project = join(PROJECTS, "mv3-extension");
  rmSync(project, { recursive: true, force: true });
  assembleQuickstart("docs/quickstart/mv3-extension.md", project, {
    relay: env().relay,
    unnamed: { json: ["extension/manifest.json"] },
  });
  installPackedPackage(project);
  const copy = spawnSync(process.execPath, ["scripts/copy-sdk.mjs"], { cwd: project, encoding: "utf8" });
  expect(copy.status, copy.stderr).toBe(0);

  const sender = await fundedPhrase(10n * ROOT_UNIT);
  const payee = await recipient();
  const extension = join(project, "extension");
  const profileDir = mkdtempSync(join(tmpdir(), "iceroot-sdk-quickstart-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    // The service worker loaded the SDK from its embedded bytes and checks sign-in messages.
    const refused = await worker.evaluate(() => {
      // @ts-expect-error: the worker's global, from importScripts
      const sdk = IceRootSdk;
      const devnet = sdk.profiles.devnet({ relays: ["http://127.0.0.1:1/api"] });
      const key = sdk.Keys.fromLegacyPassphrase("quickstart worker check", devnet);
      try {
        sdk.SignIn.parse("not a sign-in message", devnet, {
          origin: "https://example.com",
          publicKey: key.publicKey,
          address: key.address,
          now: new Date(),
        });
        return "accepted";
      } catch (error) {
        return (error as { code?: string }).code;
      } finally {
        key.release();
      }
    });
    expect(refused).toBe("InvalidSignIn");

    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => console.log(`mv3: ${message.text()}`));
    await page.goto(`chrome-extension://${id}/wallet.html`);
    await page.fill("#phrase", sender.phrase);
    await page.fill("#to", payee.address);
    await page.fill("#amount", "1.25");
    await page.click("#send button");
    await expect(page.locator("#review")).toContainText("Fee:", { timeout: 60_000 });
    await expect(page.locator("#review")).toContainText(sender.address);
    await page.click("#confirm");
    await expect(page.locator("#status")).toContainText("Confirmed (", { timeout: 180_000 });
    expect(errors).toEqual([]);
    expect(await payee.balance()).toBe(125_000_000n);
  } finally {
    await context.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("the Vite and React quickstart restores an account and sends a transfer", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const project = join(PROJECTS, "vite-react");
  rmSync(project, { recursive: true, force: true });
  assembleQuickstart("docs/quickstart/vite-react.md", project, { relay: env().relay });
  // What `npm create vite --template react-ts` provides, with the page policy of the quickstart.
  const policy = samples("docs/quickstart/vite-react.md").find((sample) => sample.lang === "html")?.code.trim();
  expect(policy).toContain("wasm-unsafe-eval");
  writeFileSync(
    join(project, "index.html"),
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    ${policy?.replaceAll("http://127.0.0.1:6003", new URL(env().relay).origin)}\n    <title>IceRoot wallet</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
  );
  writeFileSync(
    join(project, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          types: ["vite/client"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  );
  installPackedPackage(project);
  const types = spawnSync(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", project], { encoding: "utf8" });
  expect(types.stdout + types.stderr).toBe("");

  process.env.VITE_ICEROOT_RELAY = env().relay;
  await build({ root: project, logLevel: "warn" });
  const server = await preview({ root: project, logLevel: "warn", preview: { host: "127.0.0.1", port: 0 } });
  try {
    const sender = await fundedPhrase(10n * ROOT_UNIT);
    const payee = await recipient();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(server.resolvedUrls?.local[0] ?? "");
    await page.fill("textarea", sender.phrase);
    await page.click("button[type=submit]");
    await expect(page.locator("main > p").first()).toHaveText(sender.address, { timeout: 60_000 });
    const { symbol } = (await devnet()).token;
    await expect(page.locator("h2")).toHaveText(`10 ${symbol}`, { timeout: 60_000 });
    await page.fill("input[placeholder='Recipient address']", payee.address);
    await page.fill(`input[placeholder='Amount in ${symbol}']`, "2.5");
    await page.fill("input[placeholder='Memo (optional)']", "quickstart");
    await page.click("button[type=submit]");
    await expect(page.locator("h2", { hasText: "Review transfer" })).toBeVisible({ timeout: 60_000 });
    await page.click("text=Sign and send");
    await expect(page.locator("[role=status]")).toContainText("Confirmed in a block", { timeout: 180_000 });
    expect(errors).toEqual([]);
    expect(await payee.balance()).toBe(250_000_000n);
  } finally {
    await server.close();
    delete process.env.VITE_ICEROOT_RELAY;
  }
});

/** A free local port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

/** Starts `next <args>` in `project` and resolves once it answers on `port`; returns a stop function. */
async function nextServer(project: string, args: string[], port: number, env: Record<string, string>) {
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), ...args, "-p", String(port), "-H", "127.0.0.1"], {
    cwd: project,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`next ${args.join(" ")} exited: ${output}`);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill();
        throw new Error(`next ${args.join(" ")} did not start: ${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return {
    output: () => output,
    stop: () => new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    }),
  };
}

test("the Next.js quickstart serves its routes and client component, built with webpack and run with Turbopack", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const project = join(PROJECTS, "nextjs");
  rmSync(project, { recursive: true, force: true });
  assembleQuickstart("docs/quickstart/nextjs.md", project, { relay: env().relay });
  // What an app already has: a root layout, and a page that shows the search box.
  mkdirSync(join(project, "app"), { recursive: true });
  writeFileSync(
    join(project, "app", "layout.tsx"),
    'export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n',
  );
  writeFileSync(
    join(project, "app", "page.tsx"),
    '"use client";\nimport { useState } from "react";\nimport { Search } from "../components/Search";\n\nexport default function Page() {\n  const [found, setFound] = useState("");\n  return (\n    <main>\n      <Search onSearch={(kind, value) => setFound(`${kind}:${value}`)} />\n      <p id="found">{found}</p>\n    </main>\n  );\n}\n',
  );
  writeFileSync(join(project, "package.json"), `${JSON.stringify({ name: "iceroot-nextjs-quickstart", private: true }, null, 2)}\n`);
  installPackedPackage(project);
  // An app brings its own TypeScript 5 for Next.js's type check.
  symlinkSync(join(ROOT, "node_modules", "typescript-5"), join(project, "node_modules", "typescript"), "dir");

  const serverEnv = { ICEROOT_RELAY: env().relay, PUBLIC_ORIGIN: "https://validators.example" };
  const built = spawnSync(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
    cwd: project,
    encoding: "utf8",
    timeout: 8 * 60_000,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...serverEnv },
  });
  expect(built.status, built.stdout + built.stderr).toBe(0);

  const net = await devnet();
  const key = net.keys.fromPhrase(sdk.Mnemonic.generate(), { account: 0, index: 0 });
  const publicKey = key.publicKey;
  const address = key.address;
  key.release();

  for (const [mode, args] of [
    ["webpack production build", ["start"]],
    ["Turbopack development server", ["dev", "--turbopack"]],
  ] as const) {
    const port = await freePort();
    const server = await nextServer(project, [...args], port, serverEnv);
    try {
      const base = `http://127.0.0.1:${port}`;
      const validators = await fetch(`${base}/api/validators`);
      const listing = await validators.json();
      expect(validators.status, `${mode}: ${JSON.stringify(listing)} ${server.output()}`).toBe(200);
      expect(listing.meta).toEqual({ network: "devnet", stage: "s1" });
      expect(listing.data.items.length).toBeGreaterThan(0);
      expect(typeof listing.data.items[0].voteWeight).toBe("string");

      const challenge = await fetch(`${base}/api/auth/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey }),
      });
      const issued = await challenge.json();
      expect(challenge.status, `${mode}: ${JSON.stringify(issued)}`).toBe(200);
      expect(issued.address).toBe(address);
      expect(issued.network).toBe("heartwood-devnet-v90");
      expect(issued.message).toContain("\nOrigin: https://validators.example\n");
      const bad = await fetch(`${base}/api/auth/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey: `02${"00".repeat(32)}` }),
      });
      expect(bad.status).toBe(400);

      const errors: string[] = [];
      page.removeAllListeners("pageerror");
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(base);
      const box = page.locator("input[placeholder='Address, block height or validator']");
      await box.fill("12");
      await box.press("Enter");
      await expect(page.locator("#found")).toHaveText("height:12");
      // The web build loads in the client component; then an address is recognised as one.
      await expect(async () => {
        await box.fill(address);
        await box.press("Enter");
        await expect(page.locator("#found")).toHaveText(`address:${address}`, { timeout: 1_000 });
      }).toPass({ timeout: 60_000 });
      await box.fill("Genesis_1");
      await box.press("Enter");
      await expect(page.locator("#found")).toHaveText("name:genesis_1");
      expect(errors).toEqual([]);
    } finally {
      await server.stop();
    }
  }
});
