//! Minimal GLB writer used by Phase 3's USDC → Three.js geometry pipeline.
//!
//! Takes already-triangulated, per-vertex mesh data and produces a self-
//! contained GLB binary that `GLTFLoader.parseAsync` can consume on the
//! frontend. Phase 5a widens the surface to per-mesh PBR materials so the
//! UsdPreviewSurface integration can light scenes correctly; callers pass
//! a flat list of `MaterialInput`s and a `material_index` on each mesh.
//! The legacy "single default material" behavior is a one-element
//! `materials` array with `material_index = 0`.
//!
//! The caller (currently `OpenusdBackend`) is responsible for:
//!   - triangulating quads / n-gons (we only accept triangle indices)
//!   - expanding face-varying normals / UVs to per-vertex form
//!   - composing world-space transforms (the `world_matrix` field is the
//!     final composed transform applied as a node matrix)
//!   - resolving UsdPreviewSurface inputs into `MaterialInput` scalars

use serde_json::{json, Value};

/// PBR material slot referenced from one or more `MeshInput`s. All
/// fields have GLTF-compatible defaults so callers can omit unauthored
/// inputs. Phase 5c adds optional `base_color_texture` so a
/// `UsdPreviewSurface` whose `inputs:diffuseColor` is connected to a
/// `UsdUVTexture` shows up with its actual texture in the preview.
#[derive(Debug, Clone)]
pub struct MaterialInput {
    /// Display name attached to the GLTF material object. Free-form.
    pub name: String,
    /// RGBA base color factor. Default `[0.7, 0.7, 0.7, 1.0]` matches
    /// the pre-Phase-5a default material so unauthored meshes keep
    /// their look.
    pub base_color_factor: [f32; 4],
    /// 0.0 – 1.0. Default `0.0`.
    pub metallic_factor: f32,
    /// 0.0 – 1.0. Default `0.9`.
    pub roughness_factor: f32,
    /// Linear RGB emissive color. Default `[0.0, 0.0, 0.0]`.
    pub emissive_factor: [f32; 3],
    /// GLTF `doubleSided` flag. USD Mesh orientation metadata is baked
    /// into the triangulator winding so the default is `true`.
    pub double_sided: bool,
    /// Phase 5c: optional base color (sRGB) texture to embed in the GLB
    /// BIN chunk. `None` keeps the legacy "no texture, factor only"
    /// behavior. The actual byte payload + MIME type live in
    /// `BuildContext::textures` keyed by the index stored here so the
    /// builder can dedupe textures across materials.
    pub base_color_texture: Option<usize>,
    /// Phase 6a: optional tangent-space normal map (linear) texture.
    /// Same indexing semantics as `base_color_texture`. Emitted as the
    /// glTF `material.normalTexture` (sibling of `pbrMetallicRoughness`,
    /// not nested inside it). The `texCoord` is hardcoded to 0 and
    /// `scale` is left at the glTF default (1.0); per-channel `scale`
    /// support belongs to Phase 10 with the rest of multi-hop shader
    /// resolution.
    pub normal_texture: Option<usize>,
    /// Phase 6b: optional UV transform applied to the base color
    /// texture. Emitted as the `KHR_texture_transform` extension on
    /// the `baseColorTexture` reference; the identity transform is
    /// represented as `None` so the extension is omitted from the
    /// GLB JSON when no `UsdTransform2d` is authored.
    pub base_color_texture_transform: Option<TextureTransform>,
    /// Phase 6b: same as `base_color_texture_transform` but for the
    /// normal map. USD assets commonly share one `UsdTransform2d`
    /// between both channels; the two values are resolved
    /// independently so per-channel transforms (rare but valid) come
    /// through correctly.
    pub normal_texture_transform: Option<TextureTransform>,
    /// Phase 5e L1: glTF wrap mode for the base color texture sampler.
    /// `10497` = REPEAT (default), `33071` = CLAMP_TO_EDGE,
    /// `33648` = MIRRORED_REPEAT. Only meaningful when
    /// `base_color_texture` is `Some`.
    pub wrap_s: u32,
    /// Same as `wrap_s` for the T axis.
    pub wrap_t: u32,
}

/// Phase 6b: glTF `KHR_texture_transform` payload. USD's
/// `UsdTransform2d` applies its inputs in scale → rotate → translate
/// order, which matches the glTF spec's "scale applied first, then
/// rotation, then translation", so the USD inputs map directly to the
/// glTF fields. `rotation` is stored in **radians** (converted from the
/// USD `float inputs:rotation` in degrees at resolve time) so the GLB
/// serializer does not need to know about the USD authoring unit.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextureTransform {
    pub offset: [f32; 2],
    pub rotation: f32,
    pub scale: [f32; 2],
}

impl TextureTransform {
    /// Identity transform — caller-side helper for unit tests and the
    /// rare "authored transform but all defaults" case. Not emitted to
    /// the GLB (the serializer drops identity transforms).
    pub fn identity() -> Self {
        Self {
            offset: [0.0, 0.0],
            rotation: 0.0,
            scale: [1.0, 1.0],
        }
    }

    /// Returns true when the transform is close enough to the identity
    /// that `KHR_texture_transform` can be omitted. Uses a small
    /// epsilon because floating-point conversion from USD's double or
    /// degree-based authoring can introduce tiny residuals.
    pub fn is_identity(&self) -> bool {
        const EPS: f32 = 1e-6;
        (self.offset[0].abs() < EPS)
            && (self.offset[1].abs() < EPS)
            && (self.rotation.abs() < EPS)
            && ((self.scale[0] - 1.0).abs() < EPS)
            && ((self.scale[1] - 1.0).abs() < EPS)
    }
}

/// Build the JSON payload for one `KHR_texture_transform` extension
/// entry. Emitted inline on a `baseColorTexture` / `normalTexture`
/// reference; the top-level `extensionsUsed` declaration is handled
/// separately by the GLB document builder.
fn texture_transform_extension(t: &TextureTransform) -> Value {
    json!({
        "KHR_texture_transform": {
            "offset": [t.offset[0], t.offset[1]],
            "rotation": t.rotation,
            "scale": [t.scale[0], t.scale[1]],
        }
    })
}

impl MaterialInput {
    /// The default material yw-look used before Phase 5a introduced
    /// per-mesh MaterialInput. Kept so simple callers can avoid
    /// threading a materials array through when they only want the
    /// legacy "neutral grey" preview look.
    pub fn default_preview() -> Self {
        Self {
            name: "yw_look_default".to_string(),
            base_color_factor: [0.7, 0.7, 0.7, 1.0],
            metallic_factor: 0.0,
            roughness_factor: 0.9,
            emissive_factor: [0.0, 0.0, 0.0],
            double_sided: true,
            base_color_texture: None,
            normal_texture: None,
            base_color_texture_transform: None,
            normal_texture_transform: None,
            wrap_s: 10497,
            wrap_t: 10497,
        }
    }
}

/// One image to embed in the GLB binary chunk and reference from a
/// material as a `baseColorTexture`. The builder pads the BIN chunk
/// for alignment and writes a single `images[i]` + `textures[i]` +
/// `samplers[0]` triple per `TextureInput`.
#[derive(Debug, Clone)]
pub struct TextureInput {
    /// Display name attached to the glTF image / texture. Free-form;
    /// usually the source asset path.
    pub name: String,
    /// glTF MIME type, must be `"image/png"` or `"image/jpeg"`.
    /// Anything else is rejected at validation time.
    pub mime_type: String,
    /// Raw image bytes (PNG or JPEG file content as it would land on
    /// disk).
    pub data: Vec<u8>,
}

/// One UsdSkel skeleton flattened into the data glTF needs for a
/// `skin`. Joint hierarchy + bind / rest pose only — animation lives
/// on `AnimationInput`. Phase 5c E.
#[derive(Debug, Clone)]
pub struct SkinInput {
    /// Display name attached to the glTF skin.
    pub name: String,
    /// Joint display names, one per joint, in authored order.
    pub joint_names: Vec<String>,
    /// Parent index per joint, `None` for root joints. Must be the
    /// same length as `joint_names`. Used to build the joint node
    /// hierarchy.
    pub parents: Vec<Option<usize>>,
    /// Local rest-pose transforms (column-major 4×4). One per joint.
    /// Used as the default `matrix` of each joint node so the skin
    /// renders in its rest pose when no animation is bound.
    pub rest_local_matrices: Vec<[f32; 16]>,
    /// Inverse-bind matrices (column-major 4×4). One per joint. The
    /// caller must invert UsdSkelSkeleton's `bindTransforms` (which
    /// are world-space bind transforms) before constructing this
    /// vector — the GLB writer takes the values verbatim.
    pub inverse_bind_matrices: Vec<[f32; 16]>,
}

