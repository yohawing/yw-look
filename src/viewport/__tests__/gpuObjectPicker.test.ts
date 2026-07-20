import { describe, expect, it, vi } from "vitest";
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type Material,
  type WebGLRenderer,
} from "three";
import { createGpuObjectPicker } from "../gpuObjectPicker";
import { setSelectionMaterialCustomizer } from "../../viewer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createRendererMock(readback: ReturnType<typeof deferred<Uint8Array>>) {
  const previousTarget = new WebGLRenderTarget(2, 2);
  const state = {
    activeCubeFace: 3,
    activeMipmapLevel: 2,
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: false,
    autoClearStencil: true,
    clearAlpha: 0.75,
    clearColor: new Color(0x123456),
    renderTarget: previousTarget as WebGLRenderTarget | null,
    scissor: new Vector4(4, 5, 6, 7),
    scissorTest: false,
    viewport: new Vector4(8, 9, 10, 11),
  };
  const renderer = {
    autoClear: state.autoClear,
    autoClearColor: state.autoClearColor,
    autoClearDepth: state.autoClearDepth,
    autoClearStencil: state.autoClearStencil,
    clear: vi.fn(),
    getActiveCubeFace: vi.fn(() => state.activeCubeFace),
    getActiveMipmapLevel: vi.fn(() => state.activeMipmapLevel),
    getClearAlpha: vi.fn(() => state.clearAlpha),
    getClearColor: vi.fn((target: Color) => target.copy(state.clearColor)),
    getDrawingBufferSize: vi.fn((target: Vector2) => target.set(200, 100)),
    getRenderTarget: vi.fn(() => state.renderTarget),
    getScissor: vi.fn((target: Vector4) => target.copy(state.scissor)),
    getScissorTest: vi.fn(() => state.scissorTest),
    getViewport: vi.fn((target: Vector4) => target.copy(state.viewport)),
    readRenderTargetPixelsAsync: vi.fn(
      (_target, _x, _y, _width, _height, buffer: Uint8Array) =>
        readback.promise.then((value) => {
          buffer.set(value);
          return buffer;
        }),
    ),
    render: vi.fn(),
    setClearColor: vi.fn((color: Color | number, alpha?: number) => {
      state.clearColor =
        color instanceof Color ? color.clone() : new Color(color);
      state.clearAlpha = alpha ?? state.clearAlpha;
    }),
    setRenderTarget: vi.fn((target: WebGLRenderTarget | null) => {
      state.renderTarget = target;
    }),
    setScissor: vi.fn(
      (value: Vector4 | number, y?: number, w?: number, h?: number) => {
        state.scissor =
          value instanceof Vector4
            ? value.clone()
            : new Vector4(value, y ?? 0, w ?? 0, h ?? 0);
      },
    ),
    setScissorTest: vi.fn((enabled: boolean) => {
      state.scissorTest = enabled;
    }),
    setViewport: vi.fn(
      (value: Vector4 | number, y?: number, w?: number, h?: number) => {
        state.viewport =
          value instanceof Vector4
            ? value.clone()
            : new Vector4(value, y ?? 0, w ?? 0, h ?? 0);
      },
    ),
  } as unknown as WebGLRenderer;
  return { previousTarget, renderer, state };
}

