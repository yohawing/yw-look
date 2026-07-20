//! Backend-independent helpers for USD asset path resolution reports.

use std::path::{Path as StdPath, PathBuf};

pub(crate) fn filter_resolvable_relative_assets(
    root_path: &StdPath,
    layer_ids: impl IntoIterator<Item = String>,
    unresolved_assets: Vec<String>,
) -> Vec<String> {
    let mut layer_paths = Vec::<PathBuf>::new();
    layer_paths.push(root_path.to_path_buf());
    for layer_id in layer_ids {
        let layer_path = StdPath::new(&layer_id);
        if layer_path.as_os_str().is_empty() || layer_paths.iter().any(|path| path == layer_path) {
            continue;
        }
        layer_paths.push(layer_path.to_path_buf());
    }

    unresolved_assets
        .into_iter()
        .filter(|asset| {
            let authored_path = StdPath::new(asset);
            let exists = if authored_path.is_absolute() {
                authored_path.is_file()
            } else {
                relative_asset_resolves_for_every_authored_layer(&layer_paths, authored_path, asset)
            };
            !exists
        })
        .collect()
}

// `unresolved_assets` only reports authored asset strings, not the source
// layer. Keep this conservative: suppress only when every visible layer that
// authors the exact `@asset@` token can resolve it next to that layer.
fn relative_asset_resolves_for_every_authored_layer(
    layer_paths: &[PathBuf],
    authored_path: &StdPath,
    asset_path: &str,
) -> bool {
    let mut saw_authored_layer = false;
    for layer_path in layer_paths {
        if !layer_authors_asset_token(layer_path, asset_path) {
            continue;
        }
        saw_authored_layer = true;
        let Some(layer_dir) = layer_path.parent() else {
            return false;
        };
        if !layer_dir.join(authored_path).is_file() {
            return false;
        }
    }
    saw_authored_layer
}

