import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: { port: 5173, fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1500 },
  // NTCS_SCRIPTS=1 runs the generators in scripts/ (e.g. the component-library doc) instead of the tests
  test: { include: process.env.NTCS_SCRIPTS ? ['scripts/**/*.test.ts'] : ['tests/**/*.test.ts'], environment: 'node' },
});
