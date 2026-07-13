import {
  Camera,
  Color,
  Material,
  Mesh,
  MeshBasicMaterial,
  NoBlending,
  NoColorSpace,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { applySelectionMaterialCustomizer } from "../viewer";

export type GpuPickTarget = {
  key: string;
  mesh: Mesh;
};

type CameraWithViewOffset = PerspectiveCamera | OrthographicCamera;

type SavedView = {
  enabled: boolean;
  fullHeight: number;
  fullWidth: number;
  height: number;
  offsetX: number;
  offsetY: number;
  width: number;
} | null;

export type GpuObjectPickRequest = {
  camera: Camera;
  clientX: number;
  clientY: number;
  domRect: Pick<DOMRect, "height" | "left" | "top" | "width">;
  renderer: WebGLRenderer;
  scene: Scene;
  targets: GpuPickTarget[];
};

const PICK_LAYER = 31;
const PICK_LAYER_MASK = 2 ** PICK_LAYER;

function supportsViewOffset(camera: Camera): camera is CameraWithViewOffset {
  return (
    camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera
  );
}

function saveView(camera: CameraWithViewOffset): SavedView {
  return camera.view ? { ...camera.view } : null;
}

function restoreView(camera: CameraWithViewOffset, view: SavedView) {
  camera.view = view ? { ...view } : null;
  camera.updateProjectionMatrix();
}

function createIdMaterial(id: number, source: Material): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    blending: NoBlending,
    color: new Color(
      ((id >> 16) & 0xff) / 0xff,
      ((id >> 8) & 0xff) / 0xff,
      (id & 0xff) / 0xff,
    ),
    depthTest: true,
    depthWrite: true,
    fog: false,
    side: source.side,
    toneMapped: false,
  });
  material.clippingPlanes = source.clippingPlanes;
  material.clipIntersection = source.clipIntersection;
  material.clipShadows = source.clipShadows;

  // CPU raycasting treats a triangle as pickable regardless of texture alpha,
  // opacity, or alphaTest. Keep the GPU contract identical: ID materials are
  // opaque and do not sample source maps. Clipping planes and face side remain
  // meaningful geometric rejection rules and are preserved above.
  material.alphaTest = 0;
  material.transparent = false;
  return material;
}

