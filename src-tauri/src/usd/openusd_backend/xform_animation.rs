//! Bounded, time-aware animation of decomposable USD Xforms.
//!
//! The static USD transform path deliberately remains in `xform.rs`. This
//! module only samples authored xform ops, composes their local/world matrices
//! at stage time, and turns affine TRS matrices into the intermediate node
//! animation shape consumed by the GLB writer. Unsupported transforms are
//! returned as explicit extraction errors by the caller instead of being
//! silently replaced with identity transforms.

use std::cell::RefCell;
use std::collections::HashSet;

use openusd::sdf::{schema::FieldKey, Path as SdfPath, Value as SdfValue};
use openusd::usd::{InterpolationType, ResolveInfoSource, Stage, TimeCode};

use crate::usd::backend::UsdError;
use crate::usd::glb::{NodeAnimationInput, NodeAnimationInterpolation, NodeInput, NodeTrsChannel};
use crate::usd::math::{invert_mat4, mat4_mul};

use super::stage_fields::ValidatedStagePathExt;
use super::xform::compose_world_xform_at;

/// Hard limits keep malformed or unusually dense stages from allocating
/// unbounded animation payloads. The half-time-code bake step is intentional:
/// it catches nonlinear composition such as rotation + pivot while remaining
/// bounded for ordinary playback ranges.
const MAX_ANIMATED_NODES: usize = 512;
const MAX_AUTHORED_SAMPLES_PER_ATTRIBUTE: usize = 8_192;
const MAX_AUTHORED_TIMES: usize = 16_384;
const MAX_BAKED_TIMES: usize = 2_048;
const MAX_ANIMATION_FLOATS: usize = 4 * 1024 * 1024;
// Half a timeCode keeps intermediate poses for ordinary angular-rate
// intervals; the explicit 90-degree-per-step guard rejects faster segments
// instead of allowing a rotation to alias back to the identity pose. The hard
// sample budget below turns very long ranges into an explicit extraction error.
const BAKE_STEP_TIME_CODES: f64 = 0.5;
const MAX_ROTATION_DEGREES_PER_BAKE_STEP: f64 = 90.0;
const MAX_ROTATION_DEGREES_PER_AUTHORED_INTERVAL: f64 = 360.0;
const MATRIX_EPSILON: f64 = 1e-7;
const SHEAR_EPSILON: f64 = 1e-4;
const SCALE_EPSILON: f64 = 1e-10;

/// How the time range for an Xform animation was established.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum XformAnimationRangeKind {
    /// Both `startTimeCode` and `endTimeCode` were authored and valid.
    Authored,
    /// The range was inferred from composed xform-op sample times.
    Inferred,
    /// A candidate was seen but no usable time range was available.
    NoRange,
    /// A candidate was seen but this slice cannot represent it safely.
    Unsupported,
    /// No animated xform candidate was found.
    None,
}

/// Shared detection result used by the GLB routing decision and the animation
/// builder. `reason` is intentionally concise and user-facing; callers should
/// preserve it in degraded diagnostics rather than claim arbitrary attribute
/// animation support.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct XformAnimationDetection {
    pub(crate) candidate: bool,
    pub(crate) range_kind: XformAnimationRangeKind,
    pub(crate) reason: Option<String>,
}

impl XformAnimationDetection {
    pub(crate) fn should_route_to_glb(&self) -> bool {
        self.candidate
            && matches!(
                self.range_kind,
                XformAnimationRangeKind::Authored | XformAnimationRangeKind::Inferred
            )
            && self.reason.is_none()
    }
}

#[derive(Debug, Clone)]
struct AnimatedPrimInfo {
    path: SdfPath,
    sample_times: Vec<f64>,
}

#[derive(Debug, Clone, Copy)]
struct TimeRange {
    start: f64,
    end: f64,
    kind: XformAnimationRangeKind,
}

#[derive(Debug, Clone, Copy)]
struct TrsSample {
    translation: [f32; 3],
    rotation: [f32; 4],
    scale: [f32; 3],
}

