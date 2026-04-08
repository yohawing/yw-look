/**
 * scripts/batch-load-test.mjs
 *
 * ⚠️  STATIC ENUMERATION ONLY — does NOT invoke any real loader.
 *
 * samples/private/ 以下のファイルを再帰列挙し、拡張子から対応ローダーを判定して
 * 結果を artifacts/logs/batch-load-report.json に出力する。実際の Three.js
 * loader / Tauri バックエンドは一切呼ばないため、本スクリプトの "supported"
 * 判定はファイルが**読める**ことを意味しない。あくまで対応拡張子の網羅性確認用。
 *
 * 実行: npm run test:batch
 *       または: node scripts/batch-load-test.mjs
 *
 * TODO: 将来は実際のローダーを呼び出して parse / load の成否を記録する。
 *       Node 単体では WebWorker / Three.js loader を直接 invoke できないため、
 *       Tauri アプリ内のテストハーネス or Playwright 経由の実行に差し替える想定。
 */

import { readdirSync, statSync, mkdirSync, writeFileSync } from "fs";
import { join, extname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(__dirname, "..");

const SAMPLES_DIR = join(projectRoot, "samples", "private");
const OUTPUT_DIR = join(projectRoot, "artifacts", "logs");
const OUTPUT_FILE = join(OUTPUT_DIR, "batch-load-report.json");

// ---------------------------------------------------------------------------
// ローダーマッピング (拡張子 → ローダー名)
// src/viewer/loaders.ts の対応拡張子と一致させること。
// ---------------------------------------------------------------------------
/** @type {Record<string, string>} */
const LOADER_MAP = {
  // 3D モデル
  ".gltf": "GLTFLoader",
  ".glb": "GLTFLoader",
  ".fbx": "FBXLoader",
  ".obj": "OBJLoader",
  ".stl": "STLLoader",
  ".ply": "PLYLoader",
  ".dae": "ColladaLoader",  // TODO: 未実装 (ToDo.md #6)
  ".vrm": "VRMLoader",      // TODO: 未実装 (ToDo.md #6)
  ".pmx": "MMDLoader",      // TODO: 未実装 (ToDo.md #6)
  ".pmd": "MMDLoader",      // TODO: 未実装 (ToDo.md #6)
  // USD
  ".usd":  "USDLoader",
  ".usda": "USDLoader",
  ".usdc": "USDLoader (USDC — requires Rust backend Phase 3)",
  ".usdz": "USDLoader",
  // テクスチャ
  ".png":  "TextureLoader",
  ".jpg":  "TextureLoader",
  ".jpeg": "TextureLoader",
  ".tga":  "TGALoader",
  ".hdr":  "RGBELoader",
  ".exr":  "EXRLoader",
  ".dds":  "DDSLoader",
  ".ktx2": "KTX2Loader",    // TODO: 未実装 (ToDo.md #7)
};

// ---------------------------------------------------------------------------
// ファイル再帰列挙
// ---------------------------------------------------------------------------
/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkDir(dir) {
  let results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.warn(`[warn] Cannot read directory: ${dir} — ${e.message}`);
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // .gitkeep 等をスキップ
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------
const files = walkDir(SAMPLES_DIR);

/** @type {{ path: string; ext: string; loader: string; status: "supported" | "unsupported" }[]} */
const supported = [];
/** @type {{ path: string; ext: string }[]} */
const unsupported = [];
/** @type {{ path: string; error: string }[]} */
const errors = [];

for (const filePath of files) {
  const relPath = relative(projectRoot, filePath).replace(/\\/g, "/");
  const ext = extname(filePath).toLowerCase();

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) continue;

    const loader = LOADER_MAP[ext];
    if (loader) {
      supported.push({
        path: relPath,
        ext,
        loader,
        status: "supported",
        // TODO: ここで実際のローダーを呼び出して成否を記録する
        //       例: const result = await invokeLoader(filePath, loader);
        //       result.ok → "success", result.error → "error"
        note: "static analysis only — loader not invoked yet",
      });
    } else {
      unsupported.push({ path: relPath, ext });
    }
  } catch (e) {
    errors.push({ path: relPath, error: String(e) });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  samplesDir: relative(projectRoot, SAMPLES_DIR).replace(/\\/g, "/"),
  summary: {
    total: files.length,
    supported: supported.length,
    unsupported: unsupported.length,
    errors: errors.length,
  },
  supported,
  unsupported,
  errors,
};

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), "utf-8");

console.log("=== batch-load-test ===");
console.log(`Scanned: ${SAMPLES_DIR}`);
console.log(`Total files : ${report.summary.total}`);
console.log(`Supported   : ${report.summary.supported}`);
console.log(`Unsupported : ${report.summary.unsupported}`);
console.log(`Errors      : ${report.summary.errors}`);
console.log(`Report written to: ${OUTPUT_FILE}`);

if (unsupported.length > 0) {
  console.log("\nUnsupported extensions:");
  for (const f of unsupported) console.log(`  ${f.ext}  ${f.path}`);
}
if (errors.length > 0) {
  console.log("\nErrors:");
  for (const f of errors) console.log(`  ${f.path}: ${f.error}`);
}
