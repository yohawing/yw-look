import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const optionalThreeMmdLoaderPath = fileURLToPath(
  new URL("./node_modules/@yohawing/three-mmd-loader", import.meta.url),
);
const missingThreeMmdLoaderShim = fileURLToPath(
  new URL(
    "./src/packs/mmd-loader-pack/threeMmdLoaderMissing.ts",
    import.meta.url,
  ),
);
const installedMmdLoaderEntry = fileURLToPath(
  new URL("./src/packs/mmd-loader-pack/loaderInstalled.ts", import.meta.url),
);
const unavailableMmdLoaderEntry = fileURLToPath(
  new URL("./src/packs/mmd-loader-pack/loaderUnavailable.ts", import.meta.url),
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
  new URL(
    "./src/packs/gaussian-splat-loader-pack/sparkMissing.ts",
    import.meta.url,
  ),
);
const installedSparkLoaderEntry = fileURLToPath(
  new URL(
    "./src/packs/gaussian-splat-loader-pack/loaderInstalled.ts",
    import.meta.url,
  ),
);
const unavailableSparkLoaderEntry = fileURLToPath(
  new URL(
    "./src/packs/gaussian-splat-loader-pack/loaderUnavailable.ts",
    import.meta.url,
  ),
);
const hasOptionalSparkLoader = existsSync(optionalSparkLoaderPath);
const includeOptionalSparkLoader =
  hasOptionalSparkLoader &&
  process.env.YW_INCLUDE_SPARK_LOADER_PACK !== "0" &&
  process.env.YW_INCLUDE_SPARK_LOADER_PACK?.toLowerCase() !== "false";

const mmdAnimWasmPath = path.resolve(
  optionalThreeMmdLoaderPath,
  "dist/parser/wasm/generated/mmd_anim_wasm_bg.wasm",
);
const mmdAnimWasmImportPath =
  "/node_modules/@yohawing/three-mmd-loader/dist/parser/wasm/generated/mmd_anim_wasm_bg.wasm?url";
const mmdAnimWasmDevUrl = "/@yw-look/mmd-loader/mmd_anim_wasm_bg.wasm";
const mmdWasmUrlModuleId = "virtual:yw-look-mmd-wasm-url";
const resolvedMmdWasmUrlModuleId = "\0yw-look-mmd-wasm-url";

export function mmdWasmMimePlugin(): Plugin {
  let isServe = false;

  const serveMmdWasm: Connect.NextHandleFunction = (
    _request,
    response,
    next,
  ) => {
    if (!existsSync(mmdAnimWasmPath)) {
      next();
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/wasm");
    createReadStream(mmdAnimWasmPath).pipe(response);
  };

  return {
    name: "yw-look-mmd-wasm-mime",
    enforce: "pre",
    configResolved(config) {
      isServe = config.command === "serve";
    },
    resolveId(id) {
      if (id === mmdWasmUrlModuleId) {
        return resolvedMmdWasmUrlModuleId;
      }
      return null;
    },
    load(id) {
      if (id === resolvedMmdWasmUrlModuleId) {
        if (!isServe) {
          return [
            `import wasmUrl from ${JSON.stringify(mmdAnimWasmImportPath)};`,
            "export default wasmUrl;",
          ].join("\n");
        }
        return `export default ${JSON.stringify(mmdAnimWasmDevUrl)};`;
      }
      return null;
    },
    configureServer(server) {
      return () => {
        server.middlewares.stack.unshift({
          route: mmdAnimWasmDevUrl,
          handle: serveMmdWasm,
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [mmdWasmMimePlugin(), react()],
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

          if (normalizedId.includes("node_modules/@sparkjsdev/spark")) {
            return "spark-loader-pack";
          }

          if (
            normalizedId.includes("node_modules/@yohawing/three-mmd-loader")
          ) {
            return "mmd-loader-pack";
          }

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
