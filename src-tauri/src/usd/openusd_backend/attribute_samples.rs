//! Time-sample inspection for the OpenUSD Rust backend.
//!
//! This module deliberately uses only the public `openusd` stage/prim/attribute
//! handles. Numeric statistics intentionally ignore non-scalar samples: the
//! inspector reports scalar values when present, while arrays and other values
//! remain useful through their bounded summaries without poisoning the stats.

use openusd::sdf::{Path as SdfPath, PathComponent, Value as SdfValue};
use openusd::usd::{Stage, TimeCode};

use super::super::backend::UsdError;
use super::super::types::{AttributeTimeSamples, TimeSampleEntry};
use super::stage_fields::ValidatedStagePathExt;

const MAX_STRING_SUMMARY_CHARS: usize = 256;

/// Inspect authored time samples for one composed attribute.
pub(super) fn inspect_attribute_time_samples(
    stage: &Stage,
    prim_path: &str,
    attr_name: &str,
    max_samples: usize,
) -> Result<AttributeTimeSamples, UsdError> {
    let prim_path_value = parse_prim_path(prim_path)?;
    let prim = stage.prim_at(prim_path_value.clone());
    let prim_valid = prim.is_valid().map_err(|error| {
        parse_error(
            prim_path,
            attr_name,
            None,
            format!("could not resolve prim: {error}"),
        )
    })?;
    if !prim_valid {
        return Err(parse_error(
            prim_path,
            attr_name,
            None,
            "prim does not exist",
        ));
    }

    validate_attribute_name(prim_path, attr_name)?;
    let attr_path = prim_path_value
        .append_property(attr_name)
        .map_err(|error| {
            parse_error(
                prim_path,
                attr_name,
                None,
                format!("invalid attribute property path: {error}"),
            )
        })?;
    if !attr_path.is_property_path() {
        return Err(parse_error(
            prim_path,
            attr_name,
            None,
            "attribute did not produce a property path",
        ));
    }

    // `Prim::attributes` is the public composed-property query. Checking the
    // returned paths distinguishes a missing attribute from an attribute with
    // no authored default or time samples.
    let has_attribute = prim
        .attributes()
        .map_err(|error| {
            parse_error(
                prim_path,
                attr_name,
                None,
                format!("could not enumerate composed attributes: {error}"),
            )
        })?
        .into_iter()
        .any(|candidate| candidate.path() == &attr_path);
    if !has_attribute {
        return Err(parse_error(
            prim_path,
            attr_name,
            None,
            "attribute does not exist on prim",
        ));
    }

    // Resolve through the stage-level public attribute handle rather than
    // reaching into Sdf layer data. This also preserves composed/retimed
    // samples from references and payloads.
    let attribute = stage.attribute_at(attr_path);
    let total_count = attribute.num_time_samples().map_err(|error| {
        parse_error(
            prim_path,
            attr_name,
            None,
            format!("could not count time samples: {error}"),
        )
    })?;
    if max_samples == 0 || total_count == 0 {
        return Ok(AttributeTimeSamples {
            prim_path: prim_path.to_owned(),
            attribute_name: attr_name.to_owned(),
            samples: Vec::new(),
            total_count,
            numeric_min: None,
            numeric_max: None,
            numeric_mean: None,
        });
    }

    let query = attribute.query();
    let mut times = query.time_sample_times().map_err(|error| {
        parse_error(
            prim_path,
            attr_name,
            None,
            format!("could not read time sample times: {error}"),
        )
    })?;
    if times.len() != total_count {
        return Err(parse_error(
            prim_path,
            attr_name,
            None,
            format!(
                "time sample count changed while reading (count={total_count}, times={})",
                times.len()
            ),
        ));
    }
    for time in &times {
        if !time.is_finite() {
            return Err(parse_error(
                prim_path,
                attr_name,
                Some(*time),
                "time sample key is not finite",
            ));
        }
    }
    times.sort_by(f64::total_cmp);

    let returned_count = max_samples.min(total_count);
    let mut entries = Vec::with_capacity(returned_count);
    let mut numeric_values = Vec::new();
    for time in times.into_iter().take(returned_count) {
        let value = query
            .get_at::<SdfValue>(Some(TimeCode::new(time)))
            .map_err(|error| {
                parse_error(
                    prim_path,
                    attr_name,
                    Some(time),
                    format!("could not read sample value: {error}"),
                )
            })?
            .ok_or_else(|| {
                parse_error(
                    prim_path,
                    attr_name,
                    Some(time),
                    "sample value resolved to None",
                )
            })?;
        if let Some(number) = scalar_numeric(&value) {
            // Ignore non-finite scalar values so a malformed value cannot
            // poison min/max/mean or serialize NaN/Infinity into the IPC JSON.
            if number.is_finite() {
                numeric_values.push(number);
            }
        }
        entries.push(TimeSampleEntry {
            time,
            value_summary: value_summary(&value),
        });
    }

    let (numeric_min, numeric_max, numeric_mean) = numeric_stats(&numeric_values);
    Ok(AttributeTimeSamples {
        prim_path: prim_path.to_owned(),
        attribute_name: attr_name.to_owned(),
        samples: entries,
        total_count,
        numeric_min,
        numeric_max,
        numeric_mean,
    })
}

