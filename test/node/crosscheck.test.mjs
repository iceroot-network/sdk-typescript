// Independent cross-checks on 1,000 phrases each (test/suites/crosscheck.js) through the
// WebAssembly builds, against @noble and @scure.

import { test } from "node:test";

import suite from "../suites/crosscheck.js";
import { nodeEnv } from "./env.mjs";

suite(test, await nodeEnv());
