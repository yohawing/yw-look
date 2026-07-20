import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import type { WebGLRenderer } from "three";
import type { ResourceDiagnosticsSnapshot } from "../../lib/diagnostics";
import type { SceneContext } from "../../types/viewer";
import { useResourceDiagnosticsPublisher } from "../useResourceDiagnosticsPublisher";

type DiagnosticsCallback = (
  snapshot: ResourceDiagnosticsSnapshot | null,
) => void;
type Publisher = ReturnType<typeof useResourceDiagnosticsPublisher>;

let currentPublisher: Publisher | null = null;

function Harness({ onChange }: { onChange?: DiagnosticsCallback }) {
  const resourceDiagnosticsPublisher =
    useResourceDiagnosticsPublisher(onChange);

  useEffect(() => {
    currentPublisher = resourceDiagnosticsPublisher;
    return () => {
      if (currentPublisher === resourceDiagnosticsPublisher) {
        currentPublisher = null;
      }
    };
  }, [resourceDiagnosticsPublisher]);

  return null;
}

function publisher() {
  if (!currentPublisher) {
    throw new Error("resource diagnostics publisher was not mounted");
  }
  return currentPublisher;
}

function makeContext({
  geometries = 1,
  textures = 2,
  programs = 3,
  calls = 4,
  triangles = 5,
  points = 6,
  lines = 7,
}: Partial<ResourceDiagnosticsSnapshot["webgl"]> = {}) {
  const renderer = {
    info: {
      memory: { geometries, textures },
      render: { calls, triangles, points, lines },
      programs: Array.from({ length: programs ?? 0 }, () => ({})),
    },
  } as unknown as WebGLRenderer;

  return { renderer } as SceneContext;
}

describe("useResourceDiagnosticsPublisher", () => {
  afterEach(() => {
    cleanup();
    currentPublisher = null;
    vi.restoreAllMocks();
  });

  it("publishes a resource snapshot and suppresses duplicate signatures", () => {
    const onChange = vi.fn<DiagnosticsCallback>();
    render(<Harness onChange={onChange} />);

    publisher().assetResourceMetricsRef.current = {
      vertices: 10,
      triangles: 20,
      materials: 3,
      textures: 4,
    };

    const context = makeContext();
    act(() => publisher().publishResourceDiagnostics(context));
    act(() => publisher().publishResourceDiagnostics(makeContext()));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      webgl: {
        geometries: 1,
        textures: 2,
        programs: 3,
        calls: 4,
        triangles: 5,
        points: 6,
        lines: 7,
      },
      asset: {
        vertices: 10,
        triangles: 20,
        materials: 3,
        textures: 4,
      },
    });
  });

  it("uses the latest diagnostics callback after a parent rerender", () => {
    const firstOnChange = vi.fn<DiagnosticsCallback>();
    const nextOnChange = vi.fn<DiagnosticsCallback>();
    const { rerender } = render(<Harness onChange={firstOnChange} />);

    act(() => publisher().publishResourceDiagnostics(makeContext()));
    rerender(<Harness onChange={nextOnChange} />);
    act(() =>
      publisher().publishResourceDiagnostics(makeContext({ calls: 99 })),
    );

    expect(firstOnChange).toHaveBeenCalledTimes(1);
    expect(nextOnChange).toHaveBeenCalledTimes(1);
    expect(nextOnChange.mock.calls[0]?.[0]?.webgl.calls).toBe(99);
  });

  it("ignores publish requests without a callback or scene context", () => {
    render(<Harness />);
    act(() => publisher().publishResourceDiagnostics(makeContext()));

    cleanup();
    currentPublisher = null;

    const onChange = vi.fn<DiagnosticsCallback>();
    render(<Harness onChange={onChange} />);
    act(() => publisher().publishResourceDiagnostics(null));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears metrics, notifies null, and allows the same snapshot to publish again", () => {
    const onChange = vi.fn<DiagnosticsCallback>();
    render(<Harness onChange={onChange} />);

    const context = makeContext();
    publisher().assetResourceMetricsRef.current = {
      vertices: 1,
      triangles: 2,
      materials: 3,
      textures: 4,
    };

    act(() => publisher().publishResourceDiagnostics(context));
    act(() => publisher().clearResourceDiagnostics());
    act(() => publisher().publishResourceDiagnostics(context));

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls[0]?.[0]?.asset).toEqual({
      vertices: 1,
      triangles: 2,
      materials: 3,
      textures: 4,
    });
    expect(onChange.mock.calls[1]?.[0]).toBeNull();
    expect(onChange.mock.calls[2]?.[0]?.asset).toBeNull();
  });
});
