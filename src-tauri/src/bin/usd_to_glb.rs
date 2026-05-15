// Offline USD → GLB converter used by `scripts/preview-model.mjs`.
//
// yw-look's production path routes USD through the Tauri backend, so
// the Vite dev server (which the preview-model skill drives) cannot
// reach it. This bin bridges the gap: it reuses the same
// `OpenusdBackend::extract_geometry_glb` pipeline that the Tauri
// command uses, writes a `.glb` to disk, and hands the path back so
// the skill can feed it to the existing GLB preview flow.
//
// Keeping this as a bin (rather than a fresh crate) lets the skill
// exercise the actual Phase 6/7 code paths — normal maps, UsdTransform2d,
// morph targets, KHR_lights_punctual, cameras — without forking logic.

use std::{path::PathBuf, process::ExitCode};

use yw_look_lib::usd::{DefaultBackend, StageLoadPolicy, UsdGeometryBackend};

fn main() -> ExitCode {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let policy = if args.first().is_some_and(|arg| arg == "--no-payloads") {
        args.remove(0);
        StageLoadPolicy::NoPayloads
    } else {
        StageLoadPolicy::LoadAll
    };
    if args.len() != 2 {
        return usage();
    }
    let input = &args[0];
    let output = &args[1];

    let input_path = PathBuf::from(&input);
    if !input_path.exists() {
        eprintln!("input not found: {}", input_path.display());
        return ExitCode::from(1);
    }

    let backend = DefaultBackend::new();
    let bytes = match backend.extract_geometry_glb(&input_path, policy) {
        Ok(v) => v,
        Err(err) => {
            eprintln!("extract_geometry_glb failed: {err:?}");
            return ExitCode::from(1);
        }
    };

    if let Err(err) = std::fs::write(&output, &bytes) {
        eprintln!("write {} failed: {err}", output);
        return ExitCode::from(1);
    }

    println!("{}", output);
    ExitCode::SUCCESS
}

fn usage() -> ExitCode {
    eprintln!("usage: usd_to_glb [--no-payloads] <input.usd|usda|usdc|usdz> <output.glb>");
    ExitCode::from(2)
}
