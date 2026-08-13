use std::cell::RefCell;

use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::usd::Stage;

use super::stage_fields::ValidatedStagePathExt;

use crate::usd::glb;
use crate::usd::math::{mat4_f64_to_f32, mat4_mul};

use super::shader_fields::read_shader_float;
use super::stage_fields::read_token_or_string_field;
use super::xform::compose_world_xform;
use super::LEGACY_TRAVERSE_PREDICATE;

/// Phase 7b: enumerate `UsdGeomCamera` prims and resolve each to a
/// [`glb::CameraInput`]. USD's camera schema stores focal length and
/// aperture in **millimeters**, which we convert to a glTF
/// `perspective.yfov` (radians) via [`glb::camera_yfov_radians`].
///
/// Scope:
///   - Perspective cameras only. Orthographic projections require an
///     emitter for glTF `orthographic` and are deferred until a
///     concrete asset needs them.
///   - `clippingRange` is read when authored; otherwise the spec
///     defaults (0.1, 1e6) are used so the camera always produces a
///     valid glTF entry.
///
/// Out of scope (returns no entry): cameras inside un-composed
/// payloads (those are already invisible to `traverse` under
/// `NoPayloads` policy), and cameras that evaluate to
/// non-perspective projections.
pub(crate) fn resolve_cameras(
    stage: &Stage,
    up_correction: Option<&[f64; 16]>,
) -> Vec<glb::CameraInput> {
    let camera_paths = RefCell::new(Vec::<SdfPath>::new());
    if stage
        .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
            if read_token_or_string_field(stage, prim_path.clone()).as_deref() == Some("Camera") {
                camera_paths.borrow_mut().push(prim_path.clone());
            }
        })
        .is_err()
    {
        return Vec::new();
    }

    let paths = camera_paths.into_inner();
    let mut out = Vec::with_capacity(paths.len());
    for prim_path in paths {
        // USD camera defaults (per UsdGeomCamera schema):
        //   focalLength = 50mm, horizontalAperture = 20.955mm,
        //   verticalAperture = 15.2908mm.
        // glTF spec defaults: yfov = pi/4, aspectRatio = 1.0,
        // znear = 0.1. Projection types differ from USD: glTF
        // `perspective` matches USD `perspective`.
        let focal_length = read_shader_float(stage, &prim_path, "focalLength").unwrap_or(50.0);
        let horizontal_aperture =
            read_shader_float(stage, &prim_path, "horizontalAperture").unwrap_or(20.955);
        let vertical_aperture =
            read_shader_float(stage, &prim_path, "verticalAperture").unwrap_or(15.2908);

        let yfov = glb::camera_yfov_radians(vertical_aperture, focal_length);
        let aspect_ratio = if vertical_aperture > 0.0 {
            horizontal_aperture / vertical_aperture
        } else {
            1.0
        };

        // clippingRange is a float2 in USD; we read it as Vec2f and
        // fall back to glTF-friendly defaults when missing.
        let clip = prim_path
            .append_property("clippingRange")
            .ok()
            .and_then(|p| stage.attribute_at(p).get::<SdfValue>().ok().flatten());
        let (znear, zfar) = match clip {
            Some(SdfValue::Vec2f(v)) => (v[0], Some(v[1])),
            Some(SdfValue::Vec2d(v)) => (v[0] as f32, Some(v[1] as f32)),
            _ => (0.1, None),
        };
        let znear = if znear > 0.0 { znear } else { 0.1 };

        let Ok(world) = compose_world_xform(stage, &prim_path) else {
            continue;
        };
        let world = match up_correction {
            Some(correction) => mat4_mul(correction, &world),
            None => world,
        };
        let world_f32 = mat4_f64_to_f32(&world);

        out.push(glb::CameraInput {
            name: prim_path.as_str().to_string(),
            yfov,
            aspect_ratio,
            znear,
            zfar,
            world_matrix: world_f32,
        });
    }
    out
}
