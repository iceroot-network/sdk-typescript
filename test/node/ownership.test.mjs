// Ownership proofs (test/suites/ownership.js) through the WebAssembly builds.

import { test } from "node:test";

import "../shared/ownership-checks.js";
import suite from "../suites/ownership.js";
import { nodeEnv } from "./env.mjs";

suite(test, { ...(await nodeEnv()), ownershipChecks: globalThis.IceRootOwnershipChecks });
