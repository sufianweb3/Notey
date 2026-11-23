import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', '.vercel', '.wrangler', 'node_modules', 'src/web/routeTree.gen.ts', 'src/server/db/migrations', '.claude', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Hard rule 1: server and shared code must run on Workers, Vercel and Node.
    files: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*', 'fs', 'path', 'os', 'child_process', 'buffer'], message: 'Web APIs only in src/server and src/shared. Put Node code in src/adapters or src/entry/node.ts.' }] },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Read config from the env passed into createApp.' },
        { name: 'Buffer', message: 'Use Uint8Array, TextEncoder and btoa.' },
        { name: '__dirname', message: 'Not available on Workers.' },
      ],
    },
  },
);
