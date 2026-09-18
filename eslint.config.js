import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // backend/ is Deno, not Vite — it has its own toolchain and CI job.
  { ignores: ['dist', 'node_modules', 'backend'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      // Must stay last: turns off stylistic rules that Prettier owns.
      prettier,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // Unused args/vars prefixed with _ are an intentional signal, not an error.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // The three rules below are warnings, not errors, because they flag
      // pre-existing patterns throughout the app rather than new mistakes.
      // Demoting them keeps `npm run lint` actionable; re-promote to "error"
      // once the existing violations are burned down.

      // React Compiler-era rule (eslint-plugin-react-hooks v7). Flags the
      // "sync state from props in an effect" pattern used across the modals
      // and pages. Fixing these is a behavioural refactor, tracked separately.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',

      // HMR ergonomics only. shadcn/ui components legitimately export variant
      // objects alongside components, and routes.tsx exports route elements.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: { globals: globals.node },
  }
);
