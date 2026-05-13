fn main() {
    // Updater defaults are baked in via `option_env!` in lib.rs; tell
    // cargo to rebuild if they flip so dev machines don't accidentally
    // ship stale endpoints.
    println!("cargo:rerun-if-env-changed=YW_LOOK_UPDATER_ENDPOINT");
    println!("cargo:rerun-if-env-changed=YW_LOOK_UPDATER_PUBLIC_KEY");

    // Stage the C++ backend's runtime libraries into
    // `src-tauri/cpp-artifacts/<triplet>/` *before* handing control to
    // `tauri_build::build()`. The per-OS overlay configs
    // (`tauri.{macos,windows}.json`) reference that directory from
    // `bundle.resources`, and `tauri_build` validates every resource
    // path in the build script — if the directory does not yet exist
    // it aborts with `resource path '...' doesn't exist` before
    // cpp_backend has a chance to populate it. Reversing the order
    // guarantees the tree is on disk by the time tauri validates.
    #[cfg(feature = "backend-openusd-cpp")]
    cpp_backend::build();

    tauri_build::build();
}

#[cfg(feature = "backend-openusd-cpp")]
mod cpp_backend {
    use serde::Deserialize;
    use sha2::{Digest, Sha256};
    use std::env;
    use std::fs::{self, File};
    use std::io::{self, Read};
    use std::path::{Component, Path, PathBuf};
    use std::process::Command;
    use zip::ZipArchive;

    #[derive(Debug, Deserialize)]
    struct PrebuiltManifest {
        artifacts: Vec<PrebuiltArtifact>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrebuiltArtifact {
        triplet: String,
        file: String,
        sha256: String,
        size: u64,
        payload_root: String,
    }

    /// Triplet mapping is intentionally narrow: yw-look's C++ backend
    /// only targets Windows x64 and macOS arm64 for now. Adding a new
    /// host requires adding a triplet here and touching
    /// `tauri.<os>.json` for bundle resources.
    fn triplet_for(target_os: &str, target_arch: &str) -> &'static str {
        match (target_os, target_arch) {
            ("windows", "x86_64") => "x64-windows",
            ("macos", "aarch64") => "arm64-osx",
            _ => panic!(
                "backend-openusd-cpp is only supported on windows-x86_64 and \
                 macos-aarch64 (got target_os={target_os}, target_arch={target_arch})"
            ),
        }
    }

    fn vcpkg_exe(vcpkg_root: &Path, target_os: &str) -> PathBuf {
        if target_os == "windows" {
            vcpkg_root.join("vcpkg.exe")
        } else {
            vcpkg_root.join("vcpkg")
        }
    }

    fn hex_sha256(path: &Path) -> io::Result<String> {
        let mut file = File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    }

    fn is_git_lfs_pointer(path: &Path) -> bool {
        let Ok(metadata) = fs::metadata(path) else {
            return false;
        };
        if metadata.len() > 1024 {
            return false;
        }
        fs::read_to_string(path)
            .map(|content| content.starts_with("version https://git-lfs.github.com/spec/v1"))
            .unwrap_or(false)
    }

    fn validate_manifest_relative_path(value: &str, label: &str) {
        let path = Path::new(value);
        assert!(
            !value.is_empty()
                && path
                    .components()
                    .all(|component| matches!(component, Component::Normal(_) | Component::CurDir)),
            "invalid {label} in OpenUSD prebuilt manifest: {value}"
        );
    }

