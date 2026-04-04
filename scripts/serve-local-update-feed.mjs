import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const rootDir = path.join(repoRoot, "artifacts", "updater-feed");
const host = process.env.YW_LOOK_LOCAL_UPDATE_HOST ?? "127.0.0.1";
const port = Number(process.env.YW_LOOK_LOCAL_UPDATE_PORT ?? "8765");

const contentTypes = {
  ".json": "application/json; charset=utf-8",
  ".sig": "text/plain; charset=utf-8",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".msi": "application/x-msi",
};

if (!fs.existsSync(rootDir)) {
  throw new Error(
    "Local update feed is missing. Run `npm run update:local:prepare` first.",
  );
}

const server = http.createServer((request, response) => {
  const requestPath = request.url === "/" ? "/latest.json" : request.url ?? "/";
  const safePath = path.normalize(requestPath).replace(/^(\.\.[\\/])+/, "");
  const filePath = path.join(rootDir, safePath);

  if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "content-type": contentTypes[extension] ?? "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving local update feed from ${rootDir}`);
  console.log(`Open ${`http://${host}:${port}/latest.json`}`);
});