/// Detect whether a stage contains a supported, time-varying xform-op
/// candidate. This is intentionally a metadata-light scan used after the
/// frontend's `.timeSamples` marker; static USDA files do not need this query.
pub(crate) fn detect_stage_xform_animation(stage: &Stage) -> XformAnimationDetection {
    // Process each prim in the traversal callback so a large static stage does
    // not allocate a second, unbounded list of every prim path just to answer
    // the routing question. Only the bounded union of sample times survives.
    let candidate = RefCell::new(false);
    let times = RefCell::new(Vec::new());
    let reason = RefCell::new(None::<String>);
    if let Err(error) = stage.traverse(
        crate::usd::openusd_backend::LEGACY_TRAVERSE_PREDICATE,
        |path| {
            if reason.borrow().is_some() {
                return;
            }
            match animated_prim_info(stage, path.clone()) {
                Ok(Some(info)) => {
                    *candidate.borrow_mut() = true;
                    if let Err(error) =
                        extend_bounded_times(&mut times.borrow_mut(), &info.sample_times)
                    {
                        *reason.borrow_mut() = Some(error);
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    *reason.borrow_mut() = Some(error.to_string());
                }
            }
        },
    ) {
        *reason.borrow_mut() = Some(format!("could not scan stage prims: {error}"));
    }
    if let Some(reason) = reason.into_inner() {
        return unsupported_detection(reason);
    }
    let candidate = candidate.into_inner();
    let mut times = times.into_inner();

    if !candidate {
        return XformAnimationDetection {
            candidate: false,
            range_kind: XformAnimationRangeKind::None,
            reason: None,
        };
    }

    times.sort_by(f64::total_cmp);
    times.dedup_by(|a, b| a == b);
    if times.len() < 2 {
        return XformAnimationDetection {
            candidate: true,
            range_kind: XformAnimationRangeKind::NoRange,
            reason: Some("animated xform has no usable composed sample range".to_owned()),
        };
    }
    if let Some(reason) = negative_time_reason(&times) {
        return unsupported_detection(reason);
    }
    match stage_time_range(stage, &times) {
        Ok(range) => XformAnimationDetection {
            candidate: true,
            range_kind: range.kind,
            reason: None,
        },
        Err(reason) => unsupported_detection(reason),
    }
}

fn unsupported_detection(reason: impl Into<String>) -> XformAnimationDetection {
    XformAnimationDetection {
        candidate: true,
        range_kind: XformAnimationRangeKind::Unsupported,
        reason: Some(reason.into()),
    }
}

/// Build one bounded node TRS animation from the nodes emitted by
/// `build_node_tree`. Each local matrix is evaluated from world matrices so a
/// reset-xform-stack child remains correct beneath an animated parent.
pub(crate) fn build_node_animation(
    stage: &Stage,
    nodes: &[NodeInput],
) -> Result<Option<NodeAnimationInput>, UsdError> {
    let mut animated = Vec::new();
    let mut has_animated_ancestor = vec![false; nodes.len()];
    for (node_index, node) in nodes.iter().enumerate() {
        let path =
            SdfPath::new(&node.prim_path).map_err(|error| xform_error(&node.prim_path, error))?;
        let own_info = animated_prim_info(stage, path.clone())?;
        let parent_animated = node
            .parent
            .and_then(|parent| has_animated_ancestor.get(parent).copied())
            .unwrap_or(false);
        let own_animated = own_info.is_some();
        let compensation =
            own_info.is_none() && parent_animated && prim_has_reset_xform_stack(stage, &path)?;
        has_animated_ancestor[node_index] = parent_animated || own_animated || compensation;
        if let Some(info) = own_info {
            if animated.len() >= MAX_ANIMATED_NODES {
                return Err(xform_error(
                    &node.prim_path,
                    format!("animated node budget exceeds {MAX_ANIMATED_NODES}"),
                ));
            }
            animated.push(info);
        }
        if compensation {
            if animated.len() >= MAX_ANIMATED_NODES {
                return Err(xform_error(
                    &node.prim_path,
                    format!("animated node budget exceeds {MAX_ANIMATED_NODES}"),
                ));
            }
            // Its changing local TRS is evaluated against the global authored
            // time union below; do not copy the parent's time array per node.
            animated.push(AnimatedPrimInfo {
                path,
                sample_times: Vec::new(),
            });
        }
    }
    if animated.is_empty() {
        return Ok(None);
    }

    let mut authored_times = Vec::new();
    for info in &animated {
        extend_bounded_times(&mut authored_times, &info.sample_times)
            .map_err(|reason| xform_error(info.path.as_str(), reason))?;
    }
    authored_times.sort_by(f64::total_cmp);
    authored_times.dedup_by(|a, b| a == b);
    if authored_times.len() < 2 {
        return Err(xform_error(
            animated[0].path.as_str(),
            "animated xform has no usable composed sample range",
        ));
    }
    if let Some(reason) = negative_time_reason(&authored_times) {
        return Err(xform_error(animated[0].path.as_str(), reason));
    }

    let range = stage_time_range(stage, &authored_times)
        .map_err(|reason| xform_error(animated[0].path.as_str(), reason))?;
    for info in &animated {
        validate_rotation_sampling(stage, info)?;
    }
    let time_codes = dense_time_codes(&authored_times, range)
        .map_err(|reason| xform_error(animated[0].path.as_str(), reason))?;
    let tcps = time_codes_per_second(stage)?;
    let times = time_codes
        .iter()
        .map(|time| {
            let seconds = *time / tcps;
            if !seconds.is_finite() || seconds < 0.0 {
                return Err(xform_error(
                    animated[0].path.as_str(),
                    format!("xform time {time} cannot be represented as non-negative seconds"),
                ));
            }
            let seconds = seconds as f32;
            if !seconds.is_finite() {
                return Err(xform_error(
                    animated[0].path.as_str(),
                    "xform time overflows f32 seconds",
                ));
            }
            Ok(seconds)
        })
        .collect::<Result<Vec<_>, UsdError>>()?;
    if times.windows(2).any(|window| window[0] >= window[1]) {
        return Err(xform_error(
            animated[0].path.as_str(),
            "xform seconds collapse after f32 conversion",
        ));
    }

    let float_count = animated
        .len()
        .checked_mul(time_codes.len())
        .and_then(|count| count.checked_mul(10))
        .ok_or_else(|| xform_error(animated[0].path.as_str(), "xform float budget overflows"))?;
    if float_count > MAX_ANIMATION_FLOATS {
        return Err(xform_error(
            animated[0].path.as_str(),
            format!("xform float budget exceeds {MAX_ANIMATION_FLOATS}"),
        ));
    }

    let node_indices = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.prim_path.as_str(), index))
        .collect::<std::collections::HashMap<_, _>>();
    let mut channels = Vec::new();
    for info in &animated {
        let node_index = *node_indices
            .get(info.path.as_str())
            .expect("animated node came from node tree");
        let parent_path = nodes[node_index].parent.and_then(|parent| {
            nodes
                .get(parent)
                .map(|parent_node| parent_node.prim_path.as_str())
        });
        let samples = evaluate_node_samples(stage, &info.path, parent_path, &time_codes)?;
        let mut samples = samples;
        make_quaternions_continuous(&mut samples);

        channels.push(NodeTrsChannel {
            node_index,
            // The GLB writer consumes complete TRS arrays. Keeping the
            // initial sample in every channel also makes a constant scale or
            // rotation explicit while the node's initial matrix remains the
            // same pose.
            translations: flatten_vec3(&samples, |sample| sample.translation),
            rotations: flatten_vec4(&samples, |sample| sample.rotation),
            scales: flatten_vec3(&samples, |sample| sample.scale),
        });
    }

    if channels.is_empty() {
        return Ok(None);
    }

    let interpolation = match stage.interpolation_type() {
        InterpolationType::Held => NodeAnimationInterpolation::Step,
        InterpolationType::Linear => NodeAnimationInterpolation::Linear,
    };
    Ok(Some(NodeAnimationInput {
        name: "USD Xform animation".to_owned(),
        times,
        interpolation,
        channels,
    }))
}

