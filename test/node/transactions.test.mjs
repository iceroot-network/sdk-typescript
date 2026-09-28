// Drafts and signed transactions (test/suites/transactions.js) through the WebAssembly builds: the
// Node build, the test build, and the browser build as a second module instance.

import { test } from "node:test";

import suite from "../suites/transactions.js";
import { nodeEnv } from "./env.mjs";

suite(test, await nodeEnv());
