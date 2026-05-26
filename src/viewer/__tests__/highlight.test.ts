import { BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import {
  applySelectionHighlightToObject,
  clearSelectionHighlightFromObject,
} from "../highlight";

describe("selection highlight helpers", () => {
  it("skips viewport helper and MMD selection proxy meshes", () => {
    const root = new Group();
    const selectableMaterial = new MeshBasicMaterial({ color: 0xffffff });
    const helperMaterial = new MeshBasicMaterial({ color: 0xffffff });
    const proxyMaterial = new MeshBasicMaterial({ color: 0xffffff });

    const selectable = new Mesh(new BufferGeometry(), selectableMaterial);
    const helper = new Mesh(new BufferGeometry(), helperMaterial);
    const proxy = new Mesh(new BufferGeometry(), proxyMaterial);
    helper.userData.__yw_wireframe_proxy = true;
    proxy.userData.__ywSelectionProxyTarget = selectable;
    root.add(selectable, helper, proxy);

    applySelectionHighlightToObject(root);

    expect(selectable.material).not.toBe(selectableMaterial);
    expect(helper.material).toBe(helperMaterial);
    expect(proxy.material).toBe(proxyMaterial);

    clearSelectionHighlightFromObject(root);

    expect(selectable.material).toBe(selectableMaterial);
  });
});
