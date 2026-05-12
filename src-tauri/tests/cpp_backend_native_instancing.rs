//! Regression tests for native USD instancing (`instanceable = true`).
//!
//! Some DCC exports keep prototype definitions hidden and expose the visible
//! scene only through instance proxy prims. The C++ backend must traverse
//! instance proxies when collecting renderable Mesh prims.

#![cfg(feature = "backend-openusd-cpp")]

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use yw_look_lib::usd::{OpenusdCppBackend, StageLoadPolicy, UsdGeometryBackend};

fn parse_glb_json(bytes: &[u8]) -> Value {
    assert!(bytes.len() >= 20, "GLB too short");
    assert_eq!(&bytes[0..4], b"glTF", "GLB magic");
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    assert_eq!(version, 2, "GLB version");
    let chunk_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let chunk_type = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    assert_eq!(chunk_type, 0x4E4F534A, "first GLB chunk must be JSON");
    serde_json::from_slice(&bytes[20..20 + chunk_len]).expect("valid JSON chunk")
}

fn write_native_instance_scene(root: &Path) -> PathBuf {
    fs::create_dir_all(root).expect("create temp scene dir");
    let scene_path = root.join("native_instance_hidden_prototype.usda");
    fs::write(
        &scene_path,
        r#"#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "World"
{
    def Scope "Prototypes"
    {
        token visibility = "invisible"

        def Xform "TriangleProto"
        {
            def Mesh "Mesh"
            {
                int[] faceVertexCounts = [3]
                int[] faceVertexIndices = [0, 1, 2]
                point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
            }
        }
    }

    def Xform "Instances"
    {
        def Xform "Triangle_1" (
            instanceable = true
            prepend references = </World/Prototypes/TriangleProto>
        )
        {
            double3 xformOp:translate = (2, 0, 0)
            uniform token[] xformOpOrder = ["xformOp:translate"]
        }
    }
}
"#,
    )
    .expect("write temp scene");
    scene_path
}

#[test]
fn native_instance_proxy_meshes_are_rendered_when_prototypes_are_hidden() {
    let root = std::env::temp_dir().join(format!(
        "yw_look_native_instance_hidden_proto_{}",
        std::process::id()
    ));
    if root.exists() {
        fs::remove_dir_all(&root).expect("clear old temp scene dir");
    }
    let scene_path = write_native_instance_scene(&root);

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&scene_path, StageLoadPolicy::LoadAll)
        .expect("native instance proxy meshes should be extracted");

    let gltf = parse_glb_json(&bytes);
    let meshes = gltf["meshes"].as_array().expect("meshes array");
    assert_eq!(
        meshes.len(),
        1,
        "only the visible instance proxy mesh should render"
    );

    let nodes = gltf["nodes"].as_array().expect("nodes array");
    let has_instance_proxy_mesh_node = nodes.iter().any(|node| {
        node.get("mesh").is_some()
            && node
                .pointer("/extras/primPath")
                .and_then(Value::as_str)
                .is_some_and(|path| path == "/World/Instances/Triangle_1/Mesh")
    });
    assert!(
        has_instance_proxy_mesh_node,
        "GLB should contain a mesh node for the visible native instance proxy"
    );
}
