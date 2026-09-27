/**
 * The node API client.
 *
 * The client is sans-IO: the Rust core builds each request and parses each response, and the host
 * performs the HTTP call through a transport with the signature of `fetch`. Tauri apps pass the
 * HTTP plugin's `fetch`, so requests leave from Rust. The client arrives with the Rust core; this
 * module defines the transport and connection types.
 *
 * @module
 */

import type { Capability, FormatStage } from "./types.js";

/** A function with the signature of `fetch` that performs the SDK's HTTP requests. */
export type Transport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Options of `connect`. */
export interface ConnectOptions {
  /** The transport; `globalThis.fetch` by default. */
  readonly transport?: Transport;
  /** Extra headers for every request, for a relay behind a proxy that needs a token. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** The capabilities of a connected network. */
export interface Capabilities {
  /** Whether the network offers `capability`. */
  has(capability: Capability): boolean;
}

/** A node's status. */
export interface NodeStatus {
  /** Whether the node is synced with the network. */
  readonly synced: boolean;
  /** The node's height. */
  readonly height: bigint;
  /** The format stage of the next block. */
  readonly stage: FormatStage;
}
