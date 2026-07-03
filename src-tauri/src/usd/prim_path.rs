//! Backend-independent helpers for USD prim path string handling.
//!
//! These helpers intentionally do not validate or normalize paths.
//! Callers keep backend-specific filtering, ordering, and traversal
//! behavior local.

pub(crate) fn parent_prim_path(path: &str) -> Option<&str> {
    let slash_idx = path.rfind('/')?;
    if slash_idx == 0 {
        None
    } else {
        Some(&path[..slash_idx])
    }
}

pub(crate) fn basename_from_prim_path(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

pub(crate) fn ancestor_group_paths(leaf: &str) -> Vec<&str> {
    let mut ancestors = Vec::new();
    let mut current = leaf;
    while let Some(parent) = parent_prim_path(current) {
        ancestors.push(parent);
        current = parent;
    }
    ancestors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_prim_path_skips_pseudo_root() {
        assert_eq!(parent_prim_path("/A/B/C"), Some("/A/B"));
        assert_eq!(parent_prim_path("/A"), None);
        assert_eq!(parent_prim_path("/"), None);
        assert_eq!(parent_prim_path("Mesh"), None);
    }

    #[test]
    fn basename_matches_last_path_component() {
        assert_eq!(basename_from_prim_path("/Props/Table_1"), "Table_1");
        assert_eq!(basename_from_prim_path("/World"), "World");
        assert_eq!(basename_from_prim_path("Mesh"), "Mesh");
        assert_eq!(basename_from_prim_path("/"), "");
    }

    #[test]
    fn ancestor_group_paths_returns_nearest_first_without_pseudo_root() {
        assert_eq!(ancestor_group_paths("/A/B/C"), vec!["/A/B", "/A"]);
        assert!(ancestor_group_paths("/World").is_empty());
        assert!(ancestor_group_paths("/").is_empty());
        assert!(ancestor_group_paths("Mesh").is_empty());
    }
}
