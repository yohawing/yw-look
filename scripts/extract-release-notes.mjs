#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasFlag, readOption } from "./cliArgs.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_CHANGELOG_PATH = path.join(repoRoot, "CHANGELOG.md");

/** @type {ReadonlyArray<{ level: number; title: string; requireStatus?: boolean }>} */
const REQUIRED_SECTIONS = [
  { level: 3, title: "Known limitations" },
  { level: 3, title: "Distribution verification" },
  {
    level: 4,
    title: "Windows signing and SmartScreen",
    requireStatus: true,
  },
  {
    level: 4,
    title: "macOS codesign, notarization, and Gatekeeper",
    requireStatus: true,
  },
  {
    level: 4,
    title: "GitHub Release install and updater roundtrip",
    requireStatus: true,
  },
];

/** @type {ReadonlyArray<{ pattern: RegExp; message: string }>} */
const PLACEHOLDER_CHECKS = [
  {
    pattern: /\.{3}/,
    message: 'contains placeholder "..."',
  },
  {
    pattern: /verified\s*\|\s*not verified/i,
    message: 'contains template placeholder "verified | not verified"',
  },
];

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

/**
 * @param {string} body
 * @param {number} level
 * @param {string} title
 */
function findSectionContent(body, level, title) {
  const prefix = `${"#".repeat(level)} `;
  const lines = body.split("\n");
  let startLine = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      continue;
    }
    const headingText = trimmed.slice(prefix.length).trim();
    if (headingText.toLowerCase() === title.toLowerCase()) {
      startLine = index + 1;
      break;
    }
  }

  if (startLine === -1) {
    return null;
  }

  const contentLines = [];
  for (let index = startLine; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      const headingLevel = trimmed.match(/^(#+)\s+/)?.[1].length ?? 0;
      if (headingLevel <= level) {
        break;
      }
    }
    contentLines.push(lines[index]);
  }

  return contentLines.join("\n").trim();
}

/**
 * @param {string} text
 */
function hasExplicitVerificationStatus(text) {
  return /\bnot verified\b/i.test(text) || /\bverified\b/i.test(text);
}

/**
 * @param {string} body
 */
function validateReleaseContract(body) {
  /** @type {string[]} */
  const errors = [];

  for (const section of REQUIRED_SECTIONS) {
    const heading = `${"#".repeat(section.level)} ${section.title}`;
    const content = findSectionContent(body, section.level, section.title);
    if (content === null) {
      errors.push(`missing required section heading: ${heading}`);
      continue;
    }

    if (!content) {
      errors.push(`required section is empty: ${heading}`);
      continue;
    }

    if (section.title !== "Distribution verification") {
      for (const check of PLACEHOLDER_CHECKS) {
        if (check.pattern.test(content)) {
          errors.push(`${heading}: ${check.message}`);
        }
      }
    }

    if (section.requireStatus && !hasExplicitVerificationStatus(content)) {
      errors.push(
        `${heading}: must include an explicit status containing "verified" or "not verified"`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `release notes contract check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
}

function printUsage() {
  console.log(`Usage: node scripts/extract-release-notes.mjs --tag <vX.Y.Z> [options]

Extract the CHANGELOG.md section for a release tag.

Options:
  --output <path>       Write the extracted body to a file instead of stdout
  --check-contract      Fail if the extracted body omits required distribution sections
  --changelog <path>    Override the CHANGELOG path (default: CHANGELOG.md)

Examples:
  node scripts/extract-release-notes.mjs --tag v0.2.2
  node scripts/extract-release-notes.mjs --tag v0.2.2 --output release-body.md
  node scripts/extract-release-notes.mjs --tag v0.2.2 --check-contract`);
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
  const changelogPath =
    readOption(args, "--changelog") ?? DEFAULT_CHANGELOG_PATH;
  const checkContract = hasFlag(args, "--check-contract");
  const changelog = await readFile(changelogPath, "utf8");
  const body = extractSection(changelog, tag);

  if (!body) {
    throw new Error(
      `no CHANGELOG.md section found for tag "${tag}". ` +
        `Expected a heading like "## ${tag} (YYYY-MM-DD)" in CHANGELOG.md.`,
    );
  }

  if (checkContract) {
    validateReleaseContract(body);
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