fn layer_authors_asset_token(layer_path: &StdPath, asset_path: &str) -> bool {
    let Ok(bytes) = std::fs::read(layer_path) else {
        return false;
    };
    let needle = asset_path.as_bytes();
    if needle.is_empty() || bytes.len() < needle.len() + 2 {
        return false;
    }
    bytes.windows(needle.len() + 2).any(|window| {
        window.first() == Some(&b'@')
            && window.last() == Some(&b'@')
            && &window[1..window.len() - 1] == needle
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_relative_unresolved_assets_that_exist_next_to_composed_layers() {
        let root =
            std::env::temp_dir().join(format!("yw-look-filter-assets-{}", std::process::id()));
        let layer_dir = root.join("assets").join("Kitchen");
        std::fs::create_dir_all(&layer_dir).expect("create layer dir");
        let root_layer = root.join("Kitchen_set.usd");
        let layer = layer_dir.join("Kitchen.usd");
        let payload = layer_dir.join("Kitchen_payload.usd");
        std::fs::write(&root_layer, "#usda 1.0").expect("write root layer");
        std::fs::write(
            &layer,
            r#"#usda 1.0
def "Kitchen"
{
    payload = @./Kitchen_payload.usd@
}
"#,
        )
        .expect("write layer");
        std::fs::write(&payload, "#usda 1.0").expect("write payload");

        let unresolved = filter_resolvable_relative_assets(
            &root_layer,
            vec![
                root_layer.display().to_string(),
                layer.display().to_string(),
            ],
            vec![
                "./Kitchen_payload.usd".to_string(),
                "./ActuallyMissing_payload.usd".to_string(),
            ],
        );

        assert_eq!(unresolved, vec!["./ActuallyMissing_payload.usd"]);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn leaves_relative_unresolved_asset_when_only_another_layer_has_the_file() {
        let root = std::env::temp_dir().join(format!(
            "yw-look-filter-assets-negative-{}",
            std::process::id()
        ));
        let missing_layer_dir = root.join("assets").join("A");
        let unrelated_layer_dir = root.join("assets").join("B");
        std::fs::create_dir_all(&missing_layer_dir).expect("create missing layer dir");
        std::fs::create_dir_all(&unrelated_layer_dir).expect("create unrelated layer dir");
        let root_layer = root.join("Root.usd");
        let missing_layer = missing_layer_dir.join("A.usd");
        let unrelated_layer = unrelated_layer_dir.join("B.usd");
        let unrelated_payload = unrelated_layer_dir.join("Shared_payload.usd");
        std::fs::write(&root_layer, "#usda 1.0").expect("write root layer");
        std::fs::write(
            &missing_layer,
            r#"#usda 1.0
def "A"
{
    payload = @./Shared_payload.usd@
}
"#,
        )
        .expect("write missing layer");
        std::fs::write(&unrelated_layer, "#usda 1.0").expect("write unrelated layer");
        std::fs::write(&unrelated_payload, "#usda 1.0").expect("write unrelated payload");

        let unresolved = filter_resolvable_relative_assets(
            &root_layer,
            vec![
                root_layer.display().to_string(),
                missing_layer.display().to_string(),
                unrelated_layer.display().to_string(),
            ],
            vec!["./Shared_payload.usd".to_string()],
        );

        assert_eq!(unresolved, vec!["./Shared_payload.usd"]);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn leaves_relative_unresolved_asset_when_any_authoring_layer_is_missing_the_file() {
        let root = std::env::temp_dir().join(format!(
            "yw-look-filter-assets-partial-{}",
            std::process::id()
        ));
        let missing_layer_dir = root.join("assets").join("A");
        let resolved_layer_dir = root.join("assets").join("B");
        std::fs::create_dir_all(&missing_layer_dir).expect("create missing layer dir");
        std::fs::create_dir_all(&resolved_layer_dir).expect("create resolved layer dir");
        let root_layer = root.join("Root.usd");
        let missing_layer = missing_layer_dir.join("A.usd");
        let resolved_layer = resolved_layer_dir.join("B.usd");
        let resolved_payload = resolved_layer_dir.join("Shared_payload.usd");
        std::fs::write(&root_layer, "#usda 1.0").expect("write root layer");
        let layer_text = r#"#usda 1.0
def "Shared"
{
    payload = @./Shared_payload.usd@
}
"#;
        std::fs::write(&missing_layer, layer_text).expect("write missing layer");
        std::fs::write(&resolved_layer, layer_text).expect("write resolved layer");
        std::fs::write(&resolved_payload, "#usda 1.0").expect("write resolved payload");

        let unresolved = filter_resolvable_relative_assets(
            &root_layer,
            vec![
                root_layer.display().to_string(),
                missing_layer.display().to_string(),
                resolved_layer.display().to_string(),
            ],
            vec!["./Shared_payload.usd".to_string()],
        );

        assert_eq!(unresolved, vec!["./Shared_payload.usd"]);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn leaves_relative_unresolved_asset_when_path_is_only_a_substring() {
        let root = std::env::temp_dir().join(format!(
            "yw-look-filter-assets-token-{}",
            std::process::id()
        ));
        let layer_dir = root.join("assets");
        std::fs::create_dir_all(&layer_dir).expect("create layer dir");
        let root_layer = root.join("Root.usd");
        let layer = layer_dir.join("Layer.usd");
        let payload = layer_dir.join("Payload.usd");
        std::fs::write(&root_layer, "#usda 1.0").expect("write root layer");
        std::fs::write(
            &layer,
            r#"#usda 1.0
def "Layer"
{
    payload = @./Payload.usda@
}
"#,
        )
        .expect("write layer");
        std::fs::write(&payload, "#usda 1.0").expect("write payload");

        let unresolved = filter_resolvable_relative_assets(
            &root_layer,
            vec![
                root_layer.display().to_string(),
                layer.display().to_string(),
            ],
            vec!["./Payload.usd".to_string()],
        );

        assert_eq!(unresolved, vec!["./Payload.usd"]);
        std::fs::remove_dir_all(root).ok();
    }
}
