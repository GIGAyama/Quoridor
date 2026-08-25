import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  /* ⚠️ .claude/skills/ は正本（GIGAyama.github.io/standards/skills/）の写しで、
     このアプリのコードではない。中身は Node で動く道具（process / console /
     Buffer を使う）なので、ブラウザ向けのこの設定に当てると no-undef で落ちる。
     直せるのは正本の側だけなので、ここでは見ない。ずれは check-drift が見ている。 */
  { ignores: ['dist', 'node_modules', '.claude/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.serviceworker },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['vite.config.js', 'tailwind.config.js', 'postcss.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // 計測ツールと品質ゲートは Node で走る。
    // ブラウザへ流し込む文字列の中に window / document が出てくるので、
    // 両方の globals を許可する（no-undef を必ず通しておく。
    // import 漏れはビルドを通過して実行時に落ちるため）。
    files: ['tools/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