fn parse_prim_path(prim_path: &str) -> Result<SdfPath, UsdError> {
    let path = SdfPath::new(prim_path)
        .map_err(|error| parse_error(prim_path, "", None, format!("invalid prim path: {error}")))?;
    if !path.is_abs() || path.is_abs_root() || path.is_property_path() {
        return Err(parse_error(
            prim_path,
            "",
            None,
            "invalid prim path: must be a non-root absolute prim path",
        ));
    }
    let mut components = path.components();
    for component in components.by_ref() {
        match component {
            PathComponent::Prim(name) => {
                if !SdfPath::is_valid_identifier(name) {
                    return Err(parse_error(
                        prim_path,
                        "",
                        None,
                        format!("invalid prim component '{name}'"),
                    ));
                }
            }
            PathComponent::Variant { set, selection } => {
                if !SdfPath::is_valid_identifier(set) || !SdfPath::is_valid_identifier(selection) {
                    return Err(parse_error(
                        prim_path,
                        "",
                        None,
                        "invalid variant selection in prim path",
                    ));
                }
            }
        }
    }
    if !components.remainder().is_empty() || path.is_prim_variant_selection_path() {
        return Err(parse_error(
            prim_path,
            "",
            None,
            "prim path contains malformed or non-prim syntax",
        ));
    }
    Ok(path)
}

fn validate_attribute_name(prim_path: &str, attr_name: &str) -> Result<(), UsdError> {
    if attr_name.is_empty()
        || attr_name.contains(['.', '/', '[', ']'])
        || attr_name.split(':').any(str::is_empty)
        || !SdfPath::is_valid_namespace_identifier(attr_name)
    {
        return Err(parse_error(
            prim_path,
            attr_name,
            None,
            "invalid attribute name/property path",
        ));
    }
    Ok(())
}

fn parse_error(
    prim_path: &str,
    attr_name: &str,
    time: Option<f64>,
    detail: impl std::fmt::Display,
) -> UsdError {
    let time_context = time
        .map(|value| format!(" time={value}"))
        .unwrap_or_default();
    UsdError::Parse(format!(
        "attribute sample query failed prim='{prim_path}' attribute='{attr_name}'{time_context}: {detail}"
    ))
}

fn scalar_numeric(value: &SdfValue) -> Option<f64> {
    match value {
        SdfValue::Uchar(value) => Some(*value as f64),
        SdfValue::Int(value) => Some(*value as f64),
        SdfValue::Uint(value) => Some(*value as f64),
        SdfValue::Int64(value) => Some(*value as f64),
        SdfValue::Uint64(value) => Some(*value as f64),
        SdfValue::Half(value) => Some(value.to_f32() as f64),
        SdfValue::Float(value) => Some(*value as f64),
        SdfValue::Double(value) => Some(*value),
        _ => None,
    }
}

