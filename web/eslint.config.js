import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '../server/web-dist/**', 'eslint.config.js', 'svelte.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] } },
  },
  {
    rules: {
      // Raw HTML rendering is banned (XSS); Svelte escapes everything else.
      'svelte/no-at-html-tags': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
