use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::usd::Stage;

use super::stage_fields::ValidatedStagePathExt;

use crate::usd::geometry::MeshOrientation;

use super::stage_fields::token_or_string_value_to_string;

/// Reads the `orientation` metadata from a Mesh prim. USD's default is
/// `rightHanded`. Left-handed meshes are common in DCC tools authored
/// for OpenGL-style pipelines.
pub(crate) fn read_mesh_orientation(stage: &Stage, prim_path: &SdfPath) -> MeshOrientation {
    let Ok(prop_path) = prim_path.append_property("orientation") else {
        return MeshOrientation::RightHanded;
    };
    match stage
        .attribute_at(prop_path)
        .get::<SdfValue>()
        .ok()
        .flatten()
        .and_then(token_or_string_value_to_string)
    {
        Some(token) => {
            if token == "leftHanded" {
                MeshOrientation::LeftHanded
            } else {
                MeshOrientation::RightHanded
            }
        }
        _ => MeshOrientation::RightHanded,
    }
}

/// Returns `true` if the prim at `prim_path` should contribute geometry
/// to the preview. Filters out anything the authoring DCC would hide
/// from the default render purpose:
///   - non-Mesh types,
///   - any prim in the ancestor chain with `active = false`,
///   - any prim in the ancestor chain with `visibility = "invisible"`,
///   - any prim in the ancestor chain with `purpose` of `"proxy"` or
///     `"guide"`.
///
/// USD's imageability attributes are inherited down the hierarchy, so a
/// simple local-only check would still preview meshes hidden by an
/// ancestor Xform. We walk the parent chain for visibility and purpose;
/// `active` is not technically inherited but deactivating an ancestor
/// conceptually removes the whole subtree from composition, so we treat
/// it the same way.
///
/// NOTE: no longer used by `extract_geometry_glb` (superseded by
/// `is_mesh_active_and_visible` which skips the purpose filter so all
/// four purposes land in the GLB for dynamic #32 frontend toggle).
/// Kept as a reference implementation; call sites outside this module
/// may still find it useful for non-GLB paths.
#[allow(dead_code)]
pub(crate) fn is_renderable_mesh(stage: &Stage, prim_path: &SdfPath) -> bool {
    // Must be a Mesh at the leaf.
    if stage
        .prim_at(prim_path.clone())
        .type_name()
        .ok()
        .flatten()
        .as_deref()
        != Some("Mesh")
    {
        return false;
    }

    // `Prim::is_active()` already composes the whole ancestor chain
    // (see its doc comment), so a single upfront call replaces the
    // per-ancestor `active` check that used to run inline with the
    // visibility/purpose walk below. `unwrap_or(true)` matches the old
    // fallback (an unreadable field never hid the mesh).
    if !is_composed_prim_active(stage, prim_path) {
        return false;
    }

    // Walk from the leaf toward the pseudo-root. Every step checks the
    // current prim's own opinions for visibility/purpose. If any
    // ancestor hides the subtree, the mesh is skipped.
    // String-based parent walk matches `compose_world_xform`.
    let mut path_str = prim_path.as_str().to_string();
    loop {
        let Ok(ancestor) = SdfPath::new(&path_str) else {
            break;
        };

        // `visibility = "invisible"` hides the prim and all descendants
        // until an inner prim re-authors `visibility = "inherited"`. We
        // don't do the full inherited-override walk here; yw-look's
        // preview purpose is the coarse "show what usdview would show by
        // default", which matches a first-invisible-wins heuristic well
        // enough for the scenes yw-look targets.
        if let Ok(prop) = ancestor.append_property("visibility") {
            if stage
                .attribute_at(prop)
                .get::<SdfValue>()
                .ok()
                .flatten()
                .and_then(token_or_string_value_to_string)
                .as_deref()
                == Some("invisible")
            {
                return false;
            }
        }

        if let Ok(prop) = ancestor.append_property("purpose") {
            if matches!(
                stage
                    .attribute_at(prop)
                    .get::<SdfValue>()
                    .ok()
                    .flatten()
                    .and_then(token_or_string_value_to_string)
                    .as_deref(),
                Some("proxy" | "guide")
            ) {
                return false;
            }
        }

        // Ascend to the parent. Stop once we hit the pseudo-root.
        let Some(slash_idx) = path_str.rfind('/') else {
            break;
        };
        if slash_idx == 0 {
            break;
        }
        path_str.truncate(slash_idx);
    }

    true
}