fn numeric_stats(values: &[f64]) -> (Option<f64>, Option<f64>, Option<f64>) {
    let mut count = 0usize;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut mean = 0.0;
    for value in values.iter().copied().filter(|value| value.is_finite()) {
        count += 1;
        min = min.min(value);
        max = max.max(value);
        // Normalize before weighting so opposite f64::MAX values and
        // same-sign extremes never overflow an intermediate sum.
        if count == 1 {
            mean = value;
        } else {
            let scale = mean.abs().max(value.abs());
            if scale != 0.0 {
                let n = count as f64;
                mean = (mean / scale * ((n - 1.0) / n) + value / scale / n) * scale;
            }
        }
    }
    if count == 0 {
        (None, None, None)
    } else {
        (Some(min), Some(max), Some(mean))
    }
}

fn bounded_string(value: &str) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(MAX_STRING_SUMMARY_CHARS).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

pub(super) fn value_summary(value: &SdfValue) -> String {
    match value {
        SdfValue::None => "<none>".to_owned(),
        SdfValue::ValueBlock => "<value block>".to_owned(),
        SdfValue::Bool(value) => value.to_string(),
        SdfValue::Uchar(value) => value.to_string(),
        SdfValue::Int(value) => value.to_string(),
        SdfValue::Uint(value) => value.to_string(),
        SdfValue::Int64(value) => value.to_string(),
        SdfValue::Uint64(value) => value.to_string(),
        SdfValue::Half(value) => value.to_f32().to_string(),
        SdfValue::Float(value) => value.to_string(),
        SdfValue::Double(value) => value.to_string(),
        SdfValue::String(value) => bounded_string(value),
        SdfValue::Token(value) => bounded_string(value.as_str()),
        SdfValue::AssetPath(value) => bounded_string(value.as_str()),
        SdfValue::BoolVec(values) => array_summary(values.len()),
        SdfValue::UcharVec(values) => array_summary(values.len()),
        SdfValue::IntVec(values) => array_summary(values.len()),
        SdfValue::UintVec(values) => array_summary(values.len()),
        SdfValue::Int64Vec(values) => array_summary(values.len()),
        SdfValue::Uint64Vec(values) => array_summary(values.len()),
        SdfValue::HalfVec(values) => array_summary(values.len()),
        SdfValue::FloatVec(values) => array_summary(values.len()),
        SdfValue::DoubleVec(values) => array_summary(values.len()),
        SdfValue::StringVec(values) => array_summary(values.len()),
        SdfValue::TokenVec(values) => array_summary(values.len()),
        SdfValue::AssetPathVec(values) => array_summary(values.len()),
        SdfValue::QuathVec(values) => array_summary(values.len()),
        SdfValue::QuatfVec(values) => array_summary(values.len()),
        SdfValue::QuatdVec(values) => array_summary(values.len()),
        SdfValue::Vec2hVec(values) => array_summary(values.len()),
        SdfValue::Vec2fVec(values) => array_summary(values.len()),
        SdfValue::Vec2dVec(values) => array_summary(values.len()),
        SdfValue::Vec2iVec(values) => array_summary(values.len()),
        SdfValue::Vec3hVec(values) => array_summary(values.len()),
        SdfValue::Vec3fVec(values) => array_summary(values.len()),
        SdfValue::Vec3dVec(values) => array_summary(values.len()),
        SdfValue::Vec3iVec(values) => array_summary(values.len()),
        SdfValue::Vec4hVec(values) => array_summary(values.len()),
        SdfValue::Vec4fVec(values) => array_summary(values.len()),
        SdfValue::Vec4dVec(values) => array_summary(values.len()),
        SdfValue::Vec4iVec(values) => array_summary(values.len()),
        SdfValue::Matrix2dVec(values) => array_summary(values.len()),
        SdfValue::Matrix3dVec(values) => array_summary(values.len()),
        SdfValue::Matrix4dVec(values) => array_summary(values.len()),
        SdfValue::PathVec(values) => array_summary(values.len()),
        SdfValue::TimeCodeVec(values) => array_summary(values.len()),
        SdfValue::ValueVec(values) => array_summary(values.len()),
        SdfValue::Quatf(_) => "<quatf>".to_owned(),
        SdfValue::Quatd(_) => "<quatd>".to_owned(),
        SdfValue::Quath(_) => "<quath>".to_owned(),
        SdfValue::Vec2h(_) => "<vec2h>".to_owned(),
        SdfValue::Vec2f(_) => "<vec2f>".to_owned(),
        SdfValue::Vec2d(_) => "<vec2d>".to_owned(),
        SdfValue::Vec2i(_) => "<vec2i>".to_owned(),
        SdfValue::Vec3h(_) => "<vec3h>".to_owned(),
        SdfValue::Vec3f(_) => "<vec3f>".to_owned(),
        SdfValue::Vec3d(_) => "<vec3d>".to_owned(),
        SdfValue::Vec3i(_) => "<vec3i>".to_owned(),
        SdfValue::Vec4h(_) => "<vec4h>".to_owned(),
        SdfValue::Vec4f(_) => "<vec4f>".to_owned(),
        SdfValue::Vec4d(_) => "<vec4d>".to_owned(),
        SdfValue::Vec4i(_) => "<vec4i>".to_owned(),
        SdfValue::Matrix2d(_) => "<matrix2d>".to_owned(),
        SdfValue::Matrix3d(_) => "<matrix3d>".to_owned(),
        SdfValue::Matrix4d(_) => "<matrix4d>".to_owned(),
        SdfValue::Dictionary(values) => format!("<dictionary with {} entries>", values.len()),
        SdfValue::TimeSamples(values) => format!("<timeSamples with {} entries>", values.len()),
        SdfValue::TimeCode(value) => format!("<timeCode {}>", value.value()),
        _ => "<unsupported value>".to_owned(),
    }
}

