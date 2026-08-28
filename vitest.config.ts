import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Standalone test config — deliberately independent of vite.config.ts (which is
// Make-managed and loads React/Tailwind plugins the pure-logic tests don't need).
//
// Default environment stays `node` for the pure-logic tests. The few tests that
// need a DOM opt in per file with `// @vitest-environment jsdom`.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
