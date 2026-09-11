import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the build from /<repo>/, so the base path is not '/'.
// Override with VITE_BASE when hosting elsewhere (Capacitor needs './').
const base = process.env.VITE_BASE ?? '/lane-siege/';

export default defineConfig({
  base,
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
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
