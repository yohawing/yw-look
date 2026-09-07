import { createReadStream, existsSync, readFileSync } from "node:fs";
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

const rhino3dmPackagePath = fileURLToPath(
  new URL("./node_modules/rhino3dm", import.meta.url),
);
const rhino3dmJsPath = path.resolve(rhino3dmPackagePath, "rhino3dm.js");
const rhino3dmWasmPath = path.resolve(rhino3dmPackagePath, "rhino3dm.wasm");
const rhino3dmDevBaseUrl = "/rhino3dm/";
const rhino3dmLibraryPathModuleId = "virtual:yw-look-rhino3dm-library-path";
const resolvedRhino3dmLibraryPathModuleId = "\0yw-look-rhino3dm-library-path";

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

export function rhino3dmRuntimePlugin(): Plugin {
  const serveRhino3dmAsset: Connect.NextHandleFunction = (
    request,
    response,
    next,
  ) => {
    const requestPath = new URL(request.url ?? "/", "http://localhost")
      .pathname;
    const relativePath = requestPath.startsWith(rhino3dmDevBaseUrl)
      ? requestPath.slice(rhino3dmDevBaseUrl.length)
      : requestPath.startsWith("/")
        ? requestPath.slice(1)
        : requestPath;
    const assetPath =
      relativePath === "rhino3dm.js"
        ? rhino3dmJsPath
        : relativePath === "rhino3dm.wasm"
          ? rhino3dmWasmPath
          : null;

    if (!assetPath || !existsSync(assetPath)) {
      next();
      return;
    }

    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      relativePath.endsWith(".wasm")
        ? "application/wasm"
        : "text/javascript; charset=utf-8",
    );
    createReadStream(assetPath).pipe(response);
  };

  return {
    name: "yw-look-rhino3dm-runtime",
    enforce: "pre",
    resolveId(id) {
      return id === rhino3dmLibraryPathModuleId
        ? resolvedRhino3dmLibraryPathModuleId
        : null;
    },
    load(id) {
      return id === resolvedRhino3dmLibraryPathModuleId
        ? `export default ${JSON.stringify(rhino3dmDevBaseUrl)};`
        : null;
    },
    configureServer(server) {
      return () => {
        server.middlewares.stack.unshift({
          route: "/rhino3dm",
          handle: serveRhino3dmAsset,
        });
      };
    },
    generateBundle() {
      if (!existsSync(rhino3dmJsPath) || !existsSync(rhino3dmWasmPath)) {
        throw new Error(
          `rhino3dm runtime assets are missing under ${rhino3dmPackagePath}`,
        );
      }

      this.emitFile({
        type: "asset",
        fileName: "rhino3dm/rhino3dm.js",
        source: readFileSync(rhino3dmJsPath),
      });
      this.emitFile({
        type: "asset",
        fileName: "rhino3dm/rhino3dm.wasm",
        source: readFileSync(rhino3dmWasmPath),
      });
    },
  };
}

export default defineConfig({
  plugins: [mmdWasmMimePlugin(), rhino3dmRuntimePlugin(), react()],
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
