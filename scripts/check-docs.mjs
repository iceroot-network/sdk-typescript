#!/usr/bin/env node
// Checks the Markdown documentation (README.md and docs/**/*.md):
//   - every fenced code block is preceded by a sample status marker, and every marker by a code block;
//   - pending and later samples name what they depend on;
//   - relative links point at files that exist, and their anchors at headings that exist;
//   - no em dash or en dash is used.
//
//   node scripts/check-docs.mjs                 check, print a summary, exit 1 on a problem
//   node scripts/check-docs.mjs --list          also list every pending and later sample with its needs
//   node scripts/check-docs.mjs --needs         also list every name samples depend on, with where
//   node scripts/check-docs.mjs --extract DIR   also write each TypeScript and JavaScript sample to DIR
//
// Marker format, on the last non-blank line before the opening fence:
//   <!-- sample: pending; needs: connect, net.build.transfer -->
//   <!-- sample: later; needs: vote-library -->
//   <!-- sample: verified 0.1.0 -->
//   <!-- sample: plain -->
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = /^<!-- sample: (pending|later|verified|plain)(?: ([0-9]+\.[0-9]+\.[0-9]+))?(?:; needs: ([^>]+?))? -->$/;
const ANY_MARKER = /^<!-- sample:/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LINK = /!?\[(?:[^\]\\]|\\.)*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FORBIDDEN = [
  ["—", "em dash"],
  ["–", "en dash"],
];

// Run as a script; scripts/check-samples.mjs imports the parser. Node resolves symbolic links in
// the main module's path, so the path the script was started with is compared once resolved too;
// otherwise a checkout reached through a link would skip every check and pass.
const isMain = process.argv[1] !== undefined && pathToFileURL(realPath(process.argv[1])).href === import.meta.url;
const args = isMain ? process.argv.slice(2) : [];
const listSamples = args.includes("--list");
const listNeeds = args.includes("--needs");
const extractIndex = args.indexOf("--extract");
const extractDir = extractIndex >= 0 ? args[extractIndex + 1] : null;
if (extractIndex >= 0 && !extractDir) usage("--extract needs a directory");
for (const arg of args) {
  if (arg.startsWith("--") && !["--list", "--needs", "--extract"].includes(arg)) usage(`unknown option ${arg}`);
}

function realPath(file) {
  try {
    return realpathSync(path.resolve(file));
  } catch {
    return path.resolve(file);
  }
}

function usage(message) {
  console.error(`check-docs: ${message}\nusage: node scripts/check-docs.mjs [--list] [--needs] [--extract DIR]`);
  process.exit(2);
}

export async function markdownFiles() {
  const files = [path.join(ROOT, "README.md")];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
    }
  }
  await walk(path.join(ROOT, "docs"));
  return files;
}

/** GitHub's heading anchors: lowercase, punctuation removed, spaces to hyphens, repeats numbered. */
function slugger() {
  const seen = new Map();
  return (heading) => {
    const text = heading
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~]/g, (c) => (c === "_" ? "_" : ""))
      .trim()
      .toLowerCase();
    const base = text.replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

