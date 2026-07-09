//! Backend-independent matrix helpers shared by USD extraction paths.

use glam::{DMat4, Mat4, Quat, Vec3};

pub(crate) const IDENTITY_MAT4_F32: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, //
    0.0, 1.0, 0.0, 0.0, //
    0.0, 0.0, 1.0, 0.0, //
    0.0, 0.0, 0.0, 1.0,
];

#[allow(dead_code)]
pub(crate) fn mat4_mul_f32(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    (Mat4::from_cols_array(a) * Mat4::from_cols_array(b)).to_cols_array()
}

/// Column-major 4x4 matrix inverse over `f32`. Returns `None` for
/// near-singular matrices (we treat any determinant below 1e-8 as
/// non-invertible).
pub(crate) fn invert_mat4_f32(m: &[f32; 16]) -> Option<[f32; 16]> {
    let matrix = Mat4::from_cols_array(m);
    let det = matrix.determinant();
    if det.abs() < 1e-8 || !det.is_finite() {
        return None;
    }
    Some(matrix.inverse().to_cols_array())
}

/// Column-major rotation that maps a Z-up point `(x, y, z)` to the
/// equivalent Y-up point `(x, z, -y)`.
pub(crate) fn z_up_to_y_up_mat4() -> [f64; 16] {
    [
        1.0, 0.0, 0.0, 0.0, //
        0.0, 0.0, -1.0, 0.0, //
        0.0, 1.0, 0.0, 0.0, //
        0.0, 0.0, 0.0, 1.0,
    ]
}

pub(crate) fn invert_mat4(m: &[f64; 16]) -> Option<[f64; 16]> {
    invert_mat4_with_threshold(m, 1e-20)
}

pub(crate) fn invert_mat4_with_threshold(m: &[f64; 16], threshold: f64) -> Option<[f64; 16]> {
    let matrix = DMat4::from_cols_array(m);
    let det = matrix.determinant();
    if det.abs() < threshold {
        return None;
    }
    Some(matrix.inverse().to_cols_array())
}

pub(crate) fn identity_mat4() -> [f64; 16] {
    DMat4::IDENTITY.to_cols_array()
}

/// Multiplies two column-major 4x4 matrices: `a * b`.
pub(crate) fn mat4_mul(a: &[f64; 16], b: &[f64; 16]) -> [f64; 16] {
    (DMat4::from_cols_array(a) * DMat4::from_cols_array(b)).to_cols_array()
}

pub(crate) fn mat4_f64_to_f32(m: &[f64; 16]) -> [f32; 16] {
    let mut out = [0.0_f32; 16];
    for i in 0..16 {
        out[i] = m[i] as f32;
    }
    out
}

/// Build a column-major 4x4 transform from glTF-style TRS
/// (translation, rotation as `[x, y, z, w]` quaternion, scale).
/// Used by the OpenUSD C++ backend PointInstancer pass (feature-gated).
#[allow(dead_code)]
pub(crate) fn trs_to_mat4_f32(t: [f32; 3], r: [f32; 4], s: [f32; 3]) -> [f32; 16] {
    Mat4::from_scale_rotation_translation(
        Vec3::from_array(s),
        Quat::from_xyzw(r[0], r[1], r[2], r[3]),
        Vec3::from_array(t),
    )
    .to_cols_array()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_mat4_close(actual: &[f64; 16], expected: &[f64; 16]) {
        for (i, (actual, expected)) in actual.iter().zip(expected.iter()).enumerate() {
            assert!(
                (actual - expected).abs() < 1e-9,
                "matrix[{i}] expected {expected}, got {actual}"
            );
        }
    }

    fn translation_mat4(tx: f64, ty: f64, tz: f64) -> [f64; 16] {
        [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            tx, ty, tz, 1.0,
        ]
    }

    fn scale_mat4(sx: f64, sy: f64, sz: f64) -> [f64; 16] {
        [
            sx, 0.0, 0.0, 0.0, //
            0.0, sy, 0.0, 0.0, //
            0.0, 0.0, sz, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ]
    }

    #[test]
    fn glam_mat4_mul_preserves_column_major_order() {
        let transform = mat4_mul(&translation_mat4(1.0, 2.0, 3.0), &scale_mat4(2.0, 3.0, 4.0));

        assert_mat4_close(
            &transform,
            &[
                2.0, 0.0, 0.0, 0.0, //
                0.0, 3.0, 0.0, 0.0, //
                0.0, 0.0, 4.0, 0.0, //
                1.0, 2.0, 3.0, 1.0,
            ],
        );
    }

    #[test]
    fn glam_inverse_respects_thresholds() {
        let transform = mat4_mul(&translation_mat4(1.0, 2.0, 3.0), &scale_mat4(2.0, 3.0, 4.0));
        let inverse = invert_mat4(&transform).expect("invertible transform");
        let identity = mat4_mul(&transform, &inverse);
        assert_mat4_close(&identity, &identity_mat4());

        let tiny = scale_mat4(1e-8, 1e-8, 1e-8);
        assert!(invert_mat4(&tiny).is_none());
        assert!(invert_mat4_with_threshold(&tiny, 1e-30).is_some());
    }

    #[test]
    fn f32_helpers_preserve_column_major_order_and_inverse_threshold() {
        let a = [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 2.0, 0.0, 0.0, //
            0.0, 0.0, 3.0, 0.0, //
            4.0, 5.0, 6.0, 1.0,
        ];
        let b = [
            2.0, 0.0, 0.0, 0.0, //
            0.0, 3.0, 0.0, 0.0, //
            0.0, 0.0, 4.0, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ];

        assert_eq!(
            mat4_mul_f32(&a, &b),
            [
                2.0, 0.0, 0.0, 0.0, //
                0.0, 6.0, 0.0, 0.0, //
                0.0, 0.0, 12.0, 0.0, //
                4.0, 5.0, 6.0, 1.0,
            ]
        );
        assert!(invert_mat4_f32(&IDENTITY_MAT4_F32).is_some());
        assert!(invert_mat4_f32(&[0.0; 16]).is_none());
    }

    fn assert_mat4_f32_close(actual: &[f32; 16], expected: &[f32; 16]) {
        for (i, (actual, expected)) in actual.iter().zip(expected.iter()).enumerate() {
            assert!(
                (actual - expected).abs() < 1e-5,
                "matrix[{i}] expected {expected}, got {actual}"
            );
        }
    }

    #[test]
    fn trs_to_mat4_f32_uses_gltf_quaternion_order() {
        let half_turn = std::f32::consts::FRAC_1_SQRT_2;
        let transform =
            trs_to_mat4_f32([1.0, 2.0, 3.0], [0.0, 0.0, half_turn, half_turn], [1.0; 3]);

        assert_mat4_f32_close(
            &transform,
            &[
                0.0, 1.0, 0.0, 0.0, //
                -1.0, 0.0, 0.0, 0.0, //
                0.0, 0.0, 1.0, 0.0, //
                1.0, 2.0, 3.0, 1.0,
            ],
        );
    }
}
