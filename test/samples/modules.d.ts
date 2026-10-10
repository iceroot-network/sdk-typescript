// Modules the documentation's apps install that this repository does not: their declarations as
// far as the samples use them.

declare module "@tauri-apps/plugin-http" {
  export const fetch: typeof globalThis.fetch;
}

declare module "@tauri-apps/api/core" {
  export function isTauri(): boolean;
}
