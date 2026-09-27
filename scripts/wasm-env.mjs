// The C toolchain for compiling libsecp256k1 to wasm32-unknown-unknown: clang with the wasm32
// target and llvm-ar. CC_wasm32_unknown_unknown and AR_wasm32_unknown_unknown choose them;
// otherwise the first of clang, clang-22 ... clang-15 (and llvm-ar likewise) on the PATH is used.

import { execFileSync } from "node:child_process";

function versions(name) {
  const list = [name];
  for (let major = 22; major >= 15; major--) {
    list.push(`${name}-${major}`);
  }
  return list;
}

function firstCommand(candidates, accept) {
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      if (accept(candidate)) {
        return candidate;
      }
    } catch {
      // Not installed; try the next one.
    }
  }
  return undefined;
}

function targetsWasm(clang) {
  try {
    return execFileSync(clang, ["--print-targets"], { encoding: "utf8" }).includes("wasm32");
  } catch {
    return false;
  }
}

/** The environment variables that point cargo's C builds at the wasm32 toolchain. */
export function wasmCompilerEnv() {
  const cc = process.env.CC_wasm32_unknown_unknown ?? firstCommand(versions("clang"), targetsWasm);
  const ar = process.env.AR_wasm32_unknown_unknown ?? firstCommand(versions("llvm-ar"), () => true);
  if (cc === undefined || ar === undefined) {
    throw new Error("clang and llvm-ar with the wasm32 target are needed for libsecp256k1");
  }
  return { CC_wasm32_unknown_unknown: cc, AR_wasm32_unknown_unknown: ar };
}
