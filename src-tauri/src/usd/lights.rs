//! Backend-independent UsdLux to glTF punctual light helpers.
//!
//! yw-look currently emits only `DistantLight` and `SphereLight`
//! through `KHR_lights_punctual`. Area-style lights and `DomeLight`
//! are intentionally skipped by the backend-specific resolvers.

use super::glb::LightKind;

/// Map a USD light prim `typeName` to the punctual glTF light kinds
/// supported by yw-look's Phase 7a GLB extraction.
pub(crate) fn gltf_light_kind_from_usd_type_name(type_name: Option<&str>) -> Option<LightKind> {
    match type_name {
        Some("DistantLight") => Some(LightKind::Directional),
        Some("SphereLight") => Some(LightKind::Point),
        _ => None,
    }
}

/// UsdLux exposure is authored in stops and multiplies intensity by 2^exposure.
pub(crate) fn effective_light_intensity(intensity: f32, exposure: f32) -> f32 {
    intensity * 2.0f32.powf(exposure)
}

pub(crate) fn effective_light_intensity_from_authored(
    intensity: Option<f32>,
    exposure: Option<f32>,
) -> f32 {
    effective_light_intensity(intensity.unwrap_or(1.0), exposure.unwrap_or(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usd_type_names_map_to_supported_gltf_light_kinds() {
        assert_eq!(
            gltf_light_kind_from_usd_type_name(Some("DistantLight")),
            Some(LightKind::Directional)
        );
        assert_eq!(
            gltf_light_kind_from_usd_type_name(Some("SphereLight")),
            Some(LightKind::Point)
        );
        assert_eq!(gltf_light_kind_from_usd_type_name(Some("RectLight")), None);
        assert_eq!(gltf_light_kind_from_usd_type_name(Some("DomeLight")), None);
        assert_eq!(gltf_light_kind_from_usd_type_name(Some("Camera")), None);
        assert_eq!(gltf_light_kind_from_usd_type_name(None), None);
    }

    #[test]
    fn effective_light_intensity_applies_exposure_stops() {
        assert!((effective_light_intensity(3.0, 1.0) - 6.0).abs() < 1e-6);
        assert!((effective_light_intensity(10.0, 0.0) - 10.0).abs() < 1e-6);
        assert!((effective_light_intensity(1.0, -1.0) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn effective_light_intensity_from_authored_applies_schema_defaults() {
        assert!((effective_light_intensity_from_authored(None, None) - 1.0).abs() < 1e-6);
        assert!((effective_light_intensity_from_authored(Some(2.0), None) - 2.0).abs() < 1e-6);
        assert!((effective_light_intensity_from_authored(None, Some(2.0)) - 4.0).abs() < 1e-6);
    }
}
