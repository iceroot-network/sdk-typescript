#!/usr/bin/env node
// Type-checks every TypeScript sample of the documentation that is marked verified, against the
// published declarations (dist/, so build first), with TypeScript 7.0 and 5.7.
//
//   node scripts/check-samples.mjs
//
// Samples are compiled as a reader assembles them:
//   - a sample whose first line names a file (`// src/App.tsx`, `// lib/iceroot.server.ts: ...`)
//     is written to that file in a project of its page, so the page's files import each other;
//   - every other sample is a fragment of the text around it. Fragments compile as modules of one
//     project, with test/samples/context.d.ts declaring the names the text defines before them
//     (`net`, `account`, `address` and so on).
// test/samples/modules.d.ts declares the modules an app installs that this repository does not
// (the Tauri packages). The projects are written to build/samples/.
//
// Samples marked pending or later are skipped and counted: they install the release by its URL or
// tag, which does not exist before the release, or wait for later milestones.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { markdownFiles, parse, ROOT } from "./check-docs.mjs";

const OUT = path.join(ROOT, "build", "samples");
const LANGS = new Set(["ts", "tsx"]);
const NAMED = /^\/\/\s*((?:[\w.-]+\/)*[\w.-]+\.tsx?)(?::.*)?$/;
const MODULE_SYNTAX = /^\s*(?:import|export)\b/m;
const COMPILERS = [
  ["TypeScript 7", path.join(ROOT, "node_modules", "typescript", "bin", "tsc")],
  ["TypeScript 5.7", path.join(ROOT, "node_modules", "typescript-5", "bin", "tsc")],
];

// An app's usual settings: strict, as the Vite and Next.js templates set it, in a bundler project
// with the DOM, Node and Vite's client types. The declarations themselves are checked under
// stricter settings by check-types.mjs.
const COMPILER_OPTIONS = {
  target: "ES2022",
  module: "ESNext",
  moduleResolution: "Bundler",
  lib: ["ES2022", "DOM", "DOM.Iterable"],
  types: ["node", "vite/client"],
  jsx: "react-jsx",
  strict: true,
  isolatedModules: true,
  skipLibCheck: true,
  noEmit: true,
};

async function main() {
  const samples = [];
  for (const file of await markdownFiles()) {
    const relative = path.relative(ROOT, file);
    samples.push(...parse(relative, readFileSync(file, "utf8")).samples);
  }

  const checked = samples.filter((sample) => sample.status === "verified" && LANGS.has(sample.lang));
  const skipped = samples.filter((sample) => sample.status === "pending" || sample.status === "later");

  rmSync(OUT, { recursive: true, force: true });
  const projects = new Map();
  const project = (name, extra = []) => {
    if (!projects.has(name)) {
      projects.set(name, { dir: path.join(OUT, name), files: new Set(), extra });
    }
    return projects.get(name);
  };
  const fragments = project("fragments", ["context.d.ts"]);

  for (const sample of checked) {
    const code = sample.code.endsWith("\n") ? sample.code : `${sample.code}\n`;
    const named = NAMED.exec(code.split("\n", 1)[0].trim());
    const page = sample.file.replace(/\.md$/, "").replace(/[\\/]/g, "_");
    let target;
    let text = `// ${sample.file}:${sample.line}\n${code}`;
    if (named) {
      target = project(page);
      const name = named[1];
      if (target.files.has(name)) {
        throw new Error(`${sample.file}:${sample.line}: a second sample names ${name}`);
      }
      target.files.add(name);
      write(path.join(target.dir, name), text);
    } else {
      target = fragments;
      const name = `${page}-L${sample.line}.${sample.lang}`;
      if (!MODULE_SYNTAX.test(code)) {
        text += "export {};\n";
      }
      target.files.add(name);
      write(path.join(target.dir, name), text);
    }
  }

  for (const [name, { dir, files, extra }] of projects) {
    for (const declaration of ["modules.d.ts", ...extra]) {
      copyFileSync(path.join(ROOT, "test", "samples", declaration), path.join(dir, declaration));
    }
    const config = {
      compilerOptions: COMPILER_OPTIONS,
      files: [...files, "modules.d.ts", ...extra].sort(),
    };
    write(path.join(dir, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
    projects.get(name).count = files.size;
  }

  let failed = false;
  for (const [compilerName, compiler] of COMPILERS) {
    for (const [name, { dir, count }] of projects) {
      try {
        execFileSync(process.execPath, [compiler, "-p", path.join(dir, "tsconfig.json")], { cwd: ROOT, stdio: "inherit" });
        console.log(`check-samples: ${compilerName} ${name} (${count} samples) ok`);
      } catch {
        console.error(`check-samples: ${compilerName} ${name} (${count} samples) failed`);
        failed = true;
      }
    }
  }

  const byLang = (list) =>
    [...LANGS].map((lang) => `${list.filter((sample) => sample.lang === lang).length} ${lang}`).join(", ");
  const needs = new Map();
  for (const sample of skipped) {
    for (const need of sample.needs) needs.set(need, (needs.get(need) ?? 0) + 1);
  }
  const pending = skipped.filter((sample) => sample.status === "pending").length;
  const later = skipped.length - pending;
  console.log(
    `check-samples: ${checked.length} verified TypeScript samples type-checked (${byLang(checked)}) in ${projects.size} projects; ` +
      `skipped ${pending} pending and ${later} later samples (${[...needs].map(([need, count]) => `${need} ${count}`).join(", ")})`,
  );
  process.exit(failed ? 1 : 0);
}

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

await main();
