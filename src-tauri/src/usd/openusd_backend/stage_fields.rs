use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::usd::{Attribute, Prim, Relationship, Stage};

/// Accessors for paths that have already crossed yw-look's `SdfPath`
/// validation boundary. openusd 0.6 made the public Stage accessors parse
/// arbitrary `IntoPath` inputs and therefore return `PathParseError`; these
/// wrappers keep that error boundary explicit without threading an impossible
/// parse failure through every composed-stage query.
pub(crate) trait ValidatedStagePathExt {
    fn prim_at(&self, path: SdfPath) -> Prim;
    fn attribute_at(&self, path: SdfPath) -> Attribute;
    fn relationship_at(&self, path: SdfPath) -> Relationship;
}

impl ValidatedStagePathExt for Stage {
    fn prim_at(&self, path: SdfPath) -> Prim {
        self.prim(path)
            .expect("an existing SdfPath must remain parseable")
    }

    fn attribute_at(&self, path: SdfPath) -> Attribute {
        self.attribute(path)
            .expect("an existing SdfPath must remain parseable")
    }

    fn relationship_at(&self, path: SdfPath) -> Relationship {
        self.relationship(path)
            .expect("an existing SdfPath must remain parseable")
    }
}

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

/// Reads a prim's composed `typeName` via the public `Prim::type_name()`.
///
/// USD-NATIVE-01: this used to tolerate a non-conformant `String`-typed
/// `typeName` authoring (via a raw `Stage::field` read) in addition to
/// the spec's `Token`, because `Prim::type_name()` only recognizes the
/// `Token` variant. That leniency has been dropped along with the
/// fork-only raw-field helper it depended on: a `String`-typed
/// `typeName` now reads as unauthored, same as upstream `UsdPrim`.
pub(crate) fn read_token_or_string_field(stage: &Stage, path: SdfPath) -> Option<String> {
    stage
        .prim_at(path)
        .type_name()
        .ok()
        .flatten()
        .map(|token| token.as_str().to_owned())
}

/// Reads an attribute's composed default value as a `Token` or
/// `String`, e.g. a UsdShade `info:id` input. Unlike
/// [`read_token_or_string_field`], this is a plain attribute read with a
/// direct public equivalent (`Attribute::get::<Value>()` ==
/// `Stage::field(path, FieldKey::Default)`).
pub(crate) fn read_string_or_token_attribute(stage: &Stage, path: SdfPath) -> Option<String> {
    stage
        .attribute_at(path)
        .get::<SdfValue>()
        .ok()
        .flatten()
        .and_then(token_or_string_value_to_string)
}