/// One UsdSkelSkelAnimation flattened to glTF animation channels.
/// Times are in **seconds** (the caller must convert from USD time
/// codes by dividing by `timeCodesPerSecond` if it differs from 1.0).
/// Phase 5c E.
#[derive(Debug, Clone)]
pub struct AnimationInput {
    /// Display name attached to the glTF animation.
    pub name: String,
    /// Time samples in seconds. Must be sorted and unique. Length is
    /// `times.len()` for every channel below.
    pub times: Vec<f32>,
    /// Index into `SkinInput::joint_names` of the skin this animation
    /// targets. Phase 5c E only supports one skin per stage so this
    /// is always `0`, but the field is here for forward compatibility.
    pub skin_index: usize,
    /// Per-joint translation channels. `Some(vec)` means the joint
    /// is animated; `vec` is `times.len()` × VEC3 (x, y, z) flat
    /// floats. `None` means the joint stays at its rest pose.
    pub translations: Vec<Option<Vec<f32>>>,
    /// Per-joint rotation channels in **glTF quaternion order**
    /// (x, y, z, w). Same shape rules as `translations`.
    pub rotations: Vec<Option<Vec<f32>>>,
    /// Per-joint scale channels (VEC3). Same shape rules.
    pub scales: Vec<Option<Vec<f32>>>,
}

/// Phase 6d: one morph target attached to a mesh. glTF stores morph
/// targets as per-vertex **delta arrays** (offset from the base
/// position / normal), not absolute positions, and the final vertex
/// position is `base + sum(weight[i] * target[i].position)`. The
/// yw-look walker converts USD's sparse `UsdSkelBlendShape.offsets` +
/// `pointIndices` into dense per-corner arrays before stuffing them
/// here so the GLB writer only has to emit accessors.
///
/// Per-target normals are optional and omitted for Phase 6d; the
/// renderer re-computes normals from deformed positions, which is
/// visually noisier but keeps the initial commit small.
#[derive(Debug, Clone)]
pub struct MorphTarget {
    /// Optional display name. Emitted into
    /// `mesh.extras.targetNames` so renderers with shape-key UIs can
    /// label the sliders.
    pub name: Option<String>,
    /// Per-vertex position delta, flattened as `[dx, dy, dz, ...]`.
    /// Length must equal `vertex_count * 3` (same as `MeshInput::positions`).
    pub position_offsets: Vec<f32>,
}

/// One mesh ready to be packed into a GLB. Positions / normals / UVs are
/// per-vertex; `indices` describes triangles into those arrays.
#[derive(Debug, Clone)]
pub struct MeshInput {
    /// Display name attached to the GLTF node and mesh. Free-form.
    pub name: String,
    /// Column-major 4x4 world transform applied as a node `matrix`.
    pub world_matrix: [f32; 16],
    /// Vertex positions, length must be a multiple of 3.
    pub positions: Vec<f32>,
    /// Triangle indices into the per-vertex arrays. Length must be a
    /// multiple of 3.
    pub indices: Vec<u32>,
    /// Optional vertex normals, same vertex count as `positions`.
    pub normals: Option<Vec<f32>>,
    /// Optional UV coordinates, length = vertex_count * 2.
    pub uvs: Option<Vec<f32>>,
    /// Per-vertex RGB colors, length = `vertex_count * 3`. `Some`
    /// when the source mesh carries `primvars:displayColor` with
    /// per-vertex interpolation. Values are sRGB floats (0-1); the
    /// GLB writer emits them as-is because glTF's `COLOR_0` is
    /// interpreted as sRGB by Three.js when `vertexColors = true`.
    pub colors: Option<Vec<f32>>,
    /// Phase 5c E: optional 4-influence joint indices, length =
    /// `vertex_count * 4`. `Some` only for skinned meshes; the
    /// caller has already padded / truncated to 4 influences per
    /// vertex.
    pub joint_indices: Option<Vec<u16>>,
    /// Phase 5c E: optional 4-influence joint weights, length =
    /// `vertex_count * 4`. Parallel to `joint_indices`. Weights
    /// should sum to ≤ 1 per vertex but glTF does not require it.
    pub joint_weights: Option<Vec<f32>>,
    /// Index into the `materials` array passed to `build_glb`. Every
    /// mesh must reference a valid material; use `0` when the caller
    /// only supplies a single default material.
    pub material_index: usize,
    /// Phase 5c E: optional index into the `skins` array passed to
    /// `build_glb`. `Some(i)` means this mesh's primitive references
    /// `skins[i]` (and `joint_indices` / `joint_weights` must be
    /// `Some`); `None` means the mesh is rendered statically with
    /// only its `world_matrix` node transform.
    pub skin_index: Option<usize>,
    /// Phase 6d: morph targets (shape keys). Empty vec means the mesh
    /// has no morph deformation. Every entry's `position_offsets`
    /// array must have `vertex_count * 3` floats so the GLB writer
    /// can emit one accessor per target without re-validating against
    /// the mesh positions.
    pub morph_targets: Vec<MorphTarget>,
    /// Phase 6d: initial weight for each morph target, length must
    /// equal `morph_targets.len()`. Emitted as `mesh.weights` in the
    /// glTF JSON. yw-look currently populates this with zeros (rest
    /// pose); animation that drives the weights at runtime is a
    /// follow-up (SkelAnimation `blendShapeWeights` track).
    pub morph_weights: Vec<f32>,
}

impl MeshInput {
    fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    fn validate(&self) -> Result<(), String> {
        if self.positions.is_empty() {
            return Err(format!("mesh '{}' has no positions", self.name));
        }
        if self.positions.len() % 3 != 0 {
            return Err(format!(
                "mesh '{}' positions length {} is not a multiple of 3",
                self.name,
                self.positions.len()
            ));
        }
        if self.indices.len() % 3 != 0 {
            return Err(format!(
                "mesh '{}' index count {} is not a multiple of 3",
                self.name,
                self.indices.len()
            ));
        }
        let vc = self.vertex_count();
        if let Some(n) = &self.normals {
            if n.len() != vc * 3 {
                return Err(format!(
                    "mesh '{}' has {} normal floats but {} are required",
                    self.name,
                    n.len(),
                    vc * 3
                ));
            }
        }
        if let Some(uv) = &self.uvs {
            if uv.len() != vc * 2 {
                return Err(format!(
                    "mesh '{}' has {} uv floats but {} are required",
                    self.name,
                    uv.len(),
                    vc * 2
                ));
            }
        }
        // Phase 5c E: skin attributes must be 4 influences per vertex
        // (glTF JOINTS_0 / WEIGHTS_0 use VEC4) and the skin_index
        // must be set whenever they are present.
        match (&self.joint_indices, &self.joint_weights, self.skin_index) {
            (Some(indices), Some(weights), Some(_)) => {
                if indices.len() != vc * 4 {
                    return Err(format!(
                        "mesh '{}' has {} joint indices but {} are required",
                        self.name,
                        indices.len(),
                        vc * 4
                    ));
                }
                if weights.len() != vc * 4 {
                    return Err(format!(
                        "mesh '{}' has {} joint weights but {} are required",
                        self.name,
                        weights.len(),
                        vc * 4
                    ));
                }
            }
            (None, None, None) => {}
            _ => {
                return Err(format!(
                    "mesh '{}' has inconsistent skin payload (joint_indices, joint_weights, skin_index must all be set or all absent)",
                    self.name
                ));
            }
        }
        for &i in &self.indices {
            if (i as usize) >= vc {
                return Err(format!(
                    "mesh '{}' index {} out of range (vertex count {})",
                    self.name, i, vc
                ));
            }
        }
        // Phase 6d: morph target invariants. Each target's delta array
        // must be parallel to the mesh positions, and `morph_weights`
        // must be parallel to `morph_targets`. glTF itself validates
        // these at load time but we catch authoring errors closer to
        // the source.
        for (i, target) in self.morph_targets.iter().enumerate() {
            if target.position_offsets.len() != vc * 3 {
                return Err(format!(
                    "mesh '{}' morph target [{}] has {} position floats but {} are required",
                    self.name,
                    i,
                    target.position_offsets.len(),
                    vc * 3
                ));
            }
        }
        if self.morph_weights.len() != self.morph_targets.len() {
            return Err(format!(
                "mesh '{}' has {} morph weights but {} targets",
                self.name,
                self.morph_weights.len(),
                self.morph_targets.len()
            ));
        }
        Ok(())
    }

    fn position_bounds(&self) -> ([f32; 3], [f32; 3]) {
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for chunk in self.positions.chunks_exact(3) {
            for axis in 0..3 {
                if chunk[axis] < min[axis] {
                    min[axis] = chunk[axis];
                }
                if chunk[axis] > max[axis] {
                    max[axis] = chunk[axis];
                }
            }
        }
        (min, max)
    }
}

