use openusd::gf::f16;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::usd::Stage;

use crate::usd::backend::UsdError;
use crate::usd::math::{identity_mat4, invert_mat4, mat4_mul};

use super::stage_fields::token_vec_to_strings;

/// Walks `prim_path` toward the pseudo-root, multiplying each ancestor's
/// `local_xform_of` to obtain a composed world matrix in column-major order.
/// Missing local xforms are treated as identity. A prim whose `xformOpOrder`
/// contains the `!resetXformStack!` pseudo-op truncates the walk -- its own
/// local xform is still applied, but its ancestors contribute nothing. This
/// matches USD's reset-xform-stack semantics.
///
/// A failure from `local_xform_of` (e.g. an unsupported op type the fork
/// doesn't know how to materialise) is logged and treated as identity at that
/// level rather than aborting the entire GLB build. Losing one prim's
/// transform is better than refusing to preview the whole stage.
///
/// The returned matrix matches the convention used by glTF and Three.js
/// (column-vector, `M * v`).
pub(crate) fn compose_world_xform(
    stage: &Stage,
    prim_path: &SdfPath,
) -> Result<[f64; 16], UsdError> {
    // Walking by string is a deliberate simplification: the openusd `Path`
    // API doesn't expose a built-in `parent()`, and trimming the textual
    // form is robust enough for the canonical absolute paths that
    // `Stage::traverse` hands us.
    let mut path_str = prim_path.as_str().to_string();
    let mut chain: Vec<[f64; 16]> = Vec::new();

    loop {
        let sdf_path = SdfPath::new(&path_str)
            .map_err(|e| UsdError::Parse(format!("invalid prim path '{path_str}': {e}")))?;

        // Note whether this prim resets the xform stack BEFORE we read its
        // local matrix -- reading `xformOpOrder` is cheap (just a field lookup)
        // and we want to honor the boundary even if `local_xform_of` below
        // produces an error we decide to swallow.
        let resets = has_reset_xform_stack(stage, &sdf_path);

        // Always use yw-look's own composer rather than the fork's
        // `local_xform_of`: it handles `xformOp:orient` (quaternion
        // rotation -- used by e.g. Apple AR Quick Look USDZ files) and
        // `!invert!` prefixes (Maya pivot pairs), both of which the
        // fork's implementation silently drops. Doing the work here
        // keeps the routing surface small -- whatever `requires_glb_preview`
        // sends through will see the authored transforms faithfully.
        match compose_prim_local_xform(stage, &sdf_path) {
            Ok(Some(local)) => {
                if std::env::var("YW_LOOK_USD_DEBUG_XFORM").is_ok() {
                    eprintln!(
                        "  xform {} diag=[{:.3}, {:.3}, {:.3}] t=[{:.3}, {:.3}, {:.3}]",
                        path_str, local[0], local[5], local[10], local[12], local[13], local[14]
                    );
                }
                chain.push(local);
            }
            Ok(None) => {}
            Err(e) => {
                log::warn!(
                    "[usd] compose_prim_local_xform('{path_str}') failed, treating as identity: {e}"
                );
            }
        }

        if resets {
            // This prim overrides inherited ancestor transforms -- stop
            // walking upward so we don't fold any parent locals in.
            break;
        }

        // Walk to parent. Stop at the pseudo-root '/'.
        let Some(slash_idx) = path_str.rfind('/') else {
            break;
        };
        if slash_idx == 0 {
            // path_str is "/something" -> parent is "/" (pseudo-root).
            break;
        }
        path_str.truncate(slash_idx);
    }

    // Multiply ancestors first so the leaf's local transform lands on the
    // right of the product (column-vector convention: applied first to v).
    let mut world = identity_mat4();
    for local in chain.iter().rev() {
        world = mat4_mul(&world, local);
    }
    Ok(world)
}

