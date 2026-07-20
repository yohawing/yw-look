/**
 * Global test setup file for Vitest.
 *
 * - Mocks @tauri-apps/api/core so that any module calling `invoke` in a
 *   jsdom environment does not throw "window.__TAURI_IPC__ is not a function".
 * - Provides a no-op URL.createObjectURL / revokeObjectURL because jsdom
 *   does not implement these.
 * - Provides a no-op ResizeObserver for layout-driven UI primitives.
 */

import { vi } from "vitest";

// Mock Tauri IPC
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
  isTauri: vi.fn(() => false),
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

if (typeof ResizeObserver === "undefined") {
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: class ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
    writable: true,
  });
}