export function parse(file, text) {
  const lines = text.split("\n");
  const samples = [];
  const markers = [];
  const headings = new Set();
  const links = [];
  const problems = [];
  const slug = slugger();
  let fence = null;
  let lastNonBlank = null;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    for (const [char, name] of FORBIDDEN) {
      const column = line.indexOf(char);
      if (column >= 0) problems.push(`${file}:${lineNo}:${column + 1}: ${name} used; rephrase with a comma, colon or parentheses`);
    }
    if (fence) {
      const close = FENCE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length && close[2].trim() === "") {
        fence.sample.code = fence.body.join("\n");
        fence = null;
      } else {
        fence.body.push(line);
      }
      return;
    }
    const open = FENCE.exec(line);
    if (open) {
      const lang = open[2].trim().split(/\s+/)[0] || "";
      const sample = { file, line: lineNo, lang, status: null, version: null, needs: [], code: "" };
      const marker = lastNonBlank && ANY_MARKER.test(lastNonBlank.text.trim()) ? lastNonBlank : null;
      if (!marker) {
        problems.push(`${file}:${lineNo}: code block without a sample status marker on the line before it`);
      } else {
        marker.used = true;
        const match = MARKER.exec(marker.text.trim());
        if (!match) {
          problems.push(`${file}:${marker.line}: malformed sample marker: ${marker.text.trim()}`);
        } else {
          sample.status = match[1];
          sample.version = match[2] ?? null;
          sample.needs = (match[3] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
          if ((sample.status === "pending" || sample.status === "later") && sample.needs.length === 0) {
            problems.push(`${file}:${marker.line}: a ${sample.status} sample must list what it needs`);
          }
          if (sample.status === "verified" && !sample.version) {
            problems.push(`${file}:${marker.line}: a verified sample must name the release it was verified against`);
          }
          if ((sample.status === "plain" || sample.status === "verified") && sample.needs.length) {
            problems.push(`${file}:${marker.line}: a ${sample.status} sample has nothing pending; remove its needs`);
          }
        }
      }
      samples.push(sample);
      fence = { char: open[1][0], length: open[1].length, body: [], sample };
      lastNonBlank = null;
      return;
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) headings.add(slug(heading[1]));
    if (ANY_MARKER.test(line.trim())) {
      const entry = { line: lineNo, text: line, used: false };
      markers.push(entry);
      lastNonBlank = entry;
    } else if (line.trim() !== "") {
      lastNonBlank = { line: lineNo, text: line };
    }
    const withoutCode = line.replace(/`[^`]*`/g, "");
    for (const match of withoutCode.matchAll(LINK)) links.push({ line: lineNo, target: match[1] });
  });

  if (fence) problems.push(`${file}:${fence.sample.line}: code block is never closed`);
  for (const marker of markers) {
    if (!marker.used) problems.push(`${file}:${marker.line}: sample marker is not followed by a code block`);
  }
  return { samples, headings, links, problems };
}

async function exists(file) {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}

async function main() {
  const files = await markdownFiles();
  const parsed = new Map();
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) continue;
    parsed.set(file, { relative, ...parse(relative, text) });
  }

  const problems = [];
  for (const [file, doc] of parsed) {
    problems.push(...doc.problems);
    for (const link of doc.links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.target)) continue;   // https:, mailto: and other schemes
      const [targetPath, anchor] = link.target.split("#");
      const resolved = targetPath ? path.resolve(path.dirname(file), decodeURIComponent(targetPath)) : file;
      if (!resolved.startsWith(ROOT)) {
        problems.push(`${doc.relative}:${link.line}: link leaves the repository: ${link.target}`);
        continue;
      }
      const info = await exists(resolved);
      if (!info) {
        problems.push(`${doc.relative}:${link.line}: link target does not exist: ${link.target}`);
        continue;
      }
      if (anchor !== undefined && anchor !== "") {
        const target = parsed.get(resolved);
        if (!info.isFile() || !resolved.endsWith(".md") || !target) {
          problems.push(`${doc.relative}:${link.line}: anchor on a file that is not checked Markdown: ${link.target}`);
        } else if (!target.headings.has(anchor)) {
          problems.push(`${doc.relative}:${link.line}: no heading for anchor #${anchor} in ${target.relative}`);
        }
      }
    }
  }

  const samples = [...parsed.values()].flatMap((doc) => doc.samples);
  const counts = { pending: 0, later: 0, verified: 0, plain: 0 };
  for (const sample of samples) if (sample.status) counts[sample.status] += 1;

  if (listSamples) {
    console.log("Samples that still need checking:");
    for (const sample of samples.filter((s) => s.status === "pending" || s.status === "later")) {
      console.log(`  ${sample.file}:${sample.line}  ${sample.status}  ${sample.lang || "text"}  needs: ${sample.needs.join(", ")}`);
    }
  }

  if (listNeeds) {
    const needs = new Map();
    for (const sample of samples) {
      for (const name of sample.needs) {
        if (!needs.has(name)) needs.set(name, { pending: [], later: [] });
        needs.get(name)[sample.status === "later" ? "later" : "pending"].push(`${sample.file}:${sample.line}`);
      }
    }
    console.log("Names the samples depend on:");
    for (const name of [...needs.keys()].sort((a, b) => a.localeCompare(b))) {
      const entry = needs.get(name);
      const where = [...entry.pending, ...entry.later.map((item) => `${item} (later)`)];
      console.log(`  ${name}\n      ${where.join("\n      ")}`);
    }
  }

  if (extractDir) {
    const out = path.resolve(extractDir);
    await mkdir(out, { recursive: true });
    const extensions = { ts: "ts", tsx: "tsx", js: "js", mjs: "mjs", jsx: "jsx" };
    let written = 0;
    for (const sample of samples) {
      const extension = extensions[sample.lang];
      if (!extension) continue;
      const name = `${sample.file.replace(/\.md$/, "").replace(/[\\/]/g, "_")}-L${sample.line}.${extension}`;
      const header = `// ${sample.file}:${sample.line} status: ${sample.status ?? "unmarked"}${sample.needs.length ? `; needs: ${sample.needs.join(", ")}` : ""}\n`;
      await writeFile(path.join(out, name), header + sample.code + "\n");
      written += 1;
    }
    console.log(`Wrote ${written} samples to ${out}`);
  }

  for (const problem of problems) console.error(problem);
  console.log(
    `check-docs: ${parsed.size} files, ${samples.length} samples (${counts.pending} pending, ${counts.later} later, ${counts.verified} verified, ${counts.plain} plain), ${problems.length} problems`,
  );
  process.exit(problems.length ? 1 : 0);
}

if (isMain) await main();
