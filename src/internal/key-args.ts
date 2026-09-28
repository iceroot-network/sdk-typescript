// The arguments of key derivation, checked the same way by the WebAssembly entry and the Tauri
// plugin's entry.

import { InvalidArgument } from "../errors.js";

/** An account number or address index: 0 when absent, else an integer from 0 to 2^31 - 1. */
export function pathNumber(value: number | undefined, name: string): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new InvalidArgument(`the ${name} is an integer from 0 to 2147483647`, { [name]: value });
  }
  return value;
}
