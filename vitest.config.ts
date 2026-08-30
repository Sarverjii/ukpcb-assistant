import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Local-model embedding + a real Postgres round trip: give this more
    // room than vitest's 5s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      // Mirrors tsconfig.json's "@/*": ["./*"] since vitest resolves
      // modules through Vite, not the TypeScript compiler.
      '@': path.resolve(__dirname, '.'),
    },
  },
});
