//! Backend-independent USD mesh geometry helpers.

use openusd::sdf::Path as SdfPath;
use openusd::stage::MeshData;

use super::backend::UsdError;
use super::extract_shared::ScalarAttributeKind;
use super::glb::{self, MeshInput};
use super::skel::{pack_skin_influences, DenseBlendShape};

/// USD mesh face-vertex winding convention. Determines the triangle
/// vertex order emitted by the triangulator; `LeftHanded` meshes need
/// reversed indices so backface culling and flat-normal generation
/// agree with the Y-up right-handed GLTF coordinate system.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MeshOrientation {
    RightHanded,
    LeftHanded,
}

/// Triangulates a single face polygon and returns local vertex indices
/// (0..n) grouped into triangles. The output preserves the authored
/// winding: if the input polygon is CCW in its best-fit projection plane
/// the triangles are CCW as well, and vice versa. `MeshOrientation`
/// reversal is the caller's job.
///
/// Convex polygons — the overwhelming majority of authored USD faces —
/// take a **fan fast path** from vertex 0, matching the pre-Phase-5 fan
/// triangulation byte-for-byte. This matters for:
///   - non-planar quads, where the diagonal choice changes the rendered
///     surface (and the flat normals we emit) even though the quad is
///     not concave;
///   - face-varying attributes, where the diagonal choice decides which
///     corner values each triangle sees.
/// Ear clipping only runs when at least one corner is reflex.
///
/// Falls back to a plain fan on numerical degeneracy (colinear points,
/// zero-area projection, runaway ear search).
pub(crate) fn triangulate_polygon(positions: &[[f32; 3]]) -> Vec<[usize; 3]> {
    let n = positions.len();
    if n < 3 {
        return Vec::new();
    }
    if n == 3 {
        return vec![[0, 1, 2]];
    }

    let (nx, ny, nz) = newell_normal(positions);
    let normal_len_sq = nx * nx + ny * ny + nz * nz;
    if !normal_len_sq.is_finite() || normal_len_sq < 1e-24 {
        return fan_triangulate(n);
    }

    let (ax, ay) = pick_projection_axes(nx, ny, nz);
    let proj: Vec<[f32; 2]> = positions.iter().map(|p| [p[ax], p[ay]]).collect();

    // Signed area in the picked projection. Sign tells us whether the
    // polygon is CCW (>0) or CW (<0) in this 2D basis; ear tests adapt
    // so the authored winding is preserved on output.
    let mut area2 = 0.0_f32;
    for i in 0..n {
        let a = proj[i];
        let b = proj[(i + 1) % n];
        area2 += a[0] * b[1] - b[0] * a[1];
    }
    if !area2.is_finite() || area2.abs() < 1e-20 {
        return fan_triangulate(n);
    }
    let ccw_sign: f32 = if area2 > 0.0 { 1.0 } else { -1.0 };

    // Fast path: if every corner turns the same way as the overall
    // signed area, the polygon is convex and the legacy fan split is
    // the correct output. This keeps backwards-compatible behavior for
    // tri / quad / n-gon convex faces — the ear-clipper is only needed
    // when a reflex corner actually exists.
    let mut is_convex = true;
    for i in 0..n {
        let a = proj[(i + n - 1) % n];
        let b = proj[i];
        let c = proj[(i + 1) % n];
        let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if cross * ccw_sign < 0.0 {
            is_convex = false;
            break;
        }
    }
    if is_convex {
        return fan_triangulate(n);
    }

    let mut remaining: Vec<usize> = (0..n).collect();
    let mut tris: Vec<[usize; 3]> = Vec::with_capacity(n - 2);

    // Bounded work: for a simple polygon ear clipping terminates in
    // O(n^2) steps. Add a hard cap so a pathological polygon cannot
    // hang the backend — on overflow we fall back to a fan over what
    // is left.
    let guard_max = n.saturating_mul(n) + 16;
    let mut guard = 0usize;

    while remaining.len() > 3 {
        guard += 1;
        if guard > guard_max {
            for k in 1..remaining.len() - 1 {
                tris.push([remaining[0], remaining[k], remaining[k + 1]]);
            }
            return tris;
        }

        let m = remaining.len();
        let mut ear_at: Option<usize> = None;
        for i in 0..m {
            let prev_local = (i + m - 1) % m;
            let next_local = (i + 1) % m;
            let prev_idx = remaining[prev_local];
            let cur_idx = remaining[i];
            let next_idx = remaining[next_local];
            let a = proj[prev_idx];
            let b = proj[cur_idx];
            let c = proj[next_idx];

            // Convex-corner test adapted for CW/CCW. A positive
            // cross * ccw_sign means the corner turns toward the
            // polygon interior.
            let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            if cross * ccw_sign <= 0.0 {
                continue;
            }

            let mut is_ear = true;
            for j in 0..m {
                if j == prev_local || j == i || j == next_local {
                    continue;
                }
                let p = proj[remaining[j]];
                if point_in_triangle(p, a, b, c, ccw_sign) {
                    is_ear = false;
                    break;
                }
            }

            if is_ear {
                tris.push([prev_idx, cur_idx, next_idx]);
                ear_at = Some(i);
                break;
            }
        }

        match ear_at {
            Some(i) => {
                remaining.remove(i);
            }
            None => {
                // No ear found this pass — almost always means the
                // polygon is self-intersecting or pathologically
                // degenerate. Fall back to a fan over what is left so
                // we still emit *something* rather than erroring out.
                for k in 1..remaining.len() - 1 {
                    tris.push([remaining[0], remaining[k], remaining[k + 1]]);
                }
                return tris;
            }
        }
    }

    if remaining.len() == 3 {
        tris.push([remaining[0], remaining[1], remaining[2]]);
    }

    tris
}

