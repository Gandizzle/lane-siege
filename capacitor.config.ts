/**
 * Capacitor: the Android wrapper. DESIGN.md §15.2, §17 (M6).
 *
 * §1 says Android first, portrait, one-handed. Capacitor is the shell that
 * makes the same build an installable app: a WebView, the web build inside it,
 * and no second codebase. Nothing in `src/` knows it is running inside one.
 *
 * Two settings here are load-bearing:
 *
 *   - `webDir` is Vite's output. The app is served from the filesystem rather
 *     than from a host, so the build that goes in here must be made with
 *     `VITE_BASE=./` - an absolute base resolves to the device's filesystem
 *     root and every asset 404s. `npm run build:android` does both.
 *   - The background colour matches `UI.background` in src/render/palette.ts,
 *     so the WebView does not flash white before the first frame.
 *
 * The multiplayer server is NOT bundled. An installed app still reaches a room
 * the same way the web build does, by being pointed at one (§15.2), which is
 * why `androidScheme` stays https: a WebView on http is treated as insecure
 * content and modern Android blocks the WebSocket upgrade.
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lanesiege.app',
  appName: 'Lane Siege',
  webDir: 'dist',
  android: {
    // Vector shapes only (§14.2), so there is nothing to gain from a larger
    // backing store and a mid-range phone keeps the fill rate (§15.3).
    webContentsDebuggingEnabled: true,
  },
  server: {
    androidScheme: 'https',
  },
  backgroundColor: '#11131a',
};

export default config;
