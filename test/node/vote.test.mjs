// The vote library (test/suites/vote.js) through the WebAssembly builds.

import { test } from "node:test";

import suite from "../suites/vote.js";
import { nodeEnv } from "./env.mjs";

suite(test, await nodeEnv());
