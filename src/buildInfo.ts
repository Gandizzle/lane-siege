/**
 * Which build this is: what crash reports say they came from
 * (net/crashReporter.ts), and whether the test switches are on.
 *
 *   `web`      the release web version, on its own domain (docs/GO-LIVE.md §6)
 *   `android`  the release Android app
 *   `test`     the GitHub Pages build, with every test switch (main.ts)
 *   `dev`      `npm run dev`
 *
 * The edition and the server a release connects to are set when it is built
 * (`npm run build:web`, `npm run build:android`); the version is package.json's
 * and the commit is whatever the builder says it built.
 */

import type { BuildInfo } from './net/crashReporter.ts';

export const EDITION: string =
  import.meta.env.VITE_EDITION || (import.meta.env.DEV ? 'dev' : 'test');

/** A release: what players get, with the test switches off. */
export const RELEASE = EDITION === 'web' || EDITION === 'android';

export const BUILD_INFO: BuildInfo = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  build: typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '',
  edition: EDITION,
};
