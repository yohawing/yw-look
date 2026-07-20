#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultFeedDir = path.join(repoRoot, "artifacts", "updater-feed");
const feedDir = process.env.YW_LOOK_LOCAL_UPDATE_FEED_DIR
  ? path.resolve(process.env.YW_LOOK_LOCAL_UPDATE_FEED_DIR)
  : defaultFeedDir;
const host = process.env.YW_LOOK_LOCAL_UPDATE_HOST ?? "127.0.0.1";
const requestedPort = Number(process.env.YW_LOOK_LOCAL_UPDATE_PORT ?? "8765");

const contentTypes = {
  ".json": "application/json; charset=utf-8",
  ".sig": "text/plain; charset=utf-8",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".msi": "application/x-msi",
};

function detectTarget() {
  if (process.env.YW_LOOK_LOCAL_UPDATE_TARGET) {
    return process.env.YW_LOOK_LOCAL_UPDATE_TARGET;
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "darwin-aarch64" : "darwin-x86_64";
  }
  return "windows-x86_64";
}

const target = detectTarget();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isLocalHost(hostname) {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}

function createFeedServer(rootDir) {
  return http.createServer((request, response) => {
    const requestPath =
      request.url === "/" ? "/latest.json" : (request.url ?? "/");
    const safePath = path.normalize(requestPath).replace(/^(\.\.[\\/])+/, "");
    const filePath = path.join(rootDir, safePath);

    if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extension] ?? "application/octet-stream",
      "content-length": String(stat.size),
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    request.on("error", reject);
  });
}

function parseJsonResponse(response, label) {
  assert(
    response.statusCode === 200,
    `${label} returned HTTP ${response.statusCode}, expected 200`,
  );

  try {
    return JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function validateManifest(manifest) {
  assert(
    typeof manifest.version === "string" && manifest.version.length > 0,
    "latest.json is missing a non-empty version",
  );
  assert(
    manifest.platforms && typeof manifest.platforms === "object",
    "latest.json is missing platforms",
  );

  const platform = manifest.platforms[target];
  assert(platform, `latest.json is missing platform entry: ${target}`);
  assert(
    typeof platform.url === "string" && platform.url.length > 0,
    `latest.json platform ${target} is missing url`,
  );
  assert(
    typeof platform.signature === "string" &&
      platform.signature.trim().length > 0,
    `latest.json platform ${target} is missing signature`,
  );

  return platform;
}

function validateInstallerUrl(updateUrl, serverPort) {
  assert(
    isLocalHost(updateUrl.hostname),
    `Installer URL host must be localhost: ${updateUrl.href}`,
  );

  const urlPort =
    updateUrl.port.length > 0
      ? Number(updateUrl.port)
      : updateUrl.protocol === "https:"
        ? 443
        : 80;
  assert(
    urlPort === serverPort,
    `Installer URL port ${urlPort} does not match smoke server port ${serverPort}. Re-run \`npm run update:local:prepare\` with YW_LOOK_LOCAL_UPDATE_BASE_URL=http://${host}:${serverPort}`,
  );

  const installerName = decodeURIComponent(path.basename(updateUrl.pathname));
  assert(
    installerName,
    `Installer URL does not include a filename: ${updateUrl.href}`,
  );

  const installerPath = path.join(feedDir, installerName);
  assert(
    fs.existsSync(installerPath),
    `Installer URL path does not match a feed artifact: ${installerName}`,
  );

  const expectedPathname = `/${installerName.split("/").map(encodeURIComponent).join("/")}`;
  assert(
    updateUrl.pathname === expectedPathname ||
      updateUrl.pathname === `/${installerName}`,
    `Installer URL path ${updateUrl.pathname} does not match feed artifact ${installerName}`,
  );

  return { installerName, installerPath };
}

function validateInstallerResponse(response, installerName, installerPath) {
  assert(
    response.statusCode === 200,
    `Installer ${installerName} returned HTTP ${response.statusCode}, expected 200`,
  );

  const expectedSize = fs.statSync(installerPath).size;
  const bodySize = response.body.length;
  assert(bodySize > 0, `Installer ${installerName} response body is empty`);
  assert(
    bodySize === expectedSize,
    `Installer ${installerName} response size ${bodySize} does not match feed file size ${expectedSize}`,
  );

  const contentLength = response.headers["content-length"];
  if (contentLength !== undefined) {
    assert(
      Number(contentLength) === expectedSize,
      `Installer ${installerName} Content-Length ${contentLength} does not match feed file size ${expectedSize}`,
    );
    assert(
      Number(contentLength) === bodySize,
      `Installer ${installerName} Content-Length ${contentLength} does not match response body size ${bodySize}`,
    );
  }
}

async function main() {
  assert(
    fs.existsSync(feedDir),
    "Local update feed is missing. Run `npm run update:local:prepare` first.",
  );
  assert(
    fs.existsSync(path.join(feedDir, "latest.json")),
    "Missing artifacts/updater-feed/latest.json",
  );

  const server = createFeedServer(feedDir);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, resolve);
  });

  const address = server.address();
  assert(
    address && typeof address === "object",
    "Failed to resolve smoke server address",
  );
  const serverPort = address.port;
  const baseUrl = `http://${host}:${serverPort}`;

  try {
    const manifestResponse = await httpGet(`${baseUrl}/latest.json`);
    const manifest = parseJsonResponse(
      manifestResponse,
      `${baseUrl}/latest.json`,
    );
    const platform = validateManifest(manifest);

    const updateUrl = new URL(platform.url);
    const { installerName, installerPath } = validateInstallerUrl(
      updateUrl,
      serverPort,
    );

    const installerResponse = await httpGet(platform.url);
    validateInstallerResponse(installerResponse, installerName, installerPath);

    console.log(
      `smoke:update-feed ok (${target}, v${manifest.version}, ${installerName}, ${baseUrl})`,
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