fn array_summary(length: usize) -> String {
    format!("[{length} elements]")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usd::types::StageLoadPolicy;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_FIXTURE_ID: AtomicUsize = AtomicUsize::new(0);

    fn fixture_dir() -> PathBuf {
        let id = NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "yw-look-attribute-samples-{}-{id}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create fixture directory");
        dir
    }

    fn fixture_path(name: &str, source: &str) -> PathBuf {
        let dir = fixture_dir();
        let path = dir.join(name);
        std::fs::write(&path, source).expect("write fixture");
        path
    }

    fn layered_fixture(weak_source: &str, root_source: &str) -> PathBuf {
        let dir = fixture_dir();
        std::fs::write(dir.join("weak.usda"), weak_source).expect("write weak fixture");
        let root = dir.join("root.usda");
        std::fs::write(&root, root_source).expect("write root fixture");
        root
    }

    fn timed_fixture() -> PathBuf {
        fixture_path(
            "tiny_timed.usda",
            r#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root"
{
    double sampled = 99.0
    double sampled.timeSamples = {
        0: 1.5,
        12: 3.0,
        24: 4.5,
    }
}
"#,
        )
    }

    fn inspect(path: &PathBuf, max_samples: usize) -> AttributeTimeSamples {
        let stage = super::super::super::OpenusdBackend::open(path, StageLoadPolicy::LoadAll)
            .expect("open timed fixture");
        inspect_attribute_time_samples(&stage, "/Root", "sampled", max_samples)
            .expect("inspect time samples")
    }

    // A default is authored alongside time samples in the same layer;
    // exact-time query reads must still return the authored samples.
    #[test]
    fn inspect_attribute_time_samples_respects_limit_stats_and_coexisting_default() {
        let path = timed_fixture();
        let result = inspect(&path, 2);
        assert_eq!(
            result
                .samples
                .iter()
                .map(|sample| sample.time)
                .collect::<Vec<_>>(),
            vec![0.0, 12.0]
        );
        assert_eq!(
            result
                .samples
                .iter()
                .map(|sample| sample.value_summary.as_str())
                .collect::<Vec<_>>(),
            vec!["1.5", "3"]
        );
        assert_eq!(result.total_count, 3);
        assert_eq!(
            (result.numeric_min, result.numeric_max, result.numeric_mean),
            (Some(1.5), Some(3.0), Some(2.25))
        );
        assert!(result.samples.len() < result.total_count);
    }

    #[test]
    fn inspect_attribute_time_samples_returns_all_when_limit_is_large() {
        let path = timed_fixture();
        let result = inspect(&path, 3);
        assert_eq!(result.samples.len(), 3);
        assert_eq!(result.total_count, 3);
        assert_eq!(
            (result.numeric_min, result.numeric_max, result.numeric_mean),
            (Some(1.5), Some(4.5), Some(3.0))
        );
    }

    #[test]
    fn inspect_attribute_time_samples_zero_limit_keeps_count_without_stats() {
        let path = timed_fixture();
        let result = inspect(&path, 0);
        assert!(result.samples.is_empty());
        assert_eq!(result.total_count, 3);
        assert_eq!(
            (result.numeric_min, result.numeric_max, result.numeric_mean),
            (None, None, None)
        );
    }

    #[test]
    fn inspect_attribute_time_samples_reports_context_for_missing_inputs() {
        let path = timed_fixture();
        let stage = super::super::super::OpenusdBackend::open(&path, StageLoadPolicy::LoadAll)
            .expect("open timed fixture");
        for (prim, attr, needle) in [
            ("/Missing", "sampled", "prim='/Missing'"),
            ("/Root", "missing", "attribute='missing'"),
            ("not/a/prim", "sampled", "invalid prim path"),
        ] {
            let error = inspect_attribute_time_samples(&stage, prim, attr, 2)
                .expect_err("query should fail");
            let message = error.to_string();
            assert!(message.contains(needle), "{message}");
        }
    }

    #[test]
    fn inspect_attribute_time_samples_summarizes_arrays_without_stats() {
        let path = fixture_path(
            "array_timed.usda",
            r#"#usda 1.0
(
    defaultPrim = "Root"
)
def Xform "Root"
{
    double[] sampled.timeSamples = {
        0: [1.0, 2.0],
    }
}
"#,
        );
        let result = inspect(&path, 1);
        assert_eq!(result.samples[0].value_summary, "[2 elements]");
        assert_eq!(
            (result.numeric_min, result.numeric_max, result.numeric_mean),
            (None, None, None)
        );
    }

    #[test]
    fn inspect_attribute_time_samples_strong_default_shadows_weak_reference_samples() {
        let root = layered_fixture(
            r#"#usda 1.0
(
    defaultPrim = "Root"
)
def Xform "Root"
{
    double sampled.timeSamples = {
        0: 1.5,
        12: 3.0,
    }
}
"#,
            r#"#usda 1.0
(
    defaultPrim = "Root"
)
def Xform "Root" (
    references = @./weak.usda@</Root>
)
{
    double sampled = 99.0
}
"#,
        );
        let stage = super::super::super::OpenusdBackend::open(&root, StageLoadPolicy::LoadAll)
            .expect("open layered fixture");
        let result = inspect_attribute_time_samples(&stage, "/Root", "sampled", 2)
            .expect("inspect layered fixture");
        assert_eq!(result.total_count, 0);
        assert!(result.samples.is_empty());
        assert_eq!(
            (result.numeric_min, result.numeric_max, result.numeric_mean),
            (None, None, None)
        );
    }

    #[test]
    fn numeric_stats_avoids_extreme_value_overflow() {
        let largest = f64::MAX;
        let (_, _, same_sign_mean) = numeric_stats(&[largest, largest]);
        assert_eq!(same_sign_mean, Some(largest));
        let (_, _, opposite_sign_mean) = numeric_stats(&[largest, -largest]);
        assert_eq!(opposite_sign_mean, Some(0.0));
    }
}
