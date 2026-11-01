import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts'],
    // Several dev sessions share this machine; the default 5 s timed out under load.
    testTimeout: 30_000,
  },
});
