fn main() {
    tauri_build::build();

    #[cfg(feature = "backend-openusd-cpp")]
    cpp_backend::build();
}

#[cfg(feature = "backend-openusd-cpp")]
mod cpp_backend {
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

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

        let vcpkg_root = PathBuf::from(
            env::var("VCPKG_ROOT").expect("VCPKG_ROOT is not set. See docs/usd-cpp.md for setup."),
        );
        println!("cargo:rerun-if-env-changed=VCPKG_ROOT");
        println!("cargo:rerun-if-env-changed=VCPKG_BINARY_SOURCES");
        println!("cargo:rerun-if-env-changed=LIBCLANG_PATH");

        // Treat the manifest files as first-class build inputs: if a
        // developer bumps the baseline SHA or the usd version>=
        // constraint, Cargo needs to rerun the build script so vcpkg
        // picks up the change. Without these declarations Cargo only
        // reruns on source-file changes and we'd ship stale libs.
        println!(
            "cargo:rerun-if-changed={}",
            manifest_dir.join("vcpkg.json").display()
        );
        println!(
            "cargo:rerun-if-changed={}",
            manifest_dir.join("vcpkg-configuration.json").display()
        );

        // 1. Invoke vcpkg in manifest mode. Classic vcpkg users may
        //    not be used to this, but it's the mode the vcpkg.json +
        //    vcpkg-configuration.json files at `manifest_dir` express.
        //    `--x-manifest-root` picks up those two files.
        //    On first run this builds OpenUSD from source (30-60 min);
        //    subsequent runs restore from the vcpkg binary cache.
        let status = Command::new(vcpkg_exe(&vcpkg_root, &target_os))
            .args([
                "install",
                "--x-manifest-root=.",
                &format!("--triplet={triplet}"),
                &format!(
                    "--x-install-root={}",
                    manifest_dir.join("vcpkg_installed").display()
                ),
            ])
            .current_dir(&manifest_dir)
            .status()
            .expect("failed to invoke vcpkg");
        assert!(status.success(), "vcpkg install failed: {status}");

        let vcpkg_installed = manifest_dir.join("vcpkg_installed").join(triplet);
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
        let vcpkg_installed_root = manifest_dir.join("vcpkg_installed");

        let shim_install = cmake::Config::new(&shim_src)
            .profile("Release")
            .define(
                "CMAKE_TOOLCHAIN_FILE",
                vcpkg_root
                    .join("scripts")
                    .join("buildsystems")
                    .join("vcpkg.cmake"),
            )
            .define("VCPKG_TARGET_TRIPLET", triplet)
            .define("VCPKG_INSTALLED_DIR", &vcpkg_installed_root)
            .define("pxr_DIR", &pxr_dir)
            .build();

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
