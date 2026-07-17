fn main() {
    // Updater defaults are baked in via `option_env!` in lib.rs; tell Cargo
    // to rebuild if they change so local builds do not use stale endpoints.
    println!("cargo:rerun-if-env-changed=YW_LOOK_UPDATER_ENDPOINT");
    println!("cargo:rerun-if-env-changed=YW_LOOK_UPDATER_PUBLIC_KEY");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").expect("CARGO_CFG_TARGET_OS");
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH");
    let triplet = match (target_os.as_str(), target_arch.as_str()) {
        ("windows", "x86_64") => "x64-windows",
        ("macos", "aarch64") => "arm64-osx",
        _ => "",
    };
    let manifest_dir =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let vcpkg_root = discover_vcpkg_root(&target_os);
    let overlay_triplets = manifest_dir.join("triplets");

    // The repository ships the preview helper for normal builds. These
    // functions retain the explicit vcpkg/CMake regeneration path for
    // developers who set ALEMBIC_FORCE_BUILD=1 or replace a helper binary.
    ensure_windows_alembic_helper(
        &manifest_dir,
        &target_os,
        triplet,
        vcpkg_root.as_ref(),
        &overlay_triplets,
    );
    ensure_macos_alembic_helper(
        &manifest_dir,
        &target_os,
        triplet,
        vcpkg_root.as_ref(),
        &overlay_triplets,
    );

    tauri_build::build();
}

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn vcpkg_exe(vcpkg_root: &Path, target_os: &str) -> PathBuf {
    if target_os == "windows" {
        vcpkg_root.join("vcpkg.exe")
    } else {
        vcpkg_root.join("vcpkg")
    }
}

fn discover_vcpkg_root(target_os: &str) -> Option<PathBuf> {
    if let Some(root) = env::var_os("VCPKG_ROOT").map(PathBuf::from) {
        return Some(root);
    }

    let mut candidates = Vec::new();
    if target_os == "windows" {
        if let Some(home) = env::var_os("USERPROFILE").map(PathBuf::from) {
            candidates.push(home.join("vcpkg"));
            candidates.push(home.join(".vcpkg"));
        }
    } else if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".vcpkg"));
        candidates.push(home.join("vcpkg"));
    }

    candidates
        .into_iter()
        .find(|candidate| vcpkg_exe(candidate, target_os).exists())
}

fn run_vcpkg_install(
    manifest_dir: &Path,
    vcpkg_root: &Path,
    target_os: &str,
    triplet: &str,
    install_root: &Path,
    overlay_triplets: &Path,
) {
    let status = Command::new(vcpkg_exe(vcpkg_root, target_os))
        .args([
            "install",
            "--x-manifest-root=.",
            &format!("--triplet={triplet}"),
            &format!("--x-install-root={}", install_root.display()),
            &format!("--overlay-triplets={}", overlay_triplets.display()),
        ])
        .current_dir(manifest_dir)
        .status()
        .unwrap_or_else(|e| panic!("failed to invoke vcpkg for the Alembic helper: {e}"));
    assert!(status.success(), "vcpkg install failed: {status}");
}

fn should_force_alembic_tool_build() -> bool {
    matches!(
        env::var("ALEMBIC_FORCE_BUILD").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    )
}

fn executable_from_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.exists())
}

fn ninja_path() -> Option<PathBuf> {
    let from_path = executable_from_path("ninja.exe").or_else(|| executable_from_path("ninja"));
    if from_path.is_some() {
        return from_path;
    }
    env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| {
            home.join("AppData")
                .join("Local")
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join("ninja.exe")
        })
        .filter(|candidate| candidate.exists())
}

