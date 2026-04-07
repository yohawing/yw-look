import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) {
            return "three-vendor";
          }

          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/scheduler")
          ) {
            return "react-vendor";
          }

          if (id.includes("node_modules/@tauri-apps")) {
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
  },
});
