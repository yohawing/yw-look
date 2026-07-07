#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const VIEWER_DIR = path.join(SRC_DIR, "viewer");
const VIEWPORT_DIR = path.join(SRC_DIR, "viewport");
const COMPONENTS_DIR = path.join(SRC_DIR, "components");

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

function isTestFile(filePath) {
  return (
    /(?:^|[\\/])__tests__[\\/]/.test(filePath) ||
    /\.(test|spec)\./.test(filePath)
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

function checkImport({ importer, specifier, target }) {
  const violations = [];
  const normalizedImporter = normalize(importer);
  if (!isInside(normalizedImporter, VIEWER_DIR)) {
    return violations;
  }

  if (specifier === "react" || specifier.startsWith("react/")) {
    violations.push({
      importer,
      specifier,
      message: "viewer must not import React",
    });
    return violations;
  }

  if (!target || !isInside(target, SRC_DIR)) {
    return violations;
  }

  if (isInside(target, VIEWPORT_DIR)) {
    violations.push({
      importer,
      specifier,
      message: "viewer must not import viewport modules",
    });
  }

  if (isInside(target, COMPONENTS_DIR)) {
    violations.push({
      importer,
      specifier,
      message: "viewer must not import UI components",
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
      const target = await resolveRelativeImport(file, specifier);
      violations.push(...checkImport({ importer: file, specifier, target }));
    }
  }
  return violations;
}

function runSelfTest() {
  const cases = [
    {
      importer: path.join(VIEWER_DIR, "loaders.ts"),
      specifier: "react",
      target: null,
      expectViolation: true,
    },
    {
      importer: path.join(VIEWER_DIR, "scene.ts"),
      specifier: "../viewport/selection",
      target: path.join(VIEWPORT_DIR, "selection.ts"),
      expectViolation: true,
    },
    {
      importer: path.join(VIEWER_DIR, "metadata.ts"),
      specifier: "../components/UsdInspectorCard",
      target: path.join(COMPONENTS_DIR, "UsdInspectorCard.tsx"),
      expectViolation: true,
    },
    {
      importer: path.join(VIEWER_DIR, "scene.ts"),
      specifier: "../types/viewer",
      target: path.join(SRC_DIR, "types", "viewer.ts"),
      expectViolation: false,
    },
    {
      importer: path.join(SRC_DIR, "viewport", "previewLoadMount.ts"),
      specifier: "../viewer",
      target: path.join(VIEWER_DIR, "index.ts"),
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
    console.error("viewer/viewport boundary self-test failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("viewer/viewport boundary self-test passed");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const files = await walk(VIEWER_DIR);
  const violations = await checkFiles(files);
  if (violations.length > 0) {
    console.error("viewer/viewport boundary violations:");
    for (const violation of violations) {
      console.error(
        `  - ${rel(violation.importer)} imports "${violation.specifier}": ${violation.message}`,
      );
    }
    process.exit(1);
  }
  console.log(
    `viewer/viewport boundaries verified (${files.length} viewer files)`,
  );
}
