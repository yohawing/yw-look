//! Per-prim inspection for the OpenUSD Rust backend.
//!
//! The inspector intentionally asks the composed `UsdPrim`/property handles
//! for values and relationships. Metadata keys need a small amount of Sdf
//! tier inspection because the pinned Rust API has no `GetAllAuthoredMetadata`
//! equivalent: the prim's public spec stack supplies the authored key set,
//! while `Prim::get_metadata` supplies the composed value for each key.

use std::collections::BTreeSet;

use openusd::sdf::{Path as SdfPath, PathComponent, Value as SdfValue, Variability};
use openusd::usd::Stage;

use super::super::backend::UsdError;
use super::super::types::{AttributeInfo, MetadataEntry, PrimInspection, RelationshipInfo};
use super::attribute_samples::value_summary;
use super::stage_fields::ValidatedStagePathExt;

/// Sdf fields that belong to the prim/property structure or composition arcs,
/// rather than user-authored prim metadata. The public openusd API exposes
/// authored prim spec fields, so these have to be filtered explicitly before
/// turning the remaining keys into `MetadataEntry` values.
const STRUCTURAL_PRIM_FIELDS: &[&str] = &[
    "specifier",
    "typeName",
    "primChildren",
    "propertyChildren",
    "references",
    "payload",
    "inheritPaths",
    "specializes",
    "variantSetNames",
    "variantSelection",
    "subLayers",
    "custom",
    "variability",
    "default",
    "timeSamples",
    "connectionPaths",
    "targetPaths",
    "spline",
];

/// Inspect one composed prim, including only properties that have authored
/// scene description. Property values and relationship targets are composed
/// by the stage, while metadata keys come from all contributing prim specs in
/// strength order and are resolved through the prim handle.
pub(super) fn inspect_prim(stage: &Stage, prim_path: &str) -> Result<PrimInspection, UsdError> {
    let path = parse_prim_path(prim_path)?;
    let prim = stage.prim_at(path);
    if !prim
        .is_valid()
        .map_err(|error| inspect_error(prim_path, error))?
    {
        return Err(inspect_error(prim_path, "prim does not exist"));
    }

    let attributes = prim
        .authored_attributes()
        .map_err(|error| inspect_error(prim_path, error))?
        .into_iter()
        .map(|attribute| {
            let (_, name) = attribute.path().split_property().ok_or_else(|| {
                inspect_error(prim_path, "authored attribute did not have a property path")
            })?;
            let type_name = attribute
                .type_name()
                .map_err(|error| inspect_error(prim_path, error))?
                .map(|token| token.as_str().to_owned())
                .unwrap_or_default();
            let value_summary = attribute
                .get::<SdfValue>()
                .map_err(|error| inspect_error(prim_path, error))?
                .map(|value| value_summary(&value))
                .unwrap_or_default();
            let variability = match attribute
                .variability()
                .map_err(|error| inspect_error(prim_path, error))?
            {
                Some(Variability::Uniform) => "uniform",
                Some(Variability::Varying) => "varying",
                // USD attributes default to varying when no opinion is
                // authored. The Rust accessor returns `None` for that
                // unauthored case, so surface the spec default explicitly.
                None => "varying",
            }
            .to_owned();
            let custom = attribute
                .is_custom()
                .map_err(|error| inspect_error(prim_path, error))?;
            let time_sample_count = attribute
                .num_time_samples()
                .map_err(|error| inspect_error(prim_path, error))?;

            Ok(AttributeInfo {
                name: name.to_owned(),
                type_name,
                value_summary,
                variability,
                custom,
                time_sample_count,
            })
        })
        .collect::<Result<Vec<_>, UsdError>>()?;

    let relationships = prim
        .authored_relationships()
        .map_err(|error| inspect_error(prim_path, error))?
        .into_iter()
        .map(|relationship| {
            let (_, name) = relationship.path().split_property().ok_or_else(|| {
                inspect_error(
                    prim_path,
                    "authored relationship did not have a property path",
                )
            })?;
            let targets = relationship
                .targets()
                .map_err(|error| inspect_error(prim_path, error))?
                .into_iter()
                .map(|target| target.to_string())
                .collect();
            Ok(RelationshipInfo {
                name: name.to_owned(),
                targets,
            })
        })
        .collect::<Result<Vec<_>, UsdError>>()?;

    let metadata_keys = authored_metadata_keys(stage, &prim, prim_path)?;
    let metadata = metadata_keys
        .into_iter()
        .map(|key| {
            let value = prim
                .get_metadata::<SdfValue>(&key)
                .map_err(|error| inspect_error(prim_path, error))?;
            Ok(value.map(|value| MetadataEntry {
                key,
                value_summary: value_summary(&value),
            }))
        })
        .collect::<Result<Vec<_>, UsdError>>()?
        .into_iter()
        .flatten()
        .collect();

    Ok(PrimInspection {
        prim_path: prim_path.to_owned(),
        attributes,
        relationships,
        metadata,
    })
}

