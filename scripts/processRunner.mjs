import { spawn } from "node:child_process";

export function runChildProcess(command, args, options = {}) {
  const {
    cwd,
    env,
    shell = false,
    timeoutMs,
    forwardStdout = false,
    forwardStderr = false,
    signalError = true,
    windowsHide,
  } = options;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell,
      ...(windowsHide !== undefined ? { windowsHide } : {}),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({
          exitCode: null,
          durationMs: Math.round(performance.now() - startedAt),
          stdout,
          stderr,
          error: `timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    }

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      if (forwardStdout) {
        process.stdout.write(chunk);
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (forwardStderr) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", (error) => {
      finish({
        exitCode: null,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("exit", (code, signal) => {
      finish({
        exitCode: code,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        error: signal && signalError ? `terminated by ${signal}` : null,
      });
    });
  });
}
