// Runs the ownership proof vectors in Chromium: every record through the published browser build's
// ownership entry point, and the signing records through the test build's seam for fixed
// auxiliary bytes. The test serves the vectors at /vectors/S08-ownership-proofs.jsonl.

const output = document.getElementById("report");

async function main() {
  const sdk = await import("/dist/web/index.js");
  const testSdk = await import("/build/test/dist/web/index.js");
  await sdk.init();
  await testSdk.init();
  const ownership = await import("/dist/web/ownership.js");
  const text = await (await fetch("/vectors/S08-ownership-proofs.jsonl")).text();
  const records = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((record) => record.op !== "meta");
  const report = await globalThis.IceRootOwnershipChecks.run(ownership, { ...testSdk.testing, ownership: testSdk.ownership }, records);
  return { ...report, records: records.length };
}

main().then(
  (report) => {
    output.textContent = JSON.stringify(report, null, 2);
    output.dataset.done = "true";
  },
  (error) => {
    output.textContent = JSON.stringify({ ok: false, error: String(error) });
    output.dataset.done = "true";
  },
);