/// Phase 7a: one light to embed as a glTF `KHR_lights_punctual`
/// extension entry. yw-look maps USD `UsdLuxDistantLight` → directional
/// and `UsdLuxSphereLight` → point; area lights (`RectLight`,
/// `DiskLight`, `CylinderLight`) and `DomeLight` are intentionally
/// out of scope for 7a and will be approximated or handled via the
/// environment map pipeline in a later phase.
#[derive(Debug, Clone)]
pub struct LightInput {
    /// Display name — surfaces in Three.js `light.name` for UI.
    pub name: String,
    /// Light type. Spot is in the enum for symmetry with glTF but
    /// yw-look does not currently resolve UsdLux nodes to spot
    /// lights (USD has no direct spot primitive; authoring pattern
    /// is a SphereLight with `shaping:cone:*` inputs, which is
    /// deferred to Phase 10).
    pub kind: LightKind,
    /// Linear RGB color. USD authoring is in linear space already
    /// (matching the `inputs:color` semantic), so no sRGB conversion
    /// happens at this layer.
    pub color: [f32; 3],
    /// `inputs:intensity * 2^inputs:exposure` pre-multiplied at
    /// resolve time. glTF intensity units: lumens for point/spot,
    /// lux for directional. USD inputs are nits/cd/m² — the two
    /// differ by a constant factor that depends on the scene scale,
    /// and yw-look leaves the value as-is because the preview
    /// tonemap renders look-OK across a wide range.
    pub intensity: f32,
    /// Column-major world transform applied to the light's own glTF
    /// node. USD light direction comes from the parent Xform's
    /// rotation; we bake that (plus Z-up→Y-up correction when the
    /// stage is Z-up) into this matrix so the glTF node is the
    /// single source of truth.
    pub world_matrix: [f32; 16],
}

/// Variants yw-look resolves in Phase 7a. Kept narrow deliberately;
/// adding a new variant requires emitting the matching glTF `type`
/// string and any light-specific fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LightKind {
    Directional,
    Point,
    /// Reserved for future: USD `SphereLight` with `shaping:cone:angle`
    /// authoring, which the glTF spec maps to `spot`.
    Spot,
}

/// Phase 7b: one authored UsdGeomCamera prim resolved to glTF camera
/// attributes. glTF stores cameras as top-level document entries
/// (`cameras[i]`) and references them from nodes via `camera: i`;
/// we mirror that shape so Three.js's GLTFLoader picks them up
/// without a frontend-side bridge.
#[derive(Debug, Clone)]
pub struct CameraInput {
    /// Display name — surfaces in Three.js `camera.name` for the
    /// camera switcher UI.
    pub name: String,
    /// USD `focalLength` (mm) converted to glTF `perspective.yfov`
    /// (radians) using the authored `verticalAperture` (mm).
    pub yfov: f32,
    /// USD `horizontalAperture / verticalAperture`. glTF stores
    /// aspect ratio as `perspective.aspectRatio`. When authored
    /// apertures are missing yw-look emits the spec default of 1.0
    /// so the field is always present.
    pub aspect_ratio: f32,
    /// USD `clippingRange[0]` — glTF `perspective.znear`.
    pub znear: f32,
    /// USD `clippingRange[1]` — glTF `perspective.zfar`. `None`
    /// means "use glTF infinite far plane" (field omitted).
    pub zfar: Option<f32>,
    /// World-space transform baked from the camera's parent Xform
    /// chain plus any Z-up → Y-up correction, mirroring how mesh
    /// and light nodes carry `matrix`.
    pub world_matrix: [f32; 16],
}

/// Convert USD camera intrinsics (mm focal length + mm aperture) to
/// a glTF vertical field of view in radians. The formula is the
/// standard pinhole relation: `yfov = 2 * atan(vAperture / (2 * focal))`.
/// Falls back to π/4 (45°) when either input is non-positive so
/// malformed cameras still produce a valid glTF entry.
pub fn camera_yfov_radians(vertical_aperture_mm: f32, focal_length_mm: f32) -> f32 {
    if vertical_aperture_mm <= 0.0 || focal_length_mm <= 0.0 {
        return std::f32::consts::FRAC_PI_4;
    }
    2.0 * (vertical_aperture_mm / (2.0 * focal_length_mm)).atan()
}

/// Returns the axis-wise `(min, max)` over a flat `[x, y, z, x, y, z, ...]`
/// slice. Used for morph-target accessor bounds; callers must guarantee
/// `data.len() % 3 == 0`. An empty slice returns the identity-style
/// `(INFINITY, -INFINITY)` pair — glTF forbids that, but the serializer
/// only calls this when at least one vertex exists.
fn vec3_min_max(data: &[f32]) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for chunk in data.chunks_exact(3) {
        for axis in 0..3 {
            if chunk[axis] < min[axis] {
                min[axis] = chunk[axis];
            }
            if chunk[axis] > max[axis] {
                max[axis] = chunk[axis];
            }
        }
    }
    (min, max)
}

const GLB_MAGIC: u32 = 0x46546C67; // "glTF"
const GLB_VERSION: u32 = 2;
const CHUNK_TYPE_JSON: u32 = 0x4E4F534A; // "JSON"
const CHUNK_TYPE_BIN: u32 = 0x004E4942; // "BIN\0"

const COMPONENT_TYPE_FLOAT: u32 = 5126;
const COMPONENT_TYPE_UNSIGNED_INT: u32 = 5125;