/// Newell's method for a robust face normal over an arbitrary simple
/// polygon. Unlike the first-three-vertices cross product this stays
/// well-defined when the leading vertices happen to be colinear, which
/// is common in automatically tessellated exports.
fn newell_normal(positions: &[[f32; 3]]) -> (f32, f32, f32) {
    let n = positions.len();
    let mut nx = 0.0_f32;
    let mut ny = 0.0_f32;
    let mut nz = 0.0_f32;
    for i in 0..n {
        let cur = positions[i];
        let nxt = positions[(i + 1) % n];
        nx += (cur[1] - nxt[1]) * (cur[2] + nxt[2]);
        ny += (cur[2] - nxt[2]) * (cur[0] + nxt[0]);
        nz += (cur[0] - nxt[0]) * (cur[1] + nxt[1]);
    }
    (nx, ny, nz)
}

/// Picks the 2D axes to use when projecting a 3D polygon onto its best
/// plane. We drop the axis whose normal component is dominant; the two
/// axes left are the most faithful 2D mapping and avoid the degeneracy
/// of projecting onto an edge-on plane.
fn pick_projection_axes(nx: f32, ny: f32, nz: f32) -> (usize, usize) {
    let nxa = nx.abs();
    let nya = ny.abs();
    let nza = nz.abs();
    if nxa >= nya && nxa >= nza {
        (1, 2)
    } else if nya >= nza {
        (0, 2)
    } else {
        (0, 1)
    }
}

/// Half-plane point-in-triangle test that respects the caller's
/// orientation sign. `ccw_sign` is +1 for CCW triangles and -1 for CW;
/// a point counts as inside when it stays on the interior side of all
/// three edges. Edge-hugging points are intentionally treated as inside
/// to block ears whose cut would step on another vertex.
fn point_in_triangle(p: [f32; 2], a: [f32; 2], b: [f32; 2], c: [f32; 2], ccw_sign: f32) -> bool {
    let d1 = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * ccw_sign;
    let d2 = ((c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0])) * ccw_sign;
    let d3 = ((a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0])) * ccw_sign;
    d1 >= 0.0 && d2 >= 0.0 && d3 >= 0.0
}

fn fan_triangulate(n: usize) -> Vec<[usize; 3]> {
    (1..n - 1).map(|k| [0usize, k, k + 1]).collect()
}

