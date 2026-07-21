use std::cell::RefCell;

use openusd::sdf::Path as SdfPath;
use openusd::Stage;

use crate::usd::glb;
use crate::usd::lights::{
    effective_light_intensity_from_authored, gltf_light_kind_from_usd_type_name,
};
use crate::usd::math::{mat4_f64_to_f32, mat4_mul};

use super::shader_fields::{read_shader_color, read_shader_float};
use super::stage_fields::read_token_or_string_field;
use super::xform::compose_world_xform;
use super::LEGACY_TRAVERSE_PREDICATE;

/// Phase 7a: enumerate `UsdLuxLight` prims on the stage and resolve
/// each to a [`glb::LightInput`] with the authored intensity, color,
/// exposure, and world transform baked in.
///
/// Scope:
///   - `UsdLuxDistantLight` -> [`LightKind::Directional`]
///   - `UsdLuxSphereLight`  -> [`LightKind::Point`] (no shaping cone)
///
/// Out of scope (returns no entry): `RectLight`, `DiskLight`,
/// `CylinderLight`, `DomeLight`. Area lights need a glTF extension
/// that does not yet exist (`KHR_lights_area` is draft-only);
/// DomeLight is handled via the environment-map pipeline and does
/// not belong in `KHR_lights_punctual`.
///
/// Up-axis correction is applied when the stage is Z-up so the glTF
/// node matrix is expressed in the viewer's Y-up space, same as
/// mesh nodes.
pub(crate) fn resolve_lights(
    stage: &Stage,
    up_correction: Option<&[f64; 16]>,
) -> Vec<glb::LightInput> {
    let light_paths = RefCell::new(Vec::<SdfPath>::new());
    if stage
        .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
            if detect_light_kind(stage, prim_path).is_some() {
                light_paths.borrow_mut().push(prim_path.clone());
            }
        })
        .is_err()
    {
        return Vec::new();
    }

    let paths = light_paths.into_inner();
    let mut out = Vec::with_capacity(paths.len());
    for prim_path in paths {
        let Some(kind) = detect_light_kind(stage, &prim_path) else {
            continue;
        };
        let intensity = effective_light_intensity_from_authored(
            read_shader_float(stage, &prim_path, "inputs:intensity"),
            read_shader_float(stage, &prim_path, "inputs:exposure"),
        );
        let color = read_shader_color(stage, &prim_path, "inputs:color").unwrap_or([1.0, 1.0, 1.0]);

        let Ok(world) = compose_world_xform(stage, &prim_path) else {
            continue;
        };
        let world = match up_correction {
            Some(correction) => mat4_mul(correction, &world),
            None => world,
        };
        let world_f32 = mat4_f64_to_f32(&world);

        out.push(glb::LightInput {
            name: prim_path.as_str().to_string(),
            kind,
            color,
            intensity,
            world_matrix: world_f32,
        });
    }
    out
}

/// Map the prim's USD `typeName` to the subset of light kinds yw-look
/// currently emits to glTF. Returns `None` for non-lights and for
/// lights we intentionally skip (area lights, DomeLight).
pub(crate) fn detect_light_kind(stage: &Stage, prim_path: &SdfPath) -> Option<glb::LightKind> {
    let type_name = read_token_or_string_field(stage, prim_path.clone());
    gltf_light_kind_from_usd_type_name(type_name.as_deref())
}