/// Build a GLB binary from a list of meshes, materials, textures,
/// skins, and animations. Returns the GLB byte stream ready to send
/// via `tauri::ipc::Response`.
///
/// `materials` must be non-empty and every `MeshInput.material_index`
/// must point into it. Texture references on `MaterialInput` index
/// into the `textures` slice — `MaterialInput::base_color_texture =
/// Some(i)` means "use `textures[i]` as the sRGB base color sampler".
/// Pass an empty `textures` slice when no material uses one.
///
/// `skins` describe UsdSkel rigs. `MeshInput.skin_index = Some(i)`
/// references `skins[i]` and the mesh primitive will carry
/// JOINTS_0 / WEIGHTS_0 attributes from `joint_indices` and
/// `joint_weights`. Pass an empty `skins` slice for stages with no
/// rigged meshes.
///
/// `animations` are flattened SkelAnimation samples. Each animation
/// targets `skins[animation.skin_index]` and emits per-joint
/// translation / rotation / scale samplers + channels. Pass an empty
/// slice for stages without skel animation.
pub fn build_glb(
    meshes: &[MeshInput],
    materials: &[MaterialInput],
    textures: &[TextureInput],
    skins: &[SkinInput],
    animations: &[AnimationInput],
    lights: &[LightInput],
    cameras: &[CameraInput],
) -> Result<Vec<u8>, String> {
    if meshes.is_empty() {
        return Err("no meshes to export".to_string());
    }
    if materials.is_empty() {
        return Err("at least one material is required".to_string());
    }
    for (i, m) in meshes.iter().enumerate() {
        if m.material_index >= materials.len() {
            return Err(format!(
                "mesh[{i}] '{}' references material_index {} but only {} materials were supplied",
                m.name,
                m.material_index,
                materials.len()
            ));
        }
        if let Some(skin_idx) = m.skin_index {
            if skin_idx >= skins.len() {
                return Err(format!(
                    "mesh[{i}] '{}' references skin_index {} but only {} skins were supplied",
                    m.name,
                    skin_idx,
                    skins.len()
                ));
            }
        }
    }
    for (i, s) in skins.iter().enumerate() {
        if s.joint_names.is_empty() {
            return Err(format!("skin[{i}] '{}' has no joints", s.name));
        }
        if s.parents.len() != s.joint_names.len()
            || s.rest_local_matrices.len() != s.joint_names.len()
            || s.inverse_bind_matrices.len() != s.joint_names.len()
        {
            return Err(format!(
                "skin[{i}] '{}' field length mismatch (joints={}, parents={}, rest={}, ibm={})",
                s.name,
                s.joint_names.len(),
                s.parents.len(),
                s.rest_local_matrices.len(),
                s.inverse_bind_matrices.len()
            ));
        }
    }
    for (i, a) in animations.iter().enumerate() {
        if a.skin_index >= skins.len() {
            return Err(format!(
                "animation[{i}] '{}' references skin_index {} but only {} skins were supplied",
                a.name,
                a.skin_index,
                skins.len()
            ));
        }
        let joint_count = skins[a.skin_index].joint_names.len();
        if a.translations.len() != joint_count
            || a.rotations.len() != joint_count
            || a.scales.len() != joint_count
        {
            return Err(format!(
                "animation[{i}] '{}' channel arrays must match skin joint count {}",
                a.name, joint_count
            ));
        }
    }
    for (i, m) in materials.iter().enumerate() {
        if let Some(tex_idx) = m.base_color_texture {
            if tex_idx >= textures.len() {
                return Err(format!(
                    "material[{i}] '{}' references base_color_texture {} but only {} textures were supplied",
                    m.name,
                    tex_idx,
                    textures.len()
                ));
            }
        }
    }
    for (i, t) in textures.iter().enumerate() {
        if t.data.is_empty() {
            return Err(format!(
                "texture[{i}] '{}' has empty image data",
                t.name
            ));
        }
        if t.mime_type != "image/png" && t.mime_type != "image/jpeg" {
            return Err(format!(
                "texture[{i}] '{}' has unsupported mimeType '{}'; expected image/png or image/jpeg",
                t.name, t.mime_type
            ));
        }
    }
    for m in meshes {
        m.validate()?;
    }

    // ---- Layout the binary buffer ---------------------------------------
    //
    // GLTF accessors require the underlying buffer view to be aligned to
    // the size of the component. Floats (4 bytes) and u32 indices (4 bytes)
    // both need 4-byte alignment, so we pad each section to 4 bytes.

    let mut bin: Vec<u8> = Vec::new();
    let mut buffer_views: Vec<Value> = Vec::new();
    let mut accessors: Vec<Value> = Vec::new();
    let mut gltf_meshes: Vec<Value> = Vec::new();
    let mut nodes: Vec<Value> = Vec::new();
    let mut scene_nodes: Vec<Value> = Vec::new();

    for (mesh_idx, mesh) in meshes.iter().enumerate() {
        let vertex_count = mesh.vertex_count() as u64;
        let index_count = mesh.indices.len() as u64;

        // -- positions ---------------------------------------------------
        let pos_offset = bin.len() as u64;
        for &v in &mesh.positions {
            bin.extend_from_slice(&v.to_le_bytes());
        }
        let pos_byte_length = (bin.len() as u64) - pos_offset;
        pad_to_4(&mut bin);

        let position_view_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": pos_offset,
            "byteLength": pos_byte_length,
            "target": 34962, // ARRAY_BUFFER
        }));

        let (pmin, pmax) = mesh.position_bounds();
        let position_accessor_idx = accessors.len();
        accessors.push(json!({
            "bufferView": position_view_idx,
            "componentType": COMPONENT_TYPE_FLOAT,
            "count": vertex_count,
            "type": "VEC3",
            "min": [pmin[0], pmin[1], pmin[2]],
            "max": [pmax[0], pmax[1], pmax[2]],
        }));

        // -- normals (optional) ------------------------------------------
        let normal_accessor_idx = if let Some(normals) = &mesh.normals {
            let off = bin.len() as u64;
            for &v in normals {
                bin.extend_from_slice(&v.to_le_bytes());
            }
            let len = (bin.len() as u64) - off;
            pad_to_4(&mut bin);

            let view_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": off,
                "byteLength": len,
                "target": 34962,
            }));
            let acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": view_idx,
                "componentType": COMPONENT_TYPE_FLOAT,
                "count": vertex_count,
                "type": "VEC3",
            }));
            Some(acc_idx)
        } else {
            None
        };

        // -- uvs (optional) ----------------------------------------------
        let uv_accessor_idx = if let Some(uvs) = &mesh.uvs {
            let off = bin.len() as u64;
            for &v in uvs {
                bin.extend_from_slice(&v.to_le_bytes());
            }
            let len = (bin.len() as u64) - off;
            pad_to_4(&mut bin);

            let view_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": off,
                "byteLength": len,
                "target": 34962,
            }));
            let acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": view_idx,
                "componentType": COMPONENT_TYPE_FLOAT,
                "count": vertex_count,
                "type": "VEC2",
            }));
            Some(acc_idx)
        } else {
            None
        };

        // -- indices -----------------------------------------------------
        let idx_offset = bin.len() as u64;
        for &i in &mesh.indices {
            bin.extend_from_slice(&i.to_le_bytes());
        }
        let idx_byte_length = (bin.len() as u64) - idx_offset;
        pad_to_4(&mut bin);

        let index_view_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": idx_offset,
            "byteLength": idx_byte_length,
            "target": 34963, // ELEMENT_ARRAY_BUFFER
        }));
        let index_accessor_idx = accessors.len();
        accessors.push(json!({
            "bufferView": index_view_idx,
            "componentType": COMPONENT_TYPE_UNSIGNED_INT,
            "count": index_count,
            "type": "SCALAR",
        }));

        // -- vertex colors (per-vertex displayColor) ----------------------
        let color_accessor_idx = if let Some(colors) = &mesh.colors {
            let off = bin.len() as u64;
            for &v in colors {
                bin.extend_from_slice(&v.to_le_bytes());
            }
            let len = (bin.len() as u64) - off;
            pad_to_4(&mut bin);
            let view_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": off,
                "byteLength": len,
                "target": 34962,
            }));
            let acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": view_idx,
                "componentType": COMPONENT_TYPE_FLOAT,
                "count": vertex_count,
                "type": "VEC3",
            }));
            Some(acc_idx)
        } else {
            None
        };

        // -- joint indices / weights (Phase 5c E) ------------------------
        let (joints_accessor_idx, weights_accessor_idx) = match (
            mesh.joint_indices.as_ref(),
            mesh.joint_weights.as_ref(),
        ) {
            (Some(joint_idx), Some(joint_w)) => {
                // JOINTS_0: VEC4 of unsigned shorts (component 5123).
                let off_j = bin.len() as u64;
                for &v in joint_idx {
                    bin.extend_from_slice(&v.to_le_bytes());
                }
                let len_j = (bin.len() as u64) - off_j;
                pad_to_4(&mut bin);
                let view_j = buffer_views.len();
                buffer_views.push(json!({
                    "buffer": 0,
                    "byteOffset": off_j,
                    "byteLength": len_j,
                    "target": 34962,
                }));
                let acc_j = accessors.len();
                accessors.push(json!({
                    "bufferView": view_j,
                    "componentType": 5123, // UNSIGNED_SHORT
                    "count": vertex_count,
                    "type": "VEC4",
                }));

                // WEIGHTS_0: VEC4 of FLOAT.
                let off_w = bin.len() as u64;
                for &v in joint_w {
                    bin.extend_from_slice(&v.to_le_bytes());
                }
                let len_w = (bin.len() as u64) - off_w;
                pad_to_4(&mut bin);
                let view_w = buffer_views.len();
                buffer_views.push(json!({
                    "buffer": 0,
                    "byteOffset": off_w,
                    "byteLength": len_w,
                    "target": 34962,
                }));
                let acc_w = accessors.len();
                accessors.push(json!({
                    "bufferView": view_w,
                    "componentType": COMPONENT_TYPE_FLOAT,
                    "count": vertex_count,
                    "type": "VEC4",
                }));
                (Some(acc_j), Some(acc_w))
            }
            _ => (None, None),
        };

        // -- mesh primitive ----------------------------------------------
        let mut attributes = serde_json::Map::new();
        attributes.insert("POSITION".to_string(), json!(position_accessor_idx));
        if let Some(idx) = normal_accessor_idx {
            attributes.insert("NORMAL".to_string(), json!(idx));
        }
        if let Some(idx) = uv_accessor_idx {
            attributes.insert("TEXCOORD_0".to_string(), json!(idx));
        }
        if let Some(idx) = color_accessor_idx {
            attributes.insert("COLOR_0".to_string(), json!(idx));
        }
        if let Some(idx) = joints_accessor_idx {
            attributes.insert("JOINTS_0".to_string(), json!(idx));
        }
        if let Some(idx) = weights_accessor_idx {
            attributes.insert("WEIGHTS_0".to_string(), json!(idx));
        }

        // Phase 6d: morph targets. Each target produces one accessor
        // (per-vertex position deltas); glTF stores the pointer array
        // as `primitive.targets: [{POSITION: accessor_idx}]`. The
        // per-target `mesh.weights` parallel array is assembled below
        // at the mesh object level. Empty `morph_targets` means we
        // emit no `targets` field at all — keeping the GLB minimal
        // for the (common) no-blendshape case.
        let mut morph_target_json: Vec<Value> = Vec::with_capacity(mesh.morph_targets.len());
        for target in &mesh.morph_targets {
            // Validation already confirmed target.position_offsets.len()
            // == vertex_count * 3, so we can embed it as-is.
            let view = buffer_views.len();
            let off = bin.len() as u64;
            for f in &target.position_offsets {
                bin.extend_from_slice(&f.to_le_bytes());
            }
            let len = (bin.len() as u64) - off;
            pad_to_4(&mut bin);
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": off,
                "byteLength": len,
                "target": 34962, // ARRAY_BUFFER
            }));
            // Per the glTF spec, morph target accessors must carry
            // `min` / `max` so renderers can compute a tight
            // bounding volume for the deformed mesh; we supply them.
            let (min, max) = vec3_min_max(&target.position_offsets);
            let acc = accessors.len();
            accessors.push(json!({
                "bufferView": view,
                "componentType": COMPONENT_TYPE_FLOAT,
                "count": vertex_count,
                "type": "VEC3",
                "min": [min[0], min[1], min[2]],
                "max": [max[0], max[1], max[2]],
            }));
            morph_target_json.push(json!({
                "POSITION": acc,
            }));
        }

        let mut primitive = json!({
            "attributes": Value::Object(attributes),
            "indices": index_accessor_idx,
            "material": mesh.material_index,
            "mode": 4, // TRIANGLES
        });
        if !morph_target_json.is_empty() {
            primitive["targets"] = Value::Array(morph_target_json);
        }

        let mesh_idx_in_doc = gltf_meshes.len();
        let mut mesh_json = json!({
            "name": mesh.name,
            "primitives": [primitive],
        });
        // glTF `mesh.weights` is parallel to `primitive.targets`.
        // Emit only when the mesh has morph targets so the no-morph
        // GLB stays byte-identical to the pre-Phase-6d output.
        if !mesh.morph_weights.is_empty() {
            mesh_json["weights"] = json!(mesh.morph_weights);
        }
        // Emit `extras.targetNames` so renderers with shape-key
        // inspector UIs (Blender glTF importer, Three.js editor) can
        // label the sliders. Missing names fall back to anonymous
        // entries, which glTF permits.
        let names: Vec<Value> = mesh
            .morph_targets
            .iter()
            .map(|t| match &t.name {
                Some(n) => json!(n),
                None => Value::Null,
            })
            .collect();
        if names.iter().any(|n| !n.is_null()) {
            mesh_json["extras"] = json!({ "targetNames": names });
        }
        gltf_meshes.push(mesh_json);

        // -- node --------------------------------------------------------
        // The mesh node always carries the composed world transform
        // — even for skinned meshes. `mesh_data_to_input` keeps
        // vertex positions in mesh-local space, so without the world
        // matrix on the node a rigged mesh under any non-identity
        // USD xform would render at the wrong place. The skin's
        // joint hierarchy + inverseBindMatrices then handle the
        // rest-pose-relative deformation on top of that. (Codex P1
        // for Phase 5c E: the previous version hard-coded an
        // identity matrix here, breaking translated/rotated rigs.)
        let node_idx = nodes.len();
        let mut node_obj = json!({
            "name": format!("{}_node", mesh.name),
            "mesh": mesh_idx_in_doc,
            "matrix": mesh.world_matrix.iter().copied().collect::<Vec<f32>>(),
        });
        if let Some(skin_idx) = mesh.skin_index {
            node_obj["skin"] = json!(skin_idx);
        }
        nodes.push(node_obj);
        scene_nodes.push(json!(node_idx));

        let _ = mesh_idx; // silence unused if compiler complains
    }

    // ---- Phase 5c E: build joint nodes + skin objects -----------------
    //
    // Each `SkinInput` produces:
    //   - one node per joint, parented in `joint_names` order
    //   - one inverseBindMatrices accessor (FLOAT MAT4)
    //   - one `skins[i]` entry referencing the joint nodes + IBM
    //
    // Joint root nodes (parents == None) are added to the scene root
    // alongside mesh nodes so they exist in the hierarchy. Child
    // joints are linked through their parent's `children` array.
    let mut gltf_skins: Vec<Value> = Vec::with_capacity(skins.len());
    // Per-skin: the absolute glTF node index of every joint, in
    // `joint_names` order. Used by the animation channels below.
    let mut skin_joint_node_indices: Vec<Vec<usize>> = Vec::with_capacity(skins.len());
    for skin in skins {
        let joint_count = skin.joint_names.len();

        // Allocate node indices for every joint up front so children
        // can reference parents that haven't been pushed yet.
        let base_node = nodes.len();
        let joint_node_indices: Vec<usize> =
            (base_node..base_node + joint_count).collect();

        // Build a children list per joint by walking parents.
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); joint_count];
        let mut roots: Vec<usize> = Vec::new();
        for (i, parent) in skin.parents.iter().enumerate() {
            match *parent {
                Some(p) => children[p].push(joint_node_indices[i]),
                None => roots.push(joint_node_indices[i]),
            }
        }

        // Push joint nodes in order. Each carries its rest local
        // transform decomposed to TRS — glTF does **not** allow
        // animating a node's `matrix` property, so any joint that
        // could become an animation target must use translation /
        // rotation / scale instead. Decomposing every joint keeps
        // the schema consistent regardless of which joints turn out
        // to be animated. (Codex P1 for Phase 5c E.)
        for i in 0..joint_count {
            let (translation, rotation, scale) =
                decompose_trs_column_major(&skin.rest_local_matrices[i]);
            let mut joint_node = json!({
                "name": skin.joint_names[i],
                "translation": translation,
                "rotation": rotation,
                "scale": scale,
            });
            if !children[i].is_empty() {
                joint_node["children"] = json!(children[i]);
            }
            nodes.push(joint_node);
        }

        // Roots become scene-level nodes alongside mesh nodes.
        for root in &roots {
            scene_nodes.push(json!(root));
        }

        // Inverse bind matrices accessor: one VEC4 mat4 per joint,
        // 16 floats each, FLOAT componentType.
        let off = bin.len() as u64;
        for matrix in &skin.inverse_bind_matrices {
            for &v in matrix {
                bin.extend_from_slice(&v.to_le_bytes());
            }
        }
        let len = (bin.len() as u64) - off;
        pad_to_4(&mut bin);
        let view_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": off,
            "byteLength": len,
        }));
        let ibm_accessor_idx = accessors.len();
        accessors.push(json!({
            "bufferView": view_idx,
            "componentType": COMPONENT_TYPE_FLOAT,
            "count": joint_count,
            "type": "MAT4",
        }));

        let mut skin_obj = json!({
            "name": skin.name,
            "joints": joint_node_indices,
            "inverseBindMatrices": ibm_accessor_idx,
        });
        // glTF allows a `skeleton` property pointing at the common
        // ancestor of all joints. We use the first root if there is
        // exactly one — otherwise we leave it unset, which is also
        // valid.
        if roots.len() == 1 {
            skin_obj["skeleton"] = json!(roots[0]);
        }
        gltf_skins.push(skin_obj);
        skin_joint_node_indices.push(joint_node_indices);
    }

    // ---- Phase 5c E: build animations ---------------------------------
    //
    // For each animation we emit:
    //   - one input accessor with the time samples (FLOAT scalar)
    //   - per channel: one output accessor + one sampler + one
    //     channel pointing at the corresponding joint node and TRS
    //     path.
    let mut gltf_animations: Vec<Value> = Vec::with_capacity(animations.len());
    for animation in animations {
        // Time accessor (shared across every channel).
        let time_off = bin.len() as u64;
        for &t in &animation.times {
            bin.extend_from_slice(&t.to_le_bytes());
        }
        let time_len = (bin.len() as u64) - time_off;
        pad_to_4(&mut bin);
        let time_view = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": time_off,
            "byteLength": time_len,
        }));
        // glTF requires `min` / `max` for animation input accessors.
        let (t_min, t_max) = animation
            .times
            .iter()
            .copied()
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), t| {
                (lo.min(t), hi.max(t))
            });
        let time_accessor = accessors.len();
        accessors.push(json!({
            "bufferView": time_view,
            "componentType": COMPONENT_TYPE_FLOAT,
            "count": animation.times.len(),
            "type": "SCALAR",
            "min": [t_min],
            "max": [t_max],
        }));

        let mut samplers: Vec<Value> = Vec::new();
        let mut channels: Vec<Value> = Vec::new();
        let joint_nodes = &skin_joint_node_indices[animation.skin_index];

        // Helper closure to push one sampler + one channel for a
        // single TRS slot. `path` is one of "translation" /
        // "rotation" / "scale", `stride` is the number of floats
        // per sample (3 for VEC3, 4 for VEC4 quaternion).
        let mut emit_channel = |bin: &mut Vec<u8>,
                                buffer_views: &mut Vec<Value>,
                                accessors: &mut Vec<Value>,
                                joint_idx: usize,
                                samples: &[f32],
                                stride: usize,
                                path: &str| {
            let off = bin.len() as u64;
            for &v in samples {
                bin.extend_from_slice(&v.to_le_bytes());
            }
            let len = (bin.len() as u64) - off;
            pad_to_4(bin);
            let view_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": off,
                "byteLength": len,
            }));
            let acc_idx = accessors.len();
            let count = samples.len() / stride;
            accessors.push(json!({
                "bufferView": view_idx,
                "componentType": COMPONENT_TYPE_FLOAT,
                "count": count,
                "type": if stride == 4 { "VEC4" } else { "VEC3" },
            }));
            let sampler_idx = samplers.len();
            samplers.push(json!({
                "input": time_accessor,
                "output": acc_idx,
                "interpolation": "LINEAR",
            }));
            channels.push(json!({
                "sampler": sampler_idx,
                "target": {
                    "node": joint_nodes[joint_idx],
                    "path": path,
                },
            }));
        };

        for (joint_idx, samples) in animation.translations.iter().enumerate() {
            if let Some(samples) = samples {
                emit_channel(
                    &mut bin,
                    &mut buffer_views,
                    &mut accessors,
                    joint_idx,
                    samples,
                    3,
                    "translation",
                );
            }
        }
        for (joint_idx, samples) in animation.rotations.iter().enumerate() {
            if let Some(samples) = samples {
                emit_channel(
                    &mut bin,
                    &mut buffer_views,
                    &mut accessors,
                    joint_idx,
                    samples,
                    4,
                    "rotation",
                );
            }
        }
        for (joint_idx, samples) in animation.scales.iter().enumerate() {
            if let Some(samples) = samples {
                emit_channel(
                    &mut bin,
                    &mut buffer_views,
                    &mut accessors,
                    joint_idx,
                    samples,
                    3,
                    "scale",
                );
            }
        }

        gltf_animations.push(json!({
            "name": animation.name,
            "samplers": samplers,
            "channels": channels,
        }));
    }

    // ---- Embed textures into the BIN chunk -----------------------------
    //
    // Each TextureInput becomes one bufferView (containing the raw
    // PNG/JPEG bytes), one image (referencing that bufferView with the
    // declared mimeType), and one texture (referencing the image and
    // a single shared sampler with the glTF defaults). Materials then
    // index into the textures array via `pbrMetallicRoughness.baseColorTexture`.
    let mut gltf_images: Vec<Value> = Vec::with_capacity(textures.len());
    let mut gltf_textures: Vec<Value> = Vec::with_capacity(textures.len());
    for tex in textures {
        let off = bin.len() as u64;
        bin.extend_from_slice(&tex.data);
        let len = (bin.len() as u64) - off;
        pad_to_4(&mut bin);

        let view_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": off,
            "byteLength": len,
        }));
        let image_idx = gltf_images.len();
        gltf_images.push(json!({
            "name": tex.name,
            "mimeType": tex.mime_type,
            "bufferView": view_idx,
        }));
        gltf_textures.push(json!({
            "source": image_idx,
            "sampler": 0,
        }));
    }

    // ---- Build GLTF materials array ------------------------------------
    //
    // Phase 6b: the materials loop also tracks whether any authored
    // texture transform was emitted. When that flag ends up set, the
    // top-level GLTF document grows an `extensionsUsed` entry for
    // `KHR_texture_transform`, which is required by the glTF spec so
    // compliant loaders know to interpret the extension.
    let mut material_needs_transform_ext = false;
    let mut gltf_materials: Vec<Value> = Vec::with_capacity(materials.len());
    for m in materials.iter() {
        let mut pbr = json!({
            "baseColorFactor": [
                m.base_color_factor[0],
                m.base_color_factor[1],
                m.base_color_factor[2],
                m.base_color_factor[3],
            ],
            "metallicFactor": m.metallic_factor,
            "roughnessFactor": m.roughness_factor,
        });
        if let Some(tex_idx) = m.base_color_texture {
            let mut entry = json!({
                "index": tex_idx,
                "texCoord": 0,
            });
            // Phase 6b: attach KHR_texture_transform if a
            // UsdTransform2d was authored between the shader's
            // `inputs:st` and the texture node. Identity transforms
            // are dropped at resolve time so we never emit them here.
            if let Some(ref t) = m.base_color_texture_transform {
                entry["extensions"] = texture_transform_extension(t);
                material_needs_transform_ext = true;
            }
            pbr["baseColorTexture"] = entry;
        }
        let mut material = json!({
            "name": m.name,
            "pbrMetallicRoughness": pbr,
            "doubleSided": m.double_sided,
        });
        // Phase 6a: emit the optional normal map. glTF places
        // `normalTexture` at the material level, parallel to
        // `pbrMetallicRoughness`, not nested inside it.
        if let Some(tex_idx) = m.normal_texture {
            let mut entry = json!({
                "index": tex_idx,
                "texCoord": 0,
            });
            if let Some(ref t) = m.normal_texture_transform {
                entry["extensions"] = texture_transform_extension(t);
                material_needs_transform_ext = true;
            }
            material["normalTexture"] = entry;
        }
        // Only emit `emissiveFactor` when non-zero so the GLB stays
        // minimal for the (common) no-emission case.
        let emissive = m.emissive_factor;
        if emissive[0] > 0.0 || emissive[1] > 0.0 || emissive[2] > 0.0 {
            material["emissiveFactor"] =
                json!([emissive[0], emissive[1], emissive[2]]);
        }
        // glTF's default `alphaMode` is OPAQUE, which means the alpha
        // channel of baseColorFactor is ignored and the object always
        // renders fully opaque. `UsdPreviewSurface`'s `inputs:opacity`
        // flows into `base_color_factor[3]`, so whenever that value is
        // below 1 we need `BLEND` mode for the preview to actually
        // look translucent. A small epsilon avoids flipping modes on
        // floating-point noise around 1.0.
        if m.base_color_factor[3] < 1.0 - 1e-4 {
            material["alphaMode"] = json!("BLEND");
        }
        gltf_materials.push(material);
    }

    // ---- Phase 7a: KHR_lights_punctual -----------------------------
    //
    // For each LightInput, emit:
    //   1. A glTF light definition (top-level `extensions.KHR_lights_punctual.lights[i]`)
    //   2. A scene node carrying the authored world_matrix plus
    //      `extensions.KHR_lights_punctual.light: i`.
    //
    // Lights are always scene-root nodes (parent hierarchy is baked
    // into world_matrix) — keeps the JSON small and matches how
    // Three.js expects to find punctual lights.
    let mut gltf_light_defs: Vec<Value> = Vec::new();
    for light in lights {
        let type_str = match light.kind {
            LightKind::Directional => "directional",
            LightKind::Point => "point",
            LightKind::Spot => "spot",
        };
        let mut def = json!({
            "name": light.name,
            "type": type_str,
            "color": [light.color[0], light.color[1], light.color[2]],
            "intensity": light.intensity,
        });
        // glTF spec: only point / spot take `range`; omit (= infinite)
        // to match USD's default. Directional range is always infinite.
        // If we later resolve a USD `inputs:radius` fall-off we can add
        // a finite `range` here.
        if matches!(light.kind, LightKind::Spot) {
            // Placeholder cone for future Spot support. Keep generous
            // defaults so the light is visible if authored.
            def["spot"] = json!({
                "innerConeAngle": 0.0,
                "outerConeAngle": std::f32::consts::FRAC_PI_4,
            });
        }
        let light_idx = gltf_light_defs.len();
        gltf_light_defs.push(def);

        // Scene node for this light.
        let node_idx = nodes.len();
        nodes.push(json!({
            "name": format!("{}_light_node", light.name),
            "matrix": light.world_matrix.iter().copied().collect::<Vec<f32>>(),
            "extensions": {
                "KHR_lights_punctual": {
                    "light": light_idx,
                }
            },
        }));
        scene_nodes.push(json!(node_idx));
    }

    // ---- Phase 7b: glTF cameras -------------------------------------
    //
    // For each CameraInput we emit one top-level `cameras[i]` entry
    // and one scene node carrying the authored world_matrix plus
    // `camera: i`. Unlike lights, glTF cameras are core (no
    // extension), so there's no extensionsUsed bookkeeping.
    let mut gltf_cameras: Vec<Value> = Vec::new();
    for camera in cameras {
        let mut perspective = json!({
            "yfov": camera.yfov,
            "aspectRatio": camera.aspect_ratio,
            "znear": camera.znear,
        });
        if let Some(zfar) = camera.zfar {
            perspective["zfar"] = json!(zfar);
        }
        let camera_idx = gltf_cameras.len();
        gltf_cameras.push(json!({
            "name": camera.name,
            "type": "perspective",
            "perspective": perspective,
        }));

        let node_idx = nodes.len();
        nodes.push(json!({
            "name": format!("{}_camera_node", camera.name),
            "matrix": camera.world_matrix.iter().copied().collect::<Vec<f32>>(),
            "camera": camera_idx,
        }));
        scene_nodes.push(json!(node_idx));
    }

    // ---- Build GLTF JSON document --------------------------------------
    let total_bin_length = bin.len() as u64;

    let mut document = json!({
        "asset": {
            "version": "2.0",
            "generator": "yw-look usd-phase5c",
        },
        "scene": 0,
        "scenes": [{ "nodes": scene_nodes }],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "buffers": [{ "byteLength": total_bin_length }],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "materials": gltf_materials,
    });
    if !gltf_cameras.is_empty() {
        document["cameras"] = json!(gltf_cameras);
    }
    // Phase 6b / 7a: register extensions in the top-level
    // `extensionsUsed` list. glTF requires this declaration;
    // omitting it causes compliant loaders to drop the extension
    // or refuse the file. We build the list additively so both
    // Phase 6b (texture transforms) and Phase 7a (lights) can
    // coexist.
    let mut extensions_used: Vec<&str> = Vec::new();
    if material_needs_transform_ext {
        extensions_used.push("KHR_texture_transform");
    }
    if !gltf_light_defs.is_empty() {
        extensions_used.push("KHR_lights_punctual");
        document["extensions"] = json!({
            "KHR_lights_punctual": {
                "lights": gltf_light_defs,
            }
        });
    }
    if !extensions_used.is_empty() {
        document["extensionsUsed"] = json!(extensions_used);
    }
    if !textures.is_empty() {
        // Phase 5e L1: build a sampler per unique (wrapS, wrapT) pair
        // so different materials can use different wrap modes. Most
        // assets share the same mode, so this typically produces just
        // one sampler entry. Each texture entry references the sampler
        // whose wrap matches the first material that uses that texture.
        let mut sampler_dedup: std::collections::HashMap<(u32, u32), usize> =
            std::collections::HashMap::new();
        let mut gltf_samplers: Vec<Value> = Vec::new();
        // Re-map gltf_textures sampler indices per material wrap mode.
        for m in materials.iter() {
            if let Some(tex_idx) = m.base_color_texture {
                let key = (m.wrap_s, m.wrap_t);
                if !sampler_dedup.contains_key(&key) {
                    let idx = gltf_samplers.len();
                    gltf_samplers.push(json!({
                        "magFilter": 9729, // LINEAR
                        "minFilter": 9987, // LINEAR_MIPMAP_LINEAR
                        "wrapS": key.0,
                        "wrapT": key.1,
                    }));
                    sampler_dedup.insert(key, idx);
                }
                let sampler_idx = sampler_dedup[&key];
                // Patch the texture entry's sampler reference
                if let Some(tex) = gltf_textures.get_mut(tex_idx) {
                    tex["sampler"] = json!(sampler_idx);
                }
            }
        }
        // Fallback: if no material referenced any texture (shouldn't
        // happen since textures is non-empty), emit the default sampler.
        if gltf_samplers.is_empty() {
            gltf_samplers.push(json!({
                "magFilter": 9729,
                "minFilter": 9987,
                "wrapS": 10497,
                "wrapT": 10497,
            }));
        }
        document["images"] = Value::Array(gltf_images);
        document["textures"] = Value::Array(gltf_textures);
        document["samplers"] = Value::Array(gltf_samplers);
    }
    if !gltf_skins.is_empty() {
        document["skins"] = Value::Array(gltf_skins);
    }
    if !gltf_animations.is_empty() {
        document["animations"] = Value::Array(gltf_animations);
    }

    let mut json_bytes = serde_json::to_vec(&document)
        .map_err(|e| format!("failed to serialize GLTF JSON: {e}"))?;
    pad_chunk(&mut json_bytes, 0x20); // ASCII space for JSON chunk
    pad_chunk(&mut bin, 0x00); // zeros for BIN chunk

    // ---- Stitch GLB binary container -----------------------------------
    let json_chunk_len = json_bytes.len() as u32;
    let bin_chunk_len = bin.len() as u32;
    // 12 byte header + 8 byte chunk header + JSON + 8 byte chunk header + BIN
    let total_length: u32 = 12 + 8 + json_chunk_len + 8 + bin_chunk_len;

    let mut out = Vec::with_capacity(total_length as usize);
    out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
    out.extend_from_slice(&GLB_VERSION.to_le_bytes());
    out.extend_from_slice(&total_length.to_le_bytes());

    out.extend_from_slice(&json_chunk_len.to_le_bytes());
    out.extend_from_slice(&CHUNK_TYPE_JSON.to_le_bytes());
    out.extend_from_slice(&json_bytes);

    out.extend_from_slice(&bin_chunk_len.to_le_bytes());
    out.extend_from_slice(&CHUNK_TYPE_BIN.to_le_bytes());
    out.extend_from_slice(&bin);

    debug_assert_eq!(out.len() as u32, total_length);
    Ok(out)
}