/// Triangulates a USD mesh and expands face-varying attributes into the
/// per-vertex layout `glb::build_glb` expects.
///
/// We always emit triangle soup — every face vertex becomes a unique GLTF
/// vertex even if a position is shared with neighbors. This loses the index
/// sharing the USD source had, but keeps the conversion trivial and works
/// uniformly whether normals/UVs are vertex-varying or face-varying. The
/// frontend's `GLTFLoader` is fast enough that this isn't a bottleneck for
/// the asset sizes we currently care about; revisit if Kitchen Set timings
/// regress noticeably.
pub(crate) fn mesh_data_to_input(
    prim_path: &SdfPath,
    world: [f32; 16],
    data: &MeshData,
    orientation: MeshOrientation,
    max_joint: usize,
    blend_shapes: &[DenseBlendShape],
    // Optional `primvars:displayOpacity` values — flat scalar array.
    // Stride depends on interpolation (same topology as display_color):
    // point_count scalars for vertex, total_fv for faceVarying,
    // face_count for uniform, or 1 for constant.
    // Pass `None` when the primvar is absent; all alphas default to 1.0.
    display_opacity: Option<&[f32]>,
    display_opacity_kind: Option<ScalarAttributeKind>,
) -> Result<MeshInput, UsdError> {
    validate_mesh_topology(prim_path, data)?;

    let point_count = data.points.len() / 3;
    let total_face_vertices: usize = data.face_vertex_counts.iter().map(|c| *c as usize).sum();
    let face_count = data.face_vertex_counts.len();

    // Determine interpolation by length comparison. USD's authored
    // `interpolation` metadata is the canonical source of truth, but
    // `mesh_of` doesn't surface it, so size matching is what we have.
    // The supported modes are:
    //   - vertex-varying     (stride * point_count)
    //   - face-varying       (stride * sum(faceVertexCounts))
    //   - uniform            (stride * face_count)            — one per face
    //   - constant           (stride)                         — one total
    let normal_kind = classify_attribute(
        data.normals.as_ref().map(Vec::as_slice),
        3,
        point_count,
        total_face_vertices,
        face_count,
    );
    let uv_kind = classify_attribute(
        data.uvs.as_ref().map(Vec::as_slice),
        2,
        point_count,
        total_face_vertices,
        face_count,
    );
    let color_kind = classify_attribute(
        data.display_color.as_ref().map(Vec::as_slice),
        3,
        point_count,
        total_face_vertices,
        face_count,
    );
    // `displayOpacity` scalar-per-element: stride 1.
    let opacity_kind = display_opacity_kind.map(AttrKind::from).unwrap_or_else(|| {
        classify_attribute(
            display_opacity,
            1,
            point_count,
            total_face_vertices,
            face_count,
        )
    });

    let mut positions: Vec<f32> = Vec::new();
    let mut normals: Vec<f32> = Vec::new();
    let mut uvs: Vec<f32> = Vec::new();
    let mut colors: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let mut next_vertex: u32 = 0;

    // Phase 6d: one per-corner `Vec<f32>` per morph target. Filled in
    // inside the corner loop using the same `point_index` that drives
    // `positions`, so after the loop each entry holds per-vertex
    // position deltas in the same layout as `MeshInput::positions`.
    let mut morph_corner_offsets: Vec<Vec<f32>> = blend_shapes.iter().map(|_| Vec::new()).collect();

    // Phase 5c E: per-vertex skin payload. UsdSkel exposes one
    // (joint_indices, joint_weights) tuple per **point**, with
    // `joints_per_vertex` influences each. We expand into the same
    // per-corner triangle-soup layout the rest of the loop produces,
    // padding / truncating to glTF's 4 influences per vertex. The
    // arrays stay empty when the source mesh isn't rigged.
    let has_skin =
        data.joint_indices.is_some() && data.joint_weights.is_some() && data.joints_per_vertex > 0;
    let mut joint_indices_out: Vec<u16> = Vec::new();
    let mut joint_weights_out: Vec<f32> = Vec::new();

    let mut fv_cursor: usize = 0;
    let mut face_points: Vec<[f32; 3]> = Vec::new();
    for (face_idx, &count_i32) in data.face_vertex_counts.iter().enumerate() {
        let count = count_i32 as usize;
        if count < 3 {
            // Skip degenerate faces (lines / points). USD allows them but
            // they don't contribute renderable triangles.
            fv_cursor += count;
            continue;
        }

        // Gather this face's vertex positions for the triangulator and
        // validate point indices up-front so the inner loop can trust
        // them. Face-varying attributes stay indexed by the original
        // `fv_cursor + local_corner` so the ear-clipper only decides the
        // triangle set, not how attributes are looked up.
        face_points.clear();
        face_points.reserve(count);
        for local in 0..count {
            let fv_index = fv_cursor + local;
            let point_index = data.face_vertex_indices[fv_index] as usize;
            if point_index >= point_count {
                return Err(UsdError::Parse(format!(
                    "Mesh '{}' faceVertexIndex {} out of range (point_count={})",
                    prim_path.as_str(),
                    point_index,
                    point_count
                )));
            }
            face_points.push([
                data.points[point_index * 3],
                data.points[point_index * 3 + 1],
                data.points[point_index * 3 + 2],
            ]);
        }

        // Ear-clipping in the face's best-fit plane. Triangles (count==3)
        // and convex quads take a fast path inside `triangulate_polygon`;
        // concave n-gons get fully ear-clipped. LeftHanded winding is
        // handled below by reversing each output triangle so GLTF's
        // right-handed convention keeps pointing at the authored front
        // face.
        let triangles = triangulate_polygon(&face_points);

        for tri in &triangles {
            let corners: [usize; 3] = match orientation {
                MeshOrientation::RightHanded => [tri[0], tri[1], tri[2]],
                MeshOrientation::LeftHanded => [tri[0], tri[2], tri[1]],
            };
            for &local_corner in &corners {
                let fv_index = fv_cursor + local_corner;
                let point_index = data.face_vertex_indices[fv_index] as usize;

                positions.push(data.points[point_index * 3]);
                positions.push(data.points[point_index * 3 + 1]);
                positions.push(data.points[point_index * 3 + 2]);

                // Phase 6d: mirror the position push into every morph
                // target's delta array, indexed by the same
                // `point_index`. Each `DenseBlendShape.offsets` is
                // already sparse-expanded to cover every point, so the
                // lookup is a straight index.
                for (target_idx, target) in blend_shapes.iter().enumerate() {
                    let off = point_index * 3;
                    let out = &mut morph_corner_offsets[target_idx];
                    out.push(target.offsets[off]);
                    out.push(target.offsets[off + 1]);
                    out.push(target.offsets[off + 2]);
                }

                if let Some(src) = &data.normals {
                    match normal_kind {
                        AttrKind::Vertex => {
                            normals.extend_from_slice(&src[point_index * 3..point_index * 3 + 3]);
                        }
                        AttrKind::FaceVarying => {
                            normals.extend_from_slice(&src[fv_index * 3..fv_index * 3 + 3]);
                        }
                        AttrKind::Uniform => {
                            normals.extend_from_slice(&src[face_idx * 3..face_idx * 3 + 3]);
                        }
                        AttrKind::Constant => {
                            normals.extend_from_slice(&src[0..3]);
                        }
                        AttrKind::None | AttrKind::Unknown => {}
                    }
                }

                // USD texCoord V runs bottom→top; glTF V runs top→bottom.
                // Flip V on every UV emission so textures render right-side-up.
                if let Some(src) = &data.uvs {
                    let push_uv = |uvs: &mut Vec<f32>, u: f32, v: f32| {
                        uvs.push(u);
                        uvs.push(1.0 - v);
                    };
                    match uv_kind {
                        AttrKind::Vertex => {
                            let off = point_index * 2;
                            push_uv(&mut uvs, src[off], src[off + 1]);
                        }
                        AttrKind::FaceVarying => {
                            let off = fv_index * 2;
                            push_uv(&mut uvs, src[off], src[off + 1]);
                        }
                        AttrKind::Uniform => {
                            let off = face_idx * 2;
                            push_uv(&mut uvs, src[off], src[off + 1]);
                        }
                        AttrKind::Constant => {
                            push_uv(&mut uvs, src[0], src[1]);
                        }
                        AttrKind::None | AttrKind::Unknown => {}
                    }
                }

                let mut pushed_rgb = false;
                if let Some(src) = &data.display_color {
                    // RGB from displayColor.
                    match color_kind {
                        AttrKind::Vertex => {
                            colors.extend_from_slice(&src[point_index * 3..point_index * 3 + 3]);
                            pushed_rgb = true;
                        }
                        AttrKind::FaceVarying => {
                            colors.extend_from_slice(&src[fv_index * 3..fv_index * 3 + 3]);
                            pushed_rgb = true;
                        }
                        AttrKind::Uniform => {
                            colors.extend_from_slice(&src[face_idx * 3..face_idx * 3 + 3]);
                            pushed_rgb = true;
                        }
                        // Constant displayColor is a material fallback
                        // color, not per-vertex COLOR_0.
                        AttrKind::Constant => {}
                        AttrKind::None | AttrKind::Unknown => {}
                    }
                }
                if !pushed_rgb
                    && display_opacity.is_some()
                    && !matches!(opacity_kind, AttrKind::None | AttrKind::Unknown)
                {
                    colors.extend_from_slice(&[1.0, 1.0, 1.0]);
                    pushed_rgb = true;
                }
                // Alpha from displayOpacity, if present and classifiable;
                // otherwise default to 1.0.
                if pushed_rgb {
                    let alpha = match opacity_kind {
                        AttrKind::Vertex => display_opacity
                            .and_then(|src| src.get(point_index))
                            .copied()
                            .unwrap_or(1.0),
                        AttrKind::FaceVarying => display_opacity
                            .and_then(|src| src.get(fv_index))
                            .copied()
                            .unwrap_or(1.0),
                        AttrKind::Uniform => display_opacity
                            .and_then(|src| src.get(face_idx))
                            .copied()
                            .unwrap_or(1.0),
                        AttrKind::Constant => display_opacity
                            .and_then(|src| src.first())
                            .copied()
                            .unwrap_or(1.0),
                        AttrKind::None | AttrKind::Unknown => 1.0,
                    };
                    colors.push(alpha);
                }

                if has_skin {
                    let jpv = data.joints_per_vertex as usize;
                    let base = point_index * jpv;
                    let src_idx = data.joint_indices.as_ref().unwrap();
                    let src_w = data.joint_weights.as_ref().unwrap();
                    let end = (base + jpv).min(src_idx.len()).min(src_w.len());
                    pack_skin_influences(
                        &src_idx[base..end],
                        &src_w[base..end],
                        &mut joint_indices_out,
                        &mut joint_weights_out,
                        max_joint,
                    );
                }

                indices.push(next_vertex);
                next_vertex += 1;
            }
        }

        fv_cursor += count;
    }

    if normals.is_empty() {
        normals = generate_flat_normals(&positions, &indices);
    }

    let morph_targets = if morph_corner_offsets.is_empty() {
        Vec::new()
    } else {
        morph_corner_offsets
            .into_iter()
            .zip(blend_shapes.iter())
            .map(|(positions, target)| glb::MorphTarget {
                name: Some(target.name.clone()),
                position_offsets: positions,
            })
            .collect()
    };

    Ok(MeshInput {
        name: prim_path.to_string(),
        world_matrix: world,
        positions,
        indices,
        normals: Some(normals),
        uvs: if uvs.is_empty() { None } else { Some(uvs) },
        colors: if colors.is_empty() {
            None
        } else {
            Some(colors)
        },
        joint_indices: if joint_indices_out.is_empty() {
            None
        } else {
            Some(joint_indices_out)
        },
        joint_weights: if joint_weights_out.is_empty() {
            None
        } else {
            Some(joint_weights_out)
        },
        material_index: 0,
        skin_index: None,
        morph_targets,
        morph_weights: blend_shapes.iter().map(|_| 0.0).collect(),
        purpose: None,
    })
}

