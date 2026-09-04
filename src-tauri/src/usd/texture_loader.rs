//! Backend-independent texture asset loading for USD GLB extraction.

use std::path::Path as StdPath;

use openusd::ar::split_package_relative_path_outer;

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
    /// Source path passed to `extract_geometry_glb`. Used for legacy
    /// relative texture resolution and root USDZ lookups.
    source_path: &'a StdPath,
    /// Filesystem search directories, in priority order (closest layer
    /// first). Empty for USDZ-rooted stages.
    search_dirs: Vec<std::path::PathBuf>,
    /// Lazily opened USDZ archives, keyed by their canonical filesystem
    /// path. Entry names retain their archive spelling so package-relative
    /// identifiers can never collide through case folding.
    usdz_entries:
        std::collections::HashMap<std::path::PathBuf, std::collections::HashMap<String, Vec<u8>>>,
    /// Failed archive opens keyed by canonical filesystem path, so repeated
    /// texture references do not reopen a corrupt or unavailable archive.
    usdz_open_failed: std::collections::HashMap<std::path::PathBuf, String>,
}

impl<'a> TextureLoader<'a> {
    pub(crate) fn new(source_path: &'a StdPath, search_dirs: Vec<std::path::PathBuf>) -> Self {
        Self {
            source_path,
            search_dirs,
            usdz_entries: std::collections::HashMap::new(),
            usdz_open_failed: std::collections::HashMap::new(),
        }
    }

