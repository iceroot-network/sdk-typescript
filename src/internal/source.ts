// What the module can be loaded from.

/**
 * A compiled `WebAssembly.Module`. Derived from the global scope so that the declarations also
 * compile in projects whose libraries do not declare the WebAssembly namespace.
 */
export type CompiledWasmModule = typeof globalThis extends {
  WebAssembly: { Module: abstract new (...args: never[]) => infer M };
}
  ? M
  : never;

/** The module's bytes, or the module already compiled. */
export type WasmModuleBytes = ArrayBuffer | ArrayBufferView | CompiledWasmModule;

/**
 * Where to load the module from: a URL (as text or `URL`), a `Request`, a `Response` or a promise
 * of one, the module's bytes, or the module already compiled.
 */
export type WasmSource =
  | string
  | URL
  | Request
  | Response
  | Promise<Response>
  | WasmModuleBytes;