pub(crate) fn validate_mesh_topology(prim_path: &SdfPath, data: &MeshData) -> Result<(), UsdError> {
    let point_count = data.points.len() / 3;
    if data.points.len() % 3 != 0 || point_count == 0 {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' has malformed points (len={})",
            prim_path.as_str(),
            data.points.len()
        )));
    }

    // USD stores faceVertexCounts as signed i32 but counts are
    // conceptually unsigned. A negative value means the file is corrupt
    // or adversarial — casting straight to `usize` would either panic on
    // the debug-mode arithmetic overflow or silently wrap to a massive
    // index in release mode and then index out-of-bounds into
    // `face_vertex_indices`. Reject early so we return a clean parse
    // error instead of crashing the Tauri backend.
    if let Some(bad) = data.face_vertex_counts.iter().find(|c| **c < 0) {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' has negative faceVertexCounts entry ({}); file is malformed",
            prim_path.as_str(),
            bad
        )));
    }
    if let Some(bad) = data.face_vertex_indices.iter().find(|i| **i < 0) {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' has negative faceVertexIndices entry ({}); file is malformed",
            prim_path.as_str(),
            bad
        )));
    }

    let total_face_vertices: usize = data.face_vertex_counts.iter().map(|c| *c as usize).sum();
    if total_face_vertices != data.face_vertex_indices.len() {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' faceVertexIndices length {} doesn't match sum of faceVertexCounts ({})",
            prim_path.as_str(),
            data.face_vertex_indices.len(),
            total_face_vertices
        )));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AttrKind {
    None,
    Vertex,
    FaceVarying,
    Uniform,
    Constant,
    Unknown,
}

impl From<ScalarAttributeKind> for AttrKind {
    fn from(value: ScalarAttributeKind) -> Self {
        match value {
            ScalarAttributeKind::Vertex => AttrKind::Vertex,
            ScalarAttributeKind::FaceVarying => AttrKind::FaceVarying,
            ScalarAttributeKind::Uniform => AttrKind::Uniform,
            ScalarAttributeKind::Constant => AttrKind::Constant,
        }
    }
}

