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
            panic!("failed to copy {} -> {}: {}", src.display(), dst.display(), e)
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
            env::var("VCPKG_ROOT")
                .expect("VCPKG_ROOT is not set. See docs/usd-cpp.md for setup."),
        );
        println!("cargo:rerun-if-env-changed=VCPKG_ROOT");
        println!("cargo:rerun-if-env-changed=VCPKG_BINARY_SOURCES");

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
                &format!("--x-install-root={}", manifest_dir.join("vcpkg_installed").display()),
            ])
            .current_dir(&manifest_dir)
            .status()
            .expect("failed to invoke vcpkg");
        assert!(status.success(), "vcpkg install failed: {status}");

        let vcpkg_installed = manifest_dir.join("vcpkg_installed").join(triplet);
        let vcpkg_include = vcpkg_installed.join("include");
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

        if target_os == "windows" {
            // Windows ships DLLs in bin/ and import libs in lib/. We
            // only need the runtime DLLs in the bundle.
            for name in [
                "usd_ms.dll",
                "tbb12.dll",
                "tbb.dll",
                "usd.dll",
                "usdGeom.dll",
                "usdShade.dll",
            ] {
                copy_into(&vcpkg_bin.join(name), &staging);
            }
            copy_into(&shim_install.join("bin").join("usd_c_shim.dll"), &staging);
        } else if target_os == "macos" {
            // macOS stores both versioned and unversioned dylibs under
            // lib/. The Tauri macOS bundler will read Frameworks from
            // here and sign them.
            for name in [
                "libusd_ms.dylib",
                "libtbb.12.dylib",
                "libtbb.dylib",
                "libusd.dylib",
                "libusdGeom.dylib",
                "libusdShade.dylib",
            ] {
                copy_into(&vcpkg_lib.join(name), &staging);
            }
            copy_into(&shim_install.join("lib").join("libusd_c_shim.dylib"), &staging);
        }
    }
}