/// Like `is_renderable_mesh` but does NOT filter on `purpose`. Used by
/// `extract_geometry_glb_with_options` (plan A) which embeds the purpose
/// token in the GLB node extras so the frontend can toggle visibility
/// dynamically without re-extracting. The caller is responsible for
/// writing the resolved purpose onto each `MeshInput`.
pub(crate) fn is_mesh_active_and_visible(stage: &Stage, prim_path: &SdfPath) -> bool {
    // Must be a Mesh at the leaf.
    // Use Prim::type_name rather than a raw stage field lookup. Instance proxy
    // paths have no authored spec at their proxy namespace, so field lookup
    // returns None even though the composed prim is a Mesh.
    if !is_mesh_active(stage, prim_path) {
        return false;
    }

    let mut path_str = prim_path.as_str().to_string();
    loop {
        let Ok(ancestor) = SdfPath::new(&path_str) else {
            break;
        };

        if let Ok(prop) = ancestor.append_property("visibility") {
            if stage
                .attribute_at(prop)
                .get::<SdfValue>()
                .ok()
                .flatten()
                .and_then(token_or_string_value_to_string)
                .as_deref()
                == Some("invisible")
            {
                return false;
            }
        }

        let Some(slash_idx) = path_str.rfind('/') else {
            break;
        };
        if slash_idx == 0 {
            break;
        }
        path_str.truncate(slash_idx);
    }

    true
}

fn is_mesh_active(stage: &Stage, prim_path: &SdfPath) -> bool {
    stage
        .prim_at(prim_path.clone())
        .type_name()
        .ok()
        .flatten()
        .as_deref()
        == Some("Mesh")
        && is_composed_prim_active(stage, prim_path)
}

/// `Prim::is_active` currently returns false for instance proxies because
/// their composed namespace has no directly authored prim spec. Validate the
/// corresponding prototype prim, then validate the real instance root whose
/// authored namespace owns the proxy subtree.
fn is_composed_prim_active(stage: &Stage, prim_path: &SdfPath) -> bool {
    let prim = stage.prim_at(prim_path.clone());
    if !prim.is_instance_proxy().unwrap_or(false) {
        return prim.is_active().unwrap_or(true);
    }

    if prim
        .prim_in_prototype()
        .ok()
        .flatten()
        .is_some_and(|prototype_prim| !prototype_prim.is_active().unwrap_or(true))
    {
        return false;
    }

    let mut path_str = prim_path.as_str().to_string();
    loop {
        let Some(slash_idx) = path_str.rfind('/') else {
            break;
        };
        if slash_idx == 0 {
            break;
        }
        path_str.truncate(slash_idx);
        let Ok(ancestor_path) = SdfPath::new(&path_str) else {
            break;
        };
        let ancestor = stage.prim_at(ancestor_path);
        if !ancestor.is_instance_proxy().unwrap_or(false) {
            return ancestor.is_active().unwrap_or(true);
        }
    }

    true
}

/// Read the effective `purpose` token for `prim_path` by walking toward
/// the pseudo-root, returning the first authored non-"inherited" purpose
/// found. Returns `"default"` when no ancestor authors a purpose.
pub(crate) fn resolve_purpose(stage: &Stage, prim_path: &SdfPath) -> String {
    let mut path_str = prim_path.as_str().to_string();
    loop {
        let Ok(ancestor) = SdfPath::new(&path_str) else {
            break;
        };

        if let Ok(prop) = ancestor.append_property("purpose") {
            if let Some(token) = stage
                .attribute_at(prop)
                .get::<SdfValue>()
                .ok()
                .flatten()
                .and_then(token_or_string_value_to_string)
            {
                // "inherited" means "inherit from parent": keep walking.
                if !token.is_empty() && token != "inherited" {
                    return token;
                }
            }
        }

        let Some(slash_idx) = path_str.rfind('/') else {
            break;
        };
        if slash_idx == 0 {
            break;
        }
        path_str.truncate(slash_idx);
    }

    "default".to_string()
}
