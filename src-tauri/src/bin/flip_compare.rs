use std::path::PathBuf;
use std::process::ExitCode;

use nv_flip::{flip, FlipImageRgb8, FlipPool, DEFAULT_PIXELS_PER_DEGREE};

struct Args {
    reference: PathBuf,
    test: PathBuf,
    report: Option<PathBuf>,
    error_map: Option<PathBuf>,
    mean_threshold: f32,
    max_threshold: f32,
    pixels_per_degree: f32,
}

fn parse_args() -> Result<Args, String> {
    let mut args = std::env::args().skip(1);
    let reference = args.next().ok_or_else(|| usage_text())?;
    let test = args.next().ok_or_else(|| usage_text())?;

    let mut report = None;
    let mut error_map = None;
    let mut mean_threshold = 0.05f32;
    let mut max_threshold = 0.30f32;
    let mut pixels_per_degree = DEFAULT_PIXELS_PER_DEGREE;

    loop {
        let Some(key) = args.next() else {
            break;
        };
        match key.as_str() {
            "--report" => {
                report = Some(PathBuf::from(
                    args.next().ok_or("--report requires a path")?,
                ));
            }
            "--error-map" => {
                error_map = Some(PathBuf::from(
                    args.next().ok_or("--error-map requires a path")?,
                ));
            }
            "--mean-threshold" => {
                mean_threshold = args
                    .next()
                    .ok_or("--mean-threshold requires a value")?
                    .parse::<f32>()
                    .map_err(|_| "invalid --mean-threshold")?;
            }
            "--max-threshold" => {
                max_threshold = args
                    .next()
                    .ok_or("--max-threshold requires a value")?
                    .parse::<f32>()
                    .map_err(|_| "invalid --max-threshold")?;
            }
            "--ppd" => {
                pixels_per_degree = args
                    .next()
                    .ok_or("--ppd requires a value")?
                    .parse::<f32>()
                    .map_err(|_| "invalid --ppd")?;
            }
            other => {
                return Err(format!("unknown flag: {other}"));
            }
        }
    }

    Ok(Args {
        reference: PathBuf::from(reference),
        test: PathBuf::from(test),
        report,
        error_map,
        mean_threshold,
        max_threshold,
        pixels_per_degree,
    })
}

fn usage_text() -> String {
    concat!(
        "usage: flip_compare <reference.png> <test.png> [options]\n",
        "\n",
        "Compare two PNG images using NVIDIA FLIP perceptual diff.\n",
        "\n",
        "Options:\n",
        "  --report <path>       Write JSON report to file.\n",
        "  --error-map <path>    Write magma-colored error map PNG.\n",
        "  --mean-threshold <N>  Mean FLIP error threshold (default 0.05).\n",
        "  --max-threshold <N>   Max FLIP error threshold (default 0.30).\n",
        "  --ppd <N>             Pixels per degree of visual angle (default 67).\n",
        "\n",
        "Exit codes: 0=pass, 1=above threshold, 2=error\n",
    )
    .to_string()
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };

    let ref_img = match image::open(&args.reference) {
        Ok(img) => img.into_rgb8(),
        Err(e) => {
            eprintln!("cannot open reference {}: {e}", args.reference.display());
            return ExitCode::from(2);
        }
    };
    let test_img = match image::open(&args.test) {
        Ok(img) => img.into_rgb8(),
        Err(e) => {
            eprintln!("cannot open test {}: {e}", args.test.display());
            return ExitCode::from(2);
        }
    };

    if ref_img.width() != test_img.width() || ref_img.height() != test_img.height() {
        eprintln!(
            "dimension mismatch: reference {}x{} vs test {}x{}",
            ref_img.width(),
            ref_img.height(),
            test_img.width(),
            test_img.height(),
        );
        return ExitCode::from(1);
    }

    let ref_flip =
        FlipImageRgb8::with_data(ref_img.width(), ref_img.height(), &ref_img);
    let test_flip =
        FlipImageRgb8::with_data(test_img.width(), test_img.height(), &test_img);

    let error_map = flip(ref_flip, test_flip, args.pixels_per_degree);
    let mut pool = FlipPool::from_image(&error_map);

    let mean = pool.mean();
    let max = pool.max_value();
    let min = pool.min_value();
    let p25 = pool.get_percentile(0.25, true);
    let p50 = pool.get_percentile(0.50, true);
    let p75 = pool.get_percentile(0.75, true);

    let passed = mean <= args.mean_threshold && max <= args.max_threshold;

    if let Some(ref path) = args.error_map {
        let visualized = error_map.apply_color_lut(&nv_flip::magma_lut());
        let img = image::RgbImage::from_raw(
            visualized.width(),
            visualized.height(),
            visualized.to_vec(),
        )
        .expect("error map dimensions");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = img.save(path) {
            eprintln!("cannot save error map {}: {e}", path.display());
        }
    }

    let report = serde_json::json!({
        "passed": passed,
        "mean": mean,
        "max": max,
        "min": min,
        "p25": p25,
        "p50": p50,
        "p75": p75,
        "threshold_mean": args.mean_threshold,
        "threshold_max": args.max_threshold,
        "pixels_per_degree": args.pixels_per_degree,
        "reference": args.reference.to_string_lossy(),
        "test": args.test.to_string_lossy(),
    });

    if let Some(ref path) = args.report {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(&report).unwrap_or_default();
        if let Err(e) = std::fs::write(path, &json) {
            eprintln!("cannot write report {}: {e}", path.display());
        }
    }

    println!(
        "{}",
        serde_json::to_string(&report).unwrap_or_default()
    );

    if passed {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}
