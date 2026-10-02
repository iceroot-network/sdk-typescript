// Installs the package into a test context the way an app gets it: packed with npm pack and
// extracted into the context's node_modules (the release tarball's layout).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname;

/** Packs dist/ and extracts it into `contextDir`/node_modules/@iceroot-network/sdk. */
export function installPackedPackage(contextDir) {
  const packDir = mkdtempSync(join(tmpdir(), "iceroot-sdk-pack-"));
  try {
    const [{ filename }] = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], { cwd: ROOT, encoding: "utf8" }),
    );
    const target = join(contextDir, "node_modules", "@iceroot-network", "sdk");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    execFileSync("tar", ["-xzf", join(packDir, filename), "-C", target, "--strip-components=1"]);
    return target;
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}
