// Assembles a quickstart of the documentation into a project directory, from its code samples as a
// reader copies them: each sample whose first line names a file (`// src/App.tsx`,
// `<!-- extension/wallet.html -->`) is written to that file, and `unnamed` names the files of the
// samples that carry no such line (a JSON manifest, a script the text names). The documented
// devnet origin, http://127.0.0.1:6003, is replaced with the devnet's, as the quickstarts tell the
// reader to do. Samples marked `later` are left out.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ROOT } from "../browser/install-package.mjs";

const DOCUMENTED_ORIGIN = "http://127.0.0.1:6003";
const MARKER = /^<!-- sample: (pending|later|verified|plain)\b/;
const FENCE = /^```(\w*)\s*$/;
const NAMED = /^(?:\/\/|<!--|#)\s*([\w.-]+(?:\/[\w.-]+)*\.(?:js|mjs|ts|tsx|html|json|toml|rs))\s*(?:-->)?$/;

/** The code samples of a Markdown file: `{ lang, status, code }`, in order. */
export function samples(markdown) {
  const lines = readFileSync(join(ROOT, markdown), "utf8").split("\n");
  const found = [];
  let status = null;
  for (let index = 0; index < lines.length; index += 1) {
    const marker = MARKER.exec(lines[index].trim());
    if (marker) {
      status = marker[1];
      continue;
    }
    const open = FENCE.exec(lines[index]);
    if (!open) {
      continue;
    }
    const body = [];
    for (index += 1; index < lines.length && !/^```\s*$/.test(lines[index]); index += 1) {
      body.push(lines[index]);
    }
    found.push({ lang: open[1], status, code: `${body.join("\n")}\n` });
    status = null;
  }
  return found;
}

/**
 * Writes the quickstart of `markdown` into `directory`. `unnamed` maps a language to the file of
 * its unnamed samples, in order (`{ json: ["extension/manifest.json"] }`). Returns the files written.
 */
export function assembleQuickstart(markdown, directory, { relay, unnamed = {} }) {
  const origin = new URL(relay).origin;
  const queues = Object.fromEntries(Object.entries(unnamed).map(([lang, files]) => [lang, [...files]]));
  const written = [];
  for (const sample of samples(markdown)) {
    if (sample.status === "later") {
      continue;
    }
    const first = sample.code.split("\n", 1)[0].trim();
    const name = NAMED.exec(first)?.[1] ?? queues[sample.lang]?.shift();
    if (name === undefined) {
      continue;
    }
    const file = join(directory, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, sample.code.replaceAll(DOCUMENTED_ORIGIN, origin));
    written.push(name);
  }
  for (const [lang, rest] of Object.entries(queues)) {
    if (rest.length > 0) {
      throw new Error(`${markdown} has no ${lang} sample for ${rest.join(", ")}`);
    }
  }
  return written;
}
