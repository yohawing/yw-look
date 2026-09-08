import { Group } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadThreeMfPreviewObject } from "../loader";
import { readBinaryFilePrefix } from "../../../lib/files";
import { parseModelInWorker } from "../../modelParseWorker";

vi.mock("../../../lib/files", () => ({ readBinaryFilePrefix: vi.fn() }));
vi.mock("../../modelParseWorker", () => ({ parseModelInWorker: vi.fn() }));
const file = {
  path: "C:/models/part.3mf",
  fileName: "part.3mf",
  parentDirectory: "C:/models",
  extension: "3mf",
  kind: "model" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readBinaryFilePrefix).mockResolvedValue(new ArrayBuffer(8));
});
describe("3MF worker-only loading", () => {
  it("bounds native reads, transfers ownership, and returns warnings and authored units", async () => {
    const object = new Group();
    object.userData.threeMf = { warnings: ["Unsupported extension"] };
    vi.mocked(parseModelInWorker).mockResolvedValue(object);
    const result = await loadThreeMfPreviewObject(file, {
      parseTimeoutMs: 4000,
    });
    expect(readBinaryFilePrefix).toHaveBeenCalledWith(
      file.path,
      64 * 1024 * 1024 + 1,
    );
    expect(parseModelInWorker).toHaveBeenCalledWith(
      file.path,
      expect.objectContaining({ kind: "3mf" }),
      expect.objectContaining({ transferBuffer: true, timeoutMs: 4000 }),
    );
    expect(result.warnings).toEqual(["Unsupported extension"]);
    expect(result.skipScaleNormalization).toBe(true);
  });
  it("rejects oversized reads before creating a worker", async () => {
    vi.mocked(readBinaryFilePrefix).mockResolvedValue({
      byteLength: 64 * 1024 * 1024 + 1,
    } as ArrayBuffer);
    await expect(loadThreeMfPreviewObject(file, {})).rejects.toThrow(/64 MiB/);
    expect(parseModelInWorker).not.toHaveBeenCalled();
  });
  it("does not start a read after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadThreeMfPreviewObject(file, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(readBinaryFilePrefix).not.toHaveBeenCalled();
  });
  it.each(["AbortError", "TimeoutError", "Error"])(
    "propagates %s without a main-thread retry",
    async (name) => {
      const error = new Error("worker rejected the package");
      error.name = name;
      vi.mocked(parseModelInWorker).mockRejectedValue(error);
      await expect(loadThreeMfPreviewObject(file, {})).rejects.toBe(error);
      expect(parseModelInWorker).toHaveBeenCalledTimes(1);
    },
  );
});
