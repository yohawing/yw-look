use std::collections::BTreeMap;

use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::usd::Stage;

use crate::usd::backend::UsdError;
use crate::usd::types::VariantSelection;

use super::stage_fields::ValidatedStagePathExt;
use super::stage_query;

/// Apply the complete selection request to an independently opened stage.
///
/// The request is applied to the independently opened stage in prim-depth
/// order, then validated against the resulting composition. Applying first is
/// required for nested variants: an inner set can be introduced by the outer
/// selection, or disappear when the outer selection changes. Empty selections
/// mean "use the source opinion"; because every call starts from a fresh stage,
/// they are represented by omitting an override for that set.
pub(crate) fn apply_variant_selections(
    stage: &Stage,
    selections: &[VariantSelection],
) -> Result<(), UsdError> {
    // Parse all paths before authoring anything. The stage is scratch state,
    // but malformed input should still fail before a valid earlier item can
    // affect it. Keep the last request for each `(prim, set)` so an empty
    // selection provides its reset meaning even when a caller sends a stale
    // value followed by a reset in the same batch.
    let mut requested =
        BTreeMap::<String, BTreeMap<String, (Option<String>, VariantSelection)>>::new();

    for selection in selections {
        let path = SdfPath::new(&selection.prim_path).map_err(|_| invalid(selection))?;
        requested.entry(path.to_string()).or_default().insert(
            selection.set_name.clone(),
            (
                (!selection.variant_name.is_empty()).then(|| selection.variant_name.clone()),
                selection.clone(),
            ),
        );
    }

    let mut requested = requested
        .into_iter()
        .map(|(prim_path, sets)| {
            (
                SdfPath::new(&prim_path).expect("validated variant prim path"),
                sets,
            )
        })
        .collect::<Vec<_>>();
    requested.sort_by(|(left, _), (right, _)| {
        left.prim_element_count()
            .cmp(&right.prim_element_count())
            .then_with(|| left.to_string().cmp(&right.to_string()))
    });

    // Apply only non-empty final values. An empty final value intentionally
    // leaves the fresh stage's authored source selection untouched. A path
    // hidden by a prior parent selection is skipped here and rejected by the
    // final validation below; this also avoids authoring an over for a missing
    // prim in the scratch stage.
    for (path, sets) in &requested {
        let overrides = sets
            .iter()
            .filter_map(|(set_name, (value, _))| {
                value.clone().map(|value| (set_name.clone(), value))
            })
            .collect::<std::collections::HashMap<_, _>>();
        if overrides.is_empty() || !stage.prim_at(path.clone()).is_valid().unwrap_or(false) {
            continue;
        }

        stage
            .prim_at(path.clone())
            .update_metadata(FieldKey::VariantSelection.as_str(), |local| {
                let mut map = match local {
                    Some(SdfValue::VariantSelectionMap(map)) => map,
                    _ => std::collections::HashMap::new(),
                };
                map.extend(overrides);
                Some(SdfValue::VariantSelectionMap(map))
            })
            .map_err(|error| UsdError::Parse(error.to_string()))?;
    }

    // Validate every final request against the composed result. Candidate
    // names are intentionally queried after all edits, because a parent
    // selection can reveal or hide a child variant set. The effective value
    // check also catches an authored metadata opinion that composition did
    // not accept, while allowing a valid selection inherited from a weaker
    // site when it exactly matches the request.
    for (path, sets) in &requested {
        let prim = stage.prim(path.clone()).map_err(|_| {
            sets.values()
                .next()
                .map(|(_, selection)| invalid(selection))
                .expect("a prim request always contains one set")
        })?;
        let resolved = prim
            .variant_sets()
            .get_all_variant_selections()
            .map_err(|_| {
                sets.values()
                    .next()
                    .map(|(_, selection)| invalid(selection))
                    .expect("a prim request always contains one set")
            })?;

        for (set_name, (_, selection)) in sets {
            let candidates = stage_query::variant_names(stage, path.clone(), set_name);
            let resolved_selection = resolved
                .iter()
                .find(|(resolved_set, _)| resolved_set == set_name)
                .map(|(_, value)| value.as_str());

            // A locally authored unknown set/selection can appear in the
            // effective map after the metadata edit. It is still invalid
            // unless the composed stage exposes authored candidate names.
            if candidates.is_empty() {
                return Err(invalid(selection));
            }

            if !selection.variant_name.is_empty()
                && (!candidates
                    .iter()
                    .any(|candidate| candidate == &selection.variant_name)
                    || resolved_selection != Some(selection.variant_name.as_str()))
            {
                return Err(invalid(selection));
            }
        }
    }

    Ok(())
}

