#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { hasFlag, readOption, readRepeatedOption } from "./cliArgs.mjs";

const DEFAULT_PLATFORMS = [
  "windows-x86_64",
  "windows-x86_64-nsis",
  "darwin-aarch64",
];

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Usage: node scripts/check-release-updater-manifest.mjs (--manifest <path> | --url <https://.../latest.json>) [options]

Validate a Tauri updater latest.json contract for GitHub Releases.

Options:
  --manifest <path>   Local latest.json path (workflow / fixture use)
  --url <url>         Remote latest.json URL (post-release operator checks)
  --platform <name>   Additional platform key to validate (repeatable)
  --allow-http        Allow non-HTTPS artifact URLs
  --skip-url-check    Skip HTTP(S) reachability checks for artifact URLs
  --json              Print machine-readable JSON to stdout
  --help, -h          Show this help

Default platforms:
  ${DEFAULT_PLATFORMS.join(", ")}

Reachability:
  HEAD is tried first. On HTTP 405, GET with Range: bytes=0-0 is used.
  Status 2xx and 3xx are treated as reachable. Full installers are not downloaded.`);
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function uniquePlatforms(extraPlatforms) {
  return [...new Set([...DEFAULT_PLATFORMS, ...extraPlatforms])];
}

function parseArgs() {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printHelp();
    process.exit(0);
  }

  const manifestPath = readOption(args, "--manifest");
  const manifestUrl = readOption(args, "--url");
  if (manifestPath && manifestUrl) {
    throw new Error("Use either --manifest or --url, not both");
  }
  if (!manifestPath && !manifestUrl) {
    throw new Error("One of --manifest or --url is required");
  }

  const valueOptions = new Set(["--manifest", "--url", "--platform"]);
  const flagOptions = new Set([
    "--allow-http",
    "--skip-url-check",
    "--json",
    "--help",
    "-h",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (valueOptions.has(token)) {
      index += 1;
      continue;
    }
    if (flagOptions.has(token)) continue;
    throw new Error(`unknown argument: ${token}`);
  }

  if (manifestUrl && !hasFlag(args, "--allow-http")) {
    const parsedManifestUrl = new URL(manifestUrl);
    if (parsedManifestUrl.protocol !== "https:") {
      throw new Error(
        `--url must use HTTPS unless --allow-http is set: ${manifestUrl}`,
      );
    }
  }

  return {
    manifestPath,
    manifestUrl,
    platforms: uniquePlatforms(readRepeatedOption(args, "--platform")),
    allowHttp: hasFlag(args, "--allow-http"),
    skipUrlCheck: hasFlag(args, "--skip-url-check"),
    jsonOutput: hasFlag(args, "--json"),
  };
}

function isReachableStatus(statusCode) {
  return statusCode >= 200 && statusCode < 400;
}

function requestUrl(url, method, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(
      parsed,
      { method, headers, timeout: 30_000 },
      (response) => {
        response.resume();
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`timeout while requesting ${url}`));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchManifest(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.get(parsed, { timeout: 30_000 }, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        const nextUrl = new URL(response.headers.location, url).href;
        response.resume();
        fetchManifest(nextUrl).then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (!isReachableStatus(response.statusCode ?? 0)) {
          reject(
            new Error(
              `Failed to fetch manifest: HTTP ${response.statusCode ?? 0}`,
            ),
          );
          return;
        }

        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("Manifest response is not valid JSON"));
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`timeout while fetching ${url}`));
    });
    request.on("error", reject);
  });
}

async function checkUrlReachable(url) {
  let response = await requestUrl(url, "HEAD");
  if (response.statusCode === 405) {
    response = await requestUrl(url, "GET", { Range: "bytes=0-0" });
    return {
      ok: isReachableStatus(response.statusCode),
      statusCode: response.statusCode,
      method: "GET+Range",
    };
  }
  return {
    ok: isReachableStatus(response.statusCode),
    statusCode: response.statusCode,
    method: "HEAD",
  };
}

function validatePlatformEntry(platformName, entry, options, errors) {
  assert(
    entry && typeof entry === "object",
    `platforms.${platformName} is missing`,
    errors,
  );
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  const signature =
    typeof entry.signature === "string" ? entry.signature.trim() : "";

  assert(url, `platforms.${platformName}.url is empty`, errors);
  assert(signature, `platforms.${platformName}.signature is empty`, errors);

  if (!url) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    assert(
      false,
      `platforms.${platformName}.url is not a valid URL: ${url}`,
      errors,
    );
    return null;
  }

  if (!options.allowHttp && parsedUrl.protocol !== "https:") {
    assert(
      false,
      `platforms.${platformName}.url must use HTTPS: ${url}`,
      errors,
    );
  }

  return { url, signature, parsedUrl };
}

function validateManifestShape(manifest, platforms, options) {
  const errors = [];
  const platformResults = {};

  assert(
    typeof manifest.version === "string" && manifest.version.trim(),
    "version is missing or empty",
    errors,
  );
  assert(
    manifest.platforms && typeof manifest.platforms === "object",
    "platforms object is missing",
    errors,
  );

  if (!manifest.platforms || typeof manifest.platforms !== "object") {
    return { errors, platformResults };
  }

  for (const platformName of platforms) {
    platformResults[platformName] = validatePlatformEntry(
      platformName,
      manifest.platforms[platformName],
      options,
      errors,
    );
  }

  const windowsDefault = platformResults["windows-x86_64"];
  const windowsNsis = platformResults["windows-x86_64-nsis"];
  if (windowsDefault && windowsNsis) {
    assert(
      windowsDefault.url === windowsNsis.url,
      "platforms.windows-x86_64.url must match platforms.windows-x86_64-nsis.url after NSIS patch",
      errors,
    );
    assert(
      windowsDefault.signature === windowsNsis.signature,
      "platforms.windows-x86_64.signature must match platforms.windows-x86_64-nsis.signature after NSIS patch",
      errors,
    );
  }

  return { errors, platformResults };
}

async function validateUrlReachability(platformResults, skipUrlCheck) {
  const reachability = [];
  if (skipUrlCheck) {
    return reachability;
  }

  const seenUrls = new Set();
  for (const [platformName, entry] of Object.entries(platformResults)) {
    if (!entry?.url || seenUrls.has(entry.url)) {
      continue;
    }
    seenUrls.add(entry.url);

    try {
      const result = await checkUrlReachable(entry.url);
      reachability.push({
        platform: platformName,
        url: entry.url,
        ...result,
      });
      if (!result.ok) {
        reachability.at(-1).error =
          `HTTP ${result.statusCode} is not reachable`;
      }
    } catch (error) {
      reachability.push({
        platform: platformName,
        url: entry.url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return reachability;
}

async function loadManifest({ manifestPath, manifestUrl }) {
  if (manifestPath) {
    const absolutePath = path.resolve(manifestPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Manifest not found: ${absolutePath}`);
    }
    return {
      manifest: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
      source: `file:${absolutePath}`,
    };
  }

  return {
    manifest: await fetchManifest(manifestUrl),
    source: `url:${manifestUrl}`,
  };
}

