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
      // C++ backend build outputs. vcpkg_installed/ ships third-party
      // JS assets (hwloc visualizer etc.) that trip no-undef /
      // no-array-constructor; cpp-artifacts/ is pure .dll / .dylib
      // but a future port could drop JS there too. Both dirs are
      // gitignored and never materialize on CI, so ignoring them
      // only shuts up local runs on machines that built the C++
      // backend.
      "src-tauri/vcpkg_installed",
      "src-tauri/cpp-artifacts",
      "public",
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
    files: ["scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
);
