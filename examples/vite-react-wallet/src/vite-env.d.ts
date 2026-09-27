/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The devnet relay, API base path included, such as http://127.0.0.1:6003/api. */
  readonly VITE_ICEROOT_RELAY?: string;
}