/// yw-look-side replacement for the fork's `local_xform_of`. Used by every
/// Mesh prim traversed for GLB extraction, so it needs to cover anything a
/// real-world USD asset may author -- not just the minimal op set the fork
/// materialises.
///
/// Beyond the fork's capabilities this composer handles:
///   - `xformOp:orient` (quaternion rotation, used in Apple AR Quick Look
///     USDZ files)
///   - `!invert!` prefixes (Maya-style pivot pairs)
///
/// USD (row-vector) composes ops as `M_row = op[0] * op[1] * ... * op[N-1]`,
/// so in column-vector convention the equivalent matrix is
/// `M_col = op[0] * op[1] * ... * op[N-1]` as well -- the first op in the
/// list becomes the leftmost factor (outermost), and the last op becomes
/// the rightmost factor (innermost, applied first to the vertex).
///
/// Concretely: `xformOpOrder = [translate, rotateXYZ]` means "rotate
/// locally, then translate to position" -- the standard placement
/// convention used by XformCommonAPI and heavy users like Pixar's
/// Kitchen Set. The earlier implementation iterated in reverse and
/// produced `R * T`, which flung every prop around the origin.
///
/// For each entry:
///   1. Strip an optional `!invert!` prefix, remembering the flag.
///   2. Look up the underlying attribute via `stage.attribute(path).get::<Value>()`.
///   3. Build the op matrix via [`build_xform_op_matrix`].
///   4. Invert the matrix when the flag was set.
///   5. Append on the right: `result = result * op` -- so iterating the
///      list forward yields `op[0] * op[1] * ... * op[N-1]`.
///
/// Returns `Ok(None)` when the prim has no `xformOpOrder` authored.
pub(crate) fn compose_prim_local_xform(
    stage: &Stage,
    prim_path: &SdfPath,
) -> Result<Option<[f64; 16]>, UsdError> {
    let order_path = prim_path
        .append_property("xformOpOrder")
        .map_err(|e| UsdError::Parse(e.to_string()))?;
    let Some(order_value) = stage
        .attribute(order_path)
        .get::<SdfValue>()
        .map_err(|e| UsdError::Parse(e.to_string()))?
    else {
        return Ok(None);
    };
    let op_names: Vec<String> = match order_value {
        SdfValue::TokenVec(v) => token_vec_to_strings(v),
        SdfValue::StringVec(v) => v,
        other => {
            return Err(UsdError::Parse(format!(
                "Unexpected type for xformOpOrder: {other:?}"
            )));
        }
    };
    if op_names.is_empty() {
        return Ok(None);
    }

    let mut result = identity_mat4();
    for name in op_names.iter() {
        if name == "!resetXformStack!" {
            // Reset is handled by the caller (via has_reset_xform_stack),
            // not as an op -- skip it here.
            continue;
        }
        let (invert, attr_name) = match name.strip_prefix("!invert!") {
            Some(rest) => (true, rest),
            None => (false, name.as_str()),
        };

        let prop_path = prim_path
            .append_property(attr_name)
            .map_err(|e| UsdError::Parse(e.to_string()))?;
        let Some(value) = stage
            .attribute(prop_path)
            .get::<SdfValue>()
            .map_err(|e| UsdError::Parse(e.to_string()))?
        else {
            continue;
        };

        let mut op_matrix = build_xform_op_matrix(attr_name, &value)?;
        if invert {
            op_matrix = invert_mat4(&op_matrix).ok_or_else(|| {
                UsdError::Parse(format!("failed to invert xformOp '{attr_name}'"))
            })?;
        }
        result = mat4_mul(&result, &op_matrix);
    }

    Ok(Some(result))
}

