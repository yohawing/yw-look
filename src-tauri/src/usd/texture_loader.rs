//! Backend-independent texture asset loading for USD GLB extraction.

use std::path::Path as StdPath;

use super::glb;

/// Phase 5c: result of resolving an authored `UsdPreviewSurface`
/// texture asset path. `input` is the GLB-ready payload to embed,
/// `identity` is a stable string identifier for **dedup keying**:
/// two authored asset paths that resolve to the same file or USDZ
/// entry must produce the same `identity` so the GLB only emits one
/// copy of the image bytes.
pub(crate) struct LoadedTexture {
    pub(crate) input: glb::TextureInput,
    pub(crate) identity: String,
}

/// Phase 5c: lazily resolve `UsdPreviewSurface` texture asset paths
/// against either a USDZ archive (zip read on first access) or one of
/// several search directories on the filesystem. The list of search
/// directories includes the root path's parent plus every composed
/// layer's parent so a material that lives in a referenced or
/// payloaded layer resolves its `inputs:file` against the **layer's**
/// directory rather than the top-level stage's directory (Codex P2).
/// The loader is intentionally state-bearing so a stage with hundreds
/// of textures only opens its USDZ archive once.
pub(crate) struct TextureLoader<'a> {
    /// Source path passed to `extract_geometry_glb`. Used to detect
    /// USDZ archives.
    source_path: &'a StdPath,
    /// Filesystem search directories, in priority order (closest layer
    /// first). Empty for USDZ-rooted stages.
    search_dirs: Vec<std::path::PathBuf>,
    /// `Some(map)` once a USDZ archive has been opened. Keyed on the
    /// lower-cased zip entry name with the raw uncompressed file bytes.
    usdz_entries: Option<std::collections::HashMap<String, Vec<u8>>>,
    /// Set after a failed USDZ open so we don't keep retrying.
    usdz_open_failed: bool,
}

impl<'a> TextureLoader<'a> {
    pub(crate) fn new(source_path: &'a StdPath, search_dirs: Vec<std::path::PathBuf>) -> Self {
        Self {
            source_path,
            search_dirs,
            usdz_entries: None,
            usdz_open_failed: false,
        }
    }

    /// Loads `asset_path` and returns a `LoadedTexture` ready to embed.
    /// The `identity` field of the result is what callers should key
    /// dedupe caches on (NOT the authored `asset_path` string).
    pub(crate) fn load(&mut self, asset_path: &str) -> Result<LoadedTexture, String> {
        let mime = guess_image_mime(asset_path)
            .ok_or_else(|| format!("unsupported texture extension: {asset_path}"))?;

        let (bytes, identity) = if self.is_usdz_source() {
            self.load_from_usdz(asset_path)?
        } else {
            self.load_from_filesystem(asset_path)?
        };

        Ok(LoadedTexture {
            input: glb::TextureInput {
                name: asset_path.to_string(),
                mime_type: mime.to_string(),
                data: bytes,
            },
            identity,
        })
    }