fn pad_to_4(buf: &mut Vec<u8>) {
    while buf.len() % 4 != 0 {
        buf.push(0);
    }
}

/// Phase 5c E: decompose a column-major 4×4 affine into glTF TRS
/// (translation, rotation as `(x, y, z, w)` quaternion, scale).
/// glTF disallows animating a node's `matrix` so every joint node
/// has to be authored as TRS even when its rest pose has no
/// rotation. Handles negative scale via the determinant sign.
fn decompose_trs_column_major(m: &[f32; 16]) -> ([f32; 3], [f32; 4], [f32; 3]) {
    // Translation lives in the 4th column (indices 12, 13, 14).
    let translation = [m[12], m[13], m[14]];

    // Read each basis column.
    let mut col0 = [m[0], m[1], m[2]];
    let col1 = [m[4], m[5], m[6]];
    let col2 = [m[8], m[9], m[10]];

    let mut sx = (col0[0] * col0[0] + col0[1] * col0[1] + col0[2] * col0[2]).sqrt();
    let sy = (col1[0] * col1[0] + col1[1] * col1[1] + col1[2] * col1[2]).sqrt();
    let sz = (col2[0] * col2[0] + col2[1] * col2[1] + col2[2] * col2[2]).sqrt();

    // Account for negative scale by checking the determinant of the
    // 3×3 rotation/scale block. If it is negative we flip one axis
    // (canonically the X scale) so the residual is a pure rotation.
    let det = col0[0] * (col1[1] * col2[2] - col1[2] * col2[1])
        - col1[0] * (col0[1] * col2[2] - col0[2] * col2[1])
        + col2[0] * (col0[1] * col1[2] - col0[2] * col1[1]);
    if det < 0.0 {
        sx = -sx;
        col0[0] = -col0[0];
        col0[1] = -col0[1];
        col0[2] = -col0[2];
    }

    // Normalize each column to get the rotation matrix R = [r0 r1 r2].
    // Bail out to identity rotation when any axis is degenerate.
    let normalize = |v: &mut [f32; 3], len: f32| {
        if len.abs() > 1e-12 {
            v[0] /= len;
            v[1] /= len;
            v[2] /= len;
        } else {
            v[0] = 0.0;
            v[1] = 0.0;
            v[2] = 0.0;
        }
    };
    normalize(&mut col0, sx.abs());
    let mut col1n = col1;
    normalize(&mut col1n, sy);
    let mut col2n = col2;
    normalize(&mut col2n, sz);

    // Convert the rotation 3×3 (column-major: cols are basis
    // vectors) to a quaternion using the standard "largest trace"
    // algorithm. m_rs in row-major form for the formula:
    //   r00 r01 r02   = col0[0] col1n[0] col2n[0]
    //   r10 r11 r12     col0[1] col1n[1] col2n[1]
    //   r20 r21 r22     col0[2] col1n[2] col2n[2]
    let r00 = col0[0];
    let r01 = col1n[0];
    let r02 = col2n[0];
    let r10 = col0[1];
    let r11 = col1n[1];
    let r12 = col2n[1];
    let r20 = col0[2];
    let r21 = col1n[2];
    let r22 = col2n[2];

    let trace = r00 + r11 + r22;
    let (qx, qy, qz, qw) = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        let qw = 0.25 * s;
        let qx = (r21 - r12) / s;
        let qy = (r02 - r20) / s;
        let qz = (r10 - r01) / s;
        (qx, qy, qz, qw)
    } else if r00 > r11 && r00 > r22 {
        let s = (1.0 + r00 - r11 - r22).sqrt() * 2.0;
        let qw = (r21 - r12) / s;
        let qx = 0.25 * s;
        let qy = (r01 + r10) / s;
        let qz = (r02 + r20) / s;
        (qx, qy, qz, qw)
    } else if r11 > r22 {
        let s = (1.0 + r11 - r00 - r22).sqrt() * 2.0;
        let qw = (r02 - r20) / s;
        let qx = (r01 + r10) / s;
        let qy = 0.25 * s;
        let qz = (r12 + r21) / s;
        (qx, qy, qz, qw)
    } else {
        let s = (1.0 + r22 - r00 - r11).sqrt() * 2.0;
        let qw = (r10 - r01) / s;
        let qx = (r02 + r20) / s;
        let qy = (r12 + r21) / s;
        let qz = 0.25 * s;
        (qx, qy, qz, qw)
    };

    // Normalize the quaternion to compensate for floating-point
    // drift in the trace formulas.
    let qlen = (qx * qx + qy * qy + qz * qz + qw * qw).sqrt();
    let (qx, qy, qz, qw) = if qlen > 1e-12 {
        (qx / qlen, qy / qlen, qz / qlen, qw / qlen)
    } else {
        (0.0, 0.0, 0.0, 1.0)
    };

    (translation, [qx, qy, qz, qw], [sx, sy, sz])
}