fn classify_attribute(
    src: Option<&[f32]>,
    stride: usize,
    point_count: usize,
    face_vertex_count: usize,
    face_count: usize,
) -> AttrKind {
    let Some(src) = src else {
        return AttrKind::None;
    };
    if src.len() == stride {
        AttrKind::Constant
    } else if src.len() == point_count * stride {
        AttrKind::Vertex
    } else if src.len() == face_vertex_count * stride {
        AttrKind::FaceVarying
    } else if src.len() == face_count * stride {
        AttrKind::Uniform
    } else {
        AttrKind::Unknown
    }
}

fn generate_flat_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let mut normals = vec![0.0_f32; positions.len()];
    for tri in indices.chunks_exact(3) {
        let i0 = tri[0] as usize * 3;
        let i1 = tri[1] as usize * 3;
        let i2 = tri[2] as usize * 3;

        let ax = positions[i1] - positions[i0];
        let ay = positions[i1 + 1] - positions[i0 + 1];
        let az = positions[i1 + 2] - positions[i0 + 2];

        let bx = positions[i2] - positions[i0];
        let by = positions[i2 + 1] - positions[i0 + 1];
        let bz = positions[i2 + 2] - positions[i0 + 2];

        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;

        let len = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-20);
        let nx = nx / len;
        let ny = ny / len;
        let nz = nz / len;

        for &i in tri {
            let off = i as usize * 3;
            normals[off] = nx;
            normals[off + 1] = ny;
            normals[off + 2] = nz;
        }
    }
    normals
}

