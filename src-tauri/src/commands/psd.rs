use std::fs;
use std::path::PathBuf;

use crate::error::AppError;
use crate::shared::normalize_file_path;

/// Binary response format for `decode_psd`:
///
/// ```text
/// u32 little-endian width
/// u32 little-endian height
/// width * height * 4 bytes of tightly-packed RGBA8 pixels
/// ```
///
/// Keeping the dimensions beside the raw pixels avoids JSON number-array IPC
/// and lets the frontend construct a Three.js `DataTexture` directly.
const PSD_PACKET_HEADER_BYTES: usize = 8;

#[derive(Debug, PartialEq)]
struct DecodedPsd {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

fn decode_psd_bytes(bytes: &[u8]) -> Result<DecodedPsd, AppError> {
    let psd = psd::Psd::from_bytes(bytes)
        .map_err(|error| AppError::Internal(format!("PSD decode error: {error}")))?;
    let width = psd.width();
    let height = psd.height();
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| AppError::Internal("PSD dimensions overflow RGBA8 payload".into()))?;
    if width == 0 || height == 0 {
        return Err(AppError::Internal(
            "PSD decode error: image dimensions must be non-zero".into(),
        ));
    }

    // `flatten_layers_rgba` uses the PSD's layer stack when present and falls
    // back to the final image data (`rgba`) for documents without layers.
    let rgba = psd
        .flatten_layers_rgba(&|_| true)
        .map_err(|error| AppError::Internal(format!("PSD flatten error: {error}")))?;
    if rgba.len() != expected_len {
        return Err(AppError::Internal(format!(
            "PSD decode error: expected {expected_len} RGBA8 bytes, got {}",
            rgba.len()
        )));
    }

    Ok(DecodedPsd {
        width,
        height,
        rgba,
    })
}

fn encode_psd_packet(decoded: DecodedPsd) -> Result<Vec<u8>, AppError> {
    let expected_len = (decoded.width as usize)
        .checked_mul(decoded.height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| AppError::Internal("PSD dimensions overflow packet size".into()))?;
    if decoded.rgba.len() != expected_len {
        return Err(AppError::Internal(format!(
            "PSD packet error: expected {expected_len} RGBA8 bytes, got {}",
            decoded.rgba.len()
        )));
    }

    let mut packet = Vec::with_capacity(PSD_PACKET_HEADER_BYTES + expected_len);
    packet.extend_from_slice(&decoded.width.to_le_bytes());
    packet.extend_from_slice(&decoded.height.to_le_bytes());
    packet.extend_from_slice(&decoded.rgba);
    Ok(packet)
}

#[tauri::command]
pub(crate) fn decode_psd(path: String) -> Result<tauri::ipc::Response, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let extension = normalized
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if extension != "psd" {
        return Err(AppError::Internal(format!(
            "PSD decoder received a non-PSD path: {}",
            normalized.display()
        )));
    }
    let bytes = fs::read(&normalized).map_err(|error| {
        AppError::Io(format!(
            "failed to read PSD '{}': {error}",
            normalized.display()
        ))
    })?;
    let packet = encode_psd_packet(decode_psd_bytes(&bytes)?)?;
    Ok(tauri::ipc::Response::new(packet))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_rgb_psd() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"8BPS");
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&8u16.to_be_bytes());
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&[0x7f, 0x3f, 0x1f]);
        bytes
    }

    #[test]
    fn decodes_flattened_rgba_pixels_from_a_minimal_psd() {
        let decoded = decode_psd_bytes(&minimal_rgb_psd()).expect("minimal PSD");

        assert_eq!(decoded.width, 1);
        assert_eq!(decoded.height, 1);
        assert_eq!(decoded.rgba, vec![0x7f, 0x3f, 0x1f, 0xff]);
    }

    #[test]
    fn rejects_non_psd_bytes_with_a_typed_app_error() {
        let error = decode_psd_bytes(b"not a PSD").expect_err("reject non-PSD");

        assert!(
            matches!(error, AppError::Internal(message) if message.starts_with("PSD decode error:"))
        );
    }

    #[test]
    fn encodes_dimensions_and_rgba_payload_without_json_numbers() {
        let packet = encode_psd_packet(DecodedPsd {
            width: 2,
            height: 1,
            rgba: vec![1, 2, 3, 4, 5, 6, 7, 8],
        })
        .expect("packet");

        assert_eq!(&packet[..8], &[2, 0, 0, 0, 1, 0, 0, 0]);
        assert_eq!(&packet[8..], &[1, 2, 3, 4, 5, 6, 7, 8]);
    }
}
