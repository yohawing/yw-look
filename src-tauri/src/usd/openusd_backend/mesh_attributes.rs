use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::stage::MeshData;
use openusd::Stage;

/// Expand indexed face-varying UVs. USD allows `primvars:st:indices`
/// to decouple the UV array from face-vertex order — the UV array
/// is compact (unique UV coordinates only), and the indices map
/// each face vertex to its UV entry. When present, expand the
/// compact array to full face-varying layout so `classify_attribute`
/// recognizes it and `mesh_data_to_input` emits `TEXCOORD_0`.
pub(crate) fn expand_indexed_uvs(stage: &Stage, prim_path: &SdfPath, mesh_data: &mut MeshData) {
    let Some(ref uvs) = mesh_data.uvs else {
        return;
    };
    let total_fv: usize = mesh_data
        .face_vertex_counts
        .iter()
        .map(|c| *c as usize)
        .sum();
    let point_count = mesh_data.points.len() / 3;
    let uv_count = uvs.len() / 2;

    // If UVs already match vertex or face-varying count, no expansion needed.
    if uv_count == point_count || uv_count == total_fv {
        return;
    }

    // Try reading primvars:st:indices.
    let Ok(idx_path) = prim_path.append_property("primvars:st:indices") else {
        return;
    };
    let Ok(Some(idx_value)) = stage.field::<SdfValue>(idx_path, FieldKey::Default) else {
        return;
    };
    let indices: Vec<usize> = match idx_value {
        SdfValue::IntVec(v) => v.iter().map(|i| *i as usize).collect(),
        SdfValue::UintVec(v) => v.iter().map(|i| *i as usize).collect(),
        _ => return,
    };

    // indices should have total_fv entries mapping face-vertex → UV entry.
    if indices.len() != total_fv {
        return;
    }

    // Expand: for each face vertex, look up its UV via the index.
    let mut expanded = Vec::with_capacity(total_fv * 2);
    for &idx in &indices {
        if idx < uv_count {
            expanded.push(uvs[idx * 2]);
            expanded.push(uvs[idx * 2 + 1]);
        } else {
            expanded.push(0.0);
            expanded.push(0.0);
        }
    }
    mesh_data.uvs = Some(expanded);
}

/// Issue #43 displayOpacity: read `primvars:displayOpacity` from the
/// stage for a given mesh prim. Returns the flat scalar array on
/// success, or `None` when the primvar is not authored. The caller
/// determines interpolation by comparing the length against the mesh
/// topology (same pattern as `classify_attribute` uses for normals /
/// displayColor).
pub(crate) fn read_display_opacity(stage: &Stage, prim_path: &SdfPath) -> Option<Vec<f32>> {
    let prop_path = prim_path.append_property("primvars:displayOpacity").ok()?;
    let value: SdfValue = stage.field(prop_path, FieldKey::Default).ok().flatten()?;
    match value {
        SdfValue::Float(f) => Some(vec![f]),
        SdfValue::FloatVec(v) if !v.is_empty() => Some(v),
        SdfValue::Double(d) => Some(vec![d as f32]),
        SdfValue::DoubleVec(v) if !v.is_empty() => Some(v.iter().map(|&d| d as f32).collect()),
        _ => None,
    }
}
