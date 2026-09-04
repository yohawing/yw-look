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
use std::collections::HashSet;
use std::mem::size_of;
use std::time::Instant;

use crate::preview::glb::{
    append_accessor_with, append_buffer_view_with, checked_binary_byte_length, AccessorSpec,
};

fn glb_timing_enabled() -> bool {
    std::env::var_os("YW_LOOK_USD_TIMING").is_some()
}

fn log_glb_phase_timing(label: &str, phase_started: &mut Option<Instant>) {
    if let Some(started) = phase_started.as_mut() {
        log::debug!(
            "[usd glb timing] {label}: {}ms",
            started.elapsed().as_millis()
        );
        *started = Instant::now();
    }
}

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
    /// Phase 5e L1: glTF wrap mode for the material's texture sampler.
    /// `10497` = REPEAT (default), `33071` = CLAMP_TO_EDGE,
    /// `33648` = MIRRORED_REPEAT. Applied to base color and normal map
    /// textures under the current one-wrap-per-material model.
    pub wrap_s: u32,
    /// Same as `wrap_s` for the T axis.
    pub wrap_t: u32,
    /// Phase 2.N: ORM-packed metallic / roughness texture. glTF
    /// samples roughness from the G channel and metallic from the B
    /// channel of a single texture. When both UsdPreviewSurface
    /// inputs connect to the same asset (the common ORM workflow),
    /// we emit one shared texture slot; when only one of the two is
    /// authored, the other channel falls back to the scalar factor.
    /// `None` keeps the pre-Phase-2.N behavior (scalar factors only).
    pub metallic_roughness_texture: Option<usize>,
    /// Phase 2.M: UsdPreviewSurface-derived alpha mode.
    /// `None` → omit (glTF default OPAQUE) / `Some("MASK")` / `Some("BLEND")`.
    /// Authored scalar opacity < 1.0 implies BLEND; any non-zero
    /// `opacityThreshold` implies MASK with the threshold forwarded
    /// into `alpha_cutoff`.
    pub alpha_mode: Option<AlphaMode>,
    /// MASK-mode cutoff threshold (ignored for OPAQUE / BLEND). glTF
    /// default `0.5` matches the UsdPreviewSurface spec when
    /// `opacityThreshold` is unauthored.
    pub alpha_cutoff: f32,
}

/// Phase 2.M: glTF alphaMode enumeration. UsdPreviewSurface's
/// opacity / opacityThreshold pair maps directly:
///   - `opacityThreshold > 0` → `Mask(threshold)`
///   - `opacity < 1.0`         → `Blend`
///   - otherwise               → unset (glTF default OPAQUE)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlphaMode {
    Mask,
    Blend,
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
            alpha_mode: None,
            alpha_cutoff: 0.5,
            metallic_roughness_texture: None,
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
    /// Phase 2.P: composed world transform of the Skeleton prim
    /// (ancestor xforms + `metersPerUnit` already baked in).
    /// Emitted as a wrapper node that becomes the **parent** of
    /// every root joint, so animation TRS on the root joint stays
    /// authored-as-is while the hierarchy still inherits the
    /// skeleton's world-space placement.
    ///
    /// `None` or identity → no wrapper is emitted (the joint roots
    /// sit directly under the scene root). Required for ARKit USDZ
    /// assets like `chameleon_anim_mtl_variant` that author a
    /// `scale` on `/Root/chameleon_idle`; without the wrapper the
    /// skinned body renders 100× bigger than sibling unskinned
    /// meshes (glTF's skin formula ignores the mesh node matrix).
    pub skel_root_matrix: Option<[f32; 16]>,
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
    /// Phase 2.O: per-mesh morph-target weight channels driven by
    /// `UsdSkelAnimation.blendShapeWeights`. Each entry targets one
    /// mesh (by `MeshInput` index) and carries the full weight
    /// vector at every time in `times`. Empty when the animation
    /// drives only skeleton joints.
    pub weight_channels: Vec<MorphWeightChannel>,
}

/// One non-skin node animation clip. Times are in seconds and every
/// channel carries all three TRS streams so the animated node can start from
/// the first baked sample without retaining a glTF `matrix` property.
#[derive(Debug, Clone)]
pub struct NodeAnimationInput {
    /// Display name attached to the glTF animation.
    pub name: String,
    /// Sample times in seconds. These must be finite, non-negative, and
    /// strictly increasing.
    pub times: Vec<f32>,
    /// Interpolation used by every channel in this clip.
    pub interpolation: NodeAnimationInterpolation,
    /// Node TRS channels in the `nodes` slice passed to `build_glb`.
    pub channels: Vec<NodeTrsChannel>,
}

/// Interpolation mode for a non-skin node animation clip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeAnimationInterpolation {
    Linear,
    Step,
}

/// A complete baked TRS track for one `NodeInput`.
#[derive(Debug, Clone)]
pub struct NodeTrsChannel {
    /// Index into the `nodes` slice passed to `build_glb`.
    pub node_index: usize,
    /// Time-major translation samples (`times.len() * 3`).
    pub translations: Vec<f32>,
    /// Time-major glTF quaternion samples (`times.len() * 4`, x/y/z/w).
    pub rotations: Vec<f32>,
    /// Time-major scale samples (`times.len() * 3`).
    pub scales: Vec<f32>,
}

/// Phase 2.O: one mesh's morph-target weight timeline. glTF
/// animates mesh weights by targeting the node hosting the mesh
/// with `path = "weights"`; the output accessor carries
/// `times.len() × mesh.morph_targets.len()` floats.
#[derive(Debug, Clone)]
pub struct MorphWeightChannel {
    /// Index into the `meshes` slice passed to `build_glb`. Must
    /// point at a mesh whose `morph_targets` is non-empty.
    pub mesh_index: usize,
    /// Flattened weights: `times.len() × morph_targets.len()`,
    /// laid out time-major (so frame `t` starts at
    /// `t * morph_targets.len()`). Same shape convention as glTF's
    /// weights accessor.
    pub weights: Vec<f32>,
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
    /// Per-vertex RGBA colors, length = `vertex_count * 4`. `Some`
    /// when the source mesh carries `primvars:displayColor` with
    /// per-vertex interpolation. RGB from `displayColor` (sRGB floats
    /// 0-1); alpha from `primvars:displayOpacity` when authored, or
    /// 1.0 when absent. The GLB writer emits them as-is because
    /// glTF's `COLOR_0` VEC4 FLOAT is interpreted as sRGB by Three.js
    /// when `vertexColors = true`; the non-opaque alpha activates the
    /// material's `alphaMode: BLEND` path in the renderer.
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
    /// #32: USD `UsdGeomImageable.purpose` token authored on this
    /// mesh's prim (or an ancestor). One of `"default"`, `"render"`,
    /// `"proxy"`, `"guide"`. `None` is treated as `"default"` by the
    /// GLB writer so the frontend always sees a non-null string in
    /// `node.extras.purpose`.
    pub purpose: Option<String>,
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

/// #46: Prim hierarchy node produced by Pass 1.5 in the GLB extraction
/// pipeline. Every prim that contributes to the scene — Xform/Scope
/// ancestors, Mesh leaves, Light leaves, Camera leaves, and SkelRoot
/// containers — gets one `NodeInput`. The topological sort guarantees
/// that `parent` always refers to an earlier entry in the slice.
#[derive(Debug, Clone)]
pub struct NodeInput {
    /// Full SdfPath of this prim (e.g. `"/World/Hero/Cube"`).
    /// Written verbatim into `node.extras.primPath` in the GLB so the
    /// frontend can use it as a stable selection key.
    pub prim_path: String,
    /// Last path component (e.g. `"Cube"`). Used as the glTF node name
    /// so the Three.js scene graph shows human-readable labels rather
    /// than full paths.
    pub basename: String,
    /// Index into the `nodes` slice of the parent prim, or `None` for
    /// roots that sit directly under the synthetic `__upAxis` node.
    pub parent: Option<usize>,
    /// Column-major 4×4 local transform of this prim relative to its
    /// parent prim (NOT the world transform). For Group/SkelRoot nodes
    /// this is the composed local xform from USD; for Mesh/Light/Camera
    /// nodes that also carry a `MeshInput`/`LightInput`/`CameraInput`,
    /// the local xform is the delta between the prim's local space and
    /// its parent.
    pub local_matrix: [f32; 16],
    /// What kind of geometry this node carries, if any. Group nodes
    /// contribute no geometry of their own — they are pure hierarchy.
    pub kind: NodeKind,
    /// For `NodeKind::Mesh`: index into the `meshes` slice passed to
    /// `build_glb`. `None` for non-mesh nodes.
    pub mesh_payload_idx: Option<usize>,
    /// For `NodeKind::Light`: index into the `lights` slice passed to
    /// `build_glb`. `None` for non-light nodes.
    pub light_payload_idx: Option<usize>,
    /// For `NodeKind::Camera`: index into the `cameras` slice passed to
    /// `build_glb`. `None` for non-camera nodes.
    pub camera_payload_idx: Option<usize>,
    /// For `NodeKind::SkelRoot`: index into the `skins` slice passed to
    /// `build_glb`. `None` for non-skelroot nodes.
    pub skin_payload_idx: Option<usize>,
}

/// What kind of glTF-visible payload (if any) this hierarchy node carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    /// Pure hierarchy node — no geometry, no light, no camera. Xform /
    /// Scope / any other non-leaf prim type.
    Group,
    /// USD Mesh prim. Carries `mesh_payload_idx` pointing at a
    /// `MeshInput` in the caller's meshes slice.
    Mesh,
    /// USD light prim (DistantLight / SphereLight / etc.). Carries
    /// `light_payload_idx`.
    Light,
    /// USD camera prim. Carries `camera_payload_idx`.
    Camera,
    /// USD SkelRoot prim. Carries `skin_payload_idx`. Its `local_matrix`
    /// already encodes `metersPerUnit` and ancestor xforms so the joint
    /// hierarchy underneath inherits the correct world placement.
    SkelRoot,
    /// USD PointInstancer prim (#41). Acts as a pure hierarchy node in the
    /// node tree (identity local_matrix); instanced geometry is emitted via
    /// `EXT_mesh_gpu_instancing` on child nodes OR as per-instance group
    /// nodes when the TRS fallback path fires (negative / non-finite scale).
    ///
    /// Instance-level picking is deferred to a follow-up issue; only the
    /// instancer prim path is stored in `userData.primPath`, not
    /// per-instance paths.
    PointInstancer,
}

/// Per-(PointInstancer, prototype-mesh) instancing record (#41).
///
/// When the TRS decomposition gate passes (all scales positive and finite),
/// `build_glb` emits a glTF node for the prototype mesh and attaches
/// `EXT_mesh_gpu_instancing` accessors covering every instance's
/// translation/rotation/scale. Three.js r150+ parses this natively into
/// `THREE.InstancedMesh`.
#[derive(Debug, Clone)]
pub struct InstancingInput {
    /// Index into the `meshes` slice passed to `build_glb`. The node
    /// for this mesh gets `EXT_mesh_gpu_instancing` attached.
    pub prototype_mesh_idx: usize,
    /// Optional index into the `nodes` slice for a parent NodeInput.
    /// When `Some`, the instanced node becomes a child of that NodeInput's
    /// glTF node. When `None`, it is placed under the `__upAxis` root.
    pub parent_node_idx: Option<usize>,
    /// SdfPath of the source `UsdGeomPointInstancer` prim. Stamped onto
    /// the instanced glTF node's `extras.primPath` so the frontend's
    /// selection / metadata pipeline can map any clicked instance back
    /// to the authoring instancer (instance-level picking is deferred,
    /// per #41).
    pub instancer_prim_path: String,
    /// Per-instance translation in scene space (Y-up, metersPerUnit already
    /// applied). Length == instance count.
    pub translations: Vec<[f32; 3]>,
    /// Per-instance rotation quaternion in glTF order `[x, y, z, w]`.
    pub rotations: Vec<[f32; 4]>,
    /// Per-instance scale `[sx, sy, sz]`.
    pub scales: Vec<[f32; 3]>,
    /// Exact PointInstancer-relative matrices after applying the prototype
    /// subtree transform. Empty for callers that only provide TRS. A matrix
    /// that cannot round-trip through positive-scale TRS triggers the regular
    /// mesh-node fallback.
    pub matrices: Vec<[f32; 16]>,
}

