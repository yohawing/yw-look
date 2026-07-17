import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "src-tauri/target",
      // Alembic helper regeneration can populate third-party assets that
      // should not be linted as application source.
      "src-tauri/vcpkg_installed",
      "public",
      "src/vendor/FBXLoaderPatched.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler advisory: fires when an existing manual useMemo /
      // useCallback can't be preserved by the compiler. It flags missed
      // auto-memoization opportunities, not correctness bugs, and the
      // compiler isn't part of this build. Several pre-existing sites in
      // App.tsx trip it; keep the signal as a warning rather than failing
      // CI on optimization hints.
      "react-hooks/preserve-manual-memoization": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["vite.config.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ["scripts/**/*.mjs", "samples/private/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
);