    fn prebuilt_root(manifest_dir: &Path) -> PathBuf {
        env::var_os("OPENUSD_PREBUILT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                manifest_dir
                    .parent()
                    .expect("src-tauri has a repo root parent")
                    .join("third_party")
                    .join("prebuilt")
                    .join("openusd")
            })
    }

    fn should_force_vcpkg() -> bool {
        matches!(
            env::var("OPENUSD_FORCE_VCPKG").as_deref(),
            Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
        )
    }

    fn prebuilt_payload_ready(dest: &Path, sha256: &str) -> bool {
        let marker = dest.join(".yw-look-prebuilt.sha256");
        fs::read_to_string(&marker)
            .map(|value| value.trim() == sha256)
            .unwrap_or(false)
            && dest.join("share").join("pxr").exists()
            && dest.join("include").exists()
            && dest.join("lib").exists()
    }

    fn extract_prebuilt_payload(
        zip_path: &Path,
        artifact: &PrebuiltArtifact,
        manifest_dir: &Path,
        triplet: &str,
    ) -> PathBuf {
        let prebuilt_root = manifest_dir.join("prebuilt-vcpkg_installed");
        let dest = prebuilt_root.join(triplet);
        if prebuilt_payload_ready(&dest, &artifact.sha256) {
            println!(
                "cargo:warning=using cached prebuilt OpenUSD payload for {triplet}: {}",
                zip_path.display()
            );
            return prebuilt_root;
        }

        let file = File::open(zip_path).unwrap_or_else(|e| {
            panic!(
                "failed to open OpenUSD prebuilt zip {}: {e}",
                zip_path.display()
            )
        });
        let mut archive = ZipArchive::new(file).unwrap_or_else(|e| {
            panic!(
                "failed to read OpenUSD prebuilt zip {}: {e}",
                zip_path.display()
            )
        });
        let payload_root = Path::new(&artifact.payload_root);
        let tmp_dest = manifest_dir
            .join("prebuilt-vcpkg_installed")
            .join(format!("{triplet}.prebuilt-tmp"));
        fs::remove_dir_all(&tmp_dest).unwrap_or_else(|e| {
            if tmp_dest.exists() {
                panic!("failed to remove stale {}: {e}", tmp_dest.display());
            }
        });
        fs::create_dir_all(&tmp_dest)
            .unwrap_or_else(|e| panic!("failed to create {}: {e}", tmp_dest.display()));

        let mut extracted = 0usize;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .unwrap_or_else(|e| panic!("failed to read zip entry #{index}: {e}"));
            let Some(enclosed) = entry.enclosed_name() else {
                continue;
            };
            let Ok(relative) = enclosed.strip_prefix(payload_root) else {
                continue;
            };
            if relative.as_os_str().is_empty() {
                continue;
            }
            let out_path = tmp_dest.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&out_path)
                    .unwrap_or_else(|e| panic!("failed to create {}: {e}", out_path.display()));
                continue;
            }
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .unwrap_or_else(|e| panic!("failed to create {}: {e}", parent.display()));
            }
            let mut out = File::create(&out_path)
                .unwrap_or_else(|e| panic!("failed to create {}: {e}", out_path.display()));
            io::copy(&mut entry, &mut out)
                .unwrap_or_else(|e| panic!("failed to extract {}: {e}", out_path.display()));
            extracted += 1;
        }

        assert!(
            extracted > 0,
            "OpenUSD prebuilt zip {} did not contain payload root {}",
            zip_path.display(),
            artifact.payload_root
        );
        assert!(
            tmp_dest.join("share").join("pxr").exists(),
            "OpenUSD prebuilt payload {} is missing share/pxr",
            zip_path.display()
        );
        assert!(
            tmp_dest.join("include").exists() && tmp_dest.join("lib").exists(),
            "OpenUSD prebuilt payload {} is missing include/ or lib/",
            zip_path.display()
        );

        fs::remove_dir_all(&dest).unwrap_or_else(|e| {
            if dest.exists() {
                panic!("failed to remove stale {}: {e}", dest.display());
            }
        });
        mirror_tree(&tmp_dest, &dest);
        fs::remove_dir_all(&tmp_dest).unwrap_or_else(|e| {
            panic!(
                "failed to remove temporary OpenUSD extraction dir {}: {e}",
                tmp_dest.display()
            )
        });
        fs::write(dest.join(".yw-look-prebuilt.sha256"), &artifact.sha256).unwrap_or_else(|e| {
            panic!(
                "failed to write OpenUSD prebuilt marker under {}: {e}",
                dest.display()
            )
        });
        println!(
            "cargo:warning=extracted prebuilt OpenUSD payload for {triplet}: {}",
            zip_path.display()
        );
        prebuilt_root
    }

    fn try_use_prebuilt_openusd(manifest_dir: &Path, triplet: &str) -> Option<PathBuf> {
        println!("cargo:rerun-if-env-changed=OPENUSD_PREBUILT_DIR");
        println!("cargo:rerun-if-env-changed=OPENUSD_FORCE_VCPKG");
        if should_force_vcpkg() {
            println!("cargo:warning=OPENUSD_FORCE_VCPKG is set; skipping prebuilt OpenUSD payload");
            return None;
        }

        let root = prebuilt_root(manifest_dir);
        let manifest_path = root.join("manifest.json");
        println!("cargo:rerun-if-changed={}", manifest_path.display());
        if !manifest_path.exists() {
            if env::var_os("OPENUSD_PREBUILT_DIR").is_some() {
                panic!(
                    "OPENUSD_PREBUILT_DIR was set but manifest is missing: {}",
                    manifest_path.display()
                );
            }
            return None;
        }

        let manifest: PrebuiltManifest = serde_json::from_slice(
            &fs::read(&manifest_path)
                .unwrap_or_else(|e| panic!("failed to read {}: {e}", manifest_path.display())),
        )
        .unwrap_or_else(|e| panic!("failed to parse {}: {e}", manifest_path.display()));
        let Some(artifact) = manifest
            .artifacts
            .iter()
            .find(|entry| entry.triplet == triplet)
        else {
            return None;
        };
        validate_manifest_relative_path(&artifact.file, "file");
        validate_manifest_relative_path(&artifact.payload_root, "payloadRoot");
        let zip_path = root.join(&artifact.file);
        println!("cargo:rerun-if-changed={}", zip_path.display());
        let metadata = fs::metadata(&zip_path).unwrap_or_else(|e| {
            panic!(
                "OpenUSD prebuilt zip is missing {}: {e}",
                zip_path.display()
            )
        });
        if is_git_lfs_pointer(&zip_path) {
            if env::var_os("OPENUSD_PREBUILT_DIR").is_some() {
                panic!(
                    "OpenUSD prebuilt zip is still a Git LFS pointer: {}",
                    zip_path.display()
                );
            }
            println!(
                "cargo:warning=OpenUSD prebuilt zip is a Git LFS pointer; falling back to vcpkg: {}",
                zip_path.display()
            );
            return None;
        }
        assert_eq!(
            metadata.len(),
            artifact.size,
            "OpenUSD prebuilt zip size mismatch for {}",
            zip_path.display()
        );
        let actual_sha = hex_sha256(&zip_path)
            .unwrap_or_else(|e| panic!("failed to hash {}: {e}", zip_path.display()));
        assert_eq!(
            actual_sha.to_ascii_lowercase(),
            artifact.sha256.to_ascii_lowercase(),
            "OpenUSD prebuilt zip sha256 mismatch for {}",
            zip_path.display()
        );

        Some(extract_prebuilt_payload(
            &zip_path,
            artifact,
            manifest_dir,
            triplet,
        ))
    }

    /// Copies one file, creating parent directories as needed. Used
    /// to stage shim + vcpkg-installed shared libraries into a single
    /// stable location that `tauri.<os>.json` references.
    fn copy_into(src: &Path, dst_dir: &Path) {
        if !src.exists() {
            // Not an error: the shim's .dll/.dylib is only produced
            // on the matching host. Silently skip so windows builders
            // don't fail on missing macOS artifacts and vice versa.
            return;
        }
        fs::create_dir_all(dst_dir).expect("create_dir_all");
        let dst = dst_dir.join(src.file_name().expect("file_name"));
        fs::copy(src, &dst).unwrap_or_else(|e| {
            panic!(
                "failed to copy {} -> {}: {}",
                src.display(),
                dst.display(),
                e
            )
        });
    }

    /// Writes a top-level `plugInfo.json` to `dir` whose only content
    /// is an `Includes` directive matching every per-plugin
    /// `resources/` subdirectory. Needed because vcpkg's OpenUSD port
    /// produces per-plugin plugInfo files at `bin/usd/<name>/
    /// resources/plugInfo.json` but does not ship a manifest at
    /// `bin/usd/plugInfo.json`. Without a top-level manifest,
    /// `PlugRegistry::RegisterPlugins("<dll_dir>/usd")` probes
    /// `<dll_dir>/usd/plugInfo.json`, fails to open it, and never
    /// recurses into the plugin subdirs — leaving USDA / USDC file
    /// format plugins unregistered and `UsdStage::Open` aborting.
    ///
    /// The `*/resources/` include pattern matches the manifest shape
    /// vcpkg itself installs at `lib/usd/plugInfo.json`, so the
    /// generated file is semantically identical to the upstream one.
    fn write_plugin_manifest(dir: &Path) {
        if !dir.exists() {
            return;
        }
        let manifest = dir.join("plugInfo.json");
        fs::write(&manifest, b"{\n    \"Includes\": [ \"*/resources/\" ]\n}\n").unwrap_or_else(
            |e| {
                panic!(
                    "failed to write top-level plugInfo manifest {}: {e}",
                    manifest.display()
                )
            },
        );
    }

    /// Recursively mirrors `src` into `dst`, creating directories as
    /// needed. Used to ship the OpenUSD plugin tree (`bin/usd/<name>/
    /// resources/plugInfo.json`) next to the runtime DLLs so the shim
    /// can bootstrap `PlugRegistry` at startup. If `src` does not
    /// exist we silently skip: the vcpkg port may place plugins under
    /// a different subdir on future revisions, and breaking the dev
    /// build on a file layout change is worse than a quiet no-op.
    fn mirror_tree(src: &Path, dst: &Path) {
        if !src.exists() {
            return;
        }
        fs::create_dir_all(dst)
            .unwrap_or_else(|e| panic!("create_dir_all {} failed: {e}", dst.display()));
        let entries =
            fs::read_dir(src).unwrap_or_else(|e| panic!("read_dir {} failed: {e}", src.display()));
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let entry_name = entry.file_name();
            let dst_child = dst.join(&entry_name);
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                mirror_tree(&entry_path, &dst_child);
            } else if file_type.is_file() {
                let _ = fs::remove_file(&dst_child);
                fs::copy(&entry_path, &dst_child).unwrap_or_else(|e| {
                    panic!(
                        "copy plugin asset {} -> {} failed: {e}",
                        entry_path.display(),
                        dst_child.display()
                    )
                });
            }
        }
    }

    /// Walks `dir` (non-recursively) and returns every file whose
    /// extension (case-insensitive) matches `ext` and whose file name
    /// passes `accept`. Used to pick up the full runtime-library
    /// closure without committing to a hardcoded filename list that
    /// drifts as vcpkg ports rename / split / merge their output.
    fn collect_libs(dir: &Path, ext: &str, accept: impl Fn(&str) -> bool) -> Vec<PathBuf> {
        let Ok(entries) = fs::read_dir(dir) else {
            return Vec::new();
        };
        let ext_lower = ext.to_ascii_lowercase();
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let matches_ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase() == ext_lower)
                .unwrap_or(false);
            if !matches_ext {
                continue;
            }
            if accept(name) {
                out.push(path);
            }
        }
        out.sort();
        out
    }

    /// Returns true when the two files exist and their byte contents
    /// are bit-identical. Uses a full read because the runtime libs we
    /// mirror are a handful of tens of MB at most — negligible next to
    /// the OpenUSD compile that dominates this build.
    fn files_byte_equal(a: &Path, b: &Path) -> bool {
        let (Ok(am), Ok(bm)) = (fs::metadata(a), fs::metadata(b)) else {
            return false;
        };
        if am.len() != bm.len() {
            return false;
        }
        match (fs::read(a), fs::read(b)) {
            (Ok(ab), Ok(bb)) => ab == bb,
            _ => false,
        }
    }

    /// Mirror one library next to the dev binaries.
    ///
    /// Destination is Cargo's live target directory (`target/<profile>/`
    /// or `target/<profile>/deps/`), which is what `cargo run` /
    /// `cargo tauri dev` / integration tests load native libraries
    /// from.
    ///
    /// Policy:
    /// 1. If the destination already holds a byte-identical copy, skip
    ///    the write entirely. This avoids rebuild churn and — crucially
    ///    on Windows — sidesteps the DLL-lock problem whenever the
    ///    shim's output did not actually change between builds.
    /// 2. Otherwise replace the destination by deleting it first and
    ///    then copying. The two-step sequence survives the common
    ///    Windows case where the destination is currently mapped by a
    ///    running dev process: `remove_file` on a mapped DLL performs
    ///    a scheduled-for-delete rename rather than an immediate unlink
    ///    on modern NTFS, letting the subsequent `copy` create a fresh
    ///    file at the original path. If even this sequence fails, we
    ///    abort the build with an actionable error — leaving the stale
    ///    library in place would silently make the next run exercise
    ///    outdated C++ code, which is strictly worse than a build
    ///    failure the developer can fix by closing the other process.
    fn copy_into_dev_dir(src: &Path, dst_dir: &Path) {
        let dst = dst_dir.join(src.file_name().expect("file_name"));

        if !src.exists() {
            // This helper is only called from the active OS branch,
            // so a missing source means vcpkg / the shim build did
            // not actually produce the expected artifact for this
            // host (e.g. after a branch switch or a failed earlier
            // build). Leaving a stale copy next to the dev binary
            // would silently let `cargo run` load outdated native
            // code; remove it so the loader fails loudly instead.
            if dst.exists() {
                fs::remove_file(&dst).unwrap_or_else(|e| {
                    panic!(
                        "failed to evict stale dev-mirror copy {} \
                         after source {} disappeared: {}",
                        dst.display(),
                        src.display(),
                        e
                    )
                });
            }
            return;
        }
        fs::create_dir_all(dst_dir).unwrap_or_else(|e| {
            panic!(
                "failed to create dev mirror dir {}: {}",
                dst_dir.display(),
                e
            )
        });

        if files_byte_equal(src, &dst) {
            // Bit-identical: nothing to replace, so the DLL-lock case
            // cannot even be hit.
            return;
        }

        // Best-effort: try to unlink the destination first. On Windows
        // this lets a fresh copy land at the same path even if the old
        // file is still mapped into a running process. `remove_file`
        // is allowed to fail (e.g. the file does not exist yet); only
        // a failing `copy` after this is fatal.
        let _ = fs::remove_file(&dst);

        fs::copy(src, &dst).unwrap_or_else(|e| {
            panic!(
                "failed to mirror {} -> {}: {}\n\n\
                 On Windows this usually means a previously launched \
                 `cargo run`, `cargo tauri dev`, or integration-test \
                 binary still has the library mapped and is holding an \
                 exclusive lock on it. Close that process and rebuild.\n\
                 (Aborting instead of warning: a silent skip here would \
                 leave a stale native library in {} and the next launch \
                 would load old C++ backend code.)",
                src.display(),
                dst.display(),
                e,
                dst_dir.display(),
            )
        });
    }

    pub(super) fn build() {
        let target_os = env::var("CARGO_CFG_TARGET_OS").expect("CARGO_CFG_TARGET_OS");
        let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH");
        let triplet = triplet_for(&target_os, &target_arch);

        let manifest_dir =
            PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
        let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));

        println!("cargo:rerun-if-env-changed=VCPKG_ROOT");
        println!("cargo:rerun-if-env-changed=VCPKG_BINARY_SOURCES");
        println!("cargo:rerun-if-env-changed=LIBCLANG_PATH");

        // Treat the vcpkg inputs as first-class build inputs: if a
        // developer bumps the baseline SHA, usd version>= constraint,
        // or overlay triplet, Cargo needs to rerun the build script so
        // vcpkg picks up the change. Without these declarations Cargo
        // only reruns on source-file changes and we'd ship stale libs.
        println!(
            "cargo:rerun-if-changed={}",
            manifest_dir.join("vcpkg.json").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            manifest_dir.join("vcpkg-configuration.json").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            manifest_dir
                .join("triplets")
                .join("arm64-osx.cmake")
                .display()
        );

        // 1. Prefer a verified Git LFS prebuilt payload when present.
        //    It restores a separate prebuilt vcpkg install tree without
        //    building OpenUSD from source. Set OPENUSD_FORCE_VCPKG=1 when
        //    regenerating the payload or intentionally testing vcpkg.
        let prebuilt_installed_root = try_use_prebuilt_openusd(&manifest_dir, triplet);
        let vcpkg_root = env::var_os("VCPKG_ROOT").map(PathBuf::from);

        // 1b. Invoke vcpkg in manifest mode when no prebuilt payload
        //     is available. Classic vcpkg users may
        //    not be used to this, but it's the mode the vcpkg.json +
        //    vcpkg-configuration.json files at `manifest_dir` express.
        //    `--x-manifest-root` picks up those two files.
        //    On first run this builds OpenUSD from source (30-60 min);
        //    subsequent runs restore from the vcpkg binary cache.
        //
        //    `--overlay-triplets` points at our `triplets/` directory,
        //    which patches the upstream `arm64-osx` triplet to set
        //    `VCPKG_OSX_DEPLOYMENT_TARGET=11.0`. Without the overlay,
        //    the baseline triplet leaves the target unset and OpenUSD's
        //    CMake falls back to 10.13 — too old for libc++'s
        //    `<filesystem>`, which breaks the pegtl compile. The overlay
        //    is also consulted for the Windows triplet, but that file
        //    is omitted; vcpkg falls back to the upstream definition
        //    automatically when the overlay does not override it.
        let overlay_triplets = manifest_dir.join("triplets");
        if prebuilt_installed_root.is_none() {
            let vcpkg_root = vcpkg_root
                .as_deref()
                .expect("VCPKG_ROOT is not set. See docs/usd-cpp.md for setup.");
            let status = Command::new(vcpkg_exe(vcpkg_root, &target_os))
                .args([
                    "install",
                    "--x-manifest-root=.",
                    &format!("--triplet={triplet}"),
                    &format!(
                        "--x-install-root={}",
                        manifest_dir.join("vcpkg_installed").display()
                    ),
                    &format!("--overlay-triplets={}", overlay_triplets.display()),
                ])
                .current_dir(&manifest_dir)
                .status()
                .expect("failed to invoke vcpkg");
            assert!(status.success(), "vcpkg install failed: {status}");
        }

        let vcpkg_installed_root =
            prebuilt_installed_root.unwrap_or_else(|| manifest_dir.join("vcpkg_installed"));
        let vcpkg_installed = vcpkg_installed_root.join(triplet);
        let vcpkg_lib = vcpkg_installed.join("lib");
        let vcpkg_bin = vcpkg_installed.join("bin");

        // 2. Build the C shim via CMake. The `cmake` crate creates an
        //    out-of-tree build rooted under OUT_DIR/usd_c_shim and
        //    returns the install prefix.
        let shim_src = manifest_dir.join("third_party").join("usd_c_shim");
        println!("cargo:rerun-if-changed={}", shim_src.display());
        println!(
            "cargo:rerun-if-changed={}",
            shim_src.join("include").join("usd_c_shim.h").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            shim_src.join("src").join("usd_c_shim.cpp").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            shim_src.join("CMakeLists.txt").display()
        );

        // Force find_package(pxr CONFIG) to resolve against the vcpkg-
        // installed copy. Without `pxr_DIR` pinned, developers who also
        // have a manual OpenUSD build on PATH / CMAKE_PREFIX_PATH /
        // PXR_ROOT end up compiling the shim against their local
        // headers while linking against vcpkg's libraries, which
        // explodes with double-nested PXR_NAMESPACE and cryptic robin-
        // map syntax errors. Pointing `pxr_DIR` at vcpkg's share/pxr
        // short-circuits find_package() and guarantees we see exactly
        // the headers that match the libs the toolchain file links in.
        let pxr_dir = vcpkg_installed.join("share").join("pxr");

        // The `vcpkg install --x-install-root=...` we ran above puts
        // the triplet tree under `src-tauri/vcpkg_installed/`, which
        // is not where the vcpkg CMake toolchain expects to find it
        // by default (it defaults to the *CMake build dir's* vcpkg_
        // installed/ sibling). Without this override, transitive
        // `find_dependency(TBB ...)` calls inside pxrConfig.cmake fail
        // with "Could not find a package configuration file" because
        // the toolchain is looking in a different tree than the one
        // we actually installed into.
        let mut shim_config = cmake::Config::new(&shim_src);
        shim_config
            .profile("Release")
            .define("VCPKG_TARGET_TRIPLET", triplet)
            .define("VCPKG_INSTALLED_DIR", &vcpkg_installed_root)
            .define("pxr_DIR", &pxr_dir);
        if let Some(vcpkg_root) = &vcpkg_root {
            shim_config.define(
                "CMAKE_TOOLCHAIN_FILE",
                vcpkg_root
                    .join("scripts")
                    .join("buildsystems")
                    .join("vcpkg.cmake"),
            );
        } else {
            shim_config.define("CMAKE_PREFIX_PATH", &vcpkg_installed);
        }
        let shim_install = shim_config.build();

        // 3. Generate Rust bindings from the shim's C header. The
        //    allowlist keeps bindgen output tight: only our usdc_*
        //    surface is emitted.
        let header = shim_src.join("include").join("usd_c_shim.h");
        let bindings = bindgen::Builder::default()
            .header(header.to_string_lossy())
            .allowlist_function("usdc_.*")
            .allowlist_type("Usdc.*")
            .allowlist_var("USDC_.*")
            .prepend_enum_name(false)
            .derive_default(true)
            .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
            .generate()
            .expect("bindgen failed to generate usd_c_shim bindings");

        bindings
            .write_to_file(out_dir.join("usd_c_shim_bindings.rs"))
            .expect("failed to write bindings");

        // 4. Emit link directives.
        //
        // Search order: shim first (so our own library resolves before
        // vcpkg's), then vcpkg-installed.
        println!(
            "cargo:rustc-link-search=native={}",
            shim_install.join("lib").display()
        );
        println!(
            "cargo:rustc-link-search=native={}",
            shim_install.join("bin").display()
        );
        println!("cargo:rustc-link-search=native={}", vcpkg_lib.display());
        println!("cargo:rustc-link-search=native={}", vcpkg_bin.display());

        println!("cargo:rustc-link-lib=dylib=usd_c_shim");

        if target_os == "macos" {
            // Ensure the executable can find the shim and its OpenUSD
            // dependency both during local runs and inside a Tauri .app
            // bundle (where shim/dylibs live in Contents/Frameworks).
            println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path");
            println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path/../Frameworks");
        }

        // 5. Stage the libraries into `{src-tauri}/cpp-artifacts/<triplet>/`
        //    so `tauri.<os>.json` can reference them from
        //    `bundle.resources` with a stable, profile-independent
        //    path. This directory is .gitignored; build.rs regenerates
        //    it on every invocation.
        let staging = manifest_dir.join("cpp-artifacts").join(triplet);

        // 5b. Additionally mirror the runtime libraries next to the
        //     dev binaries so `cargo run` / `cargo tauri dev` / `cargo
        //     test` can dynamically load them without a `.app` / `.exe`
        //     bundle layout.
        //
        //     Two target directories matter in dev mode:
        //       - `target/<profile>/`        — the primary Cargo binary
        //         (`yw-look[.exe]`) lives here; on Windows the PE loader
        //         searches this directory first for DLLs referenced by
        //         the EXE.
        //       - `target/<profile>/deps/`   — integration-test binaries
        //         and example binaries run from here; on Windows it is
        //         also the directory rustc uses as the output dir for
        //         cdylib deps of downstream crates.
        //
        //     macOS resolves both through the `-Wl,-rpath,@loader_path`
        //     rpath emitted above (step 4): the loader checks the
        //     binary's own directory, which is either `target/<profile>/`
        //     or `target/<profile>/deps/`.
        //
        //     The location is derived from OUT_DIR so out-of-tree
        //     `CARGO_TARGET_DIR` setups still work. OUT_DIR layout is
        //     `{target_dir}/{profile}/build/{pkg-hash}/out`, so three
        //     parents up yields `{target_dir}/{profile}/`.
        let dev_profile_dir = out_dir
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .map(Path::to_path_buf);
        let dev_deps_dir = dev_profile_dir.as_deref().map(|p| p.join("deps"));

        if target_os == "windows" {
            // Scan the vcpkg bin/ tree for every DLL the shim's pxr
            // transitive closure may load at runtime. Hardcoding an
            // explicit list breaks when the vcpkg `usd` port changes
            // its flavor (e.g. 26.3 stopped shipping a monolithic
            // `usd_ms.dll` and renamed everything to `usd_*.dll` with
            // an explicit prefix — `usd_usd.dll`, `usd_sdf.dll`, ...).
            // A prefix-based scan stays correct through that churn.
            //
            // Prefixes covered:
            //   - `usd_*.dll`      → OpenUSD core + plugin libraries
            //   - `tbb*.dll`       → oneAPI TBB runtime
            //   - `hwloc*.dll`     → TBB's hwloc dependency (cpu topo)
            //   - `zlib1.dll`      → usd's layer compression / USDZ
            //
            // Anything outside these prefixes is ignored. Everything
            // inside is mirrored without needing to know whether the
            // port is monolithic or split.
            let windows_dlls = collect_libs(&vcpkg_bin, "dll", |name| {
                name.starts_with("usd_")
                    || name.starts_with("tbb")
                    || name.starts_with("hwloc")
                    || name == "zlib1.dll"
                    // legacy monolithic flavor, kept for ports that
                    // re-enable it.
                    || name == "usd_ms.dll"
            });
            for src in &windows_dlls {
                copy_into(src, &staging);
            }
            copy_into(&shim_install.join("bin").join("usd_c_shim.dll"), &staging);

            // Plugin tree: the shim registers the `usd/` subtree at
            // startup (see `shim_library_directory()` /
            // `register_plugins_once()` in usd_c_shim.cpp) so OpenUSD
            // can locate the .usda / .usdc file-format plugins that
            // `UsdStage::Open` requires. The plugInfo.json files use
            // a relative LibraryPath of `../../usd_<name>.dll`, which
            // resolves to the sibling DLLs we staged above as long as
            // we keep the tree layout identical.
            let vcpkg_plugin_tree = vcpkg_bin.join("usd");
            mirror_tree(&vcpkg_plugin_tree, &staging.join("usd"));
            write_plugin_manifest(&staging.join("usd"));

            // Mirror into both the dev profile dir (for `cargo run`) and
            // its `deps/` (for integration tests and example binaries).
            // On Windows the PE loader searches the EXE's own directory,
            // so both locations need a copy. Use the tolerant helper
            // because a running dev binary may hold a file lock on the
            // previous DLL.
            for dev_dir in [dev_profile_dir.as_deref(), dev_deps_dir.as_deref()]
                .into_iter()
                .flatten()
            {
                for src in &windows_dlls {
                    copy_into_dev_dir(src, dev_dir);
                }
                copy_into_dev_dir(&shim_install.join("bin").join("usd_c_shim.dll"), dev_dir);
                mirror_tree(&vcpkg_plugin_tree, &dev_dir.join("usd"));
                write_plugin_manifest(&dev_dir.join("usd"));
            }
        } else if target_os == "macos" {
            // macOS stores both versioned and unversioned dylibs under
            // lib/. The Tauri macOS bundler will read Frameworks from
            // here and sign them. See the Windows branch for why we
            // scan by prefix rather than hardcoding filenames.
            let macos_dylibs = collect_libs(&vcpkg_lib, "dylib", |name| {
                name.starts_with("libusd_")
                    || name.starts_with("libtbb")
                    || name.starts_with("libhwloc")
                    || name.starts_with("libz.")
                    || name == "libusd_ms.dylib"
            });
            for src in &macos_dylibs {
                copy_into(src, &staging);
            }
            copy_into(
                &shim_install.join("lib").join("libusd_c_shim.dylib"),
                &staging,
            );

            // Plugin tree (see Windows branch for rationale). On macOS
            // vcpkg places it under `lib/usd/` next to the dylibs.
            let vcpkg_plugin_tree = vcpkg_lib.join("usd");
            mirror_tree(&vcpkg_plugin_tree, &staging.join("usd"));
            write_plugin_manifest(&staging.join("usd"));

            // Mirror into the dev binary directories so the
            // `@loader_path` rpath emitted above resolves every dylib
            // alongside the main binary (`target/<profile>/`) or the
            // test/example binaries (`target/<profile>/deps/`). Use the
            // tolerant helper to stay consistent with the Windows
            // branch; dyld on macOS does not hold exclusive file
            // handles the same way, so failures here are unusual but
            // still treated as soft warnings for symmetry.
            for dev_dir in [dev_profile_dir.as_deref(), dev_deps_dir.as_deref()]
                .into_iter()
                .flatten()
            {
                for src in &macos_dylibs {
                    copy_into_dev_dir(src, dev_dir);
                }
                copy_into_dev_dir(
                    &shim_install.join("lib").join("libusd_c_shim.dylib"),
                    dev_dir,
                );
                mirror_tree(&vcpkg_plugin_tree, &dev_dir.join("usd"));
                write_plugin_manifest(&dev_dir.join("usd"));
            }
        }
    }
}
