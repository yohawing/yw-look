import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { mmdWasmMimePlugin, rhino3dmRuntimePlugin } from "./vite.config.ts";

export default defineConfig({
  plugins: [mmdWasmMimePlugin(), rhino3dmRuntimePlugin(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
    ],
    exclude: ["node_modules", "src-tauri"],
  },
});
