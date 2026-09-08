import { Group } from "three";
import { readBinaryFilePrefix, type SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import { parseModelInWorker } from "../modelParseWorker";
import type { LoadedPreview } from "../types";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export async function loadThreeMfPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  context.signal?.throwIfAborted();
  context.onStage?.("decode");
  // A bounded read also avoids allocating an oversized input across native IPC.
  const buffer = await readBinaryFilePrefix(file.path, MAX_ARCHIVE_BYTES + 1);
  if (buffer.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error("3MF: archive exceeds 64 MiB");
  context.signal?.throwIfAborted();
  const object = await parseModelInWorker(
    file.path,
    { kind: "3mf", buffer },
    {
      signal: context.signal,
      timeoutMs: context.parseTimeoutMs,
      transferBuffer: true,
    },
  );
  if (!(object instanceof Group))
    throw new Error("3MF: worker returned an invalid scene");
  context.onStage?.("scene");
  return {
    object,
    cleanupUrls: [],
    clips: [],
    formatVersion: "3MF Core",
    skipScaleNormalization: true,
    warnings: object.userData.threeMf?.warnings ?? [],
  };
}
