/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The game server a release build connects to, as `wss://play.example.com`
   * (docs/GO-LIVE.md §5, §6). Absent in the test build, which is pointed at
   * one with `?server=`.
   */
  readonly VITE_SERVER?: string;
  /** Which build: `web` or `android` for a release, absent for the test build (buildInfo.ts). */
  readonly VITE_EDITION?: string;
}

/** package.json's version, written in by vite.config.ts. */
declare const __APP_VERSION__: string | undefined;
/** The commit the build was made from, where the builder says (vite.config.ts). */
declare const __APP_BUILD__: string | undefined;
