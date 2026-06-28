import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const optionalThreeMmdLoaderPath = fileURLToPath(
  new URL("./node_modules/@yohawing/three-mmd-loader", import.meta.url),
);
const missingThreeMmdLoaderShim = fileURLToPath(
  new URL("./src/viewer/mmd/threeMmdLoaderMissing.ts", import.meta.url),
);
const installedMmdLoaderEntry = fileURLToPath(
  new URL("./src/viewer/mmd/loaderInstalled.ts", import.meta.url),
);
const unavailableMmdLoaderEntry = fileURLToPath(
  new URL("./src/viewer/mmd/loaderUnavailable.ts", import.meta.url),
);
const hasOptionalThreeMmdLoader = existsSync(optionalThreeMmdLoaderPath);
const includeOptionalThreeMmdLoader =
  hasOptionalThreeMmdLoader &&
  process.env.YW_INCLUDE_MMD_LOADER_PACK !== "0" &&
  process.env.YW_INCLUDE_MMD_LOADER_PACK?.toLowerCase() !== "false";

const optionalSparkLoaderPath = fileURLToPath(
  new URL("./node_modules/@sparkjsdev/spark", import.meta.url),
);
const missingSparkShim = fileURLToPath(
  new URL("./src/viewer/spark/sparkMissing.ts", import.meta.url),
);
const installedSparkLoaderEntry = fileURLToPath(
  new URL("./src/viewer/spark/loaderInstalled.ts", import.meta.url),
);
const unavailableSparkLoaderEntry = fileURLToPath(
  new URL("./src/viewer/spark/loaderUnavailable.ts", import.meta.url),
);
const hasOptionalSparkLoader = existsSync(optionalSparkLoaderPath);
const includeOptionalSparkLoader =
  hasOptionalSparkLoader &&
  process.env.YW_INCLUDE_SPARK_LOADER_PACK !== "0" &&
  process.env.YW_INCLUDE_SPARK_LOADER_PACK?.toLowerCase() !== "false";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __YW_HAS_THREE_MMD_LOADER__: JSON.stringify(includeOptionalThreeMmdLoader),
    __YW_HAS_SPARK_LOADER__: JSON.stringify(includeOptionalSparkLoader),
  },
  resolve: {
    alias: [
      {
        find: "#yw-look-mmd-loader-entry",
        replacement: includeOptionalThreeMmdLoader
          ? installedMmdLoaderEntry
          : unavailableMmdLoaderEntry,
      },
      {
        find: "#yw-look-spark-loader-entry",
        replacement: includeOptionalSparkLoader
          ? installedSparkLoaderEntry
          : unavailableSparkLoaderEntry,
      },
      ...(includeOptionalThreeMmdLoader
        ? []
        : [
            {
              find: "@yohawing/three-mmd-loader",
              replacement: missingThreeMmdLoaderShim,
            },
          ]),
      ...(includeOptionalSparkLoader
        ? []
        : [
            {
              find: "@sparkjsdev/spark",
              replacement: missingSparkShim,
            },
          ]),
    ],
  },
  build: {
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
      allow: [repoRoot],
    },
  },
});