    fn is_usdz_source(&self) -> bool {
        self.source_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("usdz"))
            .unwrap_or(false)
    }

    fn load_from_filesystem(&self, asset_path: &str) -> Result<(Vec<u8>, String), String> {
        // Try absolute first, then each search dir in order.
        let candidate = StdPath::new(asset_path);
        if candidate.is_absolute() {
            return std::fs::read(candidate)
                .map(|bytes| (bytes, candidate.to_string_lossy().to_string()))
                .map_err(|e| format!("read {}: {e}", candidate.display()));
        }

        let mut last_err: Option<String> = None;
        for dir in &self.search_dirs {
            let resolved = dir.join(candidate);
            match std::fs::read(&resolved) {
                Ok(bytes) => {
                    // Identity = canonicalized resolved path so two
                    // different relative authorings that hit the same
                    // file dedupe correctly.
                    let canonical = std::fs::canonicalize(&resolved)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| resolved.to_string_lossy().to_string());
                    return Ok((bytes, canonical));
                }
                Err(e) => {
                    last_err = Some(format!("{}: {e}", resolved.display()));
                }
            }
        }
        Err(format!(
            "could not resolve '{asset_path}' against {} search dirs (last error: {})",
            self.search_dirs.len(),
            last_err.as_deref().unwrap_or("none"),
        ))
    }

    fn load_from_usdz(&mut self, asset_path: &str) -> Result<(Vec<u8>, String), String> {
        if self.usdz_entries.is_none() && !self.usdz_open_failed {
            match Self::open_usdz_archive(self.source_path) {
                Ok(map) => self.usdz_entries = Some(map),
                Err(err) => {
                    self.usdz_open_failed = true;
                    return Err(format!("open usdz {}: {err}", self.source_path.display()));
                }
            }
        }
        let entries = self
            .usdz_entries
            .as_ref()
            .ok_or_else(|| "usdz archive unavailable".to_string())?;

        // USDZ entries use forward slashes; the asset path may also
        // contain `./` prefixes. Normalize before lookup. The lookup
        // is case-insensitive because USDZ archives sometimes carry
        // mixed-case names from Windows tools.
        let normalized = asset_path.replace('\\', "/");
        let needle = normalized.trim_start_matches("./").to_ascii_lowercase();
        if let Some(bytes) = entries.get(&needle) {
            // Identity = "usdz:<archive path>!<entry key>" so it
            // never collides with a filesystem identity.
            let identity = format!("usdz:{}!{needle}", self.source_path.display());
            return Ok((bytes.clone(), identity));
        }
        // Fall back to a basename match; some USDZ archives flatten
        // their texture directory and the authored path still uses
        // the original DCC layout. Codex P2: if multiple entries
        // share the same basename (e.g. `textures/body/albedo.jpg`
        // **and** `textures/head/albedo.jpg`) we **must not** pick
        // arbitrarily because `HashMap::iter()` has no stable order
        // and the preview would non-deterministically show the wrong
        // texture. Require a unique basename hit, otherwise error
        // out so the caller logs it and falls back to the scalar
        // base color factor.
        let basename = needle.rsplit('/').next().unwrap_or(&needle);
        let basename_matches: Vec<&String> = entries
            .keys()
            .filter(|k| k.rsplit('/').next() == Some(basename))
            .collect();
        match basename_matches.len() {
            0 => Err(format!("no usdz entry matches '{asset_path}'")),
            1 => {
                let key = basename_matches[0];
                let bytes = entries[key].clone();
                let identity = format!("usdz:{}!{key}", self.source_path.display());
                Ok((bytes, identity))
            }
            n => Err(format!(
                "ambiguous usdz basename '{basename}' for '{asset_path}': {n} candidates ({:?})",
                basename_matches
            )),
        }
    }

    fn open_usdz_archive(
        source_path: &StdPath,
    ) -> Result<std::collections::HashMap<String, Vec<u8>>, String> {
        use std::io::Read;
        let file = std::fs::File::open(source_path).map_err(|e| format!("open: {e}"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("zip header: {e}"))?;
        let mut out = std::collections::HashMap::new();
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("zip entry {i}: {e}"))?;
            if entry.is_dir() {
                continue;
            }
            let key = entry.name().to_ascii_lowercase();
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("read zip entry {i}: {e}"))?;
            out.insert(key, buf);
        }
        Ok(out)
    }
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
pub(crate) enum TextureEmbedLogStyle {
    OpenUsdRs,
    OpenUsdCpp,
}