async function main() {
  const options = parseArgs();
  const { manifest, source } = await loadManifest(options);
  const { errors: shapeErrors, platformResults } = validateManifestShape(
    manifest,
    options.platforms,
    options,
  );

  const reachability = await validateUrlReachability(
    platformResults,
    options.skipUrlCheck,
  );
  const reachabilityErrors = reachability
    .filter((entry) => !entry.ok)
    .map(
      (entry) =>
        `artifact URL not reachable for ${entry.platform}: ${entry.url} (${entry.error ?? `HTTP ${entry.statusCode}`})`,
    );

  const errors = [...shapeErrors, ...reachabilityErrors];
  const result = {
    ok: errors.length === 0,
    version: manifest.version ?? null,
    source,
    platforms: options.platforms,
    checks: {
      shape: shapeErrors.length === 0,
      reachability: options.skipUrlCheck
        ? "skipped"
        : reachabilityErrors.length === 0,
    },
    errors,
    reachability,
  };

  if (options.jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(
      `check:release-updater ok (v${manifest.version}, ${options.platforms.length} platform(s), ${source})`,
    );
  } else {
    console.error("check:release-updater failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
  }

  if (!result.ok) {
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  if (hasFlag(args, "--json")) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          errors: [error instanceof Error ? error.message : String(error)],
        },
        null,
        2,
      ),
    );
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}
