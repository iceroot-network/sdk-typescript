// The node API client (test/suites/client.js) through the WebAssembly builds, against the
// devnet answers recorded in sdk-rust's iceroot-sdk-api fixtures, reached through a transport in
// the process.

import { test } from "node:test";

import suite from "../suites/client.js";
import { nodeEnv } from "./env.mjs";

suite(test, await nodeEnv());
