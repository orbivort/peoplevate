import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import baseConfig from '@peoplevate/eslint-config';

const reactHooksConfig = reactHooks.configs.flat['recommended-latest'];

export default tseslint.config(...baseConfig, {
  files: ['**/*.{ts,tsx}'],
  languageOptions: {
    globals: globals.browser,
  },
  plugins: {
    ...reactHooksConfig.plugins,
    'react-refresh': reactRefresh,
  },
  rules: {
    ...reactHooksConfig.rules,
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
});