    /// Loads `asset_path` and returns a `LoadedTexture` ready to embed.
    /// The `identity` field of the result is what callers should key
    /// dedupe caches on (NOT the authored `asset_path` string).
    pub(crate) fn load(&mut self, asset_path: &str) -> Result<LoadedTexture, String> {
        let package_identifier = split_package_relative_path_outer(asset_path);
        let mime_asset_path = package_identifier
            .as_ref()
            .map(|(_, package_entry)| package_entry.as_str())
            .unwrap_or(asset_path);
        let mime = guess_image_mime(mime_asset_path)
            .ok_or_else(|| format!("unsupported texture extension: {asset_path}"))?;

        let (bytes, identity) = if let Some((package_path, package_entry)) = package_identifier {
            self.load_from_package_identifier(&package_path, &package_entry)?
        } else if StdPath::new(asset_path).is_absolute() {
            self.load_absolute_filesystem(asset_path)?
        } else if self.is_usdz_source() {
            self.load_from_legacy_usdz(asset_path)?
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
            return self.load_absolute_filesystem(asset_path);
        }

        let mut last_err: Option<String> = None;
        for dir in &self.search_dirs {
            let resolved = dir.join(candidate);
            match std::fs::read(&resolved) {
                Ok(bytes) => {
                    // Identity = canonicalized resolved path so two
                    // different relative authorings that hit the same
                    // file dedupe correctly.
                    return Ok((bytes, filesystem_identity(&resolved)));
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

    fn load_absolute_filesystem(&self, asset_path: &str) -> Result<(Vec<u8>, String), String> {
        let path = StdPath::new(asset_path);
        std::fs::read(path)
            .map(|bytes| (bytes, filesystem_identity(path)))
            .map_err(|e| format!("read {}: {e}", path.display()))
    }

    fn load_from_legacy_usdz(&mut self, asset_path: &str) -> Result<(Vec<u8>, String), String> {
        let archive_path = self.source_path.to_path_buf();
        let entries = self.usdz_entries_for(&archive_path)?;

        // Legacy root-USDZ callers historically supplied an authored
        // relative path, so retain their separator normalization,
        // case-insensitive lookup, and unique-basename fallback. Resolved
        // package identifiers use load_from_package_identifier instead and
        // never enter this compatibility path.
        let normalized = asset_path.replace('\\', "/");
        let needle = normalized.trim_start_matches("./").to_ascii_lowercase();
        let path_matches: Vec<(&String, &Vec<u8>)> = entries
            .iter()
            .filter(|(key, _)| key.eq_ignore_ascii_case(&needle))
            .collect();
        match path_matches.len() {
            1 => {
                let (key, bytes) = path_matches[0];
                let archive_identity = filesystem_identity(&archive_path);
                let identity = format!("usdz:{archive_identity}!{key}");
                return Ok((bytes.clone(), identity));
            }
            n if n > 1 => {
                return Err(format!(
                    "ambiguous usdz entry '{asset_path}' with {n} case-insensitive matches"
                ));
            }
            _ => {}
        }
        let basename = needle.rsplit('/').next().unwrap_or(&needle);
        let basename_matches: Vec<&String> = entries
            .keys()
            .filter(|key| {
                key.rsplit('/')
                    .next()
                    .is_some_and(|entry_name| entry_name.eq_ignore_ascii_case(basename))
            })
            .collect();
        match basename_matches.len() {
            0 => Err(format!("no usdz entry matches '{asset_path}'")),
            1 => {
                let key = basename_matches[0];
                let bytes = entries[key].clone();
                let archive_identity = filesystem_identity(&archive_path);
                let identity = format!("usdz:{archive_identity}!{key}");
                Ok((bytes, identity))
            }
            n => Err(format!(
                "ambiguous usdz basename '{basename}' for '{asset_path}': {n} candidates ({:?})",
                basename_matches
            )),
        }
    }

    fn load_from_package_identifier(
        &mut self,
        package_path: &str,
        package_entry: &str,
    ) -> Result<(Vec<u8>, String), String> {
        if package_entry.is_empty() {
            return Err(format!(
                "empty package entry in '{package_path}[{package_entry}]'"
            ));
        }
        let archive_path = self.resolve_package_path(package_path)?;
        let entries = self.usdz_entries_for(&archive_path)?;
        let entry = package_entry.replace('\\', "/");
        let bytes = entries.get(&entry).ok_or_else(|| {
            format!(
                "no exact usdz entry '{entry}' in package {}",
                archive_path.display()
            )
        })?;
        let archive_identity = filesystem_identity(&archive_path);
        let identity = format!("usdz:{archive_identity}!{entry}");
        Ok((bytes.clone(), identity))
    }

    fn resolve_package_path(&self, package_path: &str) -> Result<std::path::PathBuf, String> {
        let candidate = StdPath::new(package_path);
        if candidate.is_absolute() {
            return Ok(candidate.to_path_buf());
        }
        let mut last_error = None;
        for directory in &self.search_dirs {
            let resolved = directory.join(candidate);
            match std::fs::metadata(&resolved) {
                Ok(metadata) if metadata.is_file() => return Ok(resolved),
                Ok(_) => {
                    last_error = Some(format!("{} is not a file", resolved.display()));
                }
                Err(error) => {
                    last_error = Some(format!("{}: {error}", resolved.display()));
                }
            }
        }
        Err(format!(
            "could not resolve package '{package_path}' against {} search dirs (last error: {})",
            self.search_dirs.len(),
            last_error.as_deref().unwrap_or("none"),
        ))
    }

    fn usdz_entries_for(
        &mut self,
        archive_path: &StdPath,
    ) -> Result<&std::collections::HashMap<String, Vec<u8>>, String> {
        let cache_key = filesystem_identity_path(archive_path);
        if !self.usdz_entries.contains_key(&cache_key) {
            if let Some(error) = self.usdz_open_failed.get(&cache_key) {
                return Err(error.clone());
            }
            match Self::open_usdz_archive(&cache_key) {
                Ok(entries) => {
                    self.usdz_entries.insert(cache_key.clone(), entries);
                }
                Err(error) => {
                    let message = format!("open usdz {}: {error}", cache_key.display());
                    self.usdz_open_failed
                        .insert(cache_key.clone(), message.clone());
                    return Err(message);
                }
            }
        }
        self.usdz_entries
            .get(&cache_key)
            .ok_or_else(|| format!("usdz archive unavailable: {}", cache_key.display()))
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
            let key = entry.name().to_string();
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

fn filesystem_identity(path: &StdPath) -> String {
    let rendered = filesystem_identity_path(path)
        .to_string_lossy()
        .into_owned();
    #[cfg(windows)]
    {
        return normalize_windows_identity(&rendered);
    }
    #[cfg(not(windows))]
    rendered
}

fn filesystem_identity_path(path: &StdPath) -> std::path::PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn normalize_windows_identity(path: &str) -> String {
    let Some(path) = path.strip_prefix("\\\\?\\") else {
        return path.to_string();
    };
    if let Some(unc_path) = path.strip_prefix("UNC\\") {
        format!("\\\\{unc_path}")
    } else {
        path.to_string()
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
    fn windows_identity_normalization_preserves_unc_and_drive_roots() {
        assert_eq!(
            normalize_windows_identity(r"\\?\UNC\server\share\albedo.png"),
            r"\\server\share\albedo.png"
        );
        assert_eq!(
            normalize_windows_identity(r"\\?\C:\textures\albedo.png"),
            r"C:\textures\albedo.png"
        );
        assert_eq!(
            normalize_windows_identity(r"C:\textures\albedo.png"),
            r"C:\textures\albedo.png"
        );
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
    fn legacy_usdz_case_insensitive_path_collision_returns_error() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usdz");
        write_usdz(
            &source,
            &[
                ("textures/Albedo.png", b"upper"),
                ("textures/albedo.png", b"lower"),
            ],
        );
        let mut loader = TextureLoader::new(&source, Vec::new());

        let error = match loader.load("textures/ALBEDO.PNG") {
            Ok(_) => panic!("case-insensitive archive path collision must fail"),
            Err(error) => error,
        };

        assert!(error.contains("ambiguous usdz entry 'textures/ALBEDO.PNG'"));
    }

    #[test]
    fn package_identifier_owns_archive_and_exact_entry() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let first_archive = temp.path().join("first.usdz");
        let second_archive = temp.path().join("second.usdz");
        write_usdz(
            &first_archive,
            &[
                ("inner/albedo.png", b"first"),
                ("other/albedo.png", b"wrong-first"),
            ],
        );
        write_usdz(&second_archive, &[("inner/albedo.png", b"second")]);
        let mut loader = TextureLoader::new(&source, vec![temp.path().to_path_buf()]);

        let first_identifier = format!("{}[inner/albedo.png]", first_archive.display());
        let second_identifier = format!("{}[inner/albedo.png]", second_archive.display());
        let first = loader
            .load(&first_identifier)
            .expect("load first package entry");
        let second = loader
            .load(&second_identifier)
            .expect("load second package entry");

        assert_eq!(first.input.data, b"first");
        assert_eq!(second.input.data, b"second");
        assert_ne!(first.identity, second.identity);
        assert!(first.identity.contains("!inner/albedo.png"));

        let missing_exact = format!("{}[missing/albedo.png]", first_archive.display());
        let error = match loader.load(&missing_exact) {
            Ok(_) => panic!("package identifiers must not basename-fallback"),
            Err(error) => error,
        };
        assert!(error.contains("no exact usdz entry 'missing/albedo.png'"));
    }

    #[test]
    fn package_identifier_resolves_relative_archive_from_usda_search_dir() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let archive_dir = temp.path().join("assets");
        std::fs::create_dir_all(&archive_dir).expect("create archive dir");
        write_usdz(
            &archive_dir.join("materials.usdz"),
            &[("inner/albedo.png", b"embedded")],
        );
        let mut loader = TextureLoader::new(&source, vec![archive_dir]);

        let loaded = loader
            .load("materials.usdz[inner/albedo.png]")
            .expect("load relative package identifier");

        assert_eq!(loaded.input.data, b"embedded");
        assert!(loaded.identity.contains("!inner/albedo.png"));
    }

    #[test]
    fn absolute_filesystem_identifier_wins_over_root_usdz_source() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usdz");
        write_usdz(&source, &[("textures/albedo.png", b"embedded")]);
        let external_dir = temp.path().join("external");
        std::fs::create_dir_all(&external_dir).expect("create external dir");
        let external = external_dir.join("albedo.png");
        std::fs::write(&external, b"filesystem").expect("write external texture");
        let mut loader = TextureLoader::new(&source, Vec::new());

        let loaded = loader
            .load(&external.to_string_lossy())
            .expect("load absolute filesystem texture from USDZ stage");

        assert_eq!(loaded.input.data, b"filesystem");
        assert_eq!(loaded.identity, filesystem_identity(&external));
    }

    #[test]
    fn package_identity_dedupes_separator_aliases_without_case_folding() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("scene.usda");
        let archive = temp.path().join("textures.usdz");
        write_usdz(&archive, &[("inner/shared.png", b"shared")]);
        let mut loader = TextureLoader::new(&source, Vec::new());
        let archive_path = archive.to_string_lossy();

        let plain = loader
            .load(&format!("{archive_path}[inner/shared.png]"))
            .expect("load package entry");
        let slash_alias = loader
            .load(&format!("{archive_path}[inner\\shared.png]"))
            .expect("load package separator alias");

        assert_eq!(plain.identity, slash_alias.identity);
        assert_eq!(plain.input.data, slash_alias.input.data);

        let wrong_case = loader.load(&format!("{archive_path}[INNER/shared.png]"));
        assert!(
            wrong_case.is_err(),
            "package entries must remain case-sensitive"
        );
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