fn animated_prim_info(stage: &Stage, path: SdfPath) -> Result<Option<AnimatedPrimInfo>, UsdError> {
    let order_path = path
        .append_property("xformOpOrder")
        .map_err(|error| xform_error(path.as_str(), error))?;
    let order = stage.attribute_at(order_path.clone());
    // ResolveInfo is a composed source gate. A static default/fallback needs
    // no sample-summary walk at all, while a TimeSamples/ValueClips source is
    // still handled through the composed sample APIs below. This preserves
    // references, sublayers, and clips without relying on root-layer fields.
    let order_source = order
        .resolve_info()
        .map_err(|error| xform_error(path.as_str(), error))?
        .source();
    let order_count = if matches!(
        order_source,
        ResolveInfoSource::TimeSamples | ResolveInfoSource::ValueClips
    ) {
        order
            .num_time_samples()
            .map_err(|error| xform_error(path.as_str(), error))?
    } else {
        0
    };
    if order_count > MAX_AUTHORED_SAMPLES_PER_ATTRIBUTE {
        return Err(xform_error(
            path.as_str(),
            format!("xformOpOrder sample budget exceeds {MAX_AUTHORED_SAMPLES_PER_ATTRIBUTE}"),
        ));
    }
    if order_count > 1 {
        return Err(xform_error(
            path.as_str(),
            "time-varying xformOpOrder is unsupported",
        ));
    }
    let Some(order_value) = order
        .get::<SdfValue>()
        .map_err(|error| xform_error(path.as_str(), error))?
    else {
        return Ok(None);
    };
    let op_names = match order_value {
        SdfValue::TokenVec(values) => values.into_iter().map(|v| v.as_str().to_owned()).collect(),
        SdfValue::StringVec(values) => values,
        other => {
            return Err(xform_error(
                path.as_str(),
                format!("xformOpOrder has unsupported value {other:?}"),
            ))
        }
    };

    let mut animated = false;
    let mut sample_times = Vec::new();
    let mut seen_ops = HashSet::new();
    for op_name in op_names {
        if op_name == "!resetXformStack!" {
            continue;
        }
        let attr_name = op_name.strip_prefix("!invert!").unwrap_or(&op_name);
        if !seen_ops.insert(attr_name.to_owned()) {
            continue;
        }
        let attr_path = path
            .append_property(attr_name)
            .map_err(|error| xform_error(path.as_str(), error))?;
        let attribute = stage.attribute_at(attr_path);
        let source = attribute
            .resolve_info()
            .map_err(|error| xform_error(path.as_str(), error))?
            .source();
        if !matches!(
            source,
            ResolveInfoSource::TimeSamples | ResolveInfoSource::ValueClips
        ) {
            continue;
        }
        // Keep the count-only budget check before collecting the potentially
        // large composed time vector. Static defaults took the fast path
        // above and never enter this query.
        let count = attribute
            .num_time_samples()
            .map_err(|error| xform_error(path.as_str(), error))?;
        if count > MAX_AUTHORED_SAMPLES_PER_ATTRIBUTE {
            return Err(xform_error(
                path.as_str(),
                format!("xform op '{attr_name}' sample budget exceeds {MAX_AUTHORED_SAMPLES_PER_ATTRIBUTE}"),
            ));
        }
        // A non-empty time-sample source is a candidate even when it has only
        // one sample. Value clips can report no discrete times, so retain the
        // existing clip-varying check for that zero-count case.
        let varying = count == 0
            && attribute
                .value_might_be_time_varying()
                .map_err(|error| xform_error(path.as_str(), error))?;
        // Keep a single authored sample as a candidate with `NoRange`. The
        // caller can then report the bounded diagnostic instead of treating a
        // `.timeSamples` authoring site as a complete animation.
        if !varying && count == 0 {
            continue;
        }
        animated = true;
        let times = attribute
            .time_sample_times()
            .map_err(|error| xform_error(path.as_str(), error))?;
        if times.is_empty() {
            return Err(xform_error(
                path.as_str(),
                format!("animated xform op '{attr_name}' has no queryable sample times"),
            ));
        }
        extend_bounded_times(&mut sample_times, &times)
            .map_err(|reason| xform_error(path.as_str(), reason))?;
    }
    if !animated {
        return Ok(None);
    }
    sample_times.sort_by(f64::total_cmp);
    sample_times.dedup_by(|a, b| a == b);
    Ok(Some(AnimatedPrimInfo { path, sample_times }))
}

fn prim_has_reset_xform_stack(stage: &Stage, path: &SdfPath) -> Result<bool, UsdError> {
    let order_path = path
        .append_property("xformOpOrder")
        .map_err(|error| xform_error(path.as_str(), error))?;
    let value = stage
        .attribute_at(order_path)
        .get::<SdfValue>()
        .map_err(|error| xform_error(path.as_str(), error))?;
    Ok(match value {
        Some(SdfValue::TokenVec(ops)) => ops.iter().any(|op| op.as_str() == "!resetXformStack!"),
        Some(SdfValue::StringVec(ops)) => ops.iter().any(|op| op == "!resetXformStack!"),
        _ => false,
    })
}

