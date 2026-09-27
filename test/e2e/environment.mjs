// The devnet the end-to-end tests run against, as the harness describes it in the environment
// (see run.mjs), and the files the tests leave for the Rust SDK to check.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set: run the end-to-end tests with npm run test:e2e`);
  }
  return value;
}

/**
 * The relay, the last height the chain may reach, the artifacts directory, and the passphrase of
 * the genesis wallet that funds this test: `ICEROOT_E2E_FUNDER`, else `defaultFunder`. Each test
 * that runs at the same time uses its own genesis wallet, so their nonces never collide.
 */
export function e2eEnvironment(defaultFunder) {
  const funder = process.env.ICEROOT_E2E_FUNDER || defaultFunder;
  const wallets = JSON.parse(readFileSync(required("ICEROOT_E2E_WALLETS"), "utf8"));
  const wallet = wallets.genesis.find((entry) => entry.label === funder);
  if (wallet === undefined) {
    throw new Error(`the devnet has no genesis wallet ${funder}`);
  }
  return {
    relay: required("ICEROOT_E2E_RELAY"),
    maxHeight: Number(required("ICEROOT_E2E_MAX_HEIGHT")),
    artifacts: required("ICEROOT_E2E_ARTIFACTS"),
    funder,
    funderPassphrase: wallet.passphrase,
  };
}

/**
 * Leaves a scenario's signed message and transactions for the Rust SDK's end-to-end test, which
 * verifies the message natively and reads the transactions back.
 */
export function writeArtifacts(directory, report) {
  writeFileSync(join(directory, `typescript-${report.label}.message.json`), `${JSON.stringify(report.message, null, 2)}\n`);
  writeFileSync(join(directory, `typescript-${report.label}.transactions.json`), `${JSON.stringify(report.transactions, null, 2)}\n`);
}
