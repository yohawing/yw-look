import {
  Camera,
  Mesh,
  Object3D,
  Ray,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from "three";
import type { PurposeModes } from "../lib/usd";
import {
  createMeshBvhRaycastBuilder,
  isStaticMeshBvhCandidate,
  isViewportHelperObject,
  LARGE_PICK_MESH_TRIANGLE_THRESHOLD,
  meshTriangleCount,
  selectionProxyTarget,
} from "../viewer";
import { resolveObjectSelectionKey } from "../viewer/selectionKeys";
import { createGpuObjectPicker } from "./gpuObjectPicker";

export const MANUAL_HIDDEN_KEY = "__ywManualHidden";

export function selectionKeyForObject(object: Object3D) {
  const proxyTarget = selectionProxyTarget(object);
  if (proxyTarget) {
    return selectionKeyForObject(proxyTarget);
  }
  return resolveObjectSelectionKey(object);
}

export function findObjectBySelectionKey(
  root: Object3D,
  selectionKey: string,
): Object3D | null {
  let match: Object3D | null = null;

  root.traverse((child) => {
    if (match) return;
    if (selectionKeyForObject(child) === selectionKey) {
      match = child;
    }
  });

  return match;
}

export function isSelectablePickTarget(object: Object3D): object is Mesh {
  return (
    object instanceof Mesh &&
    object.name !== "__yw_shadow_catcher" &&
    !isViewportHelperObject(object) &&
    selectionKeyForObject(object) !== null
  );
}

export function collectSelectablePickTargets(root: Object3D): Mesh[] {
  const targets: Mesh[] = [];
  root.traverse((child) => {
    if (isSelectablePickTarget(child)) {
      targets.push(child);
    }
  });
  return targets;
}

function collectVisibleSelectablePickTargets(root: Object3D): Mesh[] {
  const targets: Mesh[] = [];
  root.traverseVisible((child) => {
    if (isSelectablePickTarget(child)) targets.push(child);
  });
  return targets;
}

export function createViewportPicker(
  camera: Camera,
  domElement: Pick<HTMLElement, "getBoundingClientRect">,
  options: {
    bvhBuilder?: ReturnType<typeof createMeshBvhRaycastBuilder>;
    gpuPicker?: ReturnType<typeof createGpuObjectPicker>;
    largeTriangleThreshold?: number;
  } = {},
) {
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const bvhBuilder = options.bvhBuilder ?? createMeshBvhRaycastBuilder();
  const gpuPicker = options.gpuPicker ?? createGpuObjectPicker();
  const largeTriangleThreshold =
    options.largeTriangleThreshold ?? LARGE_PICK_MESH_TRIANGLE_THRESHOLD;
  let mountedRoot: Object3D | null = null;
  let mountedSyncToken = 0;
  let targets: Mesh[] = [];
  let preparation: Promise<void> = Promise.resolve();
  let preparationPending = false;
  let currentCamera = camera;
  let gpuMode = false;
  let gpuPickGeneration = 0;
  type GpuPickRequest = {
    clientX: number;
    clientY: number;
    domRect: Pick<DOMRect, "height" | "left" | "top" | "width">;
    generation: number;
    root: Object3D;
    rootToken: number;
    settled: boolean;
    resolve(value: string | null): void;
  };
  let pendingGpuPick: GpuPickRequest | null = null;
  const activeGpuPicks = new Set<GpuPickRequest>();

  const settleGpuPick = (request: GpuPickRequest, value: string | null) => {
    if (request.settled) return;
    request.settled = true;
    activeGpuPicks.delete(request);
    if (pendingGpuPick === request) pendingGpuPick = null;
    request.resolve(value);
  };

  const cancelGpuPicks = () => {
    gpuPickGeneration += 1;
    for (const request of activeGpuPicks) settleGpuPick(request, null);
    pendingGpuPick = null;
  };

  const syncMountedObject = (mounted: Object3D | null | undefined) => {
    const next = mounted ?? null;
    if (next === mountedRoot) return;
    const syncToken = ++mountedSyncToken;
    cancelGpuPicks();
    bvhBuilder.invalidate();
    mountedRoot = next;
    const collected = next ? collectSelectablePickTargets(next) : [];
    const largeTargets = collected.filter(
      (mesh) =>
        meshTriangleCount(mesh) >= largeTriangleThreshold &&
        isStaticMeshBvhCandidate(mesh),
    );
    gpuMode = collected.some(
      (mesh) =>
        meshTriangleCount(mesh) >= largeTriangleThreshold &&
        !isStaticMeshBvhCandidate(mesh),
    );
    if (gpuMode) {
      targets = [];
      preparation = Promise.resolve();
      preparationPending = false;
      return;
    }
    targets = collected.filter(
      (mesh) => meshTriangleCount(mesh) < largeTriangleThreshold,
    );
    preparationPending = largeTargets.length > 0;
    preparation = largeTargets
      .reduce(
        (chain, mesh) =>
          chain
            .then(() =>
              mountedRoot === next && mountedSyncToken === syncToken
                ? bvhBuilder.build(mesh)
                : false,
            )
            .then((ready) => {
              if (
                ready &&
                mountedRoot === next &&
                mountedSyncToken === syncToken
              ) {
                targets.push(mesh);
              }
            }),
        Promise.resolve(),
      )
      .finally(() => {
        if (mountedRoot === next && mountedSyncToken === syncToken) {
          preparationPending = false;
        }
      });
  };

  const snapshotPickRay = (
    event: Pick<PointerEvent, "clientX" | "clientY">,
  ) => {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, currentCamera);
    return raycaster.ray.clone();
  };

  const intersectPrepared = (mounted: Object3D, pickRay: Ray) => {
    if (mounted !== mountedRoot) return null;
    raycaster.ray.copy(pickRay);

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;

    let node: Object3D | null = hits[0].object;
    while (node) {
      if (node instanceof Mesh && node.name !== "__yw_shadow_catcher") {
        return selectionKeyForObject(node);
      }
      if (node === mounted) break;
      node = node.parent;
    }
    return null;
  };

  return {
    syncMountedObject,
    async flushPendingGpuPick({
      camera: nextCamera,
      renderer,
      scene,
    }: {
      camera: Camera;
      renderer: WebGLRenderer;
      scene: Scene;
    }) {
      currentCamera = nextCamera;
      const request = pendingGpuPick;
      if (!request) return;
      pendingGpuPick = null;
      if (
        request.settled ||
        request.root !== mountedRoot ||
        request.rootToken !== mountedSyncToken ||
        request.generation !== gpuPickGeneration
      ) {
        settleGpuPick(request, null);
        return;
      }

      const gpuTargets = collectVisibleSelectablePickTargets(request.root)
        .filter((mesh) => mesh.layers.test(nextCamera.layers))
        .map((mesh) => ({
          key: selectionKeyForObject(mesh),
          mesh,
        }))
        .filter((target): target is { key: string; mesh: Mesh } =>
          Boolean(target.key),
        );
      try {
        const selectionKey = await gpuPicker.pick({
          camera: nextCamera,
          clientX: request.clientX,
          clientY: request.clientY,
          domRect: request.domRect,
          renderer,
          scene,
          targets: gpuTargets,
        });
        if (
          request.root === mountedRoot &&
          request.rootToken === mountedSyncToken &&
          request.generation === gpuPickGeneration
        ) {
          settleGpuPick(request, selectionKey);
        } else {
          settleGpuPick(request, null);
        }
      } catch (error: unknown) {
        console.warn(
          `[selection-gpu] ${error instanceof Error ? error.message : String(error)}`,
        );
        settleGpuPick(request, null);
      }
    },
    pickSelectionKey(
      mounted: Object3D,
      event: Pick<PointerEvent, "clientX" | "clientY">,
    ) {
      // Only the post-render lifecycle call may start BVH preparation. A click
      // arriving before that synchronization must not transfer CPU geometry
      // buffers before their first GPU upload.
      if (mounted !== mountedRoot) return null;
      if (gpuMode) {
        cancelGpuPicks();
        const generation = gpuPickGeneration;
        const { height, left, top, width } = domElement.getBoundingClientRect();
        const domRect = { height, left, top, width };
        return new Promise<string | null>((resolve) => {
          const request: GpuPickRequest = {
            clientX: event.clientX,
            clientY: event.clientY,
            domRect,
            generation,
            root: mounted,
            rootToken: mountedSyncToken,
            settled: false,
            resolve,
          };
          pendingGpuPick = request;
          activeGpuPicks.add(request);
        });
      }
      const pickRay = snapshotPickRay(event);
      if (!preparationPending) return intersectPrepared(mounted, pickRay);
      const expectedRoot = mountedRoot;
      return preparation.then(() => {
        if (mountedRoot !== expectedRoot) return null;
        return intersectPrepared(mounted, pickRay);
      });
    },
    dispose() {
      mountedRoot = null;
      targets = [];
      cancelGpuPicks();
      bvhBuilder.dispose();
      gpuPicker.dispose();
    },
  };
}

