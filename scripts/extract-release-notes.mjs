#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOption } from "./cliArgs.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CHANGELOG_PATH = path.join(repoRoot, "CHANGELOG.md");

/**
 * @param {string} tag
 */
function normalizeTag(tag) {
  const trimmed = tag.trim();
  if (!trimmed) {
    throw new Error("--tag is required (example: v0.2.2)");
  }
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} changelog
 * @param {string} tag
 */
function extractSection(changelog, tag) {
  const headingPattern = new RegExp(
    `^##\\s+${escapeRegExp(tag)}(?:\\s+\\([^)]+\\))?\\s*$`,
    "m",
  );
  const match = changelog.match(headingPattern);
  if (!match || match.index === undefined) {
    return null;
  }

  const bodyStart = match.index + match[0].length;
  const remainder = changelog.slice(bodyStart);
  const nextHeading = remainder.search(/^##\s+/m);
  const body = nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
  return body.trim();
}

function printUsage() {
  console.log(`Usage: node scripts/extract-release-notes.mjs --tag <vX.Y.Z> [--output <path>]

Extract the CHANGELOG.md section for a release tag.

Examples:
  node scripts/extract-release-notes.mjs --tag v0.2.2
  node scripts/extract-release-notes.mjs --tag v0.2.2 --output release-body.md`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const rawTag = readOption(args, "--tag");
  if (!rawTag) {
    throw new Error("--tag is required (example: v0.2.2)");
  }

  const tag = normalizeTag(rawTag);
  const outputPath = readOption(args, "--output");
  const changelog = await readFile(CHANGELOG_PATH, "utf8");
  const body = extractSection(changelog, tag);

  if (!body) {
    throw new Error(
      `no CHANGELOG.md section found for tag "${tag}". ` +
        `Expected a heading like "## ${tag} (YYYY-MM-DD)" in CHANGELOG.md.`,
    );
  }

  const text = `${body}\n`;
  if (outputPath) {
    await writeFile(outputPath, text, "utf8");
  } else {
    process.stdout.write(text);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`extract-release-notes: ${message}`);
  process.exit(1);
});
