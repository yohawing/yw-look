/**
 * Global test setup file for Vitest.
 *
 * - Mocks @tauri-apps/api/core so that any module calling `invoke` in a
 *   jsdom environment does not throw "window.__TAURI_IPC__ is not a function".
 * - Provides a no-op URL.createObjectURL / revokeObjectURL because jsdom
 *   does not implement these.
 */

import { vi } from "vitest";

// Mock Tauri IPC
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

// jsdom does not implement URL.createObjectURL
if (typeof URL.createObjectURL === "undefined") {
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock-url"),
    writable: true,
  });
}

if (typeof URL.revokeObjectURL === "undefined") {
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
  });
}