pub(crate) fn embed_material_textures(
    loader: &mut TextureLoader<'_>,
    materials: &mut [glb::MaterialInput],
    textures: &mut Vec<glb::TextureInput>,
    diffuse_paths: &[Option<String>],
    normal_paths: &[Option<String>],
    metal_rough_paths: Option<&[Option<String>]>,
    log_style: TextureEmbedLogStyle,
) {
    debug_assert_eq!(materials.len(), diffuse_paths.len());
    debug_assert_eq!(materials.len(), normal_paths.len());
    if let Some(paths) = metal_rough_paths {
        debug_assert_eq!(materials.len(), paths.len());
    }

    let mut texture_dedup: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();

    for (mat_idx, tex_path) in diffuse_paths.iter().enumerate() {
        let Some(tex_path) = tex_path else { continue };
        match load_texture_index(loader, textures, &mut texture_dedup, tex_path) {
            Ok(texture_index) => {
                materials[mat_idx].base_color_texture = Some(texture_index);
                let alpha = materials[mat_idx].base_color_factor[3];
                materials[mat_idx].base_color_factor = [1.0, 1.0, 1.0, alpha];
            }
            Err(err) => log_texture_embed_error(
                log_style,
                TextureEmbedChannel::Diffuse,
                tex_path,
                mat_idx,
                err,
            ),
        }
    }

    for (mat_idx, tex_path) in normal_paths.iter().enumerate() {
        let Some(tex_path) = tex_path else { continue };
        match load_texture_index(loader, textures, &mut texture_dedup, tex_path) {
            Ok(texture_index) => {
                materials[mat_idx].normal_texture = Some(texture_index);
            }
            Err(err) => log_texture_embed_error(
                log_style,
                TextureEmbedChannel::Normal,
                tex_path,
                mat_idx,
                err,
            ),
        }
    }

    let Some(metal_rough_paths) = metal_rough_paths else {
        return;
    };
    for (mat_idx, tex_path) in metal_rough_paths.iter().enumerate() {
        let Some(tex_path) = tex_path else { continue };
        match load_texture_index(loader, textures, &mut texture_dedup, tex_path) {
            Ok(texture_index) => {
                materials[mat_idx].metallic_roughness_texture = Some(texture_index);
            }
            Err(err) => log_texture_embed_error(
                log_style,
                TextureEmbedChannel::MetallicRoughness,
                tex_path,
                mat_idx,
                err,
            ),
        }
    }
}

fn load_texture_index(
    loader: &mut TextureLoader<'_>,
    textures: &mut Vec<glb::TextureInput>,
    texture_dedup: &mut std::collections::HashMap<String, usize>,
    asset_path: &str,
) -> Result<usize, String> {
    let loaded = loader.load(asset_path)?;
    if let Some(&existing) = texture_dedup.get(&loaded.identity) {
        return Ok(existing);
    }
    let index = textures.len();
    textures.push(loaded.input);
    texture_dedup.insert(loaded.identity, index);
    Ok(index)
}

#[derive(Clone, Copy)]
enum TextureEmbedChannel {
    Diffuse,
    Normal,
    MetallicRoughness,
}

fn log_texture_embed_error(
    style: TextureEmbedLogStyle,
    channel: TextureEmbedChannel,
    tex_path: &str,
    mat_idx: usize,
    err: String,
) {
    match (style, channel) {
        (TextureEmbedLogStyle::OpenUsdRs, TextureEmbedChannel::Diffuse) => {
            log::warn!(
                "[usd] failed to load texture '{}' for material[{mat_idx}]: {err}",
                tex_path
            );
        }
        (TextureEmbedLogStyle::OpenUsdRs, TextureEmbedChannel::Normal) => {
            log::warn!(
                "[usd] failed to load normal map '{}' for material[{mat_idx}]: {err}",
                tex_path
            );
        }
        (TextureEmbedLogStyle::OpenUsdRs, TextureEmbedChannel::MetallicRoughness) => {
            log::warn!(
                "[usd] failed to load metallic/roughness texture '{}' for material[{mat_idx}]: {err}",
                tex_path
            );
        }
        (TextureEmbedLogStyle::OpenUsdCpp, TextureEmbedChannel::Diffuse) => {
            log::warn!(
                "[usd-cpp] texture '{}' for material[{mat_idx}] failed: {err}",
                tex_path
            );
        }
        (TextureEmbedLogStyle::OpenUsdCpp, TextureEmbedChannel::Normal) => {
            log::warn!(
                "[usd-cpp] normal map '{}' for material[{mat_idx}] failed: {err}",
                tex_path
            );
        }
        (TextureEmbedLogStyle::OpenUsdCpp, TextureEmbedChannel::MetallicRoughness) => {
            log::warn!(
                "[usd-cpp] ORM texture '{}' for material[{mat_idx}] failed: {err}",
                tex_path
            );
        }
    }
}

