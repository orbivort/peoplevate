import globals from 'globals';
import tseslint from 'typescript-eslint';
import baseConfig from '@peoplevate/eslint-config';

export default tseslint.config(
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  { ignores: ['src/generated'] },
);