function decodeId(pixel: Uint8Array): number {
  return (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
}

export function createGpuObjectPicker() {
  let disposed = false;
  const activeRenderTargets = new Set<WebGLRenderTarget>();

  return {
    async pick({
      camera,
      clientX,
      clientY,
      domRect,
      renderer,
      scene,
      targets,
    }: GpuObjectPickRequest): Promise<string | null> {
      if (
        disposed ||
        !supportsViewOffset(camera) ||
        domRect.width <= 0 ||
        domRect.height <= 0
      ) {
        return null;
      }

      // A later click may be flushed while an earlier async readback is still
      // pending. Request-local storage prevents the two GPU reads from sharing
      // either a framebuffer or destination bytes.
      const renderTarget = new WebGLRenderTarget(1, 1, {
        depthBuffer: true,
        stencilBuffer: false,
      });
      renderTarget.texture.colorSpace = NoColorSpace;
      activeRenderTargets.add(renderTarget);
      const pixel = new Uint8Array(4);

      const drawingBufferSize = renderer.getDrawingBufferSize(new Vector2());
      const pixelX = Math.min(
        drawingBufferSize.x - 1,
        Math.max(
          0,
          Math.floor(
            ((clientX - domRect.left) / domRect.width) * drawingBufferSize.x,
          ),
        ),
      );
      const pixelY = Math.min(
        drawingBufferSize.y - 1,
        Math.max(
          0,
          Math.floor(
            ((clientY - domRect.top) / domRect.height) * drawingBufferSize.y,
          ),
        ),
      );

      const previousTarget = renderer.getRenderTarget();
      const previousCubeFace = renderer.getActiveCubeFace();
      const previousMipmapLevel = renderer.getActiveMipmapLevel();
      const previousViewport = renderer.getViewport(new Vector4()).clone();
      const previousScissor = renderer.getScissor(new Vector4()).clone();
      const previousScissorTest = renderer.getScissorTest();
      const previousClearColor = renderer.getClearColor(new Color()).clone();
      const previousClearAlpha = renderer.getClearAlpha();
      const previousAutoClear = renderer.autoClear;
      const previousAutoClearColor = renderer.autoClearColor;
      const previousAutoClearDepth = renderer.autoClearDepth;
      const previousAutoClearStencil = renderer.autoClearStencil;
      const previousBackground = scene.background;
      const previousOverrideMaterial = scene.overrideMaterial;
      const previousCameraLayers = camera.layers.mask;
      const previousView = saveView(camera);
      const previousProjectionMatrix = camera.projectionMatrix.clone();
      const previousProjectionMatrixInverse =
        camera.projectionMatrixInverse.clone();
      const previousLayerMasks = new Map<Object3D, number>();
      const previousMaterials = new Map<Mesh, Material | Material[]>();
      const temporaryMaterials: MeshBasicMaterial[] = [];
      const idToKey = new Map<number, string>();
      const keyToId = new Map<string, number>();
      let readPromise: Promise<Uint8Array> | null = null;

      try {
        scene.traverse((object) => {
          previousLayerMasks.set(object, object.layers.mask);
          object.layers.disable(PICK_LAYER);
        });
        camera.layers.mask = PICK_LAYER_MASK;

        for (const { key, mesh } of targets) {
          let id = keyToId.get(key);
          if (id === undefined) {
            id = keyToId.size + 1;
            if (id > 0xffffff) break;
            keyToId.set(key, id);
            idToKey.set(id, key);
          }

          previousMaterials.set(mesh, mesh.material);
          mesh.layers.enable(PICK_LAYER);
          const sourceMaterials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          const idMaterials = sourceMaterials.map((source) => {
            const material = createIdMaterial(id, source);
            applySelectionMaterialCustomizer(mesh, material);
            temporaryMaterials.push(material);
            return material;
          });
          mesh.material = Array.isArray(mesh.material)
            ? idMaterials
            : idMaterials[0];
        }

        if (previousView?.enabled) {
          camera.setViewOffset(
            previousView.fullWidth,
            previousView.fullHeight,
            previousView.offsetX +
              (pixelX / drawingBufferSize.x) * previousView.width,
            previousView.offsetY +
              (pixelY / drawingBufferSize.y) * previousView.height,
            previousView.width / drawingBufferSize.x,
            previousView.height / drawingBufferSize.y,
          );
        } else {
          camera.setViewOffset(
            drawingBufferSize.x,
            drawingBufferSize.y,
            pixelX,
            pixelY,
            1,
            1,
          );
        }
        camera.updateProjectionMatrix();
        scene.background = null;
        scene.overrideMaterial = null;
        renderer.autoClear = false;
        renderer.autoClearColor = false;
        renderer.autoClearDepth = false;
        renderer.autoClearStencil = false;
        renderer.setRenderTarget(renderTarget);
        renderer.setViewport(0, 0, 1, 1);
        renderer.setScissor(0, 0, 1, 1);
        renderer.setScissorTest(true);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        readPromise = renderer.readRenderTargetPixelsAsync(
          renderTarget,
          0,
          0,
          1,
          1,
          pixel,
        ) as Promise<Uint8Array>;
      } finally {
        for (const [mesh, material] of previousMaterials) {
          mesh.material = material;
        }
        for (const [object, mask] of previousLayerMasks) {
          object.layers.mask = mask;
        }
        camera.layers.mask = previousCameraLayers;
        restoreView(camera, previousView);
        camera.projectionMatrix.copy(previousProjectionMatrix);
        camera.projectionMatrixInverse.copy(previousProjectionMatrixInverse);
        scene.background = previousBackground;
        scene.overrideMaterial = previousOverrideMaterial;
        renderer.setRenderTarget(
          previousTarget,
          previousCubeFace,
          previousMipmapLevel,
        );
        renderer.setViewport(previousViewport);
        renderer.setScissor(previousScissor);
        renderer.setScissorTest(previousScissorTest);
        renderer.setClearColor(previousClearColor, previousClearAlpha);
        renderer.autoClear = previousAutoClear;
        renderer.autoClearColor = previousAutoClearColor;
        renderer.autoClearDepth = previousAutoClearDepth;
        renderer.autoClearStencil = previousAutoClearStencil;
        for (const material of temporaryMaterials) material.dispose();
        if (!readPromise) {
          activeRenderTargets.delete(renderTarget);
          renderTarget.dispose();
        }
      }

      if (!readPromise) return null;
      try {
        const result = await readPromise;
        return disposed ? null : (idToKey.get(decodeId(result)) ?? null);
      } finally {
        activeRenderTargets.delete(renderTarget);
        renderTarget.dispose();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const renderTarget of activeRenderTargets) renderTarget.dispose();
      activeRenderTargets.clear();
    },
  };
}