fn validate_rotation_sampling(stage: &Stage, info: &AnimatedPrimInfo) -> Result<(), UsdError> {
    let order_path = info
        .path
        .append_property("xformOpOrder")
        .map_err(|error| xform_error(info.path.as_str(), error))?;
    let Some(order_value) = stage
        .attribute_at(order_path)
        .get::<SdfValue>()
        .map_err(|error| xform_error(info.path.as_str(), error))?
    else {
        return Ok(());
    };
    let op_names = match order_value {
        SdfValue::TokenVec(values) => values
            .into_iter()
            .map(|value| value.as_str().to_owned())
            .collect(),
        SdfValue::StringVec(values) => values,
        _ => return Ok(()),
    };
    let mut seen_ops = HashSet::new();
    let mut animated_rotation_ops = 0usize;
    for op_name in op_names {
        if op_name == "!resetXformStack!" {
            continue;
        }
        let attr_name = op_name.strip_prefix("!invert!").unwrap_or(&op_name);
        if !seen_ops.insert(attr_name.to_owned()) {
            continue;
        }
        let base = attr_name.split(':').nth(1).unwrap_or("");
        let attr_path = info
            .path
            .append_property(attr_name)
            .map_err(|error| xform_error(info.path.as_str(), error))?;
        let attribute = stage.attribute_at(attr_path);
        let count = attribute
            .num_time_samples()
            .map_err(|error| xform_error(info.path.as_str(), error))?;
        let varying = attribute
            .value_might_be_time_varying()
            .map_err(|error| xform_error(info.path.as_str(), error))?;
        if count == 0 && !varying {
            continue;
        }
        if is_rotation_op(base) && (varying || count > 1) {
            animated_rotation_ops += 1;
            if animated_rotation_ops > 1 {
                return Err(xform_error(
                    info.path.as_str(),
                    "multiple animated rotation ops are unsupported",
                ));
            }
        }
        if !is_euler_rotation_op(base) {
            continue;
        }
        let times = attribute
            .time_sample_times()
            .map_err(|error| xform_error(info.path.as_str(), error))?;
        let values = times
            .iter()
            .map(|time| {
                attribute
                    .get_at::<SdfValue>(Some(TimeCode::new(*time)))
                    .map_err(|error| xform_error(info.path.as_str(), error))?
                    .and_then(|value| rotation_components(base, &value))
                    .ok_or_else(|| {
                        xform_error(
                            info.path.as_str(),
                            format!("rotation op '{attr_name}' has an unsupported sampled value"),
                        )
                    })
            })
            .collect::<Result<Vec<_>, UsdError>>()?;
        for (time_pair, value_pair) in times.windows(2).zip(values.windows(2)) {
            let delta_time = time_pair[1] - time_pair[0];
            let steps = (delta_time / BAKE_STEP_TIME_CODES).ceil().max(1.0);
            let total_delta = value_pair[1]
                .iter()
                .zip(value_pair[0].iter())
                .map(|(current, previous)| (current - previous).abs())
                .sum::<f64>();
            if !delta_time.is_finite() || delta_time < 0.0 || !total_delta.is_finite() {
                return Err(xform_error(
                    info.path.as_str(),
                    format!("rotation op '{attr_name}' has a non-finite sample interval"),
                ));
            }
            if total_delta > MAX_ROTATION_DEGREES_PER_AUTHORED_INTERVAL {
                return Err(xform_error(
                    info.path.as_str(),
                    format!(
                        "rotation op '{attr_name}' spans more than one turn between authored samples"
                    ),
                ));
            }
            if total_delta / steps > MAX_ROTATION_DEGREES_PER_BAKE_STEP {
                return Err(xform_error(
                    info.path.as_str(),
                    format!(
                        "rotation op '{attr_name}' changes faster than {MAX_ROTATION_DEGREES_PER_BAKE_STEP} degrees per {BAKE_STEP_TIME_CODES} timeCode"
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn is_rotation_op(base: &str) -> bool {
    base == "orient" || is_euler_rotation_op(base)
}

fn is_euler_rotation_op(base: &str) -> bool {
    matches!(
        base,
        "rotateX"
            | "rotateY"
            | "rotateZ"
            | "rotateXYZ"
            | "rotateXZY"
            | "rotateYXZ"
            | "rotateYZX"
            | "rotateZXY"
            | "rotateZYX"
    )
}

fn rotation_components(base: &str, value: &SdfValue) -> Option<[f64; 3]> {
    let scalar = || match value {
        SdfValue::Float(value) => Some(*value as f64),
        SdfValue::Double(value) => Some(*value),
        SdfValue::Half(value) => Some(f64::from(*value)),
        _ => None,
    };
    match base {
        "rotateX" => scalar().map(|value| [value, 0.0, 0.0]),
        "rotateY" => scalar().map(|value| [0.0, value, 0.0]),
        "rotateZ" => scalar().map(|value| [0.0, 0.0, value]),
        "rotateXYZ" | "rotateXZY" | "rotateYXZ" | "rotateYZX" | "rotateZXY" | "rotateZYX" => {
            match value {
                SdfValue::Vec3d(value) => Some((*value).into()),
                SdfValue::Vec3f(value) => {
                    let [x, y, z]: [f32; 3] = (*value).into();
                    Some([x as f64, y as f64, z as f64])
                }
                SdfValue::Vec3h(value) => {
                    let [x, y, z]: [openusd::gf::f16; 3] = (*value).into();
                    Some([f64::from(x), f64::from(y), f64::from(z)])
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn extend_bounded_times(target: &mut Vec<f64>, source: &[f64]) -> Result<(), String> {
    if source.len() > MAX_AUTHORED_SAMPLES_PER_ATTRIBUTE {
        return Err(format!(
            "xform authored sample budget exceeds {MAX_AUTHORED_SAMPLES_PER_ATTRIBUTE}"
        ));
    }
    let next_len = target
        .len()
        .checked_add(source.len())
        .ok_or_else(|| "xform authored time count overflows".to_owned())?;
    if next_len > MAX_AUTHORED_TIMES {
        return Err(format!(
            "xform authored time budget exceeds {MAX_AUTHORED_TIMES}"
        ));
    }
    target.extend_from_slice(source);
    if target.iter().any(|time| !time.is_finite()) {
        return Err("xform authored time is not finite".to_owned());
    }
    Ok(())
}

fn negative_time_reason(times: &[f64]) -> Option<String> {
    times
        .iter()
        .find(|time| **time < 0.0)
        .map(|time| format!("negative xform time code {time} cannot be emitted as GLB seconds"))
}

fn stage_time_range(stage: &Stage, times: &[f64]) -> Result<TimeRange, String> {
    let authored_start = stage_number_metadata(stage, FieldKey::StartTimeCode);
    let authored_end = stage_number_metadata(stage, FieldKey::EndTimeCode);
    if let (Some(start), Some(end)) = (authored_start, authored_end) {
        if !start.is_finite() || !end.is_finite() || start > end {
            return Err("authored xform time range is invalid".to_owned());
        }
        if start < 0.0 || end < 0.0 {
            return Err("negative authored xform time range is unsupported".to_owned());
        }
        return Ok(TimeRange {
            start,
            end,
            kind: XformAnimationRangeKind::Authored,
        });
    }
    let start = *times
        .first()
        .ok_or_else(|| "xform animation has no sample range".to_owned())?;
    let end = *times
        .last()
        .ok_or_else(|| "xform animation has no sample range".to_owned())?;
    Ok(TimeRange {
        start,
        end,
        kind: XformAnimationRangeKind::Inferred,
    })
}

fn dense_time_codes(authored: &[f64], range: TimeRange) -> Result<Vec<f64>, String> {
    let mut out = Vec::new();
    let mut base = authored.to_vec();
    base.push(range.start);
    base.push(range.end);
    base.sort_by(f64::total_cmp);
    base.dedup_by(|a, b| a == b);

    let mut estimated = 1usize;
    for pair in base.windows(2) {
        let delta = pair[1] - pair[0];
        if !delta.is_finite() || delta < 0.0 {
            return Err("xform sample range is not finite and ordered".to_owned());
        }
        let steps = (delta / BAKE_STEP_TIME_CODES).ceil().max(1.0);
        if steps > MAX_BAKED_TIMES as f64 {
            return Err(format!(
                "xform bake interval exceeds {MAX_BAKED_TIMES} steps"
            ));
        }
        estimated = estimated
            .checked_add(steps as usize)
            .ok_or_else(|| "xform bake sample count overflows".to_owned())?;
        if estimated > MAX_BAKED_TIMES {
            return Err(format!(
                "xform baked sample budget exceeds {MAX_BAKED_TIMES}"
            ));
        }
    }

    out.reserve(estimated);
    out.push(base[0]);
    for pair in base.windows(2) {
        let start = pair[0];
        let delta = pair[1] - start;
        let steps = (delta / BAKE_STEP_TIME_CODES).ceil().max(1.0) as usize;
        for step in 1..=steps {
            out.push(start + delta * (step as f64 / steps as f64));
        }
    }
    Ok(out)
}

fn time_codes_per_second(stage: &Stage) -> Result<f64, UsdError> {
    let value = stage_number_metadata(stage, FieldKey::TimeCodesPerSecond).unwrap_or(24.0);
    if !value.is_finite() || value <= 0.0 {
        return Err(UsdError::Parse(format!(
            "timeCodesPerSecond must be finite and positive, got {value}"
        )));
    }
    Ok(value)
}

fn stage_number_metadata(stage: &Stage, key: FieldKey) -> Option<f64> {
    let value = stage.stage_metadata(key).ok().flatten()?;
    match value {
        SdfValue::Double(value) => Some(value),
        SdfValue::Float(value) => Some(value as f64),
        SdfValue::Half(value) => Some(value.to_f32() as f64),
        SdfValue::Int(value) => Some(value as f64),
        SdfValue::Int64(value) => Some(value as f64),
        SdfValue::Uint(value) => Some(value as f64),
        SdfValue::Uint64(value) => Some(value as f64),
        _ => None,
    }
}

fn evaluate_node_samples(
    stage: &Stage,
    path: &SdfPath,
    parent_path: Option<&str>,
    time_codes: &[f64],
) -> Result<Vec<TrsSample>, UsdError> {
    let mut out = Vec::with_capacity(time_codes.len());
    let parent = parent_path
        .map(|parent| SdfPath::new(parent).map_err(|error| xform_error(parent, error)))
        .transpose()?;
    for time in time_codes {
        let own_world = compose_world_xform_at(stage, path, *time)
            .map_err(|error| xform_error(path.as_str(), error))?;
        let local = if let Some(parent) = &parent {
            let parent_world = compose_world_xform_at(stage, parent, *time)
                .map_err(|error| xform_error(parent.as_str(), error))?;
            let inverse = invert_mat4(&parent_world).ok_or_else(|| {
                xform_error(path.as_str(), "animated parent world matrix is singular")
            })?;
            mat4_mul(&inverse, &own_world)
        } else {
            own_world
        };
        out.push(decompose_trs(&local).map_err(|reason| xform_error(path.as_str(), reason))?);
    }
    Ok(out)
}

fn decompose_trs(matrix: &[f64; 16]) -> Result<TrsSample, String> {
    if matrix.iter().any(|value| !value.is_finite()) {
        return Err("animated xform matrix contains non-finite values".to_owned());
    }
    if matrix[3].abs() > MATRIX_EPSILON
        || matrix[7].abs() > MATRIX_EPSILON
        || matrix[11].abs() > MATRIX_EPSILON
        || (matrix[15] - 1.0).abs() > MATRIX_EPSILON
    {
        return Err("animated xform is non-affine".to_owned());
    }

    let columns = [
        glam::DVec3::new(matrix[0], matrix[1], matrix[2]),
        glam::DVec3::new(matrix[4], matrix[5], matrix[6]),
        glam::DVec3::new(matrix[8], matrix[9], matrix[10]),
    ];
    let scales = [
        columns[0].length(),
        columns[1].length(),
        columns[2].length(),
    ];
    if scales
        .iter()
        .any(|scale| !scale.is_finite() || *scale <= SCALE_EPSILON)
    {
        return Err("animated xform is singular or has a zero scale".to_owned());
    }
    let normalized = [
        columns[0] / scales[0],
        columns[1] / scales[1],
        columns[2] / scales[2],
    ];
    if normalized[0].dot(normalized[1]).abs() > SHEAR_EPSILON
        || normalized[0].dot(normalized[2]).abs() > SHEAR_EPSILON
        || normalized[1].dot(normalized[2]).abs() > SHEAR_EPSILON
    {
        return Err("animated xform contains shear".to_owned());
    }

    let determinant = normalized[0].cross(normalized[1]).dot(normalized[2]);
    if !determinant.is_finite() || determinant.abs() < MATRIX_EPSILON {
        return Err("animated xform rotation basis is singular".to_owned());
    }
    if determinant < 0.0 {
        return Err("animated xform has a negative determinant".to_owned());
    }

    let rotation = glam::DQuat::from_mat3(&glam::DMat3::from_cols(
        columns[0] / scales[0],
        columns[1] / scales[1],
        columns[2] / scales[2],
    ));
    let rotation = rotation.to_array();
    let translation = [matrix[12] as f32, matrix[13] as f32, matrix[14] as f32];
    let scale = [scales[0] as f32, scales[1] as f32, scales[2] as f32];
    let translation = finite_vec3(translation, "translation")?;
    let rotation = finite_vec4(rotation.map(|value| value as f32), "rotation")?;
    let scale = finite_vec3(scale, "scale")?;
    Ok(TrsSample {
        translation,
        rotation,
        scale,
    })
}

fn finite_vec3(value: [f32; 3], label: &str) -> Result<[f32; 3], String> {
    if value.iter().all(|component| component.is_finite()) {
        Ok(value)
    } else {
        Err(format!("animated xform {label} is non-finite"))
    }
}

fn finite_vec4(value: [f32; 4], label: &str) -> Result<[f32; 4], String> {
    if value.iter().all(|component| component.is_finite()) {
        Ok(value)
    } else {
        Err(format!("animated xform {label} is non-finite"))
    }
}

fn make_quaternions_continuous(samples: &mut [TrsSample]) {
    for index in 1..samples.len() {
        let previous = samples[index - 1].rotation;
        let current = samples[index].rotation;
        let dot = previous
            .iter()
            .zip(current.iter())
            .map(|(a, b)| a * b)
            .sum::<f32>();
        if dot < 0.0 {
            samples[index].rotation = current.map(|value| -value);
        }
    }
}

fn flatten_vec3<F: Fn(TrsSample) -> [f32; 3]>(samples: &[TrsSample], get: F) -> Vec<f32> {
    samples.iter().flat_map(|sample| get(*sample)).collect()
}

fn flatten_vec4<F: Fn(TrsSample) -> [f32; 4]>(samples: &[TrsSample], get: F) -> Vec<f32> {
    samples.iter().flat_map(|sample| get(*sample)).collect()
}

fn xform_error(path: &str, detail: impl std::fmt::Display) -> UsdError {
    UsdError::Parse(format!("xform animation failed prim='{path}': {detail}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usd::openusd_backend::OpenusdBackend;
    use crate::usd::types::StageLoadPolicy;

    fn fixture(source: &str) -> (tempfile::TempDir, Stage) {
        let temp = tempfile::tempdir().expect("fixture dir");
        let path = temp.path().join("animated_xform_test.usda");
        std::fs::write(&path, source).expect("fixture source");
        let stage = OpenusdBackend::open(&path, StageLoadPolicy::LoadAll).expect("open fixture");
        (temp, stage)
    }

    fn nodes_for() -> Vec<NodeInput> {
        let path = SdfPath::new("/Root/Quad").expect("quad path");
        vec![
            NodeInput {
                prim_path: "/Root".to_owned(),
                usd_type_name: None,
                basename: "Root".to_owned(),
                parent: None,
                local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
                kind: crate::usd::glb::NodeKind::Group,
                mesh_payload_idx: None,
                light_payload_idx: None,
                camera_payload_idx: None,
                skin_payload_idx: None,
            },
            NodeInput {
                prim_path: path.as_str().to_owned(),
                usd_type_name: None,
                basename: "Quad".to_owned(),
                parent: Some(0),
                local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
                kind: crate::usd::glb::NodeKind::Mesh,
                mesh_payload_idx: Some(0),
                light_payload_idx: None,
                camera_payload_idx: None,
                skin_payload_idx: None,
            },
        ]
    }

    #[test]
    fn detects_inferred_range_and_bakes_default_and_midpoint() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    double3 xformOp:translate.timeSamples = {
        1: (0, 0, 0),
        24: (1, 0, 0),
    }
    uniform token[] xformOpOrder = ["xformOp:translate"]
    def Mesh "Quad"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
}
"#,
        );
        let detection = detect_stage_xform_animation(&stage);
        assert_eq!(detection.range_kind, XformAnimationRangeKind::Inferred);
        assert!(detection.should_route_to_glb());
        let animation = build_node_animation(&stage, &nodes_for())
            .expect("build animation")
            .expect("animation");
        assert_eq!(animation.times.first().copied(), Some(1.0 / 24.0));
        assert_eq!(animation.times.last().copied(), Some(1.0));
        let channel = &animation.channels[0];
        assert_eq!(channel.translations.len(), animation.times.len() * 3);
        assert_eq!(channel.rotations.len(), animation.times.len() * 4);
        assert_eq!(channel.scales.len(), animation.times.len() * 3);
        assert!((channel.translations[animation.times.len() / 2 * 3] - 0.5).abs() < 0.06);
    }

    #[test]
    fn emits_constant_authored_transform_without_relying_on_a_default() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    double3 xformOp:translate.timeSamples = {
        1: (5, 0, 0),
        24: (5, 0, 0),
    }
    uniform token[] xformOpOrder = ["xformOp:translate"]
}
"#,
        );
        let animation = build_node_animation(&stage, &nodes_for())
            .expect("build constant authored animation")
            .expect("constant authored animation");
        assert_eq!(animation.channels.len(), 1);
        let channel = &animation.channels[0];
        assert!(channel
            .translations
            .chunks_exact(3)
            .all(|sample| (sample[0] - 5.0).abs() < f32::EPSILON));
        assert_eq!(channel.rotations.len(), animation.times.len() * 4);
        assert_eq!(channel.scales.len(), animation.times.len() * 3);
    }

    #[test]
    fn preserves_time_samples_composed_through_reference() {
        let temp = tempfile::tempdir().expect("fixture dir");
        std::fs::write(
            temp.path().join("source.usda"),
            r#"#usda 1.0
def Xform "Asset"
{
    double3 xformOp:translate.timeSamples = {
        1: (2, 0, 0),
        24: (4, 0, 0),
    }
    uniform token[] xformOpOrder = ["xformOp:translate"]
}
"#,
        )
        .expect("write source fixture");
        let root_path = temp.path().join("root.usda");
        std::fs::write(
            &root_path,
            r#"#usda 1.0
def Xform "Root" (
    prepend references = @source.usda@</Asset>
)
{
}
"#,
        )
        .expect("write root fixture");
        let stage = OpenusdBackend::open(&root_path, StageLoadPolicy::LoadAll)
            .expect("open reference fixture");

        let detection = detect_stage_xform_animation(&stage);
        assert!(detection.candidate);
        assert_eq!(detection.range_kind, XformAnimationRangeKind::Inferred);
        let animation = build_node_animation(&stage, &nodes_for())
            .expect("build referenced animation")
            .expect("referenced animation");
        let root_channel = animation
            .channels
            .iter()
            .find(|channel| channel.node_index == 0)
            .expect("referenced root channel");
        assert_eq!(root_channel.translations[0], 2.0);
        assert_eq!(
            root_channel.translations[(animation.times.len() - 1) * 3],
            4.0
        );
    }

    #[test]
    fn preserves_held_interpolation_in_animation_input() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    double3 xformOp:translate.timeSamples = {
        1: (0, 0, 0),
        3: (1, 0, 0),
    }
    uniform token[] xformOpOrder = ["xformOp:translate"]
}
"#,
        );
        stage.set_interpolation_type(InterpolationType::Held);
        let animation = build_node_animation(&stage, &nodes_for())
            .expect("build held animation")
            .expect("held animation");
        assert_eq!(animation.interpolation, NodeAnimationInterpolation::Step);
        let channel = &animation.channels[0];
        let midpoint = animation.times.len() / 2;
        assert_eq!(channel.translations[midpoint * 3], 0.0);
    }

    #[test]
    fn preserves_full_turn_rotation_with_dense_samples() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    float xformOp:rotateZ.timeSamples = {
        0: 0.0,
        24: 360.0,
    }
    uniform token[] xformOpOrder = ["xformOp:rotateZ"]
}
"#,
        );
        let nodes = vec![NodeInput {
            prim_path: "/Root".to_owned(),
            usd_type_name: None,
            basename: "Root".to_owned(),
            parent: None,
            local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
            kind: crate::usd::glb::NodeKind::Group,
            mesh_payload_idx: None,
            light_payload_idx: None,
            camera_payload_idx: None,
            skin_payload_idx: None,
        }];
        let animation = build_node_animation(&stage, &nodes)
            .expect("build rotation animation")
            .expect("rotation animation");
        let channel = &animation.channels[0];
        assert_eq!(channel.rotations.len(), animation.times.len() * 4);
        assert!(channel
            .rotations
            .chunks_exact(4)
            .any(|quat| quat[2].abs() > 0.7 && quat[3].abs() < 0.8));
    }

    #[test]
    fn preserves_short_full_turn_midpoint() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    float xformOp:rotateZ.timeSamples = {
        1: 0.0,
        3: 360.0,
    }
    uniform token[] xformOpOrder = ["xformOp:rotateZ"]
}
"#,
        );
        let nodes = vec![NodeInput {
            prim_path: "/Root".to_owned(),
            usd_type_name: None,
            basename: "Root".to_owned(),
            parent: None,
            local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
            kind: crate::usd::glb::NodeKind::Group,
            mesh_payload_idx: None,
            light_payload_idx: None,
            camera_payload_idx: None,
            skin_payload_idx: None,
        }];
        let animation = build_node_animation(&stage, &nodes)
            .expect("build short rotation animation")
            .expect("short rotation animation");
        assert!(animation.times.len() >= 3);
        let midpoint = animation.times.len() / 2;
        let quaternion = &animation.channels[0].rotations[midpoint * 4..midpoint * 4 + 4];
        assert!(quaternion[2].abs() > 0.7 && quaternion[3].abs() < 0.8);
    }

    #[test]
    fn rejects_full_turn_that_exceeds_fixed_rotation_rate_bound() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    float xformOp:rotateZ.timeSamples = {
        1: 0.0,
        2: 720.0,
    }
    uniform token[] xformOpOrder = ["xformOp:rotateZ"]
}
"#,
        );
        let nodes = vec![NodeInput {
            prim_path: "/Root".to_owned(),
            usd_type_name: None,
            basename: "Root".to_owned(),
            parent: None,
            local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
            kind: crate::usd::glb::NodeKind::Group,
            mesh_payload_idx: None,
            light_payload_idx: None,
            camera_payload_idx: None,
            skin_payload_idx: None,
        }];
        let error = build_node_animation(&stage, &nodes)
            .expect_err("excessive rotation must degrade instead of aliasing");
        let message = error.to_string();
        assert!(
            message.contains("spans more than one turn") || message.contains("changes faster than")
        );
    }

    #[test]
    fn rejects_multiple_animated_rotation_ops_before_composition_aliases() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    float xformOp:rotateZ:a.timeSamples = {
        1: 0.0,
        2: 180.0,
    }
    float xformOp:rotateZ:b.timeSamples = {
        1: 0.0,
        2: 180.0,
    }
    uniform token[] xformOpOrder = ["xformOp:rotateZ:a", "xformOp:rotateZ:b"]
}
"#,
        );
        let nodes = vec![NodeInput {
            prim_path: "/Root".to_owned(),
            usd_type_name: None,
            basename: "Root".to_owned(),
            parent: None,
            local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
            kind: crate::usd::glb::NodeKind::Group,
            mesh_payload_idx: None,
            light_payload_idx: None,
            camera_payload_idx: None,
            skin_payload_idx: None,
        }];
        let error = build_node_animation(&stage, &nodes)
            .expect_err("multiple animated rotation ops must be unsupported");
        assert!(error.to_string().contains("multiple animated rotation ops"));
    }

    #[test]
    fn rejects_negative_time_codes_without_offsetting() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    double3 xformOp:translate.timeSamples = {
        -1: (0, 0, 0),
        24: (1, 0, 0),
    }
    uniform token[] xformOpOrder = ["xformOp:translate"]
}
"#,
        );
        let detection = detect_stage_xform_animation(&stage);
        assert_eq!(detection.range_kind, XformAnimationRangeKind::Unsupported);
        assert!(detection
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("negative")));
    }

    #[test]
    fn reports_no_range_for_a_single_authored_sample() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    double3 xformOp:translate.timeSamples = {
        1: (0, 0, 0),
    }
    uniform token[] xformOpOrder = ["xformOp:translate"]
}
"#,
        );
        let detection = detect_stage_xform_animation(&stage);
        assert_eq!(detection.range_kind, XformAnimationRangeKind::NoRange);
        assert!(detection
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("no usable")));
        assert!(!detection.should_route_to_glb());
    }

    #[test]
    fn rejects_bake_ranges_before_allocating_unbounded_samples() {
        let error = dense_time_codes(
            &[0.0, 2_048.0],
            TimeRange {
                start: 0.0,
                end: 2_048.0,
                kind: XformAnimationRangeKind::Inferred,
            },
        )
        .expect_err("bake range must hit the hard sample limit");
        assert!(error.contains("bake interval") || error.contains("baked sample"));
    }

    #[test]
    fn bakes_reset_child_compensation_under_animated_parent() {
        let (_temp, stage) = fixture(
            r#"#usda 1.0
def Xform "Root"
{
    double3 xformOp:translate.timeSamples = {
        0: (0, 0, 0),
        24: (10, 0, 0),
    }
    uniform token[] xformOpOrder = ["xformOp:translate"]
    def Xform "Static"
    {
        def Xform "Reset" (
            kind = "component"
        )
        {
            double3 xformOp:translate = (2, 0, 0)
            uniform token[] xformOpOrder = ["!resetXformStack!", "xformOp:translate"]
            def Mesh "Quad"
            {
                int[] faceVertexCounts = [3]
                int[] faceVertexIndices = [0, 1, 2]
                point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
            }
        }
    }
}
"#,
        );
        let mut nodes = vec![
            NodeInput {
                prim_path: "/Root".to_owned(),
                usd_type_name: None,
                basename: "Root".to_owned(),
                parent: None,
                local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
                kind: crate::usd::glb::NodeKind::Group,
                mesh_payload_idx: None,
                light_payload_idx: None,
                camera_payload_idx: None,
                skin_payload_idx: None,
            },
            NodeInput {
                prim_path: "/Root/Static".to_owned(),
                usd_type_name: None,
                basename: "Static".to_owned(),
                parent: Some(0),
                local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
                kind: crate::usd::glb::NodeKind::Group,
                mesh_payload_idx: None,
                light_payload_idx: None,
                camera_payload_idx: None,
                skin_payload_idx: None,
            },
            NodeInput {
                prim_path: "/Root/Static/Reset".to_owned(),
                usd_type_name: None,
                basename: "Reset".to_owned(),
                parent: Some(1),
                local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
                kind: crate::usd::glb::NodeKind::Group,
                mesh_payload_idx: None,
                light_payload_idx: None,
                camera_payload_idx: None,
                skin_payload_idx: None,
            },
        ];
        nodes.push(NodeInput {
            prim_path: "/Root/Static/Reset/Quad".to_owned(),
            usd_type_name: None,
            basename: "Quad".to_owned(),
            parent: Some(2),
            local_matrix: crate::usd::math::IDENTITY_MAT4_F32,
            kind: crate::usd::glb::NodeKind::Mesh,
            mesh_payload_idx: Some(0),
            light_payload_idx: None,
            camera_payload_idx: None,
            skin_payload_idx: None,
        });
        let animation = build_node_animation(&stage, &nodes)
            .expect("build reset compensation")
            .expect("parent animation");
        assert!(animation
            .channels
            .iter()
            .any(|channel| channel.node_index == 0));
        assert!(animation
            .channels
            .iter()
            .any(|channel| channel.node_index == 2));
    }

    #[test]
    fn reports_shear_as_degraded_instead_of_wrong_trs() {
        let shear = [
            1.0, 0.0, 0.0, 0.0, // column 0
            0.5, 1.0, 0.0, 0.0, // column 1 (sheared)
            0.0, 0.0, 1.0, 0.0, // column 2
            0.0, 0.0, 0.0, 1.0,
        ];
        let error = decompose_trs(&shear).expect_err("shear must be rejected");
        assert!(error.contains("shear"));
    }

    #[test]
    fn reports_negative_determinant_as_degraded_instead_of_flipping_an_axis() {
        let reflection = [
            -1.0, 0.0, 0.0, 0.0, // reflected X column
            0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ];
        let error = decompose_trs(&reflection).expect_err("reflection must be rejected");
        assert!(error.contains("negative determinant"));
    }
}
