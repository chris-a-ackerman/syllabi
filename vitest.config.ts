import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Standalone test config — deliberately independent of vite.config.ts (which is
// Make-managed and loads React/Tailwind plugins the pure-logic tests don't need).
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