fn authored_metadata_keys(
    stage: &Stage,
    prim: &openusd::usd::Prim,
    prim_path: &str,
) -> Result<BTreeSet<String>, UsdError> {
    let mut keys = BTreeSet::new();
    let stack = prim
        .prim_stack()
        .map_err(|error| inspect_error(prim_path, error))?;
    for site in stack {
        let layer = stage.layer(&site.layer).ok_or_else(|| {
            inspect_error(
                prim_path,
                format!("prim stack layer '{}' is not loaded", site.layer),
            )
        })?;
        let spec = layer
            .prim(site.path.clone())
            .map_err(|error| inspect_error(prim_path, error))?
            .ok_or_else(|| {
                inspect_error(
                    prim_path,
                    format!("prim stack site '{}' has no prim spec", site.path),
                )
            })?;
        for key in spec.fields() {
            if !STRUCTURAL_PRIM_FIELDS.contains(&key.as_str()) {
                keys.insert(key);
            }
        }
    }
    Ok(keys)
}

fn parse_prim_path(prim_path: &str) -> Result<SdfPath, UsdError> {
    let path = SdfPath::new(prim_path)
        .map_err(|error| inspect_error(prim_path, format!("invalid prim path: {error}")))?;
    if !path.is_abs() || path.is_abs_root() || path.is_property_path() {
        return Err(inspect_error(
            prim_path,
            "invalid prim path: must be a non-root absolute prim path",
        ));
    }
    let mut components = path.components();
    for component in components.by_ref() {
        match component {
            PathComponent::Prim(name) => {
                if !SdfPath::is_valid_identifier(name) {
                    return Err(inspect_error(
                        prim_path,
                        format!("invalid prim component '{name}'"),
                    ));
                }
            }
            PathComponent::Variant { set, selection } => {
                if !SdfPath::is_valid_identifier(set) || !SdfPath::is_valid_identifier(selection) {
                    return Err(inspect_error(
                        prim_path,
                        "invalid variant selection in prim path",
                    ));
                }
            }
        }
    }
    if !components.remainder().is_empty() || path.is_prim_variant_selection_path() {
        return Err(inspect_error(
            prim_path,
            "prim path contains malformed or non-prim syntax",
        ));
    }
    Ok(path)
}

