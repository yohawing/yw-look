import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "scripts",
  plugins: [react()],
  clearScreen: false,
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");

          if (normalizedId.includes("node_modules/three")) {
            return "three-vendor";
          }

          if (
            normalizedId.includes("node_modules/react") ||
            normalizedId.includes("node_modules/scheduler")
          ) {
            return "react-vendor";
          }

          if (normalizedId.includes("node_modules/@tauri-apps")) {
            return "tauri-vendor";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: [".."],
    },
  },
});
