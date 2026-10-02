// Browser projects only: a compiled module is accepted where bytes are.

import { init, initSync } from "@iceroot-network/sdk";

export async function compiled(module: WebAssembly.Module, response: Promise<Response>): Promise<void> {
  initSync(module);
  await init(module);
  await init(response);
}