fn inspect_error(prim_path: &str, detail: impl std::fmt::Display) -> UsdError {
    UsdError::Parse(format!(
        "prim inspection failed prim='{prim_path}': {detail}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usd::types::StageLoadPolicy;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_FIXTURE_ID: AtomicUsize = AtomicUsize::new(0);

    fn fixture_path(source: &str) -> PathBuf {
        let id = NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "yw-look-prim-inspection-{}-{id}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("create fixture directory");
        let path = directory.join("inspector.usda");
        std::fs::write(&path, source).expect("write fixture");
        path
    }

    fn layered_fixture(weak_source: &str, root_source: &str) -> PathBuf {
        let id = NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "yw-look-prim-inspection-layered-{}-{id}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("create layered fixture directory");
        std::fs::write(directory.join("weak.usda"), weak_source).expect("write weak fixture");
        let path = directory.join("root.usda");
        std::fs::write(&path, root_source).expect("write root fixture");
        path
    }

    fn inspect(source: &str) -> PrimInspection {
        let path = fixture_path(source);
        let stage =
            crate::usd::openusd_backend::OpenusdBackend::open(&path, StageLoadPolicy::LoadAll)
                .expect("open inspection fixture");
        inspect_prim(&stage, "/Root").expect("inspect fixture root")
    }

    #[test]
    fn inspects_authored_properties_metadata_and_composed_values() {
        let inspection = inspect(
            r#"#usda 1.0
(
    defaultPrim = "Root"
)
def Xform "Root" (
    kind = "component"
    doc = "Inspector root"
    customData = { string owner = "prim-inspection" }
)
{
    custom float strength = 7.5
    custom float strength.timeSamples = {
        0: 0,
        24: 12,
    }
    string longText = "bounded"
    rel focus = </Root/Target>
}
def Xform "Target" {}
"#,
        );

        let strength = inspection
            .attributes
            .iter()
            .find(|attribute| attribute.name == "strength")
            .expect("strength attribute");
        assert_eq!(strength.type_name, "float");
        assert_eq!(strength.value_summary, "7.5");
        assert_eq!(strength.variability, "varying");
        assert!(strength.custom);
        assert_eq!(strength.time_sample_count, 2);

        assert_eq!(inspection.relationships.len(), 1);
        assert_eq!(inspection.relationships[0].name, "focus");
        assert_eq!(inspection.relationships[0].targets, ["/Root/Target"]);
        assert_eq!(
            inspection
                .metadata
                .iter()
                .map(|entry| entry.key.as_str())
                .collect::<Vec<_>>(),
            vec!["customData", "documentation", "kind"]
        );
        assert_eq!(
            inspection.metadata[0].value_summary,
            "<dictionary with 1 entries>"
        );
        assert_eq!(inspection.metadata[1].value_summary, "Inspector root");
        assert_eq!(inspection.metadata[2].value_summary, "component");
    }

    #[test]
    fn bounds_long_authored_value_summary() {
        let long_value = "x".repeat(300);
        let source = format!(
            r#"#usda 1.0
def Xform "Root"
{{
    string longText = "{long_value}"
}}
"#
        );
        let inspection = inspect(&source);
        let value = inspection
            .attributes
            .iter()
            .find(|attribute| attribute.name == "longText")
            .expect("longText attribute")
            .value_summary
            .clone();
        assert_eq!(value.chars().count(), 257);
        assert!(value.ends_with('…'));
    }

    #[test]
    fn resolves_composed_values_and_metadata_across_sublayer_specs() {
        let path = layered_fixture(
            r#"#usda 1.0
def Xform "Root" (
    documentation = "weak documentation"
    customData = { string weak = "yes" }
)
{
    custom float strength = 2.0
    rel focus = </Root/WeakTarget>
}
"#,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    subLayers = [ @./weak.usda@ ]
)
over "Root" (
    doc = "strong documentation"
    customData = { string strong = "yes" }
)
{
    custom float strength = 7.5
    rel focus = </Root/StrongTarget>
}
def Xform "StrongTarget" {}
"#,
        );
        let stage =
            crate::usd::openusd_backend::OpenusdBackend::open(&path, StageLoadPolicy::LoadAll)
                .expect("open layered inspection fixture");
        let inspection = inspect_prim(&stage, "/Root").expect("inspect layered root");

        let strength = inspection
            .attributes
            .iter()
            .find(|attribute| attribute.name == "strength")
            .expect("strength attribute");
        assert_eq!(strength.value_summary, "7.5");
        assert_eq!(inspection.relationships[0].targets, ["/Root/StrongTarget"]);
        assert_eq!(
            inspection
                .metadata
                .iter()
                .find(|entry| entry.key == "documentation")
                .map(|entry| entry.value_summary.as_str()),
            Some("strong documentation")
        );
        assert_eq!(
            inspection
                .metadata
                .iter()
                .find(|entry| entry.key == "customData")
                .map(|entry| entry.value_summary.as_str()),
            Some("<dictionary with 2 entries>")
        );
    }

    #[test]
    fn missing_prim_returns_contextual_error() {
        let path = fixture_path("#usda 1.0\ndef Xform \"Root\" {}\n");
        let stage =
            crate::usd::openusd_backend::OpenusdBackend::open(&path, StageLoadPolicy::LoadAll)
                .expect("open inspection fixture");
        let error = inspect_prim(&stage, "/Missing").expect_err("missing prim should fail");
        assert!(error.to_string().contains("prim='/Missing'"));
        assert!(error.to_string().contains("prim does not exist"));
    }
}