/// Filter a MeshData to only include faces at the given face indices
/// (0-based). Used by the GeomSubset pipeline to split a multi-
/// material mesh into per-subset MeshInputs. The points array is
/// shared (face_vertex_indices still reference the same point
/// indices); only face_vertex_counts / face_vertex_indices /
/// face-varying attributes are sliced.
pub(crate) fn filter_mesh_by_face_indices(mesh: &MeshData, face_indices: &[u32]) -> MeshData {
    let mut counts = Vec::new();
    let mut indices = Vec::new();

    // Build a face-vertex cursor map for the original mesh so we can
    // slice face-varying attributes correctly.
    let mut fv_offsets: Vec<usize> = Vec::with_capacity(mesh.face_vertex_counts.len());
    let mut cursor: usize = 0;
    for &c in &mesh.face_vertex_counts {
        fv_offsets.push(cursor);
        cursor += c as usize;
    }

    let mut new_normals: Option<Vec<f32>> = mesh.normals.as_ref().map(|_| Vec::new());
    let mut new_uvs: Option<Vec<f32>> = mesh.uvs.as_ref().map(|_| Vec::new());
    let mut new_dc: Option<Vec<f32>> = mesh.display_color.as_ref().map(|_| Vec::new());

    let total_fv: usize = mesh.face_vertex_counts.iter().map(|c| *c as usize).sum();
    let face_count = mesh.face_vertex_counts.len();

    for &fi in face_indices {
        let fi = fi as usize;
        if fi >= face_count {
            continue;
        }
        let count = mesh.face_vertex_counts[fi];
        counts.push(count);
        let off = fv_offsets[fi];
        let end = off + count as usize;
        indices.extend_from_slice(&mesh.face_vertex_indices[off..end]);

        // Face-varying attributes: copy the corresponding slice.
        // We detect face-varying by checking if the source length
        // matches total_fv * stride.
        if let (Some(src), Some(dst)) = (&mesh.normals, &mut new_normals) {
            if src.len() == total_fv * 3 {
                dst.extend_from_slice(&src[off * 3..end * 3]);
            }
        }
        if let (Some(src), Some(dst)) = (&mesh.uvs, &mut new_uvs) {
            if src.len() == total_fv * 2 {
                dst.extend_from_slice(&src[off * 2..end * 2]);
            }
        }
        if let (Some(src), Some(dst)) = (&mesh.display_color, &mut new_dc) {
            if src.len() == total_fv * 3 {
                dst.extend_from_slice(&src[off * 3..end * 3]);
            }
        }
    }

    // For vertex-varying / constant / uniform attributes, pass the
    // original arrays through unchanged; mesh_data_to_input will index
    // into them by point_index which still works because we kept the
    // same points array.
    let normals = if mesh.normals.as_ref().map(|n| n.len()) == Some(total_fv * 3) {
        new_normals
    } else {
        mesh.normals.clone()
    };
    let uvs = if mesh.uvs.as_ref().map(|u| u.len()) == Some(total_fv * 2) {
        new_uvs
    } else {
        mesh.uvs.clone()
    };
    let display_color = if mesh.display_color.as_ref().map(|d| d.len()) == Some(total_fv * 3) {
        new_dc
    } else {
        mesh.display_color.clone()
    };

    MeshData {
        points: mesh.points.clone(),
        face_vertex_indices: indices,
        face_vertex_counts: counts,
        normals,
        uvs,
        joint_indices: mesh.joint_indices.clone(),
        joint_weights: mesh.joint_weights.clone(),
        joints_per_vertex: mesh.joints_per_vertex,
        display_color,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seq_f32(len: usize, offset: f32) -> Vec<f32> {
        (0..len).map(|i| offset + i as f32).collect()
    }

    /// Helper: every output triangle must have strictly positive signed
    /// area in the projection plane implied by the polygon normal. For
    /// XY-plane fixtures that means `ccw_sign * cross > 0`.
    fn triangle_signed_area_xy(a: [f32; 3], b: [f32; 3], c: [f32; 3]) -> f32 {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    }

    fn base_mesh() -> MeshData {
        MeshData {
            points: vec![0.0; 15],
            face_vertex_indices: vec![0, 1, 2, 2, 3, 4, 0, 0, 2, 4],
            face_vertex_counts: vec![3, 4, 3],
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color: None,
        }
    }

    fn identity_matrix() -> [f32; 16] {
        [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ]
    }

    fn assert_parse_error_contains(err: UsdError, needle: &str) {
        let UsdError::Parse(msg) = err else {
            panic!("expected Parse error, got {err:?}");
        };
        assert!(
            msg.contains(needle),
            "expected error containing '{needle}', got '{msg}'"
        );
    }

    #[test]
    fn validate_mesh_topology_rejects_malformed_points() {
        let mut mesh = base_mesh();
        mesh.points = vec![0.0, 1.0];
        let prim_path = SdfPath::new("/MalformedPoints").unwrap();

        let err = validate_mesh_topology(&prim_path, &mesh)
            .expect_err("malformed point buffer must be rejected");

        assert_parse_error_contains(err, "malformed points");
    }

    #[test]
    fn validate_mesh_topology_rejects_count_index_mismatch() {
        let mut mesh = base_mesh();
        mesh.face_vertex_counts = vec![3, 3];
        mesh.face_vertex_indices = vec![0, 1, 2];
        let prim_path = SdfPath::new("/MismatchedTopology").unwrap();

        let err = validate_mesh_topology(&prim_path, &mesh)
            .expect_err("faceVertexCounts sum mismatch must be rejected");

        assert_parse_error_contains(err, "doesn't match sum of faceVertexCounts");
    }

    #[test]
    fn classify_attribute_returns_none_for_absent_source() {
        assert_eq!(classify_attribute(None, 3, 3, 6, 2), AttrKind::None);
    }

    #[test]
    fn classify_attribute_prefers_constant_for_single_element_source() {
        let src = [0.25_f32, 0.5, 0.75];

        assert_eq!(
            classify_attribute(Some(&src), 3, 1, 3, 1),
            AttrKind::Constant
        );
    }

    #[test]
    fn classify_attribute_matches_vertex_face_varying_and_uniform_lengths() {
        assert_eq!(
            classify_attribute(Some(&[0.0; 12]), 3, 4, 9, 2),
            AttrKind::Vertex
        );
        assert_eq!(
            classify_attribute(Some(&[0.0; 18]), 2, 4, 9, 2),
            AttrKind::FaceVarying
        );
        assert_eq!(
            classify_attribute(Some(&[0.0; 6]), 3, 4, 9, 2),
            AttrKind::Uniform
        );
        assert_eq!(
            classify_attribute(Some(&[0.0; 5]), 3, 4, 9, 2),
            AttrKind::Unknown
        );
    }

    /// Regression test for the P2 Codex finding: a negative entry in
    /// `faceVertexCounts` used to cast to `usize` and either panic
    /// (debug) or wrap and index OOB (release). Now the mesh builder
    /// should return a clean parse error instead of crashing.
    #[test]
    fn negative_face_counts_are_rejected() {
        let bad_mesh = MeshData {
            points: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            face_vertex_indices: vec![0, 1, 2],
            face_vertex_counts: vec![-1],
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color: None,
        };
        let prim_path = SdfPath::new("/Malicious").unwrap();
        let err = mesh_data_to_input(
            &prim_path,
            [0.0; 16],
            &bad_mesh,
            MeshOrientation::RightHanded,
            usize::MAX,
            &[],
            None,
            None,
        )
        .expect_err("negative faceVertexCounts must be rejected");
        let UsdError::Parse(msg) = err else {
            panic!("expected Parse error, got {err:?}");
        };
        assert!(
            msg.contains("negative faceVertexCounts"),
            "unexpected error message: {msg}"
        );
    }

    #[test]
    fn negative_face_vertex_indices_are_rejected() {
        let bad_mesh = MeshData {
            points: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            face_vertex_indices: vec![0, -1, 2],
            face_vertex_counts: vec![3],
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color: None,
        };
        let prim_path = SdfPath::new("/Malicious").unwrap();
        let err = mesh_data_to_input(
            &prim_path,
            [0.0; 16],
            &bad_mesh,
            MeshOrientation::RightHanded,
            usize::MAX,
            &[],
            None,
            None,
        )
        .expect_err("negative faceVertexIndices must be rejected");
        let UsdError::Parse(msg) = err else {
            panic!("expected Parse error, got {err:?}");
        };
        assert!(
            msg.contains("negative faceVertexIndices"),
            "unexpected error message: {msg}"
        );
    }

    /// End-to-end regression: feeding a concave n-gon through
    /// `mesh_data_to_input` must produce a triangle soup whose total
    /// area (in XY) equals the polygon area. A plain fan would
    /// over-count because one of its triangles flips to the "wrong"
    /// side of the reflex vertex.
    #[test]
    fn mesh_data_concave_polygon_ear_clipped() {
        // L-shaped hexagon with area 3.
        let positions_flat: Vec<f32> = vec![
            0.0, 0.0, 0.0, // 0
            2.0, 0.0, 0.0, // 1
            2.0, 1.0, 0.0, // 2
            1.0, 1.0, 0.0, // 3 reflex
            1.0, 2.0, 0.0, // 4
            0.0, 2.0, 0.0, // 5
        ];
        let data = MeshData {
            points: positions_flat,
            face_vertex_indices: vec![0, 1, 2, 3, 4, 5],
            face_vertex_counts: vec![6],
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color: None,
        };
        let prim_path = SdfPath::new("/L").unwrap();
        let out = mesh_data_to_input(
            &prim_path,
            identity_matrix(),
            &data,
            MeshOrientation::RightHanded,
            usize::MAX,
            &[],
            None,
            None,
        )
        .expect("mesh_data_to_input");

        // Each output vertex is a unique corner -> 4 triangles * 3
        // corners = 12 positions, 12 indices.
        assert_eq!(out.indices.len(), 12);
        assert_eq!(out.positions.len(), 36);

        // Sum signed area across triangles should equal L's area (3).
        let mut total = 0.0_f32;
        for tri in out.indices.chunks_exact(3) {
            let get = |idx: u32| {
                let i = idx as usize * 3;
                [out.positions[i], out.positions[i + 1], out.positions[i + 2]]
            };
            let a = get(tri[0]);
            let b = get(tri[1]);
            let c = get(tri[2]);
            let area = triangle_signed_area_xy(a, b, c);
            assert!(area > 0.0, "post-triangulation tri has area {area}");
            total += 0.5 * area;
        }
        assert!(
            (total - 3.0).abs() < 1e-3,
            "L-shaped hexagon total area = {total}, expected 3"
        );
    }

    #[test]
    fn mesh_data_constant_display_color_does_not_emit_color_0() {
        let data = MeshData {
            points: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            face_vertex_indices: vec![0, 1, 2],
            face_vertex_counts: vec![3],
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color: Some(vec![0.8, 0.2, 0.1]),
        };
        let prim_path = SdfPath::new("/ConstantColor").unwrap();

        let out = mesh_data_to_input(
            &prim_path,
            identity_matrix(),
            &data,
            MeshOrientation::RightHanded,
            usize::MAX,
            &[],
            None,
            None,
        )
        .expect("mesh_data_to_input");

        assert_eq!(out.colors, None);
    }

    #[test]
    fn mesh_data_display_opacity_without_color_emits_white_rgba() {
        let data = MeshData {
            points: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            face_vertex_indices: vec![0, 1, 2],
            face_vertex_counts: vec![3],
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color: None,
        };
        let prim_path = SdfPath::new("/OpacityOnly").unwrap();

        let out = mesh_data_to_input(
            &prim_path,
            identity_matrix(),
            &data,
            MeshOrientation::RightHanded,
            usize::MAX,
            &[],
            Some(&[1.0, 0.5, 0.25]),
            Some(ScalarAttributeKind::Vertex),
        )
        .expect("mesh_data_to_input");

        assert_eq!(
            out.colors,
            Some(vec![
                1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0, 0.25
            ])
        );
    }

    #[test]
    fn mesh_data_initializes_rest_morph_weights_for_targets() {
        let data = MeshData {
            points: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            face_vertex_indices: vec![0, 1, 2],
            face_vertex_counts: vec![3],
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color: None,
        };
        let blend_shapes = vec![
            DenseBlendShape {
                name: "Smile".to_string(),
                offsets: vec![0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0],
            },
            DenseBlendShape {
                name: "Blink".to_string(),
                offsets: vec![0.0; 9],
            },
        ];
        let prim_path = SdfPath::new("/Morph").unwrap();

        let out = mesh_data_to_input(
            &prim_path,
            identity_matrix(),
            &data,
            MeshOrientation::RightHanded,
            usize::MAX,
            &blend_shapes,
            None,
            None,
        )
        .expect("mesh_data_to_input");

        assert_eq!(out.morph_targets.len(), 2);
        assert_eq!(out.morph_weights, vec![0.0, 0.0]);
        assert_eq!(out.morph_targets[0].name.as_deref(), Some("Smile"));
        assert_eq!(out.morph_targets[1].name.as_deref(), Some("Blink"));
    }

    #[test]
    fn triangulate_triangle_passthrough() {
        let positions = vec![[0.0_f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let tris = triangulate_polygon(&positions);
        assert_eq!(tris, vec![[0, 1, 2]]);
    }

    #[test]
    fn triangulate_convex_quad_matches_fan() {
        let positions = vec![
            [0.0_f32, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ];
        let tris = triangulate_polygon(&positions);
        assert_eq!(tris.len(), 2);
        for tri in &tris {
            let area =
                triangle_signed_area_xy(positions[tri[0]], positions[tri[1]], positions[tri[2]]);
            assert!(area > 0.0, "tri {tri:?} area {area}");
        }
    }

    /// Arrow-shaped concave quad: vertex 3 is a reflex corner. A simple
    /// fan from vertex 0 produces the triangle `[0, 2, 3]` which is
    /// oriented the wrong way (negative area) because the cut crosses
    /// outside the polygon. Ear-clipping must produce only CCW
    /// triangles.
    #[test]
    fn triangulate_concave_quad_arrow() {
        let positions = vec![
            [0.0_f32, 0.0, 0.0], // 0
            [4.0, 2.0, 0.0],     // 1
            [0.0, 4.0, 0.0],     // 2
            [2.0, 2.0, 0.0],     // 3 reflex
        ];
        let tris = triangulate_polygon(&positions);
        assert_eq!(tris.len(), 2, "tris = {tris:?}");
        for tri in &tris {
            let area =
                triangle_signed_area_xy(positions[tri[0]], positions[tri[1]], positions[tri[2]]);
            assert!(area > 0.0, "triangle {tri:?} has non-positive area {area}");
        }
        let mut seen = [false; 4];
        for tri in &tris {
            for &i in tri {
                seen[i] = true;
            }
        }
        assert!(seen.iter().all(|&x| x), "all vertices should be used");
    }

    /// L-shaped hexagon: vertex 3 is reflex. Must produce exactly
    /// 4 CCW triangles that together cover the L.
    #[test]
    fn triangulate_concave_l_hexagon() {
        let positions = vec![
            [0.0_f32, 0.0, 0.0], // 0
            [2.0, 0.0, 0.0],     // 1
            [2.0, 1.0, 0.0],     // 2
            [1.0, 1.0, 0.0],     // 3 reflex
            [1.0, 2.0, 0.0],     // 4
            [0.0, 2.0, 0.0],     // 5
        ];
        let tris = triangulate_polygon(&positions);
        assert_eq!(tris.len(), 4, "tris = {tris:?}");

        let mut total_area = 0.0_f32;
        for tri in &tris {
            let area =
                triangle_signed_area_xy(positions[tri[0]], positions[tri[1]], positions[tri[2]]);
            assert!(area > 0.0, "triangle {tri:?} area {area}");
            total_area += 0.5 * area;
        }
        // L-shape area = 2*1 + 1*1 = 3.
        assert!(
            (total_area - 3.0).abs() < 1e-4,
            "total area {total_area} should equal 3"
        );
    }

    /// CW-authored concave polygon: the triangulator must preserve the
    /// authored winding (each output triangle has negative signed area
    /// in XY projection) instead of silently flipping to CCW.
    #[test]
    fn triangulate_preserves_cw_winding() {
        let positions = vec![
            [0.0_f32, 0.0, 0.0], // 0
            [0.0, 4.0, 0.0],     // 1
            [4.0, 2.0, 0.0],     // 2
            [2.0, 2.0, 0.0],     // 3 reflex
        ];
        let tris = triangulate_polygon(&positions);
        assert_eq!(tris.len(), 2);
        for tri in &tris {
            let area =
                triangle_signed_area_xy(positions[tri[0]], positions[tri[1]], positions[tri[2]]);
            assert!(
                area < 0.0,
                "CW input must produce CW triangles: {tri:?} area {area}"
            );
        }
    }

    /// Degenerate polygon (all points colinear) falls back to a fan
    /// instead of panicking or looping forever.
    #[test]
    fn triangulate_degenerate_colinear_falls_back_to_fan() {
        let positions = vec![
            [0.0_f32, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [3.0, 0.0, 0.0],
        ];
        let tris = triangulate_polygon(&positions);
        // Fan on 4 vertices = 2 triangles, even if they're zero-area.
        assert_eq!(tris.len(), 2);
    }

    #[test]
    fn filter_mesh_by_face_indices_selects_counts_and_indices() {
        let mesh = base_mesh();
        let filtered = filter_mesh_by_face_indices(&mesh, &[1, 99, 0]);

        assert_eq!(filtered.face_vertex_counts, vec![4, 3]);
        assert_eq!(filtered.face_vertex_indices, vec![2, 3, 4, 0, 0, 1, 2]);
        assert_eq!(filtered.points, mesh.points);
    }

    #[test]
    fn filter_mesh_by_face_indices_slices_face_varying_attributes() {
        let mut mesh = base_mesh();
        mesh.normals = Some(seq_f32(30, 0.0));
        mesh.uvs = Some(seq_f32(20, 100.0));
        mesh.display_color = Some(seq_f32(30, 200.0));

        let filtered = filter_mesh_by_face_indices(&mesh, &[1, 0]);

        let mut expected_normals = mesh.normals.as_ref().unwrap()[9..21].to_vec();
        expected_normals.extend_from_slice(&mesh.normals.as_ref().unwrap()[0..9]);
        assert_eq!(filtered.normals, Some(expected_normals));

        let mut expected_uvs = mesh.uvs.as_ref().unwrap()[6..14].to_vec();
        expected_uvs.extend_from_slice(&mesh.uvs.as_ref().unwrap()[0..6]);
        assert_eq!(filtered.uvs, Some(expected_uvs));

        let mut expected_dc = mesh.display_color.as_ref().unwrap()[9..21].to_vec();
        expected_dc.extend_from_slice(&mesh.display_color.as_ref().unwrap()[0..9]);
        assert_eq!(filtered.display_color, Some(expected_dc));
    }

    #[test]
    fn filter_mesh_by_face_indices_passes_through_vertex_and_constant_attributes() {
        let mut mesh = base_mesh();
        mesh.normals = Some(seq_f32(15, 0.0));
        mesh.uvs = Some(seq_f32(10, 100.0));
        mesh.display_color = Some(vec![0.25, 0.5, 0.75]);

        let filtered = filter_mesh_by_face_indices(&mesh, &[1]);

        assert_eq!(filtered.normals, mesh.normals);
        assert_eq!(filtered.uvs, mesh.uvs);
        assert_eq!(filtered.display_color, mesh.display_color);
    }

    #[test]
    fn filter_mesh_by_face_indices_skips_out_of_range_faces() {
        let mut mesh = base_mesh();
        mesh.normals = Some(seq_f32(30, 0.0));

        let filtered = filter_mesh_by_face_indices(&mesh, &[42]);

        assert!(filtered.face_vertex_counts.is_empty());
        assert!(filtered.face_vertex_indices.is_empty());
        assert_eq!(filtered.normals, Some(Vec::new()));
        assert_eq!(filtered.points, mesh.points);
    }
}