describe("createGpuObjectPicker", () => {
  it("deduplicates proxy keys, decodes RGB IDs, and restores mutated state", async () => {
    const readback = deferred<Uint8Array>();
    const { previousTarget, renderer, state } = createRendererMock(readback);
    const scene = new Scene();
    const background = new Texture();
    scene.background = background;
    const firstMaterial = new MeshBasicMaterial();
    const secondMaterial = new MeshBasicMaterial();
    const sourceShaderHook = vi.fn();
    firstMaterial.onBeforeCompile = sourceShaderHook;
    const first = new Mesh(undefined, firstMaterial);
    const second = new Mesh(undefined, secondMaterial);
    first.layers.mask = 3;
    second.layers.mask = 5;
    const customizeSelectionMaterial = vi.fn((material: Material) => {
      material.userData.ywMmdSdef = true;
    });
    setSelectionMaterialCustomizer(first, customizeSelectionMaterial);
    scene.add(first, second);
    const camera = new PerspectiveCamera(60, 2, 0.1, 100);
    camera.layers.mask = 7;
    camera.setViewOffset(400, 200, 20, 10, 300, 150);
    const previousView = { ...camera.view! };
    let firstIdColor: number | null = null;
    let secondIdColor: number | null = null;
    vi.mocked(renderer.render).mockImplementation(() => {
      const firstIdMaterial = first.material as MeshBasicMaterial;
      const secondIdMaterial = second.material as MeshBasicMaterial;
      firstIdColor = firstIdMaterial.color.getHex();
      secondIdColor = secondIdMaterial.color.getHex();
      expect(camera.view).toMatchObject({
        fullHeight: 200,
        fullWidth: 400,
        height: 1.5,
        offsetX: 170,
        offsetY: 85,
        width: 1.5,
      });
      expect(firstIdMaterial.userData.ywMmdSdef).toBe(true);
      expect(firstIdMaterial.onBeforeCompile).not.toBe(sourceShaderHook);
      expect(scene.background).toBeNull();
      expect(first.layers.isEnabled(31)).toBe(true);
      expect(second.layers.isEnabled(31)).toBe(true);
      expect(state.renderTarget?.texture.colorSpace).toBe(NoColorSpace);
    });

    const picker = createGpuObjectPicker();
    const result = picker.pick({
      camera,
      clientX: 50,
      clientY: 50,
      domRect: { height: 100, left: 0, top: 0, width: 100 },
      renderer,
      scene,
      targets: [
        { key: "same", mesh: first },
        { key: "same", mesh: second },
      ],
    });

    expect(firstIdColor).toBe(secondIdColor);
    expect(customizeSelectionMaterial).toHaveBeenCalledTimes(1);
    expect(first.material).toBe(firstMaterial);
    expect(second.material).toBe(secondMaterial);
    expect(first.layers.mask).toBe(3);
    expect(second.layers.mask).toBe(5);
    expect(camera.layers.mask).toBe(7);
    expect(camera.view).toMatchObject(previousView);
    expect(scene.background).toBe(background);
    expect(state.renderTarget).toBe(previousTarget);
    expect(state.viewport).toEqual(new Vector4(8, 9, 10, 11));
    expect(state.scissor).toEqual(new Vector4(4, 5, 6, 7));
    expect(state.scissorTest).toBe(false);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.autoClearColor).toBe(true);
    expect(renderer.autoClearDepth).toBe(false);
    expect(renderer.autoClearStencil).toBe(true);

    readback.resolve(new Uint8Array([0, 0, 1, 255]));
    await expect(result).resolves.toBe("same");
    picker.dispose();
  });

  it("uses request-local buffers for overlapping async readbacks", async () => {
    const firstRead = deferred<Uint8Array>();
    const secondRead = deferred<Uint8Array>();
    const firstRenderer = createRendererMock(firstRead).renderer;
    const secondRenderer = createRendererMock(secondRead).renderer;
    const scene = new Scene();
    const mesh = new Mesh();
    scene.add(mesh);
    const camera = new PerspectiveCamera();
    const picker = createGpuObjectPicker();
    const request = {
      camera,
      clientX: 1,
      clientY: 1,
      domRect: { height: 2, left: 0, top: 0, width: 2 },
      scene,
      targets: [{ key: "mesh", mesh }],
    };

    const first = picker.pick({ ...request, renderer: firstRenderer });
    const second = picker.pick({ ...request, renderer: secondRenderer });
    const firstBuffer = vi.mocked(firstRenderer.readRenderTargetPixelsAsync)
      .mock.calls[0][5];
    const secondBuffer = vi.mocked(secondRenderer.readRenderTargetPixelsAsync)
      .mock.calls[0][5];
    expect(firstBuffer).not.toBe(secondBuffer);

    secondRead.resolve(new Uint8Array([0, 0, 1, 255]));
    firstRead.resolve(new Uint8Array([0, 0, 1, 255]));
    await expect(first).resolves.toBe("mesh");
    await expect(second).resolves.toBe("mesh");
    picker.dispose();
  });

  it("supports an orthographic camera view offset", async () => {
    const readback = deferred<Uint8Array>();
    const { renderer } = createRendererMock(readback);
    const scene = new Scene();
    const mesh = new Mesh();
    scene.add(mesh);
    const camera = new OrthographicCamera(-2, 2, 1, -1, 0.1, 10);
    const picker = createGpuObjectPicker();
    const result = picker.pick({
      camera,
      clientX: 1,
      clientY: 1,
      domRect: { height: 2, left: 0, top: 0, width: 2 },
      renderer,
      scene,
      targets: [{ key: "mesh", mesh }],
    });

    readback.resolve(new Uint8Array([0, 0, 1, 255]));
    await expect(result).resolves.toBe("mesh");
    expect(camera.view).toBeNull();
    picker.dispose();
  });

  it("restores state when rendering fails", async () => {
    const readback = deferred<Uint8Array>();
    const { previousTarget, renderer, state } = createRendererMock(readback);
    vi.mocked(renderer.render).mockImplementation(() => {
      throw new Error("render failed");
    });
    const scene = new Scene();
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(undefined, material);
    scene.add(mesh);
    const camera = new PerspectiveCamera();
    const picker = createGpuObjectPicker();

    await expect(
      picker.pick({
        camera,
        clientX: 1,
        clientY: 1,
        domRect: { height: 2, left: 0, top: 0, width: 2 },
        renderer,
        scene,
        targets: [{ key: "mesh", mesh }],
      }),
    ).rejects.toThrow("render failed");
    expect(mesh.material).toBe(material);
    expect(state.renderTarget).toBe(previousTarget);
    picker.dispose();
  });
});