/// Builds a column-major matrix for a single `xformOp:*` attribute. Mirrors
/// the fork's private `xform_op_matrix` but lives here so it can be called
/// from the `!invert!`-aware composer above.
pub(crate) fn build_xform_op_matrix(
    op_name: &str,
    value: &SdfValue,
) -> Result<[f64; 16], UsdError> {
    // USD namespaces xform ops as `xformOp:base[:suffix]` -- e.g.
    // `xformOp:translate:pivot`. The base at index 1 is what we dispatch on.
    let base = op_name.split(':').nth(1).unwrap_or("");
    match base {
        "transform" => match value {
            SdfValue::Matrix4d(m) => Ok((*m).into()),
            other => Err(UsdError::Parse(format!(
                "xformOp:transform must be matrix4d, got {other:?}"
            ))),
        },
        "translate" => {
            let (x, y, z) = read_vec3(value).ok_or_else(|| {
                UsdError::Parse(format!("xformOp:translate must be vec3, got {value:?}"))
            })?;
            Ok(translation_mat4(x, y, z))
        }
        "scale" => {
            let (x, y, z) = read_vec3(value).ok_or_else(|| {
                UsdError::Parse(format!("xformOp:scale must be vec3, got {value:?}"))
            })?;
            Ok(scale_mat4(x, y, z))
        }
        "rotateX" => {
            let a = read_angle(value)
                .ok_or_else(|| UsdError::Parse("xformOp:rotateX must be scalar".into()))?;
            Ok(rotate_x_mat4(a))
        }
        "rotateY" => {
            let a = read_angle(value)
                .ok_or_else(|| UsdError::Parse("xformOp:rotateY must be scalar".into()))?;
            Ok(rotate_y_mat4(a))
        }
        "rotateZ" => {
            let a = read_angle(value)
                .ok_or_else(|| UsdError::Parse("xformOp:rotateZ must be scalar".into()))?;
            Ok(rotate_z_mat4(a))
        }
        "orient" => {
            // USD stores quaternions as `(real, i, j, k)` i.e.
            // `[w, x, y, z]` in array order.
            let (w, x, y, z) = read_quat(value).ok_or_else(|| {
                UsdError::Parse(format!(
                    "xformOp:orient must be a quat (Quatf/Quatd/Quath), got {value:?}"
                ))
            })?;
            Ok(quat_to_mat4(w, x, y, z))
        }
        "rotateXYZ" | "rotateXZY" | "rotateYXZ" | "rotateYZX" | "rotateZXY" | "rotateZYX" => {
            let (rx, ry, rz) = read_vec3(value).ok_or_else(|| {
                UsdError::Parse(format!("Euler xformOp must be vec3, got {value:?}"))
            })?;
            // Axis suffix lists innermost-first (e.g. XYZ means X then Y
            // then Z applied to the point). In column-vector convention
            // we multiply right-to-left, so the first listed axis becomes
            // the rightmost factor.
            let mut m = identity_mat4();
            for axis in base[6..].chars().rev() {
                let r = match axis {
                    'X' => rotate_x_mat4(rx),
                    'Y' => rotate_y_mat4(ry),
                    'Z' => rotate_z_mat4(rz),
                    _ => unreachable!(),
                };
                m = mat4_mul(&m, &r);
            }
            Ok(m)
        }
        other => Err(UsdError::Parse(format!("Unsupported xformOp: {other}"))),
    }
}

fn read_vec3(value: &SdfValue) -> Option<(f64, f64, f64)> {
    match value {
        SdfValue::Vec3d(v) => {
            let [x, y, z]: [f64; 3] = (*v).into();
            Some((x, y, z))
        }
        SdfValue::Vec3f(v) => {
            let [x, y, z]: [f32; 3] = (*v).into();
            Some((x as f64, y as f64, z as f64))
        }
        SdfValue::Vec3h(v) => {
            let [x, y, z]: [f16; 3] = (*v).into();
            Some((f64::from(x), f64::from(y), f64::from(z)))
        }
        _ => None,
    }
}

fn read_angle(value: &SdfValue) -> Option<f64> {
    match value {
        SdfValue::Float(f) => Some(*f as f64),
        SdfValue::Double(d) => Some(*d),
        SdfValue::Half(h) => Some(f64::from(*h)),
        _ => None,
    }
}

/// Extracts a quaternion from any of USD's quat value types. openusd
/// v0.5 exposes `gf::Quat*` arrays in scalar-first order:
/// `[w, x, y, z]`. Return the same scalar-first tuple so matrix
/// construction stays aligned with USD's `(real, i, j, k)` convention.
pub(crate) fn read_quat(value: &SdfValue) -> Option<(f64, f64, f64, f64)> {
    match value {
        SdfValue::Quatd(v) => {
            let [w, x, y, z]: [f64; 4] = (*v).into();
            Some((w, x, y, z))
        }
        SdfValue::Quatf(v) => {
            let [w, x, y, z]: [f32; 4] = (*v).into();
            Some((w as f64, x as f64, y as f64, z as f64))
        }
        SdfValue::Quath(v) => {
            let [w, x, y, z]: [f16; 4] = (*v).into();
            Some((f64::from(w), f64::from(x), f64::from(y), f64::from(z)))
        }
        _ => None,
    }
}

