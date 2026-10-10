// Runs inside the container: starts tauri-driver, opens the application through WebDriver, waits
// for the page's report and prints it on one line starting with RESULT.
//
//   node smoke.mjs <application binary> [seconds to wait]

import { spawn } from "node:child_process";

const application = process.argv[2];
const seconds = Number(process.argv[3] ?? "600");
const DRIVER = "http://127.0.0.1:4444";

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
  const session = await newSession();
  const id = session.sessionId;
  let report = null;
  const deadline = Date.now() + seconds * 1000;
  while (report === null && Date.now() < deadline) {
    report = await webdriver("POST", `/session/${id}/execute/sync`, {
      script: "const e = document.getElementById('report'); return e && e.dataset.done ? e.textContent : null;",
      args: [],
    });
    if (report === null) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await webdriver("DELETE", `/session/${id}`);
  if (report === null) {
    throw new Error(`the page wrote no report within ${seconds} s`);
  }
  console.log(`RESULT ${report}`);
} catch (error) {
  console.log(`RESULT ${JSON.stringify({ error: String(error) })}`);
  exitCode = 1;
} finally {
  driver.kill();
}
process.exit(exitCode);