fn visual_studio_dev_env() -> Option<Vec<(String, String)>> {
    let candidates = [
        Path::new(
            r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
        ),
        Path::new(
            r"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
        ),
        Path::new(
            r"C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
        ),
        Path::new(
            r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat",
        ),
        Path::new(
            r"C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat",
        ),
        Path::new(
            r"C:\Program Files\Microsoft Visual Studio\18\Professional\Common7\Tools\VsDevCmd.bat",
        ),
        Path::new(
            r"C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\Tools\VsDevCmd.bat",
        ),
    ];
    for script_path in candidates {
        if !script_path.exists() {
            continue;
        }
        let script = format!(
            "call \"{}\" -arch=x64 -host_arch=x64 >nul && set",
            script_path.display()
        );
        let mut command = Command::new("cmd");
        #[cfg(windows)]
        command.raw_arg(format!("/d /c {script}"));
        #[cfg(not(windows))]
        command.args(["/d", "/c", &script]);
        let output = command.output().ok()?;
        if !output.status.success() {
            continue;
        }
        let keep = [
            "PATH",
            "INCLUDE",
            "LIB",
            "LIBPATH",
            "VCToolsInstallDir",
            "VSINSTALLDIR",
            "WindowsSdkDir",
            "WindowsSDKLibVersion",
            "WindowsSDKVersion",
            "UCRTVersion",
            "ExtensionSdkDir",
        ];
        let values = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.split_once('='))
            .filter(|(key, _)| keep.iter().any(|name| key.eq_ignore_ascii_case(name)))
            .map(|(key, value)| (key.to_owned(), value.to_owned()))
            .collect::<Vec<_>>();
        if !values.is_empty() {
            return Some(values);
        }
    }
    None
}

fn collect_libs(dir: &Path, ext: &str, accept: impl Fn(&str) -> bool) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let ext_lower = ext.to_ascii_lowercase();
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let matches_ext = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase() == ext_lower)
            .unwrap_or(false);
        if matches_ext && accept(name) {
            out.push(path);
        }
    }
    out.sort();
    out
}

fn find_first_matching_lib(dir: &Path, prefix: &str, ext: &str) -> Option<PathBuf> {
    collect_libs(dir, ext, |name| name.starts_with(prefix))
        .into_iter()
        .next()
}

fn ensure_windows_alembic_helper(
    manifest_dir: &Path,
    target_os: &str,
    triplet: &str,
    vcpkg_root: Option<&PathBuf>,
    overlay_triplets: &Path,
) {
    if target_os != "windows" || triplet != "x64-windows" {
        return;
    }

    let tool_src = manifest_dir.join("alembic-tools/src/abc_to_obj.cpp");
    let tool_dir = manifest_dir.join("alembic-tools/x64-windows");
    let tool_path = tool_dir.join("abc_to_obj.exe");
    println!("cargo:rerun-if-env-changed=ALEMBIC_FORCE_BUILD");
    println!("cargo:rerun-if-changed={}", tool_src.display());

    if tool_path.exists() && !should_force_alembic_tool_build() {
        println!(
            "cargo:warning=using bundled Alembic preview helper: {}",
            tool_path.display()
        );
        return;
    }

    let vcpkg_root = vcpkg_root
        .map(PathBuf::as_path)
        .expect("VCPKG_ROOT is not set. Building the Alembic preview helper requires vcpkg.");
    let install_root = manifest_dir.join("vcpkg_installed");
    run_vcpkg_install(
        manifest_dir,
        vcpkg_root,
        target_os,
        triplet,
        &install_root,
        overlay_triplets,
    );

    let mut config = cmake::Config::new(manifest_dir.join("alembic-tools/src"));
    if let Some((ninja, env_values)) =
        ninja_path().and_then(|ninja| visual_studio_dev_env().map(|env| (ninja, env)))
    {
        println!(
            "cargo:warning=building Alembic preview helper with Ninja: {}",
            ninja.display()
        );
        config.generator("Ninja");
        config.define("CMAKE_MAKE_PROGRAM", &ninja);
        for (key, value) in &env_values {
            config.env(key, value);
        }
    }
    let cmake_out = config
        .profile("Release")
        .define("VCPKG_TARGET_TRIPLET", triplet)
        .define("VCPKG_INSTALLED_DIR", &install_root)
        .define(
            "CMAKE_TOOLCHAIN_FILE",
            vcpkg_root.join("scripts/buildsystems/vcpkg.cmake"),
        )
        .build();

    let built_exe = ["bin", "."]
        .iter()
        .map(|sub| cmake_out.join(sub).join("abc_to_obj.exe"))
        .find(|path| path.exists())
        .unwrap_or_else(|| {
            panic!(
                "CMake build succeeded but abc_to_obj.exe was not found under {}",
                cmake_out.display()
            )
        });
    fs::create_dir_all(&tool_dir)
        .unwrap_or_else(|e| panic!("failed to create {}: {e}", tool_dir.display()));
    fs::copy(&built_exe, &tool_path).unwrap_or_else(|e| {
        panic!(
            "failed to copy Alembic helper {} -> {}: {e}",
            built_exe.display(),
            tool_path.display()
        )
    });

    let vcpkg_bin = install_root.join(triplet).join("bin");
    for dll_name in ["Alembic.dll", "Imath-3_2.dll"] {
        let src = vcpkg_bin.join(dll_name);
        let dst = tool_dir.join(dll_name);
        if src.exists() {
            fs::copy(&src, &dst).unwrap_or_else(|e| {
                panic!("failed to copy {} -> {}: {e}", src.display(), dst.display())
            });
        }
    }
    println!(
        "cargo:warning=rebuilt Alembic preview helper: {}",
        tool_path.display()
    );
}