fn invalid(selection: &VariantSelection) -> UsdError {
    UsdError::InvalidVariantSelection {
        prim_path: selection.prim_path.clone(),
        set_name: selection.set_name.clone(),
        variant_name: selection.variant_name.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usd::backend::{UsdGeometryBackend, UsdInspectBackend, UsdSessionBackend};
    use crate::usd::types::{ExtractGeometryOptions, PurposeModes, StageLoadPolicy};
    use crate::usd::OpenStage;
    use std::path::PathBuf;

    fn fixture_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "yw-look-variant-helper-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("create variant fixture directory");
        dir.join(name)
    }

    fn write_fixture(path: &PathBuf) {
        std::fs::write(
            path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root" (
    variants = {
        string look = "blue"
        string material = "matte"
    }
    prepend variantSets = ["look", "material"]
)
{
    variantSet "look" = {
        "red" { }
        "blue" { }
    }
    variantSet "material" = {
        "glossy" { }
        "matte" { }
    }
}
"#,
        )
        .expect("write variant fixture");
    }

    fn write_nested_fixture(path: &PathBuf) {
        std::fs::write(
            path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root" (
    variants = {
        string mode = "base"
    }
    prepend variantSets = ["mode"]
)
{
    variantSet "mode" = {
        "base" { }
        "nested" {
            def Xform "Child" (
                variants = {
                    string look = "a"
                }
                prepend variantSets = ["look"]
            )
            {
                variantSet "look" = {
                    "a" { }
                    "b" { }
                }
            }
        }
    }
}
"#,
        )
        .expect("write nested variant fixture");
    }

    fn write_payload_mesh(path: &PathBuf, mesh_name: &str) {
        std::fs::write(
            path,
            format!(
                r#"#usda 1.0
(
    defaultPrim = "Payload"
)

def Xform "Payload"
{{
    def Mesh "{mesh_name}"
    {{
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        uniform token subdivisionScheme = "none"
    }}
}}
"#
            ),
        )
        .expect("write payload mesh fixture");
    }

    fn write_payload_variant_fixture(path: &PathBuf) {
        let directory = path.parent().expect("payload fixture directory");
        write_payload_mesh(&directory.join("a-red.usda"), "RedA");
        write_payload_mesh(&directory.join("b-red.usda"), "RedB");
        write_payload_mesh(&directory.join("a-blue.usda"), "BlueA");
        write_payload_mesh(&directory.join("b-blue.usda"), "BlueB");
        std::fs::write(
            path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root" (
    variants = {
        string look = "red"
    }
    prepend variantSets = ["look"]
)
{
    variantSet "look" = {
        "red" {
            def Xform "A" (payload = @./a-red.usda@</Payload>) { }
            def Xform "B" (payload = @./b-red.usda@</Payload>) { }
        }
        "blue" {
            def Xform "A" (payload = @./a-blue.usda@</Payload>) { }
            def Xform "B" (payload = @./b-blue.usda@</Payload>) { }
        }
    }
}
"#,
        )
        .expect("write payload variant fixture");
    }

    fn write_inner_payload(path: &PathBuf, base_name: &str, selected_name: &str) {
        std::fs::write(
            path,
            format!(
                r#"#usda 1.0
(
    defaultPrim = "Payload"
)

def Xform "Payload" (
    variants = {{
        string detail = "base"
    }}
    prepend variantSets = ["detail"]
)
{{
    variantSet "detail" = {{
        "base" {{
            def Mesh "{base_name}"
            {{
                int[] faceVertexCounts = [3]
                int[] faceVertexIndices = [0, 1, 2]
                point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
                uniform token subdivisionScheme = "none"
            }}
        }}
        "selected" {{
            def Mesh "{selected_name}"
            {{
                int[] faceVertexCounts = [3]
                int[] faceVertexIndices = [0, 1, 2]
                point3f[] points = [(0, 0, 0), (2, 0, 0), (0, 2, 0)]
                uniform token subdivisionScheme = "none"
            }}
        }}
    }}
}}
"#
            ),
        )
        .expect("write inner payload fixture");
    }

    fn write_inner_payload_fixture(path: &PathBuf) {
        let directory = path.parent().expect("inner payload fixture directory");
        write_inner_payload(&directory.join("inner-a.usda"), "BaseA", "SelectedA");
        write_inner_payload(&directory.join("inner-b.usda"), "BaseB", "SelectedB");
        std::fs::write(
            path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root"
{
    def Xform "A" (payload = @./inner-a.usda@</Payload>) { }
    def Xform "B" (payload = @./inner-b.usda@</Payload>) { }
}
"#,
        )
        .expect("write inner payload root fixture");
    }

    fn selections(stage: &Stage) -> Vec<(String, String)> {
        stage
            .prim_at(SdfPath::new("/Root").expect("valid path"))
            .variant_sets()
            .get_all_variant_selections()
            .expect("variant selections")
    }

    fn fixture_variant_override_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("usd-stateful")
            .join("fixtures")
            .join("variant_override.usda")
    }

    fn glb_prim_paths(glb: &[u8]) -> Vec<String> {
        assert_eq!(&glb[0..4], b"glTF", "expected a GLB payload");
        let json_len =
            u32::from_le_bytes(glb[12..16].try_into().expect("GLB JSON length")) as usize;
        let json =
            serde_json::from_slice::<serde_json::Value>(&glb[20..20 + json_len]).expect("GLB JSON");
        json["nodes"]
            .as_array()
            .expect("GLB nodes")
            .iter()
            .filter_map(|node| node["extras"]["primPath"].as_str().map(str::to_owned))
            .collect()
    }

    fn variant_options(variant_name: &str) -> ExtractGeometryOptions {
        ExtractGeometryOptions {
            policy: StageLoadPolicy::NoPayloads,
            variant_selections: vec![VariantSelection {
                prim_path: "/Root".into(),
                set_name: "look".into(),
                variant_name: variant_name.into(),
            }],
            purpose_modes: PurposeModes::default(),
        }
    }

    #[test]
    fn override_is_isolated_to_fresh_stage_and_source_bytes() {
        let path = fixture_path("isolation.usda");
        write_fixture(&path);
        let source = std::fs::read(&path).expect("read source bytes");
        let stage_a = Stage::open(path.to_str().expect("utf8 path")).expect("open A");
        let stage_b = Stage::open(path.to_str().expect("utf8 path")).expect("open B");

        apply_variant_selections(
            &stage_a,
            &[VariantSelection {
                prim_path: "/Root".into(),
                set_name: "look".into(),
                variant_name: "red".into(),
            }],
        )
        .expect("apply A override");

        assert!(selections(&stage_a)
            .iter()
            .any(|(set, value)| set == "look" && value == "red"));
        assert!(selections(&stage_b)
            .iter()
            .any(|(set, value)| set == "look" && value == "blue"));
        let stage_c = Stage::open(path.to_str().expect("utf8 path")).expect("open C");
        assert!(selections(&stage_c)
            .iter()
            .any(|(set, value)| set == "look" && value == "blue"));
        assert_eq!(
            std::fs::read(&path).expect("read source after override"),
            source
        );
        std::fs::remove_dir_all(path.parent().expect("fixture directory")).ok();
    }

    #[test]
    fn invalid_batch_is_typed_without_polluting_source_or_future_open() {
        let path = fixture_path("invalid.usda");
        write_fixture(&path);
        let source = std::fs::read(&path).expect("read source bytes");
        let stage = Stage::open(path.to_str().expect("utf8 path")).expect("open fixture");
        let result = apply_variant_selections(
            &stage,
            &[
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "look".into(),
                    variant_name: "red".into(),
                },
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "look".into(),
                    variant_name: "missing".into(),
                },
            ],
        );
        let error = result.expect_err("unknown variant should fail");
        assert!(matches!(
            error,
            UsdError::InvalidVariantSelection {
                prim_path,
                set_name,
                variant_name
            } if prim_path == "/Root" && set_name == "look" && variant_name == "missing"
        ));
        assert_eq!(
            std::fs::read(&path).expect("read source after failure"),
            source
        );
        let reopened = Stage::open(path.to_str().expect("reopen fixture")).expect("reopen");
        assert!(selections(&reopened)
            .iter()
            .any(|(set, value)| set == "look" && value == "blue"));
        std::fs::remove_dir_all(path.parent().expect("fixture directory")).ok();
    }

    #[test]
    fn malformed_prim_and_missing_set_are_typed_invalid_selections() {
        let path = fixture_path("invalid-shape.usda");
        write_fixture(&path);

        let malformed = Stage::open(path.to_str().expect("utf8 path")).expect("open fixture");
        let malformed_error = apply_variant_selections(
            &malformed,
            &[VariantSelection {
                prim_path: "Root/not-an-absolute-path".into(),
                set_name: "look".into(),
                variant_name: "blue".into(),
            }],
        )
        .expect_err("malformed prim path should fail");
        assert!(matches!(
            malformed_error,
            UsdError::InvalidVariantSelection {
                prim_path,
                set_name,
                variant_name
            } if prim_path == "Root/not-an-absolute-path"
                && set_name == "look"
                && variant_name == "blue"
        ));

        let missing_set = Stage::open(path.to_str().expect("utf8 path")).expect("reopen fixture");
        let missing_set_error = apply_variant_selections(
            &missing_set,
            &[VariantSelection {
                prim_path: "/Root".into(),
                set_name: "missingSet".into(),
                variant_name: "blue".into(),
            }],
        )
        .expect_err("missing variant set should fail");
        assert!(matches!(
            missing_set_error,
            UsdError::InvalidVariantSelection {
                prim_path,
                set_name,
                variant_name
            } if prim_path == "/Root" && set_name == "missingSet" && variant_name == "blue"
        ));
        std::fs::remove_dir_all(path.parent().expect("fixture directory")).ok();
    }

    #[test]
    fn nested_variant_requests_apply_parent_before_child_and_validate_final_state() {
        let path = fixture_path("nested.usda");
        write_nested_fixture(&path);
        let stage = Stage::open(path.to_str().expect("utf8 path")).expect("open fixture");
        apply_variant_selections(
            &stage,
            &[
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "mode".into(),
                    variant_name: "nested".into(),
                },
                VariantSelection {
                    prim_path: "/Root/Child".into(),
                    set_name: "look".into(),
                    variant_name: "b".into(),
                },
            ],
        )
        .expect("outer selection should reveal inner set");
        let child = stage.prim_at(SdfPath::new("/Root/Child").expect("valid child path"));
        assert!(child
            .variant_sets()
            .get_all_variant_selections()
            .expect("child variant selections")
            .iter()
            .any(|(set, value)| set == "look" && value == "b"));
        std::fs::remove_dir_all(path.parent().expect("fixture directory")).ok();
    }

    #[test]
    fn nested_variant_request_hidden_by_parent_is_typed_failure() {
        let path = fixture_path("nested-hidden.usda");
        write_nested_fixture(&path);
        let stage = Stage::open(path.to_str().expect("utf8 path")).expect("open fixture");
        let error = apply_variant_selections(
            &stage,
            &[
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "mode".into(),
                    variant_name: "base".into(),
                },
                VariantSelection {
                    prim_path: "/Root/Child".into(),
                    set_name: "look".into(),
                    variant_name: "b".into(),
                },
            ],
        )
        .expect_err("hidden inner set should fail final validation");
        assert!(matches!(
            error,
            UsdError::InvalidVariantSelection {
                prim_path,
                set_name,
                variant_name
            } if prim_path == "/Root/Child" && set_name == "look" && variant_name == "b"
        ));
        std::fs::remove_dir_all(path.parent().expect("fixture directory")).ok();
    }

    #[test]
    fn empty_selection_keeps_authored_source_and_multiple_sets_merge() {
        let path = fixture_path("reset.usda");
        write_fixture(&path);
        let stage = Stage::open(path.to_str().expect("utf8 path")).expect("open fixture");
        apply_variant_selections(
            &stage,
            &[
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "look".into(),
                    variant_name: "red".into(),
                },
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "material".into(),
                    variant_name: "glossy".into(),
                },
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "look".into(),
                    variant_name: "".into(),
                },
            ],
        )
        .expect("merge and reset selections");
        let resolved = selections(&stage);
        assert!(resolved
            .iter()
            .any(|(set, value)| set == "look" && value == "blue"));
        assert!(resolved
            .iter()
            .any(|(set, value)| set == "material" && value == "glossy"));
        std::fs::remove_dir_all(path.parent().expect("fixture directory")).ok();
    }

    #[test]
    fn stateless_geometry_extract_switches_variant_branch() {
        let path = fixture_variant_override_path();
        let backend = crate::usd::OpenusdBackend::new();
        let red = backend
            .extract_geometry_glb_with_options(&path, &variant_options("red"))
            .expect("extract red variant");
        let blue = backend
            .extract_geometry_glb_with_options(&path, &variant_options("blue"))
            .expect("extract blue variant");
        let red_paths = glb_prim_paths(&red);
        let blue_paths = glb_prim_paths(&blue);
        assert!(red_paths.iter().any(|path| path == "/Root/RedQuad"));
        assert!(!red_paths.iter().any(|path| path == "/Root/BlueQuad"));
        assert!(blue_paths.iter().any(|path| path == "/Root/BlueQuad"));
        assert!(!blue_paths.iter().any(|path| path == "/Root/RedQuad"));
    }

    #[test]
    fn persistent_session_extract_switches_variants_without_mutating_source_stage() {
        let path = fixture_variant_override_path();
        let backend = crate::usd::OpenusdBackend::new();
        let stage = backend
            .open_stage_session(&path, StageLoadPolicy::NoPayloads)
            .expect("open variant session");
        let red = backend
            .extract_geometry_from_session(&stage, &path, &variant_options("red"))
            .expect("extract red session variant");
        let blue = backend
            .extract_geometry_from_session(&stage, &path, &variant_options("blue"))
            .expect("extract blue session variant");
        assert!(glb_prim_paths(&red)
            .iter()
            .any(|path| path == "/Root/RedQuad"));
        assert!(glb_prim_paths(&blue)
            .iter()
            .any(|path| path == "/Root/BlueQuad"));

        let OpenStage::Rust(mutex) = &stage;
        let session = mutex.lock().expect("session lock");
        assert!(selections(&session.stage)
            .iter()
            .any(|(set, value)| set == "look" && value == "red"));
    }

    #[test]
    fn failed_session_variant_batch_leaves_persistent_stage_unchanged() {
        let path = fixture_variant_override_path();
        let backend = crate::usd::OpenusdBackend::new();
        let stage = backend
            .open_stage_session(&path, StageLoadPolicy::NoPayloads)
            .expect("open variant session");
        let options = ExtractGeometryOptions {
            policy: StageLoadPolicy::NoPayloads,
            variant_selections: vec![
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "look".into(),
                    variant_name: "blue".into(),
                },
                VariantSelection {
                    prim_path: "/Root".into(),
                    set_name: "look".into(),
                    variant_name: "missing".into(),
                },
            ],
            purpose_modes: PurposeModes::default(),
        };
        let error = backend
            .extract_geometry_from_session(&stage, &path, &options)
            .expect_err("invalid session batch should fail");
        assert!(matches!(
            error,
            UsdError::InvalidVariantSelection {
                prim_path,
                set_name,
                variant_name
            } if prim_path == "/Root" && set_name == "look" && variant_name == "missing"
        ));

        let OpenStage::Rust(mutex) = &stage;
        let session = mutex.lock().expect("session lock");
        assert!(selections(&session.stage)
            .iter()
            .any(|(set, value)| set == "look" && value == "red"));
    }

    #[test]
    fn persistent_variants_keep_only_explicit_payload_loaded_across_geometry_paths() {
        let path = fixture_path("payload-variants.usda");
        write_payload_variant_fixture(&path);
        let backend = crate::usd::OpenusdBackend::new();
        let stage = backend
            .open_stage_session(&path, StageLoadPolicy::NoPayloads)
            .expect("open payload variant session");
        backend
            .load_payload(&stage, "/Root/A")
            .expect("load only payload A");

        let red = backend
            .extract_geometry_from_session(
                &stage,
                &path,
                &ExtractGeometryOptions {
                    policy: StageLoadPolicy::NoPayloads,
                    variant_selections: vec![],
                    purpose_modes: PurposeModes::default(),
                },
            )
            .expect("extract red payload variant");
        let red_paths = glb_prim_paths(&red);
        assert!(red_paths.iter().any(|path| path.ends_with("/RedA")));
        assert!(!red_paths.iter().any(|path| path.ends_with("/RedB")));

        let blue = backend
            .extract_geometry_from_session(
                &stage,
                &path,
                &ExtractGeometryOptions {
                    policy: StageLoadPolicy::NoPayloads,
                    variant_selections: vec![VariantSelection {
                        prim_path: "/Root".into(),
                        set_name: "look".into(),
                        variant_name: "blue".into(),
                    }],
                    purpose_modes: PurposeModes::default(),
                },
            )
            .expect("extract blue payload variant");
        let blue_paths = glb_prim_paths(&blue);
        assert!(blue_paths.iter().any(|path| path.ends_with("/BlueA")));
        assert!(!blue_paths.iter().any(|path| path.ends_with("/BlueB")));

        let OpenStage::Rust(mutex) = &stage;
        let session = mutex.lock().expect("session lock");
        assert!(selections(&session.stage)
            .iter()
            .any(|(set, value)| set == "look" && value == "red"));
        assert_eq!(session.loaded_payload_paths.len(), 1);
        assert!(session.loaded_payload_paths.contains("/Root/A"));
        std::fs::remove_dir_all(path.parent().expect("fixture directory")).ok();
    }

    #[test]
    fn persistent_loaded_payload_allows_inner_variant_selection_after_load() {
        let path = fixture_path("inner-payload-variants.usda");
        write_inner_payload_fixture(&path);
        let backend = crate::usd::OpenusdBackend::new();
        let stage = backend
            .open_stage_session(&path, StageLoadPolicy::NoPayloads)
            .expect("open inner payload session");
        backend
            .load_payload(&stage, "/Root/A")
            .expect("load only inner payload A");

        let selected = backend
            .extract_geometry_from_session(
                &stage,
                &path,
                &ExtractGeometryOptions {
                    policy: StageLoadPolicy::NoPayloads,
                    variant_selections: vec![VariantSelection {
                        // The payload's target `/Payload` is mapped onto the
                        // payload root `/Root/A` in the composed stage.
                        prim_path: "/Root/A".into(),
                        set_name: "detail".into(),
                        variant_name: "selected".into(),
                    }],
                    purpose_modes: PurposeModes::default(),
                },
            )
            .expect("select inner variant in loaded payload");
        let paths = glb_prim_paths(&selected);
        assert!(paths.iter().any(|path| path.ends_with("/SelectedA")));
        assert!(!paths.iter().any(|path| path.ends_with("/BaseA")));
        assert!(!paths.iter().any(|path| path.ends_with("/SelectedB")));
        assert!(!paths.iter().any(|path| path.ends_with("/BaseB")));

        let OpenStage::Rust(mutex) = &stage;
        let session = mutex.lock().expect("session lock");
        assert!(session.loaded_payload_paths.contains("/Root/A"));
        assert!(session.loaded_payload_paths.len() == 1);
        std::fs::remove_dir_all(path.parent().expect("fixture directory")).ok();
    }

    #[test]
    fn variant_aware_inspection_and_issue_queries_use_the_selected_stage() {
        let path = fixture_variant_override_path();
        let backend = crate::usd::OpenusdBackend::new();
        let options = variant_options("blue");
        assert!(
            backend
                .requires_glb_preview(&path)
                .expect("route variant stage through GLB"),
            "a single-layer stage with a resolved variant set must not fall through to JS"
        );
        let inspection = backend
            .inspect_stage_with_variants(&path, options.policy, &options.variant_selections)
            .expect("inspect blue variant");
        let variant = inspection
            .variant_sets
            .iter()
            .find(|entry| entry.prim_path == "/Root" && entry.set_name == "look")
            .expect("look variant");
        assert_eq!(variant.selection.as_deref(), Some("blue"));

        let summary = backend
            .summarize_stage_with_variants(&path, options.policy, &options.variant_selections)
            .expect("summarize blue variant");
        assert!(summary.has_variants);
        assert!(summary.variant_set_count >= 1);

        let issues = backend
            .collect_asset_issues_with_variants(&path, &options.variant_selections)
            .expect("collect blue variant issues");
        assert!(issues.is_empty(), "unexpected issues: {issues:?}");
    }
}
