import js from '@eslint/js';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'web-dist/**', 'public-legacy/**', 'node_modules/**', 'eslint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Object lookups here are keyed by validated enums; the rule is noisy for that pattern.
      'security/detect-object-injection': 'off',
      // Paths are built from validated codes under fixed roots (see routes/logos.ts).
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-unsafe-member-access': 'off', '@typescript-eslint/no-unsafe-assignment': 'off', '@typescript-eslint/no-unsafe-argument': 'off' },
  },
);
