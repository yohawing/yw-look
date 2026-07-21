use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::Stage;

use super::stage_fields::read_string_or_token_attribute;

/// Read a `float` / `double` input from a light (or shader) prim.
/// Returns `None` when unauthored or typed as something else.
pub(crate) fn read_shader_float(
    stage: &Stage,
    prim_path: &SdfPath,
    input_name: &str,
) -> Option<f32> {
    let prop_path = prim_path.append_property(input_name).ok()?;
    let value: SdfValue = stage.attribute(prop_path).get::<SdfValue>().ok().flatten()?;
    match value {
        SdfValue::Float(v) => Some(v),
        SdfValue::Double(v) => Some(v as f32),
        _ => None,
    }
}

/// Read a `color3f` / `color3d` input on a light prim. Falls back to
/// `None` when the value is unauthored or the wrong type.
pub(crate) fn read_shader_color(
    stage: &Stage,
    prim_path: &SdfPath,
    input_name: &str,
) -> Option<[f32; 3]> {
    let prop_path = prim_path.append_property(input_name).ok()?;
    let value: SdfValue = stage.attribute(prop_path).get::<SdfValue>().ok().flatten()?;
    match value {
        SdfValue::Vec3f(v) => Some(v.into()),
        SdfValue::Vec3d(v) => Some([v[0] as f32, v[1] as f32, v[2] as f32]),
        _ => None,
    }
}

pub(crate) fn read_shader_token(
    stage: &Stage,
    prim_path: &SdfPath,
    input_name: &str,
) -> Option<String> {
    let prop_path = prim_path.append_property(input_name).ok()?;
    read_string_or_token_attribute(stage, prop_path)
}
