import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the build from /<repo>/, so the base path is not '/'.
// Override with VITE_BASE when hosting elsewhere (Capacitor needs './').
const base = process.env.VITE_BASE ?? '/lane-siege/';

// What crash reports say they came from (src/buildInfo.ts): the version, and
// the commit, from whichever builder made it - GitHub, Cloudflare or Railway.
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const build =
  process.env.GITHUB_SHA ??
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  '';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(build.slice(0, 12)),
  },
  resolve: {
    alias: {
      '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
      '@data': fileURLToPath(new URL('./src/data', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
      '@util': fileURLToPath(new URL('./src/util', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