export function isManuallyHidden(object: Object3D) {
  return object.userData?.[MANUAL_HIDDEN_KEY] === true;
}

export function setSubtreeManualHidden(root: Object3D, hidden: boolean) {
  root.traverse((child) => {
    if (child.name === "__yw_shadow_catcher") {
      return;
    }
    if (hidden) {
      child.userData[MANUAL_HIDDEN_KEY] = true;
    } else {
      delete child.userData[MANUAL_HIDDEN_KEY];
    }
  });

  const parent = root.parent;
  if (!parent) {
    return;
  }
  parent.traverse((child) => {
    if (selectionProxyTarget(child) !== root) {
      return;
    }
    if (hidden) {
      child.userData[MANUAL_HIDDEN_KEY] = true;
    } else {
      delete child.userData[MANUAL_HIDDEN_KEY];
    }
  });
}

export function applyManualVisibility(root: Object3D) {
  root.traverse((child) => {
    if (child.name === "__yw_shadow_catcher") {
      return;
    }
    if (isManuallyHidden(child)) {
      child.visible = false;
    }
  });
}

export function isolateObject(root: Object3D, selected: Object3D) {
  setSubtreeManualHidden(root, true);
  setSubtreeManualHidden(selected, false);

  let ancestor = selected.parent;
  while (ancestor && ancestor !== root.parent) {
    delete ancestor.userData[MANUAL_HIDDEN_KEY];
    if (ancestor === root) break;
    ancestor = ancestor.parent;
  }
}

export function applyPurposeVisibility(
  root: Object3D,
  modes: PurposeModes | undefined,
) {
  const render = modes?.render ?? true;
  const proxy = modes?.proxy ?? false;
  const guide = modes?.guide ?? false;

  root.traverse((child) => {
    const purpose: unknown = child.userData?.purpose;
    if (typeof purpose !== "string") return;

    let visible: boolean;
    switch (purpose) {
      case "default":
        visible = true;
        break;
      case "render":
        visible = render;
        break;
      case "proxy":
        visible = proxy;
        break;
      case "guide":
        visible = guide;
        break;
      default:
        visible = true;
    }
    child.visible = visible && !isManuallyHidden(child);
  });
}
