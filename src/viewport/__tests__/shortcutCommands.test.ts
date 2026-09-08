import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Box3,
  Vector3,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneContext } from "../../types/viewer";
import { isManuallyHidden } from "../selection";
import { applyViewportShortcutCommand } from "../shortcutCommands";

function createMesh(name: string) {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.name = name;
  return mesh;
}

function createContext(root: Group | Mesh) {
  const scene = new Scene();
  scene.add(root);
  const camera = new PerspectiveCamera(50, 1);
  const controls = new OrbitControls(camera, document.createElement("div"));

  return {
    renderer: {},
    scene,
    camera,
    controls,
    pmremGenerator: {},
    mountedObject: root,
    sourceObject: root,
    previewObject: null,
    boneOnlyPreview: false,
    cleanupUrls: [],
    cleanupCallbacks: [],
    animationRoot: null,
    mixer: null,
    clips: [],
    activeAction: null,
    mmdModel: null,
    mmdMotion: null,
    textureRegistry: new Map(),
    rawMaxDimension: 2,
  } as unknown as SceneContext;
}

function runCommand(
  context: SceneContext | null,
  command: Parameters<typeof applyViewportShortcutCommand>[0]["command"],
  viewerSurfaceMode: "asset" | "texture" = "asset",
) {
  return applyViewportShortcutCommand({
    cameraSpeedMultiplier: 1,
    command,
    context,
    purposeModes: undefined,
    showAxes: true,
    showGrid: true,
    texturePreview3D: false,
    viewerSurfaceMode,
  });
}

describe("applyViewportShortcutCommand", () => {
  it("ignores missing commands and contexts", () => {
    expect(runCommand(null, null)).toBe(false);
    expect(runCommand(createContext(new Group()), null)).toBe(false);
  });

  it("frames all mounted content", () => {
    const root = new Group();
    root.add(createMesh("Target"));
    const context = createContext(root);

    expect(runCommand(context, { kind: "frameAll" })).toBe(true);
    expect(context.camera.position.length()).toBeGreaterThan(0);
  });

  it("focuses the selected object in asset mode only", () => {
    const root = new Group();
    root.add(createMesh("Target"));
    const context = createContext(root);

    expect(
      runCommand(
        context,
        { kind: "focusSelected", selectionKey: "Target" },
        "texture",
      ),
    ).toBe(false);
    expect(
      runCommand(context, {
        kind: "focusSelected",
        selectionKey: "Target",
      }),
    ).toBe(true);
    expect(context.camera.position.length()).toBeGreaterThan(0);
  });

  it("focuses runtime bounds and ignores a response after runtime replacement", async () => {
    const context = createContext(new Group());
    const bounds = new Box3(new Vector3(10, 20, 30), new Vector3(12, 22, 32));
    context.packRuntime = {
      dispose: () => {},
      selection: {
        pick: async () => null,
        select: async () => {},
        getBounds: async () => bounds,
      },
    };
    expect(
      runCommand(context, { kind: "focusSelected", selectionKey: "ifc:20" }),
    ).toBe(true);
    await Promise.resolve();
    expect(context.controls.target.toArray()).toEqual([11, 21, 31]);
    context.controls.target.set(0, 0, 0);
    runCommand(context, { kind: "focusSelected", selectionKey: "ifc:20" });
    context.packRuntime = null;
    await Promise.resolve();
    expect(context.controls.target.toArray()).toEqual([0, 0, 0]);
  });
  it("updates manual visibility commands", () => {
    const root = new Group();
    const first = createMesh("First");
    const second = createMesh("Second");
    root.add(first, second);
    const context = createContext(root);

    expect(
      runCommand(context, {
        kind: "hideSelected",
        selectionKey: "First",
      }),
    ).toBe(true);
    expect(isManuallyHidden(first)).toBe(true);

    expect(
      runCommand(context, {
        kind: "isolateSelected",
        selectionKey: "Second",
      }),
    ).toBe(true);
    expect(isManuallyHidden(first)).toBe(true);
    expect(isManuallyHidden(second)).toBe(false);

    expect(runCommand(context, { kind: "unhideAll" })).toBe(true);
    expect(isManuallyHidden(first)).toBe(false);
    expect(isManuallyHidden(second)).toBe(false);
  });
});
