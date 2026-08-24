import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import type { DirectionalLight } from "three";
import type { SceneContext } from "../../viewer";
import { useSceneObjectEffects } from "../useSceneObjectEffects";

const viewerMocks = vi.hoisted(() => ({
  applyBackfaceCulling: vi.fn(),
  applyBoundingBoxHelpers: vi.fn(),
  applyDisplayMode: vi.fn(),
  applyShadows: vi.fn(),
  applySkeletonHelpers: vi.fn(),
  applySurfaceMaterialMode: vi.fn(),
  applyTextureFilter: vi.fn(),
}));

vi.mock("../../viewer", () => viewerMocks);

function createOptions(viewerSurfaceMode: "asset" | "texture") {
  const sourceObject = {};
  const scene = {};
  return {
    backfaceCulling: true,
    displayMode: "textured" as const,
    keyLightRef: { current: null } as MutableRefObject<DirectionalLight | null>,
    sceneContextRef: {
      current: {
        boneOnlyPreview: false,
        scene,
        sourceObject,
      } as SceneContext,
    },
    showBoundingBoxes: true,
    showJointNames: true,
    showLocalAxis: true,
    showNormals: false,
    showShadows: false,
    showSkeleton: true,
    showUnlit: false,
    showVertexColors: false,
    textureFilterMode: "linear" as const,
    viewerSurfaceMode,
  };
}

describe("useSceneObjectEffects", () => {
  it("removes asset helpers in texture view and restores them in asset view", () => {
    const textureOptions = createOptions("texture");
    const initialProps: {
      viewerSurfaceMode: "asset" | "texture";
    } = { viewerSurfaceMode: "texture" };
    const { rerender } = renderHook(
      ({ viewerSurfaceMode }: { viewerSurfaceMode: "asset" | "texture" }) =>
        useSceneObjectEffects({ ...textureOptions, viewerSurfaceMode }),
      { initialProps },
    );

    expect(viewerMocks.applySkeletonHelpers).toHaveBeenLastCalledWith(
      textureOptions.sceneContextRef.current?.scene,
      textureOptions.sceneContextRef.current?.sourceObject,
      false,
      true,
      true,
    );
    expect(viewerMocks.applyBoundingBoxHelpers).toHaveBeenLastCalledWith(
      textureOptions.sceneContextRef.current?.scene,
      textureOptions.sceneContextRef.current?.sourceObject,
      false,
    );

    rerender({ viewerSurfaceMode: "asset" });

    expect(viewerMocks.applySkeletonHelpers).toHaveBeenLastCalledWith(
      textureOptions.sceneContextRef.current?.scene,
      textureOptions.sceneContextRef.current?.sourceObject,
      true,
      true,
      true,
    );
    expect(viewerMocks.applyBoundingBoxHelpers).toHaveBeenLastCalledWith(
      textureOptions.sceneContextRef.current?.scene,
      textureOptions.sceneContextRef.current?.sourceObject,
      true,
    );
  });
});
