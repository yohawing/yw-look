use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::Stage;

/// Reads a stage-level metadatum authored on the pseudoroot (`/`) as
/// a double. Returns `None` when the field is not authored on the
/// root layer or when the value is some unrelated type. Float values
/// (some DCCs author `framesPerSecond` as `Float` instead of the
/// USD-spec `Double`) are widened so the inspector can still surface them.
pub(crate) fn read_root_double_field(
    stage: &Stage,
    pseudo_root: &SdfPath,
    field: FieldKey,
) -> Option<f64> {
    let value = stage.field::<SdfValue>(pseudo_root.clone(), field).ok()??;
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

pub(crate) fn read_token_or_string_field(
    stage: &Stage,
    path: SdfPath,
    field: impl AsRef<str>,
) -> Option<String> {
    stage
        .field::<SdfValue>(path, field)
        .ok()
        .flatten()
        .and_then(token_or_string_value_to_string)
}
