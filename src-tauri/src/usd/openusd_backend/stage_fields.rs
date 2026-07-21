use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::Stage;

use super::nonpublic_api;

/// Reads a stage-level metadatum (composed over the session layer, same as
/// `up_axis` / `meters_per_unit` in `stage_query.rs`) as a double. Returns
/// `None` when the field is unauthored or the value is some unrelated
/// type. Float values (some DCCs author `framesPerSecond` as `Float`
/// instead of the USD-spec `Double`) are widened so the inspector can
/// still surface them.
pub(crate) fn read_root_double_field(stage: &Stage, field: FieldKey) -> Option<f64> {
    let value = stage.stage_metadata(field).ok()??;
    match value {
        SdfValue::Double(v) => Some(v),
        SdfValue::Float(v) => Some(v as f64),
        _ => None,
    }
}

pub(crate) fn token_vec_to_strings(tokens: Vec<openusd::tf::Token>) -> Vec<String> {
    tokens
        .into_iter()
        .map(|token| token.as_str().to_owned())
        .collect()
}

pub(crate) fn token_or_string_value_to_string(value: SdfValue) -> Option<String> {
    match value {
        SdfValue::Token(token) => Some(token.as_str().to_owned()),
        SdfValue::String(s) => Some(s),
        _ => None,
    }
}

/// Reads a prim's `typeName` field, tolerating a non-conformant
/// `String`-typed authoring alongside the spec's `Token`. Always
/// `FieldKey::TypeName`; the raw read lives in `nonpublic_api` because
/// `Prim::type_name()` only recognizes the `Token` variant (see that
/// helper's doc comment).
pub(crate) fn read_token_or_string_field(stage: &Stage, path: SdfPath) -> Option<String> {
    nonpublic_api::prim_type_name_field(stage, path)
        .ok()
        .flatten()
        .and_then(token_or_string_value_to_string)
}

/// Reads an attribute's composed default value as a `Token` or
/// `String`, e.g. a UsdShade `info:id` input. Unlike
/// [`read_token_or_string_field`], this is a plain attribute read with a
/// direct public equivalent (`Attribute::get::<Value>()` ==
/// `Stage::field(path, FieldKey::Default)`).
pub(crate) fn read_string_or_token_attribute(stage: &Stage, path: SdfPath) -> Option<String> {
    stage
        .attribute(path)
        .get::<SdfValue>()
        .ok()
        .flatten()
        .and_then(token_or_string_value_to_string)
}