fn pad_chunk(buf: &mut Vec<u8>, byte: u8) {
    while buf.len() % 4 != 0 {
        buf.push(byte);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity_matrix() -> [f32; 16] {
        [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ]
    }

    fn unit_quad_split_into_two_triangles() -> MeshInput {
        // 4 vertices forming a unit quad in the XY plane
        // (0,0,0), (1,0,0), (1,1,0), (0,1,0)
        MeshInput {
            name: "quad".to_string(),
            world_matrix: identity_matrix(),
            positions: vec![
                0.0, 0.0, 0.0, //
                1.0, 0.0, 0.0, //
                1.0, 1.0, 0.0, //
                0.0, 1.0, 0.0,
            ],
            indices: vec![0, 1, 2, 0, 2, 3],
            normals: Some(vec![
                0.0, 0.0, 1.0, //
                0.0, 0.0, 1.0, //
                0.0, 0.0, 1.0, //
                0.0, 0.0, 1.0,
            ]),
            uvs: Some(vec![
                0.0, 0.0, //
                1.0, 0.0, //
                1.0, 1.0, //
                0.0, 1.0,
            ]),
            colors: None,
            joint_indices: None,
            joint_weights: None,
            material_index: 0,
            skin_index: None,
            morph_targets: Vec::new(),
            morph_weights: Vec::new(),
        }
    }

    fn default_materials() -> Vec<MaterialInput> {
        vec![MaterialInput::default_preview()]
    }

    #[test]
    fn build_glb_roundtrips_a_unit_quad() {
        let mesh = unit_quad_split_into_two_triangles();
        let glb = build_glb(&[mesh], &default_materials(), &[], &[], &[], &[], &[]).expect("build glb");

        // GLB header sanity check
        assert_eq!(&glb[0..4], b"glTF");
        let version = u32::from_le_bytes(glb[4..8].try_into().unwrap());
        assert_eq!(version, 2);
        let total_length = u32::from_le_bytes(glb[8..12].try_into().unwrap());
        assert_eq!(total_length as usize, glb.len());

        // First chunk should be JSON
        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_chunk_type = u32::from_le_bytes(glb[16..20].try_into().unwrap());
        assert_eq!(json_chunk_type, CHUNK_TYPE_JSON);
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .expect("json chunk is utf8")
            .trim_end_matches(' ');
        let doc: serde_json::Value =
            serde_json::from_str(json_text).expect("json chunk parses");
        assert_eq!(doc["asset"]["version"], "2.0");
        assert_eq!(doc["meshes"][0]["primitives"][0]["mode"], 4);
        assert_eq!(doc["accessors"].as_array().unwrap().len(), 4); // pos + normal + uv + idx

        // Second chunk should be BIN, containing 4*3*4 (positions) +
        // 4*3*4 (normals) + 4*2*4 (uvs) + 6*4 (indices) = 48 + 48 + 32 + 24 = 152
        // possibly padded.
        let bin_chunk_offset = json_end;
        let bin_chunk_len =
            u32::from_le_bytes(glb[bin_chunk_offset..bin_chunk_offset + 4].try_into().unwrap())
                as usize;
        let bin_chunk_type = u32::from_le_bytes(
            glb[bin_chunk_offset + 4..bin_chunk_offset + 8].try_into().unwrap(),
        );
        assert_eq!(bin_chunk_type, CHUNK_TYPE_BIN);
        assert!(bin_chunk_len >= 152, "bin chunk too small: {bin_chunk_len}");
    }

    #[test]
    fn rejects_mismatched_normal_count() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.normals = Some(vec![0.0; 6]); // wrong length
        let err = build_glb(&[mesh], &default_materials(), &[], &[], &[], &[], &[]).unwrap_err();
        assert!(err.contains("normal"));
    }

    #[test]
    fn rejects_out_of_range_index() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.indices = vec![0, 1, 99];
        let err = build_glb(&[mesh], &default_materials(), &[], &[], &[], &[], &[]).unwrap_err();
        assert!(err.contains("out of range"));
    }

    #[test]
    fn rejects_material_index_out_of_range() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.material_index = 5;
        let err = build_glb(&[mesh], &default_materials(), &[], &[], &[], &[], &[]).unwrap_err();
        assert!(
            err.contains("material_index"),
            "expected material_index error, got: {err}"
        );
    }

    #[test]
    fn rejects_empty_materials_array() {
        let mesh = unit_quad_split_into_two_triangles();
        let err = build_glb(&[mesh], &[], &[], &[], &[], &[], &[]).unwrap_err();
        assert!(err.contains("material"));
    }

    #[test]
    fn emits_alpha_mode_blend_for_translucent_material() {
        let mesh = unit_quad_split_into_two_triangles();
        let materials = vec![MaterialInput {
            name: "glass".to_string(),
            base_color_factor: [0.2, 0.5, 0.9, 0.4],
            metallic_factor: 0.0,
            roughness_factor: 0.1,
            emissive_factor: [0.0, 0.0, 0.0],
            double_sided: true,
            base_color_texture: None,
            normal_texture: None,
            base_color_texture_transform: None,
            normal_texture_transform: None,
            wrap_s: 10497,
            wrap_t: 10497,
        }];
        let glb = build_glb(&[mesh], &materials, &[], &[], &[], &[], &[]).expect("build glb");

        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        assert_eq!(doc["materials"][0]["alphaMode"], "BLEND");
    }

    #[test]
    fn omits_alpha_mode_for_opaque_material() {
        let mesh = unit_quad_split_into_two_triangles();
        let materials = vec![MaterialInput::default_preview()];
        let glb = build_glb(&[mesh], &materials, &[], &[], &[], &[], &[]).expect("build glb");

        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // Default alphaMode is OPAQUE, so we deliberately omit the
        // field rather than writing "OPAQUE" explicitly — a minor
        // size + review-noise win.
        assert!(doc["materials"][0].get("alphaMode").is_none());
    }

    #[test]
    fn emits_multiple_materials_with_custom_factors() {
        // Two meshes referencing two different material slots — verify
        // the GLTF JSON carries both materials with their authored
        // factors, and that each mesh primitive points at the right
        // index. This covers the Phase 5a plumbing end-to-end without
        // needing a USD stage.
        let mut red_mesh = unit_quad_split_into_two_triangles();
        red_mesh.name = "red".to_string();
        red_mesh.material_index = 0;
        let mut blue_mesh = unit_quad_split_into_two_triangles();
        blue_mesh.name = "blue".to_string();
        blue_mesh.material_index = 1;

        let materials = vec![
            MaterialInput {
                name: "red".to_string(),
                base_color_factor: [1.0, 0.2, 0.2, 1.0],
                metallic_factor: 0.1,
                roughness_factor: 0.4,
                emissive_factor: [0.0, 0.0, 0.0],
                double_sided: false,
                base_color_texture: None,
                normal_texture: None,
                wrap_s: 10497,
                wrap_t: 10497,
                base_color_texture_transform: None,
                normal_texture_transform: None,
            },
            MaterialInput {
                name: "blue_emissive".to_string(),
                base_color_factor: [0.1, 0.2, 0.9, 1.0],
                metallic_factor: 0.8,
                roughness_factor: 0.2,
                emissive_factor: [0.0, 0.0, 0.4],
                double_sided: true,
                base_color_texture: None,
                normal_texture: None,
                wrap_s: 10497,
                wrap_t: 10497,
                base_color_texture_transform: None,
                normal_texture_transform: None,
            },
        ];

        let glb = build_glb(&[red_mesh, blue_mesh], &materials, &[], &[], &[], &[], &[]).expect("build glb");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let materials_arr = doc["materials"].as_array().expect("materials array");
        assert_eq!(materials_arr.len(), 2);
        assert_eq!(materials_arr[0]["name"], "red");
        let base = materials_arr[0]["pbrMetallicRoughness"]["baseColorFactor"]
            .as_array()
            .expect("baseColorFactor array");
        let expected_red = [1.0_f64, 0.2, 0.2, 1.0];
        for (i, component) in base.iter().enumerate() {
            let v = component.as_f64().expect("factor is number");
            assert!(
                (v - expected_red[i]).abs() < 1e-5,
                "baseColorFactor[{i}] = {v}, expected {}",
                expected_red[i]
            );
        }
        assert!(
            materials_arr[0].get("emissiveFactor").is_none(),
            "zero emissive should be omitted"
        );
        assert_eq!(materials_arr[1]["name"], "blue_emissive");
        assert_eq!(materials_arr[1]["doubleSided"], true);
        let emissive = materials_arr[1]["emissiveFactor"]
            .as_array()
            .expect("emissiveFactor array");
        let expected_emissive = [0.0_f64, 0.0, 0.4];
        for (i, component) in emissive.iter().enumerate() {
            let v = component.as_f64().expect("emissive component");
            assert!(
                (v - expected_emissive[i]).abs() < 1e-5,
                "emissiveFactor[{i}] = {v}",
            );
        }

        let meshes_arr = doc["meshes"].as_array().expect("meshes array");
        assert_eq!(meshes_arr[0]["primitives"][0]["material"], 0);
        assert_eq!(meshes_arr[1]["primitives"][0]["material"], 1);
    }
}