impl NodeInput {
    /// Convenience constructor for a pure hierarchy (Xform/Scope) node.
    pub fn group(
        prim_path: String,
        basename: String,
        parent: Option<usize>,
        local_matrix: [f32; 16],
    ) -> Self {
        Self {
            prim_path,
            basename,
            parent,
            local_matrix,
            kind: NodeKind::Group,
            mesh_payload_idx: None,
            light_payload_idx: None,
            camera_payload_idx: None,
            skin_payload_idx: None,
        }
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

const COMPONENT_TYPE_FLOAT: u32 = 5126;
const COMPONENT_TYPE_UNSIGNED_INT: u32 = 5125;

fn checked_padded_section_len(element_count: usize, element_size: usize) -> Option<usize> {
    let byte_len = element_count.checked_mul(element_size)?;
    let padding = (4 - (byte_len % 4)) % 4;
    byte_len.checked_add(padding)
}

fn checked_add_bin_section(
    total: &mut usize,
    element_count: usize,
    element_size: usize,
) -> Option<()> {
    *total = total.checked_add(checked_padded_section_len(element_count, element_size)?)?;
    Some(())
}

fn mesh_output_node_flags(
    mesh_count: usize,
    nodes: &[NodeInput],
    instancing: &[InstancingInput],
) -> Vec<bool> {
    // Weight channels are serialized before the hierarchy-aware node pass.
    // In that mode mesh_node_indices still contains only usize::MAX sentinels,
    // so build_glb deliberately skips every weight channel at this point.
    if !nodes.is_empty() {
        return vec![false; mesh_count];
    }
    let mut flags = vec![true; mesh_count];
    for input in instancing {
        if let Some(flag) = flags.get_mut(input.prototype_mesh_idx) {
            *flag = false;
        }
    }
    flags
}

fn uses_gpu_instancing(input: &InstancingInput) -> bool {
    let valid_trs = input
        .translations
        .iter()
        .flatten()
        .chain(input.rotations.iter().flatten())
        .all(|value| value.is_finite())
        && input
            .scales
            .iter()
            .flatten()
            .all(|value| value.is_finite() && *value > 0.0);
    if !valid_trs || input.matrices.is_empty() {
        return valid_trs;
    }
    input.matrices.iter().enumerate().all(|(index, exact)| {
        let reconstructed = crate::usd::math::trs_to_mat4_f32(
            input.translations[index],
            input.rotations[index],
            input.scales[index],
        );
        exact
            .iter()
            .zip(reconstructed.iter())
            .all(|(left, right)| (left - right).abs() <= 1e-4)
    })
}

fn validate_node_animations(
    node_animations: &[NodeAnimationInput],
    nodes: &[NodeInput],
) -> Result<(), String> {
    for (animation_index, animation) in node_animations.iter().enumerate() {
        if animation.times.is_empty() {
            return Err(format!(
                "node_animation[{animation_index}] '{}' has no time samples",
                animation.name
            ));
        }
        for (time_index, &time) in animation.times.iter().enumerate() {
            if !time.is_finite() || time < 0.0 {
                return Err(format!(
                    "node_animation[{animation_index}] '{}' time[{time_index}] must be finite and non-negative",
                    animation.name
                ));
            }
            if let Some(&next_time) = animation.times.get(time_index + 1) {
                if next_time <= time {
                    return Err(format!(
                        "node_animation[{animation_index}] '{}' times must be strictly increasing",
                        animation.name
                    ));
                }
            }
        }
        if animation.channels.is_empty() {
            return Err(format!(
                "node_animation[{animation_index}] '{}' has no channels",
                animation.name
            ));
        }

        let translation_len = animation.times.len().checked_mul(3).ok_or_else(|| {
            format!(
                "node_animation[{animation_index}] '{}' translation sample count overflows",
                animation.name
            )
        })?;
        let rotation_len = animation.times.len().checked_mul(4).ok_or_else(|| {
            format!(
                "node_animation[{animation_index}] '{}' rotation sample count overflows",
                animation.name
            )
        })?;
        let mut seen_nodes = HashSet::with_capacity(animation.channels.len());
        for (channel_index, channel) in animation.channels.iter().enumerate() {
            if channel.node_index >= nodes.len() {
                return Err(format!(
                    "node_animation[{animation_index}] '{}' channel[{channel_index}] node_index {} is out of range (nodes.len={})",
                    animation.name,
                    channel.node_index,
                    nodes.len()
                ));
            }
            if !seen_nodes.insert(channel.node_index) {
                return Err(format!(
                    "node_animation[{animation_index}] '{}' has duplicate track for node_index {}",
                    animation.name, channel.node_index
                ));
            }
            if channel.translations.len() != translation_len {
                return Err(format!(
                    "node_animation[{animation_index}] '{}' channel[{channel_index}] translation length {} does not match expected {}",
                    animation.name,
                    channel.translations.len(),
                    translation_len
                ));
            }
            if channel.rotations.len() != rotation_len {
                return Err(format!(
                    "node_animation[{animation_index}] '{}' channel[{channel_index}] rotation length {} does not match expected {}",
                    animation.name,
                    channel.rotations.len(),
                    rotation_len
                ));
            }
            if channel.scales.len() != translation_len {
                return Err(format!(
                    "node_animation[{animation_index}] '{}' channel[{channel_index}] scale length {} does not match expected {}",
                    animation.name,
                    channel.scales.len(),
                    translation_len
                ));
            }
            if let Some(value_index) = channel
                .translations
                .iter()
                .position(|value| !value.is_finite())
            {
                return Err(format!(
                    "node_animation[{animation_index}] '{}' channel[{channel_index}] translation[{value_index}] must be finite",
                    animation.name
                ));
            }
            if let Some(value_index) = channel.scales.iter().position(|value| !value.is_finite()) {
                return Err(format!(
                    "node_animation[{animation_index}] '{}' channel[{channel_index}] scale[{value_index}] must be finite",
                    animation.name
                ));
            }
            for (sample_index, rotation) in channel.rotations.chunks_exact(4).enumerate() {
                if rotation.iter().any(|value| !value.is_finite()) {
                    return Err(format!(
                        "node_animation[{animation_index}] '{}' channel[{channel_index}] rotation sample {sample_index} must be finite",
                        animation.name
                    ));
                }
                let norm_squared = rotation.iter().map(|value| value * value).sum::<f32>();
                let norm = norm_squared.sqrt();
                if !norm.is_finite() || norm <= f32::EPSILON || (norm - 1.0).abs() > 1e-3 {
                    return Err(format!(
                        "node_animation[{animation_index}] '{}' channel[{channel_index}] rotation sample {sample_index} must be a normalized quaternion",
                        animation.name
                    ));
                }
            }
        }
    }
    Ok(())
}

fn first_node_animation_poses(
    node_animations: &[NodeAnimationInput],
    node_count: usize,
) -> Vec<Option<([f32; 3], [f32; 4], [f32; 3])>> {
    let mut initial_poses = vec![None; node_count];
    for animation in node_animations {
        for channel in &animation.channels {
            if initial_poses[channel.node_index].is_none() {
                initial_poses[channel.node_index] = Some((
                    [
                        channel.translations[0],
                        channel.translations[1],
                        channel.translations[2],
                    ],
                    [
                        channel.rotations[0],
                        channel.rotations[1],
                        channel.rotations[2],
                        channel.rotations[3],
                    ],
                    [channel.scales[0], channel.scales[1], channel.scales[2]],
                ));
            }
        }
    }
    initial_poses
}

fn apply_node_animation_initial_pose(
    node_json: &mut Value,
    initial_pose: Option<([f32; 3], [f32; 4], [f32; 3])>,
) {
    let Some((translation, rotation, scale)) = initial_pose else {
        return;
    };
    let Some(node_object) = node_json.as_object_mut() else {
        return;
    };
    node_object.remove("matrix");
    node_object.insert("translation".to_string(), json!(translation));
    node_object.insert("rotation".to_string(), json!(rotation));
    node_object.insert("scale".to_string(), json!(scale));
}

fn sanitized_vec3(value: [f32; 3], fallback: f32) -> [f32; 3] {
    value.map(|component| {
        component
            .is_finite()
            .then_some(component)
            .unwrap_or(fallback)
    })
}

fn sanitized_rotation(value: [f32; 4]) -> [f32; 4] {
    value
        .iter()
        .all(|component| component.is_finite())
        .then_some(value)
        .unwrap_or([0.0, 0.0, 0.0, 1.0])
}

fn attach_instancing_node(
    gltf_nodes: &mut [Value],
    scene_nodes: &mut Vec<Value>,
    hierarchy_nodes: &[NodeInput],
    parent_node_idx: Option<usize>,
    child_node_idx: usize,
) {
    if let Some(parent_node_idx) = parent_node_idx {
        if !hierarchy_nodes.is_empty() {
            let parent_gltf_idx = 1 + parent_node_idx;
            if let Some(parent_node) = gltf_nodes.get_mut(parent_gltf_idx) {
                if let Some(children) = parent_node["children"].as_array_mut() {
                    children.push(json!(child_node_idx));
                } else {
                    parent_node["children"] = json!([child_node_idx]);
                }
                return;
            }
        }
    }
    scene_nodes.push(json!(child_node_idx));
}

/// Estimate the exact padded BIN payload size from the same section-emission
/// conditions used by `build_glb`. Returning `None` on arithmetic overflow
/// lets the caller safely fall back to normal Vec growth instead of attempting
/// an erroneous near-`usize::MAX` reservation.
fn estimate_bin_capacity(
    nodes: &[NodeInput],
    meshes: &[MeshInput],
    textures: &[TextureInput],
    skins: &[SkinInput],
    animations: &[AnimationInput],
    instancing: &[InstancingInput],
) -> Option<usize> {
    let mut total = 0usize;
    let mesh_output_nodes = mesh_output_node_flags(meshes.len(), nodes, instancing);

    for mesh in meshes {
        checked_add_bin_section(&mut total, mesh.positions.len(), size_of::<f32>())?;
        if let Some(normals) = &mesh.normals {
            checked_add_bin_section(&mut total, normals.len(), size_of::<f32>())?;
        }
        if let Some(uvs) = &mesh.uvs {
            checked_add_bin_section(&mut total, uvs.len(), size_of::<f32>())?;
        }
        checked_add_bin_section(&mut total, mesh.indices.len(), size_of::<u32>())?;
        if let Some(colors) = &mesh.colors {
            checked_add_bin_section(&mut total, colors.len(), size_of::<f32>())?;
        }
        if let (Some(joint_indices), Some(joint_weights)) =
            (&mesh.joint_indices, &mesh.joint_weights)
        {
            checked_add_bin_section(&mut total, joint_indices.len(), size_of::<u16>())?;
            checked_add_bin_section(&mut total, joint_weights.len(), size_of::<f32>())?;
        }
        for target in &mesh.morph_targets {
            checked_add_bin_section(&mut total, target.position_offsets.len(), size_of::<f32>())?;
        }
    }

    for skin in skins {
        checked_add_bin_section(
            &mut total,
            skin.inverse_bind_matrices.len(),
            size_of::<[f32; 16]>(),
        )?;
    }

    for animation in animations {
        checked_add_bin_section(&mut total, animation.times.len(), size_of::<f32>())?;
        for samples in animation
            .translations
            .iter()
            .chain(&animation.rotations)
            .chain(&animation.scales)
            .flatten()
        {
            checked_add_bin_section(&mut total, samples.len(), size_of::<f32>())?;
        }
        for channel in &animation.weight_channels {
            let Some(mesh) = meshes.get(channel.mesh_index) else {
                continue;
            };
            let target_count = mesh.morph_targets.len();
            let expected_weights = animation.times.len().checked_mul(target_count);
            if target_count == 0
                || expected_weights != Some(channel.weights.len())
                || !mesh_output_nodes
                    .get(channel.mesh_index)
                    .copied()
                    .unwrap_or(false)
            {
                continue;
            }
            checked_add_bin_section(&mut total, channel.weights.len(), size_of::<f32>())?;
        }
    }

    for texture in textures {
        checked_add_bin_section(&mut total, texture.data.len(), size_of::<u8>())?;
    }

    for input in instancing {
        if input.translations.is_empty() {
            continue;
        }
        if !uses_gpu_instancing(input) {
            continue;
        }
        checked_add_bin_section(&mut total, input.translations.len(), size_of::<[f32; 3]>())?;
        checked_add_bin_section(&mut total, input.rotations.len(), size_of::<[f32; 4]>())?;
        checked_add_bin_section(&mut total, input.scales.len(), size_of::<[f32; 3]>())?;
    }

    Some(total)
}

/// Build a GLB binary from a list of meshes, materials, textures,
/// skins, and animations. Returns the GLB byte stream ready to send
/// via `tauri::ipc::Response`.
///
/// `nodes` is the topologically-sorted prim hierarchy produced by Pass
/// 1.5 of the GLB extraction pipeline (#46). When `nodes` is non-empty
/// the function uses it to build the glTF node tree; `meshes`, `lights`,
/// and `cameras` are then addressed by the index fields on `NodeInput`
/// rather than by traversal order. When `nodes` is empty the function
/// falls back to the legacy flat scene-root layout for compatibility
/// with callers that have not been migrated yet.
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
    nodes: &[NodeInput],
    meshes: &[MeshInput],
    materials: &[MaterialInput],
    textures: &[TextureInput],
    skins: &[SkinInput],
    animations: &[AnimationInput],
    lights: &[LightInput],
    cameras: &[CameraInput],
    up_correction: Option<[f32; 16]>,
    instancing: &[InstancingInput],
) -> Result<Vec<u8>, String> {
    build_glb_with_bin_capacity(
        nodes,
        meshes,
        materials,
        textures,
        skins,
        animations,
        lights,
        cameras,
        up_correction,
        instancing,
        None,
    )
}

/// Build a GLB with baked TRS animations for non-skin `NodeInput`s. The
/// arguments match [`build_glb`] with `node_animations` appended so existing
/// callers can keep using the static or skin-animation entrypoint.
#[allow(clippy::too_many_arguments)]
pub fn build_glb_with_node_animations(
    nodes: &[NodeInput],
    meshes: &[MeshInput],
    materials: &[MaterialInput],
    textures: &[TextureInput],
    skins: &[SkinInput],
    animations: &[AnimationInput],
    lights: &[LightInput],
    cameras: &[CameraInput],
    up_correction: Option<[f32; 16]>,
    instancing: &[InstancingInput],
    node_animations: &[NodeAnimationInput],
) -> Result<Vec<u8>, String> {
    build_glb_with_bin_capacity_and_node_animations(
        nodes,
        meshes,
        materials,
        textures,
        skins,
        animations,
        lights,
        cameras,
        up_correction,
        instancing,
        node_animations,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn build_glb_with_bin_capacity(
    nodes: &[NodeInput],
    meshes: &[MeshInput],
    materials: &[MaterialInput],
    textures: &[TextureInput],
    skins: &[SkinInput],
    animations: &[AnimationInput],
    lights: &[LightInput],
    cameras: &[CameraInput],
    up_correction: Option<[f32; 16]>,
    instancing: &[InstancingInput],
    bin_capacity_override: Option<usize>,
) -> Result<Vec<u8>, String> {
    build_glb_with_bin_capacity_and_node_animations(
        nodes,
        meshes,
        materials,
        textures,
        skins,
        animations,
        lights,
        cameras,
        up_correction,
        instancing,
        &[],
        bin_capacity_override,
    )
}

#[allow(clippy::too_many_arguments)]
fn build_glb_with_bin_capacity_and_node_animations(
    nodes: &[NodeInput],
    meshes: &[MeshInput],
    materials: &[MaterialInput],
    textures: &[TextureInput],
    skins: &[SkinInput],
    animations: &[AnimationInput],
    lights: &[LightInput],
    cameras: &[CameraInput],
    up_correction: Option<[f32; 16]>,
    instancing: &[InstancingInput],
    node_animations: &[NodeAnimationInput],
    bin_capacity_override: Option<usize>,
) -> Result<Vec<u8>, String> {
    let timing_enabled = glb_timing_enabled();
    let mut phase_started = timing_enabled.then(Instant::now);
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
            return Err(format!("texture[{i}] '{}' has empty image data", t.name));
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
    validate_node_animations(node_animations, nodes)?;
    let node_animation_initial_poses = if node_animations.is_empty() {
        Vec::new()
    } else {
        first_node_animation_poses(node_animations, nodes.len())
    };
    // #41: validate instancing inputs
    for (i, inst) in instancing.iter().enumerate() {
        if inst.prototype_mesh_idx >= meshes.len() {
            return Err(format!(
                "instancing[{i}] prototype_mesh_idx {} is out of range (meshes.len={})",
                inst.prototype_mesh_idx,
                meshes.len()
            ));
        }
        if inst.translations.len() != inst.rotations.len()
            || inst.translations.len() != inst.scales.len()
        {
            return Err(format!(
                "instancing[{i}] translations/rotations/scales length mismatch \
                 ({}/{}/{})",
                inst.translations.len(),
                inst.rotations.len(),
                inst.scales.len()
            ));
        }
        if !inst.matrices.is_empty() && inst.matrices.len() != inst.translations.len() {
            return Err(format!(
                "instancing[{i}] matrices length {} does not match translations length {}",
                inst.matrices.len(),
                inst.translations.len()
            ));
        }
    }
    log_glb_phase_timing("validate", &mut phase_started);

    // ---- Layout the binary buffer ---------------------------------------
    //
    // GLTF accessors require the underlying buffer view to be aligned to
    // the size of the component. Floats (4 bytes) and u32 indices (4 bytes)
    // both need 4-byte alignment, so we pad each section to 4 bytes.

    let bin_capacity = bin_capacity_override.unwrap_or_else(|| {
        estimate_bin_capacity(nodes, meshes, textures, skins, animations, instancing).unwrap_or(0)
    });
    let mut bin: Vec<u8> = Vec::with_capacity(bin_capacity);
    let mut buffer_views: Vec<Value> = Vec::new();
    let mut accessors: Vec<Value> = Vec::new();
    let mut gltf_meshes: Vec<Value> = Vec::new();
    let mut gltf_nodes: Vec<Value> = Vec::new();
    let mut scene_nodes: Vec<Value> = Vec::new();
    // Filled by the hierarchy pass after the synthetic root and any joint
    // nodes have been allocated. Node animation targets must use these
    // absolute glTF indices rather than the caller's NodeInput indices.
    let mut node_gltf_indices_for_animation: Option<Vec<usize>> = None;
    // Phase 2.O: map each MeshInput index to the glTF node index
    // that hosts it, so weight-animation channels can target the
    // right node with `path = "weights"`. A mesh without morph
    // targets keeps the entry but the animation resolver only
    // reads it when a weight channel references that mesh.
    let mut mesh_node_indices: Vec<usize> = Vec::with_capacity(meshes.len());

    for (mesh_idx, mesh) in meshes.iter().enumerate() {
        let vertex_count = mesh.vertex_count();
        let index_count = mesh.indices.len();

        // -- positions ---------------------------------------------------
        let (pmin, pmax) = mesh.position_bounds();
        let position_accessor_idx = append_accessor_with(
            &mut bin,
            &mut buffer_views,
            &mut accessors,
            checked_binary_byte_length(mesh.positions.len(), size_of::<f32>())?,
            AccessorSpec {
                target: Some(34962), // ARRAY_BUFFER
                component_type: COMPONENT_TYPE_FLOAT,
                count: vertex_count,
                type_name: "VEC3",
                normalized: false,
                byte_offset: None,
                min: Some(json!([pmin[0], pmin[1], pmin[2]])),
                max: Some(json!([pmax[0], pmax[1], pmax[2]])),
            },
            |binary| {
                for &v in &mesh.positions {
                    binary.extend_from_slice(&v.to_le_bytes());
                }
            },
        )?;

        // -- normals (optional) ------------------------------------------
        let normal_accessor_idx = if let Some(normals) = &mesh.normals {
            let acc_idx = append_accessor_with(
                &mut bin,
                &mut buffer_views,
                &mut accessors,
                checked_binary_byte_length(normals.len(), size_of::<f32>())?,
                AccessorSpec {
                    target: Some(34962),
                    component_type: COMPONENT_TYPE_FLOAT,
                    count: vertex_count,
                    type_name: "VEC3",
                    normalized: false,
                    byte_offset: None,
                    min: None,
                    max: None,
                },
                |binary| {
                    for &v in normals {
                        binary.extend_from_slice(&v.to_le_bytes());
                    }
                },
            )?;
            Some(acc_idx)
        } else {
            None
        };

        // -- uvs (optional) ----------------------------------------------
        let uv_accessor_idx = if let Some(uvs) = &mesh.uvs {
            let acc_idx = append_accessor_with(
                &mut bin,
                &mut buffer_views,
                &mut accessors,
                checked_binary_byte_length(uvs.len(), size_of::<f32>())?,
                AccessorSpec {
                    target: Some(34962),
                    component_type: COMPONENT_TYPE_FLOAT,
                    count: vertex_count,
                    type_name: "VEC2",
                    normalized: false,
                    byte_offset: None,
                    min: None,
                    max: None,
                },
                |binary| {
                    for &v in uvs {
                        binary.extend_from_slice(&v.to_le_bytes());
                    }
                },
            )?;
            Some(acc_idx)
        } else {
            None
        };

        // -- indices -----------------------------------------------------
        let index_accessor_idx = append_accessor_with(
            &mut bin,
            &mut buffer_views,
            &mut accessors,
            checked_binary_byte_length(mesh.indices.len(), size_of::<u32>())?,
            AccessorSpec {
                target: Some(34963), // ELEMENT_ARRAY_BUFFER
                component_type: COMPONENT_TYPE_UNSIGNED_INT,
                count: index_count,
                type_name: "SCALAR",
                normalized: false,
                byte_offset: None,
                min: None,
                max: None,
            },
            |binary| {
                for &i in &mesh.indices {
                    binary.extend_from_slice(&i.to_le_bytes());
                }
            },
        )?;

        // -- vertex colors (per-vertex displayColor) ----------------------
        let color_accessor_idx = if let Some(colors) = &mesh.colors {
            let acc_idx = append_accessor_with(
                &mut bin,
                &mut buffer_views,
                &mut accessors,
                checked_binary_byte_length(colors.len(), size_of::<f32>())?,
                AccessorSpec {
                    target: Some(34962),
                    component_type: COMPONENT_TYPE_FLOAT,
                    count: vertex_count,
                    type_name: "VEC4",
                    normalized: false,
                    byte_offset: None,
                    min: None,
                    max: None,
                },
                |binary| {
                    for &v in colors {
                        binary.extend_from_slice(&v.to_le_bytes());
                    }
                },
            )?;
            Some(acc_idx)
        } else {
            None
        };

        // -- joint indices / weights (Phase 5c E) ------------------------
        let (joints_accessor_idx, weights_accessor_idx) =
            match (mesh.joint_indices.as_ref(), mesh.joint_weights.as_ref()) {
                (Some(joint_idx), Some(joint_w)) => {
                    // JOINTS_0: VEC4 of unsigned shorts (component 5123).
                    let acc_j = append_accessor_with(
                        &mut bin,
                        &mut buffer_views,
                        &mut accessors,
                        checked_binary_byte_length(joint_idx.len(), size_of::<u16>())?,
                        AccessorSpec {
                            target: Some(34962),
                            component_type: 5123, // UNSIGNED_SHORT
                            count: vertex_count,
                            type_name: "VEC4",
                            normalized: false,
                            byte_offset: None,
                            min: None,
                            max: None,
                        },
                        |binary| {
                            for &v in joint_idx {
                                binary.extend_from_slice(&v.to_le_bytes());
                            }
                        },
                    )?;

                    // WEIGHTS_0: VEC4 of FLOAT.
                    let acc_w = append_accessor_with(
                        &mut bin,
                        &mut buffer_views,
                        &mut accessors,
                        checked_binary_byte_length(joint_w.len(), size_of::<f32>())?,
                        AccessorSpec {
                            target: Some(34962),
                            component_type: COMPONENT_TYPE_FLOAT,
                            count: vertex_count,
                            type_name: "VEC4",
                            normalized: false,
                            byte_offset: None,
                            min: None,
                            max: None,
                        },
                        |binary| {
                            for &v in joint_w {
                                binary.extend_from_slice(&v.to_le_bytes());
                            }
                        },
                    )?;
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
            // Per the glTF spec, morph target accessors must carry
            // `min` / `max` so renderers can compute a tight
            // bounding volume for the deformed mesh; we supply them.
            let (min, max) = vec3_min_max(&target.position_offsets);
            let acc = append_accessor_with(
                &mut bin,
                &mut buffer_views,
                &mut accessors,
                checked_binary_byte_length(target.position_offsets.len(), size_of::<f32>())?,
                AccessorSpec {
                    target: Some(34962), // ARRAY_BUFFER
                    component_type: COMPONENT_TYPE_FLOAT,
                    count: vertex_count,
                    type_name: "VEC3",
                    normalized: false,
                    byte_offset: None,
                    min: Some(json!([min[0], min[1], min[2]])),
                    max: Some(json!([max[0], max[1], max[2]])),
                },
                |binary| {
                    for &f in &target.position_offsets {
                        binary.extend_from_slice(&f.to_le_bytes());
                    }
                },
            )?;
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
        // When the hierarchy-aware path (nodes slice non-empty) is used,
        // glTF nodes for mesh prims are emitted later in the node-tree
        // building pass, keyed by NodeInput.mesh_payload_idx. Here we
        // only record the gltf_meshes index so mesh_node_indices can be
        // filled in that pass.
        //
        // When nodes slice is empty (legacy flat path), we emit a node
        // for every mesh now, carrying the full world_matrix and the
        // prim name without suffix.
        //
        // #41 fix: skip standalone scene-node emission for meshes that
        // are referenced by an InstancingInput. The instancing pass below
        // emits a node carrying `EXT_mesh_gpu_instancing` for each
        // (instancer, prototype-mesh) pair — emitting an additional flat
        // node here would render the prototype geometry twice (once at
        // its authored origin, once per instance).
        let is_instancing_prototype = instancing
            .iter()
            .any(|inst| inst.prototype_mesh_idx == mesh_idx);
        if nodes.is_empty() && !is_instancing_prototype {
            let node_idx = gltf_nodes.len();
            let mut node_obj = json!({
                "name": mesh.name,
                "mesh": mesh_idx_in_doc,
                "matrix": mesh.world_matrix.iter().copied().collect::<Vec<f32>>(),
            });
            if let Some(skin_idx) = mesh.skin_index {
                node_obj["skin"] = json!(skin_idx);
            }
            let purpose_str = mesh.purpose.as_deref().unwrap_or("default");
            node_obj["extras"] = json!({ "purpose": purpose_str });
            gltf_nodes.push(node_obj);
            scene_nodes.push(json!(node_idx));
            mesh_node_indices.push(node_idx);
        } else if nodes.is_empty() {
            // Instancing prototype in flat mode: no standalone node, but
            // we still need a placeholder so the indices array stays
            // aligned with the meshes slice.
            mesh_node_indices.push(usize::MAX);
        } else {
            // Hierarchy-aware path: filled in during the node-tree pass.
            mesh_node_indices.push(usize::MAX);
        }

        let _ = mesh_idx; // silence unused if compiler complains
    }
    log_glb_phase_timing("mesh layout", &mut phase_started);

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
        let base_node = gltf_nodes.len();
        let joint_node_indices: Vec<usize> = (base_node..base_node + joint_count).collect();

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
            gltf_nodes.push(joint_node);
        }

        // Phase 2.P: emit an optional wrapper node that carries the
        // skeleton prim's composed world transform. Root joints
        // become children of the wrapper so animation on the root
        // joint TRS stays in the authored local skeleton space
        // while every joint's `matrixWorld` inherits the wrapper's
        // placement (skeleton's ancestor xform chain +
        // `metersPerUnit`). Without this wrapper, glTF's skin
        // formula drops the mesh node matrix and the skinned body
        // renders at authored USD scale (e.g. 100× bigger than
        // unskinned siblings on ARKit assets that author a scale
        // on their SkelRoot container).
        //
        // When the hierarchy-aware path is used (nodes slice is non-empty),
        // the SkelRoot node itself provides this transform and the wrapper
        // is emitted only in the legacy flat path.
        let emit_legacy_wrapper = nodes.is_empty()
            && match skin.skel_root_matrix {
                Some(m) => !is_identity_mat4_f32(&m),
                None => false,
            };
        if emit_legacy_wrapper {
            let wrapper_idx = gltf_nodes.len();
            let m = skin.skel_root_matrix.expect("checked above");
            gltf_nodes.push(json!({
                "name": format!("{}_skel_root", skin.name),
                "matrix": m.iter().copied().collect::<Vec<f32>>(),
                "children": roots.clone(),
            }));
            scene_nodes.push(json!(wrapper_idx));
        } else if nodes.is_empty() {
            for root in &roots {
                scene_nodes.push(json!(root));
            }
        }
        // In the hierarchy-aware path, joint roots are wired up under the
        // SkelRoot node in the node-tree building pass below.
        // Stash roots so the SkelRoot NodeKind handler can find them.
        let _ = roots; // used above or below depending on path

        // Inverse bind matrices accessor: one VEC4 mat4 per joint,
        // 16 floats each, FLOAT componentType.
        let ibm_accessor_idx = append_accessor_with(
            &mut bin,
            &mut buffer_views,
            &mut accessors,
            checked_binary_byte_length(
                checked_binary_byte_length(skin.inverse_bind_matrices.len(), 16)?,
                size_of::<f32>(),
            )?,
            AccessorSpec {
                target: None,
                component_type: COMPONENT_TYPE_FLOAT,
                count: joint_count,
                type_name: "MAT4",
                normalized: false,
                byte_offset: None,
                min: None,
                max: None,
            },
            |binary| {
                for matrix in &skin.inverse_bind_matrices {
                    for &v in matrix {
                        binary.extend_from_slice(&v.to_le_bytes());
                    }
                }
            },
        )?;

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
        // glTF requires `min` / `max` for animation input accessors.
        let (t_min, t_max) = animation
            .times
            .iter()
            .copied()
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), t| {
                (lo.min(t), hi.max(t))
            });
        let time_accessor = append_accessor_with(
            &mut bin,
            &mut buffer_views,
            &mut accessors,
            checked_binary_byte_length(animation.times.len(), size_of::<f32>())?,
            AccessorSpec {
                target: None,
                component_type: COMPONENT_TYPE_FLOAT,
                count: animation.times.len(),
                type_name: "SCALAR",
                normalized: false,
                byte_offset: None,
                min: Some(json!([t_min])),
                max: Some(json!([t_max])),
            },
            |binary| {
                for &t in &animation.times {
                    binary.extend_from_slice(&t.to_le_bytes());
                }
            },
        )?;

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
                                path: &str|
         -> Result<(), String> {
            let count = samples.len() / stride;
            let acc_idx = append_accessor_with(
                bin,
                buffer_views,
                accessors,
                checked_binary_byte_length(samples.len(), size_of::<f32>())?,
                AccessorSpec {
                    target: None,
                    component_type: COMPONENT_TYPE_FLOAT,
                    count,
                    type_name: if stride == 4 { "VEC4" } else { "VEC3" },
                    normalized: false,
                    byte_offset: None,
                    min: None,
                    max: None,
                },
                |binary| {
                    for &v in samples {
                        binary.extend_from_slice(&v.to_le_bytes());
                    }
                },
            )?;
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
            Ok(())
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
                )?;
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
                )?;
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
                )?;
            }
        }

        // Phase 2.O: morph-target weight channels. Each channel
        // targets one mesh node with `path = "weights"`; the
        // output accessor holds `frames × morph_target_count`
        // floats (time-major). Silently skip channels pointing at
        // a mesh without morph targets — malformed authoring, no
        // sensible output.
        for wc in &animation.weight_channels {
            let Some(&node_idx) = mesh_node_indices.get(wc.mesh_index) else {
                continue;
            };
            if node_idx == usize::MAX {
                continue;
            }
            let target_count = meshes[wc.mesh_index].morph_targets.len();
            if target_count == 0 {
                continue;
            }
            // Each frame contributes `target_count` weights; accessor
            // count is frames × targets (glTF spec). When sample
            // counts don't line up we drop the channel rather than
            // emitting garbage.
            let Some(expected_weight_count) = animation.times.len().checked_mul(target_count)
            else {
                continue;
            };
            if wc.weights.len() != expected_weight_count {
                continue;
            }
            let acc_idx = append_accessor_with(
                &mut bin,
                &mut buffer_views,
                &mut accessors,
                checked_binary_byte_length(wc.weights.len(), size_of::<f32>())?,
                AccessorSpec {
                    target: None,
                    component_type: COMPONENT_TYPE_FLOAT,
                    count: wc.weights.len(),
                    type_name: "SCALAR",
                    normalized: false,
                    byte_offset: None,
                    min: None,
                    max: None,
                },
                |binary| {
                    for &w in &wc.weights {
                        binary.extend_from_slice(&w.to_le_bytes());
                    }
                },
            )?;
            let sampler_idx = samplers.len();
            samplers.push(json!({
                "input": time_accessor,
                "output": acc_idx,
                "interpolation": "LINEAR",
            }));
            channels.push(json!({
                "sampler": sampler_idx,
                "target": {
                    "node": node_idx,
                    "path": "weights",
                },
            }));
        }

        if !channels.is_empty() {
            gltf_animations.push(json!({
                "name": animation.name,
                "samplers": samplers,
                "channels": channels,
            }));
        }
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
        let view_idx = append_buffer_view_with(
            &mut bin,
            &mut buffer_views,
            tex.data.len(),
            None,
            |binary| binary.extend_from_slice(&tex.data),
        )?;
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
        // Phase 2.N: ORM-packed metallic/roughness texture. glTF
        // spec samples the G channel for roughness and B for metallic
        // from the same image. yw-look's callers dedupe by asset
        // identity before reaching here, so the index is already
        // pointing at the right texture slot.
        if let Some(tex_idx) = m.metallic_roughness_texture {
            pbr["metallicRoughnessTexture"] = json!({
                "index": tex_idx,
                "texCoord": 0,
            });
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
            material["emissiveFactor"] = json!([emissive[0], emissive[1], emissive[2]]);
        }
        // Phase 2.M: alpha mode selection. UsdPreviewSurface has two
        // dimensions — a scalar `opacity` that lands on
        // `base_color_factor[3]`, and an `opacityThreshold` that
        // turns the material into a MASK (alpha test). Explicit
        // `MaterialInput.alpha_mode` wins when set (so `MASK` from
        // `opacityThreshold` overrides the implicit BLEND a
        // sub-1.0 scalar opacity would otherwise emit). When
        // unset, fall back to the scalar-opacity → BLEND heuristic
        // so pre-Phase-2.M materials (and the Rust fork) keep
        // working unchanged.
        match m.alpha_mode {
            Some(AlphaMode::Mask) => {
                material["alphaMode"] = json!("MASK");
                material["alphaCutoff"] = json!(m.alpha_cutoff);
            }
            Some(AlphaMode::Blend) => {
                material["alphaMode"] = json!("BLEND");
            }
            None => {
                if m.base_color_factor[3] < 1.0 - 1e-4 {
                    material["alphaMode"] = json!("BLEND");
                }
            }
        }
        gltf_materials.push(material);
    }
    log_glb_phase_timing("aux layout", &mut phase_started);

    // ---- #46: hierarchy-aware node tree building pass ---------------
    //
    // When `nodes` (NodeInput slice) is non-empty, we build the full
    // prim hierarchy here. The slice is topologically sorted so we can
    // allocate glTF node indices in one forward pass and then fill in
    // children arrays in a second pass.
    //
    // Layout:
    //   index 0 … N-1: glTF nodes corresponding to NodeInput[0..N-1]
    //   (joints were already pushed above and occupy higher indices)
    //
    // A synthetic `__upAxis` root node is inserted at index 0 in the
    // gltf_nodes vector; all top-level NodeInput roots (parent=None)
    // become children of that node. The scene root points at the
    // __upAxis node only. This concentrates the Z→Y correction into
    // one place and is transparent to skeleton/animation which only
    // addresses joint nodes by their own indices.
    if !nodes.is_empty() {
        // Build a per-light and per-camera index into the already-built
        // gltf_light_defs / gltf_cameras vectors (built in the loops
        // below). We need those indices here, so we pre-build them first.
        // NOTE: gltf_light_defs is built further down; we reference the
        // light_kind from the `lights` slice to construct the definition
        // here inline so we don't need a separate pre-pass.

        // Map NodeInput index → glTF node index (into gltf_nodes).
        // We pre-allocate all node slots now; index 0 is the __upAxis node.
        let up_axis_gltf_idx: usize = gltf_nodes.len(); // current length = 0 for first call
                                                        // Reserve the __upAxis node slot.
        gltf_nodes.push(Value::Null); // placeholder, filled below
        let node_input_base = gltf_nodes.len(); // first real NodeInput node
                                                // Allocate all NodeInput nodes in order.
        for ni in nodes.iter() {
            let gltf_idx = gltf_nodes.len();
            let _ = (ni, gltf_idx); // used below
            gltf_nodes.push(Value::Null); // placeholder
        }

        // Per-NodeInput: gltf_node index.
        let node_gltf_indices: Vec<usize> =
            (node_input_base..node_input_base + nodes.len()).collect();

        // Per-NodeInput: list of gltf node indices of its children.
        let mut children_of: Vec<Vec<usize>> = vec![Vec::new(); nodes.len()];
        // Roots: NodeInput indices whose parent is None.
        let mut root_ni_indices: Vec<usize> = Vec::new();

        for (ni_idx, ni) in nodes.iter().enumerate() {
            match ni.parent {
                Some(parent_ni_idx) => {
                    children_of[parent_ni_idx].push(node_gltf_indices[ni_idx]);
                }
                None => {
                    root_ni_indices.push(ni_idx);
                }
            }
        }

        // Now fill in each NodeInput's glTF node JSON.
        // We also need to wire mesh_node_indices and handle SkelRoot joint roots.
        // For each skin, collect the joint gltf root nodes (the ones that
        // need to become children of the SkelRoot node).
        // skin_joint_node_indices was filled in the skin-building pass above.
        // For each skin, the roots in `joint_node_indices` that have no
        // parent in the joint hierarchy are the ones to wire under SkelRoot.
        // We reconstruct per-skin joint roots from skin data.
        let skin_joint_roots: Vec<Vec<usize>> = skins
            .iter()
            .zip(skin_joint_node_indices.iter())
            .map(|(skin, jni)| {
                skin.parents
                    .iter()
                    .enumerate()
                    .filter_map(|(i, p)| if p.is_none() { Some(jni[i]) } else { None })
                    .collect()
            })
            .collect();

        for (ni_idx, ni) in nodes.iter().enumerate() {
            let gltf_idx = node_gltf_indices[ni_idx];
            let local_mat: Vec<f32> = ni.local_matrix.iter().copied().collect();

            let purpose_str = meshes
                .get(ni.mesh_payload_idx.unwrap_or(usize::MAX))
                .and_then(|m| m.purpose.as_deref())
                .unwrap_or("default");

            let mut extras = json!({
                "primPath": ni.prim_path,
                "purpose": purpose_str,
            });

            let node_json = match ni.kind {
                NodeKind::Group => {
                    let children_gltf: Vec<usize> = children_of[ni_idx].clone();
                    let mut obj = json!({
                        "name": ni.basename,
                        "matrix": local_mat,
                        "extras": extras,
                    });
                    if !children_gltf.is_empty() {
                        obj["children"] = json!(children_gltf);
                    }
                    obj
                }
                NodeKind::Mesh => {
                    let mesh_idx = ni
                        .mesh_payload_idx
                        .expect("Mesh node must have mesh_payload_idx");
                    let mesh = &meshes[mesh_idx];
                    let gltf_mesh_idx = mesh_idx; // 1:1 mapping: meshes[i] → gltf_meshes[i]
                    mesh_node_indices[mesh_idx] = gltf_idx;

                    let purpose_str2 = mesh.purpose.as_deref().unwrap_or("default");
                    extras["purpose"] = json!(purpose_str2);

                    let mut obj = json!({
                        "name": ni.basename,
                        "mesh": gltf_mesh_idx,
                        "matrix": local_mat,
                        "extras": extras,
                    });
                    if let Some(skin_idx) = mesh.skin_index {
                        obj["skin"] = json!(skin_idx);
                    }
                    let children_gltf = &children_of[ni_idx];
                    if !children_gltf.is_empty() {
                        obj["children"] = json!(children_gltf);
                    }
                    obj
                }
                NodeKind::Light => {
                    let light_idx_payload = ni
                        .light_payload_idx
                        .expect("Light node must have light_payload_idx");
                    // The light definition index matches light_payload_idx since we build
                    // light defs in the loop below in the same order as `lights` slice.
                    let mut obj = json!({
                        "name": ni.basename,
                        "matrix": local_mat,
                        "extras": extras,
                        "extensions": {
                            "KHR_lights_punctual": {
                                "light": light_idx_payload,
                            }
                        },
                    });
                    let children_gltf = &children_of[ni_idx];
                    if !children_gltf.is_empty() {
                        obj["children"] = json!(children_gltf);
                    }
                    obj
                }
                NodeKind::Camera => {
                    let cam_idx_payload = ni
                        .camera_payload_idx
                        .expect("Camera node must have camera_payload_idx");
                    let mut obj = json!({
                        "name": ni.basename,
                        "matrix": local_mat,
                        "extras": extras,
                        "camera": cam_idx_payload,
                    });
                    let children_gltf = &children_of[ni_idx];
                    if !children_gltf.is_empty() {
                        obj["children"] = json!(children_gltf);
                    }
                    obj
                }
                NodeKind::SkelRoot => {
                    let skin_idx_payload = ni
                        .skin_payload_idx
                        .expect("SkelRoot node must have skin_payload_idx");
                    // Children of a SkelRoot include: hierarchy children from NodeInput,
                    // plus the joint roots that belong to this skin.
                    let children_gltf_base: Vec<usize> = children_of[ni_idx].clone();
                    let mut children_gltf = children_gltf_base;
                    if let Some(joint_roots) = skin_joint_roots.get(skin_idx_payload) {
                        children_gltf.extend(joint_roots.iter().copied());
                    }
                    let mut obj = json!({
                        "name": ni.basename,
                        "matrix": local_mat,
                        "extras": extras,
                    });
                    if !children_gltf.is_empty() {
                        obj["children"] = json!(children_gltf);
                    }
                    obj
                }
                NodeKind::PointInstancer => {
                    // PointInstancer is emitted as a pure hierarchy group node.
                    // Instanced geometry lives as child nodes with
                    // EXT_mesh_gpu_instancing (emitted separately below in the
                    // instancing pass). Instance-level picking is deferred (#41).
                    let children_gltf: Vec<usize> = children_of[ni_idx].clone();
                    let mut obj = json!({
                        "name": ni.basename,
                        "matrix": local_mat,
                        "extras": extras,
                    });
                    if !children_gltf.is_empty() {
                        obj["children"] = json!(children_gltf);
                    }
                    obj
                }
            };

            let mut node_json = node_json;
            apply_node_animation_initial_pose(
                &mut node_json,
                node_animation_initial_poses.get(ni_idx).copied().flatten(),
            );
            gltf_nodes[gltf_idx] = node_json;
        }

        // Build the __upAxis node, whose children are all the root NodeInput
        // glTF nodes. When the source stage is Z-up the caller passes the
        // Z→Y rotation in `up_correction`; we apply it here as the synthetic
        // root's matrix so every descendant inherits the correction. The
        // legacy flat path bakes the same correction into per-mesh / per-
        // light / per-camera world matrices, so it does not need this.
        let root_gltf_children: Vec<usize> = root_ni_indices
            .iter()
            .map(|&ni_idx| node_gltf_indices[ni_idx])
            .collect();
        let mut up_axis_node = json!({
            "name": "__upAxis",
            "children": root_gltf_children,
            "extras": { "primPath": "/" },
        });
        if let Some(correction) = up_correction {
            up_axis_node["matrix"] = json!(correction.iter().copied().collect::<Vec<f32>>());
        }
        gltf_nodes[up_axis_gltf_idx] = up_axis_node;
        scene_nodes.push(json!(up_axis_gltf_idx));
        if !node_animations.is_empty() {
            node_gltf_indices_for_animation = Some(node_gltf_indices);
        }
    }

    // ---- USD-ANIMATION-XFORM-01: non-skin node animations -----------
    //
    // NodeInput glTF indices are only known after the synthetic __upAxis
    // root and any skin joint nodes have been allocated. Emit these clips
    // after the hierarchy pass so targets always address the actual glTF
    // nodes, including scenes that contain skins before the hierarchy.
    if !node_animations.is_empty() {
        let node_gltf_indices = node_gltf_indices_for_animation
            .as_ref()
            .ok_or_else(|| "node animations require a non-empty NodeInput hierarchy".to_string())?;
        for node_animation in node_animations {
            let (t_min, t_max) = node_animation
                .times
                .iter()
                .copied()
                .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), time| {
                    (lo.min(time), hi.max(time))
                });
            let time_accessor = append_accessor_with(
                &mut bin,
                &mut buffer_views,
                &mut accessors,
                checked_binary_byte_length(node_animation.times.len(), size_of::<f32>())?,
                AccessorSpec {
                    target: None,
                    component_type: COMPONENT_TYPE_FLOAT,
                    count: node_animation.times.len(),
                    type_name: "SCALAR",
                    normalized: false,
                    byte_offset: None,
                    min: Some(json!([t_min])),
                    max: Some(json!([t_max])),
                },
                |binary| {
                    for &time in &node_animation.times {
                        binary.extend_from_slice(&time.to_le_bytes());
                    }
                },
            )?;

            let interpolation = match node_animation.interpolation {
                NodeAnimationInterpolation::Linear => "LINEAR",
                NodeAnimationInterpolation::Step => "STEP",
            };
            let mut samplers: Vec<Value> = Vec::new();
            let mut channels: Vec<Value> = Vec::new();
            let mut emit_channel = |samples: &[f32],
                                    stride: usize,
                                    path: &str,
                                    node_idx: usize|
             -> Result<(), String> {
                let accessor_idx = append_accessor_with(
                    &mut bin,
                    &mut buffer_views,
                    &mut accessors,
                    checked_binary_byte_length(samples.len(), size_of::<f32>())?,
                    AccessorSpec {
                        target: None,
                        component_type: COMPONENT_TYPE_FLOAT,
                        count: samples.len() / stride,
                        type_name: if stride == 4 { "VEC4" } else { "VEC3" },
                        normalized: false,
                        byte_offset: None,
                        min: None,
                        max: None,
                    },
                    |binary| {
                        for &value in samples {
                            binary.extend_from_slice(&value.to_le_bytes());
                        }
                    },
                )?;
                let sampler_idx = samplers.len();
                samplers.push(json!({
                    "input": time_accessor,
                    "output": accessor_idx,
                    "interpolation": interpolation,
                }));
                channels.push(json!({
                    "sampler": sampler_idx,
                    "target": {
                        "node": node_idx,
                        "path": path,
                    },
                }));
                Ok(())
            };

            for channel in &node_animation.channels {
                let node_idx = node_gltf_indices[channel.node_index];
                emit_channel(&channel.translations, 3, "translation", node_idx)?;
                emit_channel(&channel.rotations, 4, "rotation", node_idx)?;
                emit_channel(&channel.scales, 3, "scale", node_idx)?;
            }
            gltf_animations.push(json!({
                "name": node_animation.name,
                "samplers": samplers,
                "channels": channels,
            }));
        }
    }

    // ---- Phase 7a: KHR_lights_punctual -----------------------------
    //
    // For each LightInput, emit:
    //   1. A glTF light definition (top-level `extensions.KHR_lights_punctual.lights[i]`)
    //   2. A scene node carrying the authored world_matrix plus
    //      `extensions.KHR_lights_punctual.light: i` (legacy flat path only).
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

        // Scene node for this light. In the legacy flat path only —
        // the hierarchy-aware path wires lights under their NodeInput
        // parent in the node-tree building pass below.
        if nodes.is_empty() {
            let node_idx = gltf_nodes.len();
            gltf_nodes.push(json!({
                "name": light.name,
                "matrix": light.world_matrix.iter().copied().collect::<Vec<f32>>(),
                "extensions": {
                    "KHR_lights_punctual": {
                        "light": light_idx,
                    }
                },
            }));
            scene_nodes.push(json!(node_idx));
        }
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

        // Scene node for this camera. In the legacy flat path only —
        // the hierarchy-aware path wires cameras under their NodeInput
        // parent in the node-tree building pass below.
        if nodes.is_empty() {
            let node_idx = gltf_nodes.len();
            gltf_nodes.push(json!({
                "name": camera.name,
                "matrix": camera.world_matrix.iter().copied().collect::<Vec<f32>>(),
                "camera": camera_idx,
            }));
            scene_nodes.push(json!(node_idx));
        }
    }

    // ---- #41 EXT_mesh_gpu_instancing pass ---------------------------------
    //
    // For each InstancingInput we emit three binary accessors (TRANSLATION,
    // ROTATION, SCALE) and a glTF node that references the prototype mesh
    // plus the extension block. The node is wired as a child of the caller-
    // specified parent NodeInput (or under the __upAxis synthetic root when
    // parent_node_idx is None).
    //
    // Three.js r150+ parses EXT_mesh_gpu_instancing natively into
    // THREE.InstancedMesh. No frontend code changes are required.
    let mut has_instancing_ext = false;
    for inst in instancing {
        let instance_count = inst.translations.len();
        if instance_count == 0 {
            continue;
        }

        if !uses_gpu_instancing(inst) {
            log::warn!(
                "[usd-glb] PointInstancer '{}' uses regular-node fallback because its transforms cannot be represented as finite positive-scale TRS",
                inst.instancer_prim_path
            );
            let mesh_idx = inst.prototype_mesh_idx;
            let mesh_name = meshes
                .get(mesh_idx)
                .map(|mesh| mesh.name.as_str())
                .unwrap_or("prototype");
            for instance_index in 0..instance_count {
                let node_index = gltf_nodes.len();
                let mut node = json!({
                    "name": format!("{mesh_name}_instance_{instance_index}"),
                    "mesh": mesh_idx,
                    "extras": {
                        "primPath": inst.instancer_prim_path,
                        "instancingFallback": true,
                    },
                });
                if let Some(matrix) = inst
                    .matrices
                    .get(instance_index)
                    .filter(|matrix| matrix.iter().all(|value| value.is_finite()))
                {
                    node["matrix"] = json!(matrix);
                } else {
                    node["translation"] =
                        json!(sanitized_vec3(inst.translations[instance_index], 0.0));
                    node["rotation"] = json!(sanitized_rotation(inst.rotations[instance_index]));
                    node["scale"] = json!(sanitized_vec3(inst.scales[instance_index], 1.0));
                }
                gltf_nodes.push(node);
                attach_instancing_node(
                    &mut gltf_nodes,
                    &mut scene_nodes,
                    nodes,
                    inst.parent_node_idx,
                    node_index,
                );
            }
            continue;
        }

        // ---- TRANSLATION accessor (VEC3 / FLOAT) ----
        // Compute min/max for TRANSLATION (glTF validator requires them)
        let (t_min, t_max) = inst.translations.iter().fold(
            ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]),
            |(mut mn, mut mx), t| {
                for i in 0..3 {
                    if t[i] < mn[i] {
                        mn[i] = t[i];
                    }
                    if t[i] > mx[i] {
                        mx[i] = t[i];
                    }
                }
                (mn, mx)
            },
        );
        let t_acc_idx = append_accessor_with(
            &mut bin,
            &mut buffer_views,
            &mut accessors,
            checked_binary_byte_length(
                checked_binary_byte_length(instance_count, 3)?,
                size_of::<f32>(),
            )?,
            AccessorSpec {
                target: Some(34962), // ARRAY_BUFFER
                component_type: COMPONENT_TYPE_FLOAT,
                count: instance_count,
                type_name: "VEC3",
                normalized: false,
                byte_offset: Some(0),
                min: Some(json!([t_min[0], t_min[1], t_min[2]])),
                max: Some(json!([t_max[0], t_max[1], t_max[2]])),
            },
            |binary| {
                for t in &inst.translations {
                    for &f in t.iter() {
                        binary.extend_from_slice(&f.to_le_bytes());
                    }
                }
            },
        )?;

        // ---- ROTATION accessor (VEC4 / FLOAT, x,y,z,w glTF order) ----
        let r_acc_idx = append_accessor_with(
            &mut bin,
            &mut buffer_views,
            &mut accessors,
            checked_binary_byte_length(
                checked_binary_byte_length(instance_count, 4)?,
                size_of::<f32>(),
            )?,
            AccessorSpec {
                target: Some(34962),
                component_type: COMPONENT_TYPE_FLOAT,
                count: instance_count,
                type_name: "VEC4",
                normalized: false,
                byte_offset: Some(0),
                min: None,
                max: None,
            },
            |binary| {
                for r in &inst.rotations {
                    for &f in r.iter() {
                        binary.extend_from_slice(&f.to_le_bytes());
                    }
                }
            },
        )?;

        // ---- SCALE accessor (VEC3 / FLOAT) ----
        let s_acc_idx = append_accessor_with(
            &mut bin,
            &mut buffer_views,
            &mut accessors,
            checked_binary_byte_length(
                checked_binary_byte_length(instance_count, 3)?,
                size_of::<f32>(),
            )?,
            AccessorSpec {
                target: Some(34962),
                component_type: COMPONENT_TYPE_FLOAT,
                count: instance_count,
                type_name: "VEC3",
                normalized: false,
                byte_offset: Some(0),
                min: None,
                max: None,
            },
            |binary| {
                for s in &inst.scales {
                    for &f in s.iter() {
                        binary.extend_from_slice(&f.to_le_bytes());
                    }
                }
            },
        )?;

        // ---- Emit a glTF node with EXT_mesh_gpu_instancing ----
        let mesh_idx = inst.prototype_mesh_idx;
        let inst_node_idx = gltf_nodes.len();
        let inst_node_name = meshes
            .get(mesh_idx)
            .map(|m| format!("{}_instanced", m.name))
            .unwrap_or_else(|| format!("instanced_{mesh_idx}"));
        gltf_nodes.push(json!({
            "name": inst_node_name,
            "mesh": mesh_idx,
            // #41: stamp the instancer's SdfPath into extras so the
            // frontend selection pipeline can map any clicked instance
            // back to the authoring PointInstancer prim (read via
            // `Object3D.userData.primPath`). Instance-level picking is
            // deferred — every instance shares the instancer's path.
            "extras": {
                "primPath": inst.instancer_prim_path,
            },
            "extensions": {
                "EXT_mesh_gpu_instancing": {
                    "attributes": {
                        "TRANSLATION": t_acc_idx,
                        "ROTATION": r_acc_idx,
                        "SCALE": s_acc_idx,
                    }
                }
            }
        }));

        attach_instancing_node(
            &mut gltf_nodes,
            &mut scene_nodes,
            nodes,
            inst.parent_node_idx,
            inst_node_idx,
        );

        has_instancing_ext = true;
    }
    log_glb_phase_timing("scene layout", &mut phase_started);

    // ---- Build GLTF JSON document --------------------------------------
    let total_bin_length = bin.len() as u64;

    let mut document = json!({
        "asset": {
            "version": "2.0",
            "generator": "yw-look usd-phase5c",
        },
        "scene": 0,
        "scenes": [{ "nodes": scene_nodes }],
        "nodes": gltf_nodes,
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
    // #41: EXT_mesh_gpu_instancing was used if at least one InstancingInput
    // produced a glTF node.
    if has_instancing_ext {
        extensions_used.push("EXT_mesh_gpu_instancing");
        // The prototype is intentionally not emitted as a non-instanced node,
        // so there is no semantically correct core-glTF fallback.
        document["extensionsRequired"] = json!(["EXT_mesh_gpu_instancing"]);
    }
    if !extensions_used.is_empty() {
        document["extensionsUsed"] = json!(extensions_used);
    }
    if !textures.is_empty() {
        // Phase 5e L1: build a sampler per unique (wrapS, wrapT) pair
        // so different materials can use different wrap modes. Most
        // assets share the same mode, so this typically produces just
        // one sampler entry. Texture entries referenced by material
        // channels are patched to the sampler matching that material.
        let mut sampler_dedup: std::collections::HashMap<(u32, u32), usize> =
            std::collections::HashMap::new();
        let mut gltf_samplers: Vec<Value> = Vec::new();
        // Re-map gltf_textures sampler indices per material wrap mode.
        for m in materials.iter() {
            let mut apply_material_sampler = |tex_idx: usize| {
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
            };
            if let Some(tex_idx) = m.base_color_texture {
                apply_material_sampler(tex_idx);
            }
            if let Some(tex_idx) = m.normal_texture {
                apply_material_sampler(tex_idx);
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
    log_glb_phase_timing("document", &mut phase_started);

    let json_bytes =
        serde_json::to_vec(&document).map_err(|e| format!("failed to serialize GLTF JSON: {e}"))?;
    let bin_capacity = bin.capacity();
    let (json_chunk_len, bin_chunk_len, _) =
        crate::preview::glb::checked_glb_container_lengths(json_bytes.len(), bin.len())
            .map_err(|error| format!("failed to assemble GLB container: {error}"))?;
    log_glb_phase_timing("json serialize", &mut phase_started);

    // ---- Stitch GLB binary container -----------------------------------
    let out = crate::preview::glb::finish_glb(json_bytes, bin)
        .map_err(|error| format!("failed to assemble GLB container: {error}"))?;
    log_glb_phase_timing("final concat", &mut phase_started);
    if timing_enabled {
        log::debug!(
            "[usd glb timing] sizes: meshes={}, nodes={}, materials={}, textures={}, bin_len={}, bin_capacity={}, json_len={}, out_len={}",
            meshes.len(),
            nodes.len(),
            materials.len(),
            textures.len(),
            bin_chunk_len,
            bin_capacity,
            json_chunk_len,
            out.len()
        );
    }
    Ok(out)
}

/// Phase 2.P: column-major 4×4 identity check with a small epsilon
/// so floating-point residuals from USD matrix composition don't
/// spuriously emit a skel wrapper node.
fn is_identity_mat4_f32(m: &[f32; 16]) -> bool {
    const EPS: f32 = 1e-6;
    for i in 0..4 {
        for j in 0..4 {
            let expected = if i == j { 1.0 } else { 0.0 };
            if (m[i * 4 + j] - expected).abs() > EPS {
                return false;
            }
        }
    }
    true
}

/// Phase 5c E: decompose a column-major 4×4 affine into glTF TRS
/// (translation, rotation as `(x, y, z, w)` quaternion, scale).
/// glTF disallows animating a node's `matrix` so every joint node
/// has to be authored as TRS even when its rest pose has no
/// rotation. Handles negative scale via the determinant sign.
pub(crate) fn decompose_trs_column_major(m: &[f32; 16]) -> ([f32; 3], [f32; 4], [f32; 3]) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::glb::{BIN_CHUNK as CHUNK_TYPE_BIN, JSON_CHUNK as CHUNK_TYPE_JSON};

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
            purpose: None,
        }
    }

    fn default_materials() -> Vec<MaterialInput> {
        vec![MaterialInput::default_preview()]
    }

    fn glb_json(glb: &[u8]) -> serde_json::Value {
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_text = std::str::from_utf8(&glb[20..20 + json_chunk_len])
            .expect("json chunk is utf8")
            .trim_end_matches(' ');
        serde_json::from_str(json_text).expect("json chunk parses")
    }

    fn glb_bin_chunk_len(glb: &[u8]) -> usize {
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let bin_header = 20 + json_chunk_len;
        u32::from_le_bytes(glb[bin_header..bin_header + 4].try_into().unwrap()) as usize
    }

    fn accessor_f32(doc: &serde_json::Value, glb: &[u8], accessor_index: usize) -> Vec<f32> {
        let accessor = &doc["accessors"][accessor_index];
        let view_index = accessor["bufferView"]
            .as_u64()
            .expect("accessor bufferView") as usize;
        let view = &doc["bufferViews"][view_index];
        let view_offset = view["byteOffset"].as_u64().unwrap_or(0) as usize;
        let accessor_offset = accessor["byteOffset"].as_u64().unwrap_or(0) as usize;
        let count = accessor["count"].as_u64().expect("accessor count") as usize;
        let components = match accessor["type"].as_str().expect("accessor type") {
            "SCALAR" => 1,
            "VEC3" => 3,
            "VEC4" => 4,
            other => panic!("unsupported test accessor type {other}"),
        };
        let bin_start = 20 + u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize + 8;
        let start = bin_start + view_offset + accessor_offset;
        (0..count * components)
            .map(|index| {
                let offset = start + index * size_of::<f32>();
                f32::from_le_bytes(glb[offset..offset + 4].try_into().unwrap())
            })
            .collect()
    }

    fn node_animation_fixture(animation: NodeAnimationInput) -> Result<Vec<u8>, String> {
        let nodes = vec![NodeInput::group(
            "/Animated".to_string(),
            "Animated".to_string(),
            None,
            identity_matrix(),
        )];
        build_glb_with_node_animations(
            &nodes,
            &[],
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
            &[animation],
        )
    }

    #[test]
    fn bin_capacity_estimate_covers_all_emitted_sections_exactly() {
        let mut skinned_mesh = unit_quad_split_into_two_triangles();
        skinned_mesh.colors = Some(vec![1.0; 16]);
        skinned_mesh.joint_indices = Some(vec![0; 16]);
        skinned_mesh.joint_weights = Some(vec![0.25; 16]);
        skinned_mesh.skin_index = Some(0);
        skinned_mesh.morph_targets = vec![MorphTarget {
            name: Some("Smile".to_string()),
            position_offsets: vec![0.0; skinned_mesh.positions.len()],
        }];
        skinned_mesh.morph_weights = vec![0.0];

        let meshes = vec![skinned_mesh, unit_quad_split_into_two_triangles()];
        let textures = vec![TextureInput {
            name: "three-byte.png".to_string(),
            mime_type: "image/png".to_string(),
            data: vec![1, 2, 3],
        }];
        let skins = vec![SkinInput {
            name: "skin".to_string(),
            joint_names: vec!["Root".to_string()],
            parents: vec![None],
            rest_local_matrices: vec![identity_matrix()],
            inverse_bind_matrices: vec![identity_matrix()],
            skel_root_matrix: None,
        }];
        let animations = vec![AnimationInput {
            name: "animation".to_string(),
            times: vec![0.0, 1.0],
            skin_index: 0,
            translations: vec![Some(vec![0.0; 6])],
            rotations: vec![Some(vec![0.0; 8])],
            scales: vec![Some(vec![1.0; 6])],
            weight_channels: vec![MorphWeightChannel {
                mesh_index: 0,
                weights: vec![0.0, 1.0],
            }],
        }];
        let instancing = vec![InstancingInput {
            prototype_mesh_idx: 1,
            parent_node_idx: None,
            instancer_prim_path: "/World/Instancer".to_string(),
            translations: vec![[0.0, 0.0, 0.0]],
            rotations: vec![[0.0, 0.0, 0.0, 1.0]],
            scales: vec![[1.0, 1.0, 1.0]],
            matrices: vec![],
        }];
        let materials = default_materials();

        let estimate =
            estimate_bin_capacity(&[], &meshes, &textures, &skins, &animations, &instancing)
                .expect("capacity estimate");
        let optimized = build_glb(
            &[],
            &meshes,
            &materials,
            &textures,
            &skins,
            &animations,
            &[],
            &[],
            None,
            &instancing,
        )
        .expect("build comprehensive glb");
        let legacy_growth = build_glb_with_bin_capacity(
            &[],
            &meshes,
            &materials,
            &textures,
            &skins,
            &animations,
            &[],
            &[],
            None,
            &instancing,
            Some(0),
        )
        .expect("build comprehensive glb without preallocation");

        assert_eq!(estimate, glb_bin_chunk_len(&optimized));
        assert_eq!(
            optimized, legacy_growth,
            "preallocation must not alter GLB bytes"
        );
    }

    #[test]
    fn build_glb_emits_gpu_instancing_contract() {
        let meshes = vec![unit_quad_split_into_two_triangles()];
        let instancing = vec![InstancingInput {
            prototype_mesh_idx: 0,
            parent_node_idx: None,
            instancer_prim_path: "/World/Instances".to_string(),
            translations: vec![[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
            rotations: vec![[0.0, 0.0, 0.0, 1.0]; 2],
            scales: vec![[1.0, 1.0, 1.0]; 2],
            matrices: vec![],
        }];

        let glb = build_glb(
            &[],
            &meshes,
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &instancing,
        )
        .expect("build instanced glb");
        let document = glb_json(&glb);
        let node = document["nodes"]
            .as_array()
            .and_then(|nodes| nodes.first())
            .expect("instanced node");

        assert_eq!(
            document["extensionsUsed"],
            json!(["EXT_mesh_gpu_instancing"])
        );
        assert_eq!(
            document["extensionsRequired"],
            json!(["EXT_mesh_gpu_instancing"])
        );
        assert_eq!(node["extras"]["primPath"], "/World/Instances");
        assert_eq!(
            node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"]
                .as_object()
                .map(|attributes| attributes.len()),
            Some(3)
        );
        assert_eq!(document["accessors"][4]["count"], 2);
        assert_eq!(document["accessors"][5]["count"], 2);
        assert_eq!(document["accessors"][6]["count"], 2);
    }

    #[test]
    fn build_glb_falls_back_to_nodes_for_negative_or_non_finite_scale() {
        let meshes = vec![unit_quad_split_into_two_triangles()];
        let instancing = vec![InstancingInput {
            prototype_mesh_idx: 0,
            parent_node_idx: None,
            instancer_prim_path: "/World/Instances".to_string(),
            translations: vec![[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
            rotations: vec![[0.0, 0.0, 0.0, 1.0]; 2],
            scales: vec![[-1.0, 1.0, 1.0], [f32::NAN, 1.0, 1.0]],
            matrices: vec![
                crate::usd::math::trs_to_mat4_f32(
                    [0.0, 0.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                    [-1.0, 1.0, 1.0],
                ),
                crate::usd::math::trs_to_mat4_f32(
                    [2.0, 0.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                    [f32::NAN, 1.0, 1.0],
                ),
            ],
        }];

        let glb = build_glb(
            &[],
            &meshes,
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &instancing,
        )
        .expect("build fallback instancing glb");
        let document = glb_json(&glb);
        let nodes = document["nodes"].as_array().expect("fallback nodes");

        assert!(document.get("extensionsUsed").is_none());
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0]["matrix"][0], -1.0);
        assert!(nodes[0].get("scale").is_none());
        assert_eq!(nodes[1]["scale"], json!([1.0, 1.0, 1.0]));
        assert_eq!(nodes[0]["extras"]["instancingFallback"], true);
    }

    #[test]
    fn bin_capacity_estimate_handles_padding_empty_and_overflow() {
        assert_eq!(checked_padded_section_len(0, 4), Some(0));
        assert_eq!(checked_padded_section_len(1, 1), Some(4));
        assert_eq!(checked_padded_section_len(4, 1), Some(4));
        assert_eq!(checked_padded_section_len(5, 1), Some(8));
        assert_eq!(checked_padded_section_len(usize::MAX, 2), None);

        let mut total = usize::MAX;
        assert_eq!(checked_add_bin_section(&mut total, 1, 1), None);
        assert_eq!(total, usize::MAX);
        assert_eq!(estimate_bin_capacity(&[], &[], &[], &[], &[], &[]), Some(0));
    }

    #[test]
    fn build_glb_allows_empty_scene() {
        let glb = build_glb(
            &[],
            &[],
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
        )
        .expect("build empty glb scene");
        assert_eq!(&glb[0..4], b"glTF");
    }

    #[test]
    fn build_glb_roundtrips_a_unit_quad() {
        let mesh = unit_quad_split_into_two_triangles();
        let glb = build_glb(
            &[],
            &[mesh],
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
        )
        .expect("build glb");

        // GLB header sanity check
        assert_eq!(&glb[0..4], b"glTF");
        let version = u32::from_le_bytes(glb[4..8].try_into().unwrap());
        assert_eq!(version, 2);
        let total_length = u32::from_le_bytes(glb[8..12].try_into().unwrap());
        assert_eq!(total_length as usize, glb.len());

        // First chunk should be JSON
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_chunk_type = u32::from_le_bytes(glb[16..20].try_into().unwrap());
        assert_eq!(json_chunk_type, CHUNK_TYPE_JSON);
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let doc = glb_json(&glb);
        assert_eq!(doc["asset"]["version"], "2.0");
        assert_eq!(doc["meshes"][0]["primitives"][0]["mode"], 4);
        assert_eq!(doc["accessors"].as_array().unwrap().len(), 4); // pos + normal + uv + idx

        // Second chunk should be BIN, containing 4*3*4 (positions) +
        // 4*3*4 (normals) + 4*2*4 (uvs) + 6*4 (indices) = 48 + 48 + 32 + 24 = 152
        // possibly padded.
        let bin_chunk_offset = json_end;
        let bin_chunk_len = u32::from_le_bytes(
            glb[bin_chunk_offset..bin_chunk_offset + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let bin_chunk_type = u32::from_le_bytes(
            glb[bin_chunk_offset + 4..bin_chunk_offset + 8]
                .try_into()
                .unwrap(),
        );
        assert_eq!(bin_chunk_type, CHUNK_TYPE_BIN);
        assert!(bin_chunk_len >= 152, "bin chunk too small: {bin_chunk_len}");
    }

    #[test]
    fn skips_weight_channels_without_resolved_mesh_node() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.morph_targets = vec![MorphTarget {
            name: Some("Smile".to_string()),
            position_offsets: vec![0.0; mesh.positions.len()],
        }];
        mesh.morph_weights = vec![0.0];
        let skin = SkinInput {
            name: "skin".to_string(),
            joint_names: vec!["Root".to_string()],
            parents: vec![None],
            rest_local_matrices: vec![identity_matrix()],
            inverse_bind_matrices: vec![identity_matrix()],
            skel_root_matrix: None,
        };
        let animation = AnimationInput {
            name: "weights".to_string(),
            times: vec![0.0, 1.0],
            skin_index: 0,
            translations: vec![None],
            rotations: vec![None],
            scales: vec![None],
            weight_channels: vec![MorphWeightChannel {
                mesh_index: 0,
                weights: vec![0.0, 1.0],
            }],
        };
        let nodes = vec![NodeInput {
            prim_path: "/Root".to_string(),
            basename: "Root".to_string(),
            parent: None,
            local_matrix: identity_matrix(),
            kind: NodeKind::Group,
            mesh_payload_idx: None,
            light_payload_idx: None,
            camera_payload_idx: None,
            skin_payload_idx: None,
        }];
        let meshes = vec![mesh];
        let skins = vec![skin];
        let animations = vec![animation];
        let estimated = estimate_bin_capacity(&nodes, &meshes, &[], &skins, &animations, &[])
            .expect("capacity estimate");

        let glb = build_glb(
            &nodes,
            &meshes,
            &default_materials(),
            &[],
            &skins,
            &animations,
            &[],
            &[],
            None,
            &[],
        )
        .expect("build glb");
        let doc = glb_json(&glb);

        assert_eq!(estimated, glb_bin_chunk_len(&glb));
        assert!(
            doc.get("animations").is_none(),
            "unresolved mesh-node weight channel must not be emitted: {:?}",
            doc.get("animations")
        );
    }

    #[test]
    fn rejects_mismatched_normal_count() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.normals = Some(vec![0.0; 6]); // wrong length
        let err = build_glb(
            &[],
            &[mesh],
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
        )
        .unwrap_err();
        assert!(err.contains("normal"));
    }

    #[test]
    fn rejects_out_of_range_index() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.indices = vec![0, 1, 99];
        let err = build_glb(
            &[],
            &[mesh],
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
        )
        .unwrap_err();
        assert!(err.contains("out of range"));
    }

    #[test]
    fn rejects_material_index_out_of_range() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.material_index = 5;
        let err = build_glb(
            &[],
            &[mesh],
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
        )
        .unwrap_err();
        assert!(
            err.contains("material_index"),
            "expected material_index error, got: {err}"
        );
    }

    #[test]
    fn rejects_empty_materials_array() {
        let mesh = unit_quad_split_into_two_triangles();
        let err = build_glb(&[], &[mesh], &[], &[], &[], &[], &[], &[], None, &[]).unwrap_err();
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
            alpha_mode: None,
            alpha_cutoff: 0.5,
            metallic_roughness_texture: None,
        }];
        let glb = build_glb(&[], &[mesh], &materials, &[], &[], &[], &[], &[], None, &[])
            .expect("build glb");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
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
        let glb = build_glb(&[], &[mesh], &materials, &[], &[], &[], &[], &[], None, &[])
            .expect("build glb");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
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
    fn normal_texture_uses_material_wrap_sampler() {
        let mesh = unit_quad_split_into_two_triangles();
        let materials = vec![MaterialInput {
            name: "normal_only".to_string(),
            normal_texture: Some(0),
            wrap_s: 33071,
            wrap_t: 33648,
            ..MaterialInput::default_preview()
        }];
        let textures = vec![TextureInput {
            name: "normal.png".to_string(),
            mime_type: "image/png".to_string(),
            data: vec![
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
                0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
                0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
                0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD, 0xFF,
                0x69, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
            ],
        }];

        let glb = build_glb(
            &[],
            &[mesh],
            &materials,
            &textures,
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
        )
        .expect("build glb");
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_text = std::str::from_utf8(&glb[20..20 + json_chunk_len])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        assert_eq!(doc["materials"][0]["normalTexture"]["index"], 0);
        assert_eq!(doc["textures"][0]["sampler"], 0);
        assert_eq!(doc["samplers"][0]["wrapS"], 33071);
        assert_eq!(doc["samplers"][0]["wrapT"], 33648);
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
                alpha_mode: None,
                alpha_cutoff: 0.5,
                metallic_roughness_texture: None,
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
                alpha_mode: None,
                alpha_cutoff: 0.5,
                metallic_roughness_texture: None,
            },
        ];

        let glb = build_glb(
            &[],
            &[red_mesh, blue_mesh],
            &materials,
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
        )
        .expect("build glb");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
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

    #[test]
    fn node_animation_targets_actual_node_after_synthetic_root_and_skin_joints() {
        let nodes = vec![
            NodeInput::group(
                "/Root".to_string(),
                "Root".to_string(),
                None,
                identity_matrix(),
            ),
            NodeInput::group(
                "/Root/Animated".to_string(),
                "Animated".to_string(),
                Some(0),
                [
                    1.0, 0.0, 0.0, 0.0, // matrix must be replaced by initial TRS
                    0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 8.0, 0.0, 0.0, 1.0,
                ],
            ),
        ];
        let skins = vec![SkinInput {
            name: "skin".to_string(),
            joint_names: vec!["Joint".to_string()],
            parents: vec![None],
            rest_local_matrices: vec![identity_matrix()],
            inverse_bind_matrices: vec![identity_matrix()],
            skel_root_matrix: None,
        }];
        let node_animation = NodeAnimationInput {
            name: "xform_step".to_string(),
            times: vec![0.0, 1.0],
            interpolation: NodeAnimationInterpolation::Step,
            channels: vec![NodeTrsChannel {
                node_index: 1,
                translations: vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
                rotations: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.70710677, 0.70710677],
                scales: vec![1.0, 1.0, 1.0, 2.0, 2.0, 2.0],
            }],
        };

        let glb = build_glb_with_node_animations(
            &nodes,
            &[],
            &default_materials(),
            &[],
            &skins,
            &[],
            &[],
            &[],
            None,
            &[],
            &[node_animation],
        )
        .expect("build node animation glb");
        let doc = glb_json(&glb);

        // Skin joint = 0, synthetic __upAxis = 1, Root = 2, Animated = 3.
        let animated_node = &doc["nodes"][3];
        assert!(animated_node.get("matrix").is_none());
        assert_eq!(animated_node["translation"], json!([1.0, 2.0, 3.0]));
        assert_eq!(animated_node["rotation"], json!([0.0, 0.0, 0.0, 1.0]));
        assert_eq!(animated_node["scale"], json!([1.0, 1.0, 1.0]));

        let animation = &doc["animations"][0];
        assert_eq!(animation["name"], "xform_step");
        assert_eq!(animation["samplers"].as_array().unwrap().len(), 3);
        assert_eq!(animation["channels"][0]["target"]["node"], 3);
        assert_eq!(animation["channels"][0]["target"]["path"], "translation");
        assert_eq!(animation["channels"][1]["target"]["path"], "rotation");
        assert_eq!(animation["channels"][2]["target"]["path"], "scale");
        for sampler in animation["samplers"].as_array().unwrap() {
            assert_eq!(sampler["interpolation"], "STEP");
            assert_eq!(
                accessor_f32(&doc, &glb, sampler["input"].as_u64().unwrap() as usize),
                vec![0.0, 1.0]
            );
        }
        assert_eq!(
            accessor_f32(
                &doc,
                &glb,
                animation["samplers"][0]["output"].as_u64().unwrap() as usize
            ),
            vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        );
        assert_eq!(
            accessor_f32(
                &doc,
                &glb,
                animation["samplers"][1]["output"].as_u64().unwrap() as usize
            ),
            vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.70710677, 0.70710677]
        );
        assert_eq!(
            accessor_f32(
                &doc,
                &glb,
                animation["samplers"][2]["output"].as_u64().unwrap() as usize
            ),
            vec![1.0, 1.0, 1.0, 2.0, 2.0, 2.0]
        );
    }

    #[test]
    fn build_glb_with_empty_node_animations_is_byte_identical() {
        let nodes = vec![NodeInput::group(
            "/Static".to_string(),
            "Static".to_string(),
            None,
            identity_matrix(),
        )];
        let old = build_glb(
            &nodes,
            &[],
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
        )
        .expect("build static glb");
        let additive = build_glb_with_node_animations(
            &nodes,
            &[],
            &default_materials(),
            &[],
            &[],
            &[],
            &[],
            &[],
            None,
            &[],
            &[],
        )
        .expect("build static glb through additive entrypoint");
        assert_eq!(old, additive);
    }

    #[test]
    fn rejects_malformed_node_animation_tracks() {
        let valid_channel = || NodeTrsChannel {
            node_index: 0,
            translations: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            rotations: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
            scales: vec![1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        };
        let valid = || NodeAnimationInput {
            name: "invalid".to_string(),
            times: vec![0.0, 1.0],
            interpolation: NodeAnimationInterpolation::Linear,
            channels: vec![valid_channel()],
        };

        let mut cases = Vec::new();
        let mut no_times = valid();
        no_times.times.clear();
        cases.push((no_times, "no time samples"));
        let mut no_channels = valid();
        no_channels.channels.clear();
        cases.push((no_channels, "no channels"));
        let mut bad_length = valid();
        bad_length.channels[0].scales.pop();
        cases.push((bad_length, "scale length"));
        let mut bad_index = valid();
        bad_index.channels[0].node_index = 1;
        cases.push((bad_index, "out of range"));
        let mut bad_time = valid();
        bad_time.times = vec![1.0, 1.0];
        cases.push((bad_time, "strictly increasing"));
        let mut bad_negative_time = valid();
        bad_negative_time.times[0] = -0.1;
        cases.push((bad_negative_time, "non-negative"));
        let mut bad_finite = valid();
        bad_finite.channels[0].translations[0] = f32::NAN;
        cases.push((bad_finite, "must be finite"));
        let mut bad_quaternion = valid();
        bad_quaternion.channels[0].rotations[3] = 0.5;
        cases.push((bad_quaternion, "normalized quaternion"));
        let mut duplicate = valid();
        duplicate.channels.push(valid_channel());
        cases.push((duplicate, "duplicate track"));

        for (animation, expected_error) in cases {
            let error = node_animation_fixture(animation).expect_err(expected_error);
            assert!(error.contains(expected_error), "{error}");
        }
    }
}