fn ensure_macos_alembic_helper(
    manifest_dir: &Path,
    target_os: &str,
    triplet: &str,
    vcpkg_root: Option<&PathBuf>,
    overlay_triplets: &Path,
) {
    if target_os != "macos" || triplet != "arm64-osx" {
        return;
    }

    let tool_src = manifest_dir.join("alembic-tools/src/abc_to_obj.cpp");
    let tool_dir = manifest_dir.join("alembic-tools/arm64-osx");
    let tool_path = tool_dir.join("abc_to_obj");
    println!("cargo:rerun-if-env-changed=ALEMBIC_FORCE_BUILD");
    println!("cargo:rerun-if-changed={}", tool_src.display());

    if tool_path.exists() && !should_force_alembic_tool_build() {
        println!(
            "cargo:warning=using bundled Alembic preview helper: {}",
            tool_path.display()
        );
        return;
    }

    let vcpkg_root = vcpkg_root
        .map(PathBuf::as_path)
        .expect("VCPKG_ROOT is not set. Building the Alembic preview helper requires vcpkg.");
    let install_root = manifest_dir.join("vcpkg_installed");
    run_vcpkg_install(
        manifest_dir,
        vcpkg_root,
        target_os,
        triplet,
        &install_root,
        overlay_triplets,
    );

    let include_dir = install_root.join(triplet).join("include");
    let lib_dir = install_root.join(triplet).join("lib");
    let alembic_lib = find_first_matching_lib(&lib_dir, "libAlembic", "a")
        .unwrap_or_else(|| panic!("missing static Alembic library under {}", lib_dir.display()));
    let imath_lib = find_first_matching_lib(&lib_dir, "libImath", "a")
        .unwrap_or_else(|| panic!("missing static Imath library under {}", lib_dir.display()));

    fs::create_dir_all(&tool_dir)
        .unwrap_or_else(|e| panic!("failed to create {}: {e}", tool_dir.display()));
    let status = Command::new("clang++")
        .args([
            "-std=c++17",
            "-O2",
            "-I",
            include_dir.to_str().expect("valid include path"),
            tool_src.to_str().expect("valid Alembic helper source path"),
            alembic_lib.to_str().expect("valid Alembic library path"),
            imath_lib.to_str().expect("valid Imath library path"),
            "-lz",
            "-o",
            tool_path.to_str().expect("valid helper output path"),
        ])
        .status()
        .expect("failed to invoke clang++ for the Alembic preview helper");
    assert!(
        status.success(),
        "failed to build Alembic preview helper: {status}"
    );

    let status = Command::new("codesign")
        .args([
            "--force",
            "--sign",
            "-",
            tool_path.to_str().expect("valid tool path"),
        ])
        .status()
        .expect("failed to invoke codesign for the Alembic preview helper");
    assert!(
        status.success(),
        "failed to ad-hoc sign Alembic preview helper: {status}"
    );

    let output = Command::new("otool")
        .args(["-L", tool_path.to_str().expect("valid tool path")])
        .output()
        .expect("failed to inspect Alembic preview helper dylib dependencies");
    assert!(
        output.status.success(),
        "failed to inspect Alembic preview helper dylib dependencies: {}",
        output.status
    );
    let linked = String::from_utf8_lossy(&output.stdout);
    assert!(
        !linked.contains("libAlembic") && !linked.contains("libImath"),
        "Alembic preview helper must statically link Alembic and Imath:\n{linked}"
    );
}
