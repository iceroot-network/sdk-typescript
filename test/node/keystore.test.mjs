// The keystore (test/suites/keystore.js) through the WebAssembly builds.

import { test } from "node:test";

import suite from "../suites/keystore.js";
import { nodeEnv } from "./env.mjs";

suite(test, await nodeEnv());