/// Builds a column-major rotation matrix from a USD quaternion.
/// Assumes `(w, x, y, z)` element order (USD convention: real part first).
/// Normalizes the quaternion first -- authored quaternions from DCC tools
/// are usually unit-length but we guard against slightly denormalized
/// inputs that would otherwise produce a scaled rotation.
fn quat_to_mat4(w: f64, x: f64, y: f64, z: f64) -> [f64; 16] {
    let norm_sq = w * w + x * x + y * y + z * z;
    let (w, x, y, z) = if norm_sq > 1e-20 && (norm_sq - 1.0).abs() > 1e-6 {
        let inv = 1.0 / norm_sq.sqrt();
        (w * inv, x * inv, y * inv, z * inv)
    } else {
        (w, x, y, z)
    };

    let xx = x * x;
    let yy = y * y;
    let zz = z * z;
    let xy = x * y;
    let xz = x * z;
    let yz = y * z;
    let wx = w * x;
    let wy = w * y;
    let wz = w * z;

    // Column-major: m[col*4 + row].
    [
        1.0 - 2.0 * (yy + zz),
        2.0 * (xy + wz),
        2.0 * (xz - wy),
        0.0,
        2.0 * (xy - wz),
        1.0 - 2.0 * (xx + zz),
        2.0 * (yz + wx),
        0.0,
        2.0 * (xz + wy),
        2.0 * (yz - wx),
        1.0 - 2.0 * (xx + yy),
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ]
}

fn translation_mat4(tx: f64, ty: f64, tz: f64) -> [f64; 16] {
    let mut m = identity_mat4();
    m[12] = tx;
    m[13] = ty;
    m[14] = tz;
    m
}

fn scale_mat4(sx: f64, sy: f64, sz: f64) -> [f64; 16] {
    let mut m = [0.0; 16];
    m[0] = sx;
    m[5] = sy;
    m[10] = sz;
    m[15] = 1.0;
    m
}

fn rotate_x_mat4(deg: f64) -> [f64; 16] {
    let r = deg.to_radians();
    let (s, c) = r.sin_cos();
    let mut m = identity_mat4();
    m[5] = c;
    m[6] = s;
    m[9] = -s;
    m[10] = c;
    m
}

fn rotate_y_mat4(deg: f64) -> [f64; 16] {
    let r = deg.to_radians();
    let (s, c) = r.sin_cos();
    let mut m = identity_mat4();
    m[0] = c;
    m[2] = -s;
    m[8] = s;
    m[10] = c;
    m
}

fn rotate_z_mat4(deg: f64) -> [f64; 16] {
    let r = deg.to_radians();
    let (s, c) = r.sin_cos();
    let mut m = identity_mat4();
    m[0] = c;
    m[1] = s;
    m[4] = -s;
    m[5] = c;
    m
}

/// Returns `true` if the prim's `xformOpOrder` attribute contains the
/// `!resetXformStack!` pseudo-op that truncates inherited transforms.
///
/// The fork's `local_xform_of` silently ignores the token (there is no
/// `xformOp:!resetXformStack!` attribute to look up), so we probe the order
/// list here in order to honor the boundary during parent composition.
/// Any error or missing attribute is treated as "no reset".
fn has_reset_xform_stack(stage: &Stage, prim_path: &SdfPath) -> bool {
    let order_path = match prim_path.append_property("xformOpOrder") {
        Ok(p) => p,
        Err(_) => return false,
    };
    // `xformOpOrder` is authored as a token[] (or, rarely, a string[]). The
    // fork's `Value` enum stores these as `TokenVec` / `StringVec`; no
    // `TryFrom<Value>` for `Vec<String>` exists so we match the raw enum.
    match stage.attribute(order_path).get::<SdfValue>() {
        Ok(Some(SdfValue::TokenVec(ops))) => {
            ops.iter().any(|op| op.as_str() == "!resetXformStack!")
        }
        Ok(Some(SdfValue::StringVec(ops))) => ops.iter().any(|op| op == "!resetXformStack!"),
        _ => false,
    }
}
