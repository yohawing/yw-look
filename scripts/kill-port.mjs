#!/usr/bin/env node
// Kill any process listening on the given port (Windows only).
// Usage: node scripts/kill-port.mjs 1420

import { execFileSync } from "node:child_process";

const port = process.argv[2];
if (!port || !/^\d{1,5}$/.test(port)) process.exit(0);

function parsePowerShellJson(value) {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function findListeningPidsWithPowerShell() {
  if (process.platform !== "win32") return new Set();
  try {
    const command = [
      "$ErrorActionPreference = 'SilentlyContinue';",
      `$items = Get-NetTCPConnection -LocalPort ${port} -State Listen |`,
      "Select-Object -ExpandProperty OwningProcess -Unique;",
      "$items | ConvertTo-Json -Compress",
    ].join(" ");
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return new Set(
      parsePowerShellJson(out)
        .map((pid) => String(pid))
        .filter((pid) => /^\d+$/.test(pid) && pid !== "0"),
    );
  } catch {
    return new Set();
  }
}

function localAddressPort(address) {
  const match = address.match(/:(\d+)$/);
  return match?.[1] ?? null;
}

function findListeningPidsWithNetstat() {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new Set(
      out
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter(
          ([proto, localAddress, , state]) =>
            proto?.toUpperCase() === "TCP" &&
            state?.toUpperCase() === "LISTENING" &&
            localAddressPort(localAddress) === port,
        )
        .map((parts) => parts.at(-1))
        .filter((pid) => pid && /^\d+$/.test(pid)),
    );
  } catch {
    return new Set();
  }
}

function hasListeningPort() {
  if (process.platform === "win32") {
    const pids = findListeningPidsWithPowerShell();
    if (pids.size > 0) return true;
  }
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out.split("\n").some((line) => {
      const [proto, localAddress, , state] = line.trim().split(/\s+/);
      return (
        proto?.toUpperCase() === "TCP" &&
        state?.toUpperCase() === "LISTENING" &&
        localAddressPort(localAddress) === port
      );
    });
  } catch {
    return false;
  }
}

const pids = new Set([
  ...findListeningPidsWithPowerShell(),
  ...findListeningPidsWithNetstat(),
]);

for (const pid of pids) {
  try {
    execFileSync("taskkill", ["/F", "/PID", pid], { stdio: "pipe" });
    console.log(`kill-port: killed PID ${pid} on port ${port}`);
  } catch {
    // already dead
  }
}

if (pids.size > 0) {
  // Wait for the OS to fully release the port after killing processes.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!hasListeningPort()) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
}
