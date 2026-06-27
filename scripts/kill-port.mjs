#!/usr/bin/env node
// Kill any process listening on the given port (Windows only).
// Usage: node scripts/kill-port.mjs 1420

import { execFileSync } from "node:child_process";

const port = process.argv[2];
if (!port || !/^\d{1,5}$/.test(port)) process.exit(0);

function localAddressPort(address) {
  const match = address.match(/:(\d+)$/);
  return match?.[1] ?? null;
}

try {
  const out = execFileSync("netstat", ["-ano", "-p", "tcp"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pids = new Set(
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
  for (const pid of pids) {
    try {
      execFileSync("taskkill", ["/F", "/PID", pid], { stdio: "pipe" });
      console.log(`kill-port: killed PID ${pid} on port ${port}`);
    } catch {
      // already dead
    }
  }
} catch {
  // no process on port — nothing to do
}
