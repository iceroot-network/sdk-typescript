#!/usr/bin/env node
// Publishes a GitHub release of the package: the tarball that `npm pack` makes, the WebAssembly
// module and its embedded-bytes file on their own, and SHA256SUMS, with release notes.
//
//   node scripts/release.mjs [--tag vX.Y.Z] [--no-build] [--require-on BRANCH] [--dry-run]
//
// --tag           the release tag (default: $GITHUB_REF_NAME); it must be v<version of package.json>
//                 and point at the checked-out commit
// --no-build      use build/pack/ as `npm run pack` left it, instead of building it again
// --require-on    refuse unless the commit is on origin/BRANCH (the release workflow passes prod)
// --dry-run       print the notes and the assets, publish nothing
//
// The release workflow (.github/workflows/release.yml) runs this for every pushed v* tag, after
// the checks and tests. It needs the GitHub CLI with a token that may write releases (GH_TOKEN).
// The build is built from sdk-rust next to this repository, which the workflow checks out at the
// same tag.
//
// The notes say how to install the release, what it contains, the notes written for the version in
// release-notes/<tag>.md (what an application must know: changed or removed interfaces), the
// assets and the commits since the previous tag.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(root, "build", "pack");
const repository = "iceroot-network/sdk-typescript";

const { values: options } = parseArgs({
  options: {
    tag: { type: "string", default: process.env.GITHUB_REF_NAME },
    "no-build": { type: "boolean", default: false },
    "require-on": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

main();

function main() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tag = options.tag;
  if (tag !== `v${pkg.version}`) {
    fail(`the tag ${tag ?? "(none)"} is not v${pkg.version}, the version in package.json`);
  }
  const head = git(root, "rev-parse", "HEAD");
  const tagged = gitOrNull(root, "rev-parse", `${tag}^{commit}`);
  if (tagged === null) {
    fail(`the tag ${tag} does not exist here`);
  }
  if (tagged !== head) {
    fail(`the tag ${tag} is ${tagged}, but the checkout is ${head}`);
  }
  if (git(root, "status", "--porcelain", "--untracked-files=no") !== "") {
    fail("the working tree has changes; a release is built from the tagged commit only");
  }
  if (options["require-on"] !== undefined) {
    const branch = `origin/${options["require-on"]}`;
    if (gitOrNull(root, "merge-base", "--is-ancestor", head, branch) === null) {
      fail(`${head} is not on ${branch}`);
    }
  }

  if (!options["no-build"]) {
    run(process.execPath, [join(root, "scripts", "build.mjs"), "--pack"], root);
  }
  const assets = checkAssets(pkg);
  const notes = releaseNotes(pkg, tag, head, assets);

  if (options["dry-run"]) {
    process.stdout.write(`release: ${tag} (dry run), assets:\n`);
    for (const asset of assets.files) process.stdout.write(`  ${asset}\n`);
    process.stdout.write(`\n${notes}`);
    return;
  }
  const notesFile = join(mkdtempSync(join(tmpdir(), "release-")), "notes.md");
  writeFileSync(notesFile, notes);
  const args = ["release", "create", tag, ...assets.files.map((file) => join(packDir, file))];
  args.push("--repo", repository, "--title", `${pkg.name} ${pkg.version}`, "--notes-file", notesFile, "--verify-tag");
  if (pkg.version.includes("-")) {
    args.push("--prerelease");
  }
  run("gh", args, root);
  process.stdout.write(`release: published ${tag}\n`);
}

// The assets in build/pack/, each checked against SHA256SUMS.
function checkAssets(pkg) {
  const tarball = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
  const expected = [tarball, "iceroot_sdk_bg.wasm", "iceroot-sdk-bytes.js", "SHA256SUMS"];
  if (!existsSync(packDir)) {
    fail("build/pack/ is missing: run npm run pack, or leave out --no-build");
  }
  const present = readdirSync(packDir).sort();
  const missing = expected.filter((file) => !present.includes(file));
  const extra = present.filter((file) => !expected.includes(file));
  if (missing.length > 0 || extra.length > 0) {
    fail(`build/pack/ should hold exactly ${expected.join(", ")} (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
  }
  const sums = readFileSync(join(packDir, "SHA256SUMS"), "utf8");
  const listed = new Map(
    sums
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/))
      .map(([digest, file]) => [file, digest]),
  );
  for (const file of expected.filter((f) => f !== "SHA256SUMS")) {
    const digest = sha256(readFileSync(join(packDir, file)));
    if (listed.get(file) !== digest) {
      fail(`${file} does not match SHA256SUMS`);
    }
  }
  // The module in the tarball's builds is the one attached on its own.
  const listing = execFileSync("tar", ["-xOzf", join(packDir, tarball), "package/dist/web/iceroot_sdk_bg.wasm"]);
  const module = readFileSync(join(packDir, "iceroot_sdk_bg.wasm"));
  if (!listing.equals(module)) {
    fail("the module attached on its own differs from the one in the tarball");
  }
  return { files: expected, tarball, sums, module };
}

function releaseNotes(pkg, tag, head, assets) {
  const url = `https://github.com/${repository}/releases/download/${tag}/${assets.tarball}`;
  const sdkRust = join(root, "..", "sdk-rust");
  const sdkRustCommit = gitOrNull(sdkRust, "rev-parse", "HEAD") ?? "unknown";
  const sdkRustTag = gitOrNull(sdkRust, "describe", "--tags", "--exact-match", "HEAD");
  const heartwood = heartwoodSource();
  const profiles = builtProfiles();
  const bindgen = lockedVersion("wasm-bindgen");
  const previous = gitOrNull(root, "describe", "--tags", "--abbrev=0", "--match", "v*", `${head}^`);
  const changes = git(root, "log", "--no-merges", "--format=- %s", previous ? `${previous}..${head}` : head)
    .split("\n")
    .filter(Boolean);
  const written = versionNotes(tag);

  return `Install from this release, with no registry account or token:

\`\`\`sh
npm install ${url}
\`\`\`

Imports use the package name, \`${pkg.name}\`, so moving to a registry later changes only the dependency line.

## Contents

- sdk-rust: ${sdkRustTag ? `${sdkRustTag} (${sdkRustCommit})` : sdkRustCommit}
- heartwood-crypto: ${heartwood}
- Profiles: ${profiles}
- WebAssembly module: ${assets.module.length} bytes, ${gzipSync(assets.module, { level: 9 }).length} bytes gzipped; the web, Node and classic-script builds share it
- Built with Rust ${rustVersion()} and wasm-bindgen ${bindgen}
${written ? `\n## Notes\n\n${written}\n` : ""}
## Assets

| Asset | What it is |
|---|---|
| \`${assets.tarball}\` | The npm package, with the WebAssembly module built |
| \`iceroot_sdk_bg.wasm\` | The WebAssembly module on its own, for hosts that serve it separately |
| \`iceroot-sdk-bytes.js\` | The same module as an embedded byte array (global \`IceRootSdkWasmBytes\`) |
| \`SHA256SUMS\` | SHA-256 of each asset above |

\`\`\`text
${assets.sums.trim()}
\`\`\`

Check a download with \`sha256sum --check --ignore-missing SHA256SUMS\` (on macOS, \`shasum -a 256 --check --ignore-missing SHA256SUMS\`).

## Changes${previous ? ` since ${previous}` : ""}

${changes.join("\n") || "- No changes."}
`;
}

// The notes written for this version, if any.
function versionNotes(tag) {
  const file = join(root, "release-notes", `${tag}.md`);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

// Where heartwood-crypto comes from, as wasm/Cargo.lock records it.
function heartwoodSource() {
  const lock = readFileSync(join(root, "wasm", "Cargo.lock"), "utf8");
  const match = /\[\[package\]\]\nname = "heartwood-crypto"\nversion = "([^"]+)"\nsource = "git\+([^"]+)"/.exec(lock);
  if (match === null) {
    fail("wasm/Cargo.lock has no git source for heartwood-crypto");
  }
  const [, version, source] = match;
  const [location, commit] = source.split("#");
  const url = new URL(location.replace(/^ssh:\/\/git@[^/]+\//, "https://github.com/"));
  const pin = url.searchParams.get("tag") ?? url.searchParams.get("rev") ?? url.searchParams.get("branch");
  const repo = `${url.origin}${url.pathname.replace(/\.git$/, "")}`;
  return `${version} from ${repo}${pin ? ` at ${pin}` : ""} (commit ${commit})`;
}

function lockedVersion(name) {
  const lock = readFileSync(join(root, "wasm", "Cargo.lock"), "utf8");
  return new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`).exec(lock)?.[1] ?? "unknown";
}

function rustVersion() {
  try {
    return execFileSync("rustc", ["--version"], { cwd: join(root, "wasm"), encoding: "utf8" }).trim().split(" ")[1];
  } catch {
    return "unknown";
  }
}

// The built-in profiles of the built Node package, with their backends.
function builtProfiles() {
  const script = `
    const { profiles } = await import(${JSON.stringify(join(root, "dist", "node", "index.js"))});
    const out = [];
    for (const [name, make] of Object.entries(profiles)) {
      try {
        const p = make({ relays: ["http://127.0.0.1:1/api"] });
        out.push(p.id + " (backend " + p.backend + ", keys " + p.keyScheme + ")");
      } catch {
        out.push(name);
      }
    }
    console.log(out.join(", "));
  `;
  try {
    return execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim();
  } catch {
    fail("the built Node package could not be loaded to list its profiles");
  }
}

// Helpers ------------------------------------------------------------------------------------

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitOrNull(cwd, ...args) {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function fail(message) {
  process.stderr.write(`release: ${message}\n`);
  process.exit(1);
}
