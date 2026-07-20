#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const PACKS_DIR = path.join(SRC_DIR, "packs");
const PACKS_INDEX = path.join(PACKS_DIR, "index.ts");
const SHARED_PACK_HELPERS = new Set([
  normalize(path.join(PACKS_DIR, "abort.ts")),
]);

const IMPORT_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/gms;

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(fullPath)));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function normalize(filePath) {
  return path.resolve(filePath);
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function stripQuery(specifier) {
  const queryIndex = specifier.indexOf("?");
  return queryIndex >= 0 ? specifier.slice(0, queryIndex) : specifier;
}

async function existingFile(candidate) {
  try {
    const info = await stat(candidate);
    return info.isFile();
  } catch {
    return false;
  }
}

async function resolveRelativeImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = normalize(
    path.resolve(path.dirname(importer), stripQuery(specifier)),
  );
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.css`,
    `${base}.json`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
    base,
  ];
  for (const candidate of candidates) {
    if (await existingFile(candidate)) return candidate;
  }
  return base;
}

function packageRootFor(filePath) {
  if (!isInside(filePath, PACKS_DIR)) return null;
  const relative = path.relative(PACKS_DIR, filePath).split(path.sep);
  return relative[0] ? path.join(PACKS_DIR, relative[0]) : null;
}

function isTestFile(filePath) {
  return (
    /(?:^|[\\/])__tests__[\\/]/.test(filePath) ||
    /\.(test|spec)\./.test(filePath)
  );
}

function allowedPackToCoreTarget(target) {
  const relative = rel(target);
  return (
    relative.startsWith("src/types/") ||
    relative.startsWith("src/lib/") ||
    relative === "src/viewer/index.ts" ||
    relative === "src/viewer/index.tsx"
  );
}

function checkImport({ importer, specifier, targets }) {
  const violations = [];
  if (normalize(importer) === normalize(PACKS_INDEX)) {
    return violations;
  }
  const importerInPacks = isInside(importer, PACKS_DIR);
  const importerPackRoot = packageRootFor(importer);

  const target = Array.isArray(targets) ? targets[0] : targets;
  if (!target || !isInside(target, SRC_DIR)) return violations;

  const targetInPacks = isInside(target, PACKS_DIR);
  if (
    !importerInPacks &&
    targetInPacks &&
    normalize(target) !== normalize(PACKS_INDEX)
  ) {
    violations.push({
      importer,
      specifier,
      message: "core must import packs only through src/packs/index.ts",
    });
    return violations;
  }

  if (!importerInPacks || !importerPackRoot) return violations;
  if (SHARED_PACK_HELPERS.has(normalize(target))) {
    return violations;
  }
  if (targetInPacks) {
    const targetPackRoot = packageRootFor(target);
    if (
      targetPackRoot &&
      normalize(targetPackRoot) !== normalize(importerPackRoot)
    ) {
      violations.push({
        importer,
        specifier,
        message: "pack internals must not import another pack directly",
      });
    }
    return violations;
  }

  if (!allowedPackToCoreTarget(target)) {
    violations.push({
      importer,
      specifier,
      message:
        "pack must import core through src/viewer/index.ts, src/types, or src/lib",
    });
  }
  return violations;
}

async function checkFiles(files) {
  const violations = [];
  for (const file of files) {
    if (isTestFile(file)) continue;
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const targets = await resolveRelativeImport(file, specifier);
      if (!targets) continue;
      violations.push(...checkImport({ importer: file, specifier, targets }));
    }
  }
  return violations;
}

function runSelfTest() {
  const cases = [
    {
      importer: path.join(SRC_DIR, "app", "App.tsx"),
      specifier: "../packs/mmd-loader-pack/pack",
      targets: [path.join(PACKS_DIR, "mmd-loader-pack", "pack.ts")],
      expectViolation: true,
    },
    {
      importer: path.join(SRC_DIR, "app", "App.tsx"),
      specifier: "../packs",
      targets: [PACKS_INDEX],
      expectViolation: false,
    },
    {
      importer: path.join(PACKS_DIR, "mmd-loader-pack", "pack.ts"),
      specifier: "../abort",
      targets: [path.join(PACKS_DIR, "abort.ts")],
      expectViolation: false,
    },
    {
      importer: path.join(PACKS_DIR, "mmd-loader-pack", "pack.ts"),
      specifier: "../../viewer/scene",
      targets: [path.join(SRC_DIR, "viewer", "scene.ts")],
      expectViolation: true,
    },
    {
      importer: path.join(PACKS_DIR, "mmd-loader-pack", "pack.ts"),
      specifier: "../../viewer",
      targets: [path.join(SRC_DIR, "viewer", "index.ts")],
      expectViolation: false,
    },
    {
      importer: path.join(PACKS_DIR, "mmd-loader-pack", "pack.ts"),
      specifier: "../../components/CurrentFileCard",
      targets: [path.join(SRC_DIR, "components", "CurrentFileCard.tsx")],
      expectViolation: true,
    },
    {
      importer: path.join(PACKS_DIR, "mmd-loader-pack", "pack.ts"),
      specifier: "../../types/format-pack",
      targets: [path.join(SRC_DIR, "types", "format-pack.ts")],
      expectViolation: false,
    },
  ];

  const failures = [];
  for (const testCase of cases) {
    const actual = checkImport(testCase).length > 0;
    if (actual !== testCase.expectViolation) {
      failures.push(
        `${rel(testCase.importer)} -> ${testCase.specifier}: expected ${
          testCase.expectViolation ? "violation" : "ok"
        }, got ${actual ? "violation" : "ok"}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("format pack boundary self-test failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("format pack boundary self-test passed");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const files = await walk(SRC_DIR);
  const violations = await checkFiles(files);
  if (violations.length > 0) {
    console.error("format pack boundary violations:");
    for (const violation of violations) {
      console.error(
        `  - ${rel(violation.importer)} imports "${violation.specifier}": ${violation.message}`,
      );
    }
    process.exit(1);
  }
  console.log(`format pack boundaries verified (${files.length} source files)`);
}
