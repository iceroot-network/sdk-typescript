// Runs inside the container: opens the example application of examples/tauri-plugin, with its own
// page, through tauri-driver, and goes through the page as a holder would against the recorded
// node the relay serves at http://127.0.0.1:6003/api (the page's default relay): connect, create a
// phrase, encrypt it into a keystore, open the account from the keystore, sign a message. Prints
// one line starting with RESULT.
//
//   node example-smoke.mjs <application binary>

import { spawn } from "node:child_process";

const application = process.argv[2];
const DRIVER = "http://127.0.0.1:4444";
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

const driver = spawn("tauri-driver", [], { stdio: ["ignore", "inherit", "inherit"] });

async function webdriver(method, path, body) {
  const response = await fetch(`${DRIVER}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${JSON.stringify(payload)}`);
  }
  return payload.value;
}

async function newSession() {
  const capabilities = { capabilities: { alwaysMatch: { "tauri:options": { application } } } };
  for (let attempt = 0; ; attempt++) {
    try {
      return await webdriver("POST", "/session", capabilities);
    } catch (error) {
      if (attempt >= 60) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

let exitCode = 0;
try {
  const id = (await newSession()).sessionId;
  const element = async (selector) => (await webdriver("POST", `/session/${id}/element`, { using: "css selector", value: selector }))[ELEMENT];
  const text = async (selector) => webdriver("GET", `/session/${id}/element/${await element(selector)}/text`);
  const click = async (selector) => webdriver("POST", `/session/${id}/element/${await element(selector)}/click`, {});
  const type = async (selector, value) => webdriver("POST", `/session/${id}/element/${await element(selector)}/value`, { text: value });
  /** Waits until `selector`'s text passes `test`, or the page shows an error. */
  const until = async (selector, test, what) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await text(selector);
      if (test(value)) {
        return value;
      }
      const error = await text("#error");
      if (error !== "") {
        throw new Error(`${what}: the page shows ${error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`${what}: no result`);
  };

  const steps = {};
  await click("#connect");
  steps.network = JSON.parse(await until("#network", (value) => value.includes("nethash"), "connect"));
  await click("#create");
  const shown = await until("#phrase", (value) => value.includes("Write these 24 words"), "create");
  steps.words = shown.split("\n")[1]?.split(" ").length;
  await type("#password", "correct horse battery");
  await click("#keep");
  steps.keystore = await until("#phrase", (value) => value.startsWith("Encrypted: irks:"), "keep");
  await click("#open");
  steps.account = JSON.parse(await until("#account", (value) => value.includes("address"), "open"));
  await click("#sign");
  steps.signature = JSON.parse(await until("#signature", (value) => value.includes("verifies"), "sign"));
  await webdriver("DELETE", `/session/${id}`);
  console.log(`RESULT ${JSON.stringify(steps)}`);
} catch (error) {
  console.log(`RESULT ${JSON.stringify({ error: String(error) })}`);
  exitCode = 1;
} finally {
  driver.kill();
}
process.exit(exitCode);