/// Best-effort image MIME type from a file extension. glTF only
/// natively supports PNG and JPEG, so anything else is rejected at
/// the call site.
fn guess_image_mime(asset_path: &str) -> Option<&'static str> {
    let lower = asset_path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some("image/jpeg")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_usdz(path: &StdPath, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).expect("create usdz");
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in entries {
            archive.start_file(*name, options).expect("start zip file");
            archive.write_all(bytes).expect("write zip entry");
        }
        archive.finish().expect("finish zip");
    }

    #[test]
    fn guess_image_mime_classifies_png_and_jpeg_extensions() {
        assert_eq!(guess_image_mime("albedo.png"), Some("image/png"));
        assert_eq!(guess_image_mime("albedo.PNG"), Some("image/png"));
        assert_eq!(guess_image_mime("albedo.jpg"), Some("image/jpeg"));
        assert_eq!(guess_image_mime("albedo.jpeg"), Some("image/jpeg"));
        assert_eq!(guess_image_mime("albedo.JPEG"), Some("image/jpeg"));
        assert_eq!(guess_image_mime("albedo.tga"), None);
    }

    #[test]
    fn load_rejects_unsupported_extension() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);

        let err = match loader.load("albedo.tga") {
            Ok(_) => panic!("unsupported tga should fail"),
            Err(err) => err,
        };

        assert!(err.contains("unsupported texture extension: albedo.tga"));
    }

    #[test]
    fn load_accepts_jpeg_aliases_case_insensitively() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let texture = temp.path().join("Albedo.JPEG");
        std::fs::write(&texture, b"jpeg").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);

        let loaded = loader.load("Albedo.JPEG").expect("load jpeg");

        assert_eq!(loaded.input.mime_type, "image/jpeg");
        assert_eq!(loaded.input.data, b"jpeg");
    }

    #[test]
    fn filesystem_load_resolves_relative_path() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let texture_dir = temp.path().join("textures");
        std::fs::create_dir_all(&texture_dir).expect("create texture dir");
        std::fs::write(texture_dir.join("base.png"), b"png").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);

        let loaded = loader.load("textures/base.png").expect("load png");

        assert_eq!(loaded.input.mime_type, "image/png");
        assert_eq!(loaded.input.data, b"png");
        assert!(
            loaded.identity.ends_with("textures\\base.png")
                || loaded.identity.ends_with("textures/base.png")
        );
    }

    #[test]
    fn filesystem_load_canonicalizes_identity_for_equivalent_relative_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let texture_dir = temp.path().join("textures");
        std::fs::create_dir_all(&texture_dir).expect("create texture dir");
        std::fs::write(texture_dir.join("base.png"), b"png").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);

        let plain = loader.load("textures/base.png").expect("load plain path");
        let dotted = loader
            .load("textures/./base.png")
            .expect("load dotted path");

        assert_eq!(plain.input.data, dotted.input.data);
        assert_eq!(plain.identity, dotted.identity);
    }

    #[test]
    fn filesystem_absolute_path_skips_search_dirs() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let actual = temp.path().join("actual.jpg");
        let search_dir = temp.path().join("search");
        std::fs::create_dir_all(&search_dir).expect("create search dir");
        std::fs::write(&actual, b"actual").expect("write absolute texture");
        std::fs::write(search_dir.join("actual.jpg"), b"wrong").expect("write search texture");
        let mut loader = TextureLoader::new(&source, vec![search_dir]);

        let loaded = loader
            .load(&actual.to_string_lossy())
            .expect("load absolute texture");

        assert_eq!(loaded.input.data, b"actual");
        assert_eq!(loaded.identity, actual.to_string_lossy());
    }

    #[test]
    fn usdz_loads_entry_by_full_path_and_basename_with_same_identity() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usdz");
        write_usdz(&source, &[("0/chameleon_bc.jpg", b"jpeg-bytes")]);
        let mut loader = TextureLoader::new(&source, Vec::new());

        let full = loader.load("0/chameleon_bc.jpg").expect("load full path");
        let bare = loader.load("chameleon_bc.jpg").expect("load by basename");

        assert_eq!(full.input.mime_type, "image/jpeg");
        assert_eq!(full.input.data, b"jpeg-bytes");
        assert_eq!(bare.input.data, full.input.data);
        assert_eq!(bare.identity, full.identity);
    }

    #[test]
    fn usdz_ambiguous_basename_returns_error() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usdz");
        write_usdz(&source, &[("a/albedo.jpg", b"a"), ("b/albedo.jpg", b"b")]);
        let mut loader = TextureLoader::new(&source, Vec::new());

        let err = match loader.load("albedo.jpg") {
            Ok(_) => panic!("ambiguous basename should fail"),
            Err(err) => err,
        };

        assert!(err.contains("ambiguous usdz basename 'albedo.jpg'"));
    }

    #[test]
    fn embed_diffuse_texture_sets_slot_and_neutralizes_rgb_preserving_alpha() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        std::fs::write(temp.path().join("base.png"), b"png").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);
        let mut materials = vec![glb::MaterialInput::default_preview()];
        materials[0].base_color_factor = [0.2, 0.3, 0.4, 0.42];
        let mut textures = Vec::new();

        embed_material_textures(
            &mut loader,
            &mut materials,
            &mut textures,
            &[Some("base.png".to_string())],
            &[None],
            None,
            TextureEmbedLogStyle::OpenUsdRs,
        );

        assert_eq!(materials[0].base_color_texture, Some(0));
        assert_eq!(materials[0].base_color_factor, [1.0, 1.0, 1.0, 0.42]);
        assert_eq!(textures.len(), 1);
        assert_eq!(textures[0].data, b"png");
    }

    #[test]
    fn embed_normal_texture_sets_normal_slot() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        std::fs::write(temp.path().join("normal.jpg"), b"jpeg").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);
        let mut materials = vec![glb::MaterialInput::default_preview()];
        materials[0].base_color_factor = [0.2, 0.3, 0.4, 0.5];
        materials[0].metallic_factor = 0.25;
        materials[0].roughness_factor = 0.75;
        let original = materials[0].clone();
        let mut textures = Vec::new();

        embed_material_textures(
            &mut loader,
            &mut materials,
            &mut textures,
            &[None],
            &[Some("normal.jpg".to_string())],
            None,
            TextureEmbedLogStyle::OpenUsdRs,
        );

        assert_eq!(materials[0].normal_texture, Some(0));
        assert_eq!(materials[0].base_color_texture, original.base_color_texture);
        assert_eq!(
            materials[0].metallic_roughness_texture,
            original.metallic_roughness_texture
        );
        assert_eq!(materials[0].base_color_factor, original.base_color_factor);
        assert_eq!(materials[0].metallic_factor, original.metallic_factor);
        assert_eq!(materials[0].roughness_factor, original.roughness_factor);
        assert_eq!(textures.len(), 1);
        assert_eq!(textures[0].mime_type, "image/jpeg");
    }

    #[test]
    fn embed_metallic_roughness_texture_sets_orm_slot() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        std::fs::write(temp.path().join("orm.png"), b"orm").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);
        let mut materials = vec![glb::MaterialInput::default_preview()];
        materials[0].base_color_factor = [0.2, 0.3, 0.4, 0.5];
        materials[0].metallic_factor = 0.25;
        materials[0].roughness_factor = 0.75;
        let original = materials[0].clone();
        let mut textures = Vec::new();

        embed_material_textures(
            &mut loader,
            &mut materials,
            &mut textures,
            &[None],
            &[None],
            Some(&[Some("orm.png".to_string())]),
            TextureEmbedLogStyle::OpenUsdCpp,
        );

        assert_eq!(materials[0].metallic_roughness_texture, Some(0));
        assert_eq!(materials[0].base_color_texture, original.base_color_texture);
        assert_eq!(materials[0].normal_texture, original.normal_texture);
        assert_eq!(materials[0].base_color_factor, original.base_color_factor);
        assert_eq!(materials[0].metallic_factor, original.metallic_factor);
        assert_eq!(materials[0].roughness_factor, original.roughness_factor);
        assert_eq!(textures.len(), 1);
        assert_eq!(textures[0].data, b"orm");
    }

    #[test]
    fn embed_reuses_identity_across_diffuse_and_normal_channels() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let texture_dir = temp.path().join("textures");
        std::fs::create_dir_all(&texture_dir).expect("create texture dir");
        std::fs::write(texture_dir.join("shared.png"), b"shared").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);
        let mut materials = vec![glb::MaterialInput::default_preview()];
        let mut textures = Vec::new();

        embed_material_textures(
            &mut loader,
            &mut materials,
            &mut textures,
            &[Some("textures/shared.png".to_string())],
            &[Some("textures/./shared.png".to_string())],
            None,
            TextureEmbedLogStyle::OpenUsdRs,
        );

        assert_eq!(materials[0].base_color_texture, Some(0));
        assert_eq!(materials[0].normal_texture, Some(0));
        assert_eq!(materials[0].base_color_factor, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(textures.len(), 1);
    }

    #[test]
    fn embed_reuses_identity_across_diffuse_normal_and_orm_channels() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let texture_dir = temp.path().join("textures");
        std::fs::create_dir_all(&texture_dir).expect("create texture dir");
        std::fs::write(texture_dir.join("shared.png"), b"shared").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);
        let mut materials = vec![glb::MaterialInput::default_preview()];
        materials[0].base_color_factor = [0.2, 0.3, 0.4, 0.5];
        let mut textures = Vec::new();

        embed_material_textures(
            &mut loader,
            &mut materials,
            &mut textures,
            &[Some("textures/shared.png".to_string())],
            &[Some("textures/./shared.png".to_string())],
            Some(&[Some("textures/shared.png".to_string())]),
            TextureEmbedLogStyle::OpenUsdCpp,
        );

        assert_eq!(materials[0].base_color_texture, Some(0));
        assert_eq!(materials[0].normal_texture, Some(0));
        assert_eq!(materials[0].metallic_roughness_texture, Some(0));
        assert_eq!(materials[0].base_color_factor, [1.0, 1.0, 1.0, 0.5]);
        assert_eq!(textures.len(), 1);
    }

    #[test]
    fn embed_partial_failure_preserves_successful_channels_and_failed_factors() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        std::fs::write(temp.path().join("base.png"), b"png").expect("write texture");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);
        let mut materials = vec![glb::MaterialInput::default_preview()];
        materials[0].base_color_factor = [0.2, 0.3, 0.4, 0.5];
        materials[0].metallic_factor = 0.25;
        materials[0].roughness_factor = 0.75;
        let mut textures = Vec::new();

        embed_material_textures(
            &mut loader,
            &mut materials,
            &mut textures,
            &[Some("base.png".to_string())],
            &[Some("missing-normal.png".to_string())],
            Some(&[Some("missing-orm.jpg".to_string())]),
            TextureEmbedLogStyle::OpenUsdCpp,
        );

        assert_eq!(materials[0].base_color_texture, Some(0));
        assert_eq!(materials[0].normal_texture, None);
        assert_eq!(materials[0].metallic_roughness_texture, None);
        assert_eq!(materials[0].base_color_factor, [1.0, 1.0, 1.0, 0.5]);
        assert_eq!(materials[0].metallic_factor, 0.25);
        assert_eq!(materials[0].roughness_factor, 0.75);
        assert_eq!(textures.len(), 1);
    }

    #[test]
    fn embed_load_failure_continues_without_mutating_material_or_textures() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);
        let mut materials = vec![glb::MaterialInput::default_preview()];
        materials[0].base_color_factor = [0.2, 0.3, 0.4, 0.5];
        materials[0].metallic_factor = 0.25;
        materials[0].roughness_factor = 0.75;
        let original = materials[0].clone();
        let mut textures = Vec::new();

        embed_material_textures(
            &mut loader,
            &mut materials,
            &mut textures,
            &[Some("missing.png".to_string())],
            &[Some("unsupported.tga".to_string())],
            Some(&[Some("missing-orm.jpg".to_string())]),
            TextureEmbedLogStyle::OpenUsdCpp,
        );

        assert_eq!(materials[0].base_color_texture, original.base_color_texture);
        assert_eq!(materials[0].normal_texture, original.normal_texture);
        assert_eq!(
            materials[0].metallic_roughness_texture,
            original.metallic_roughness_texture
        );
        assert_eq!(materials[0].base_color_factor, original.base_color_factor);
        assert_eq!(materials[0].metallic_factor, original.metallic_factor);
        assert_eq!(materials[0].roughness_factor, original.roughness_factor);
        assert!(textures.is_empty());
    }
}
