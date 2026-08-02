import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['vendor/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // The catalogue and placement engines are frozen contracts; an unused
      // export or a stray variable there is a signal worth failing CI over.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-implicit-coercion': ['error', { boolean: false }],
    },
  },
  {
    files: ['app.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['tests/**/*.mjs', 'babel-v3.js', 'world-engine.js', 'world-model.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
