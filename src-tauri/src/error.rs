use serde::{ser::SerializeStruct, Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rhino3dmErrorDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_status: Option<String>,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),

    #[error("USD error: {0}")]
    Usd(String),

    #[error("FBX error: {0}")]
    Fbx(String),

    #[error("Operation was canceled")]
    Cancelled,

    #[error("Serialization error: {0}")]
    Serde(String),

    #[error("Operation timed out")]
    Timeout,

    #[error("{0}")]
    Internal(String),

    #[error("{message}")]
    Rhino3dm {
        kind: String,
        message: String,
        details: Rhino3dmErrorDetails,
    },
}

impl AppError {
    pub(crate) fn rhino3dm(
        kind: impl Into<String>,
        message: impl Into<String>,
        details: Rhino3dmErrorDetails,
    ) -> Self {
        Self::Rhino3dm {
            kind: kind.into(),
            message: message.into(),
            details,
        }
    }
}

// Keep the existing `{ kind, message }` IPC shape for all old variants while
// allowing the native 3DM path to carry structured details at the same level.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut value = serializer.serialize_struct(
            "AppError",
            match self {
                Self::Rhino3dm { .. } => 3,
                Self::Cancelled | Self::Timeout => 1,
                _ => 2,
            },
        )?;
        match self {
            Self::Io(message) => {
                value.serialize_field("kind", "io")?;
                value.serialize_field("message", message)?;
            }
            Self::Usd(message) => {
                value.serialize_field("kind", "usd")?;
                value.serialize_field("message", message)?;
            }
            Self::Fbx(message) => {
                value.serialize_field("kind", "fbx")?;
                value.serialize_field("message", message)?;
            }
            Self::Cancelled => {
                value.serialize_field("kind", "cancelled")?;
            }
            Self::Serde(message) => {
                value.serialize_field("kind", "serde")?;
                value.serialize_field("message", message)?;
            }
            Self::Timeout => {
                value.serialize_field("kind", "timeout")?;
            }
            Self::Internal(message) => {
                value.serialize_field("kind", "internal")?;
                value.serialize_field("message", message)?;
            }
            Self::Rhino3dm {
                kind,
                message,
                details,
            } => {
                value.serialize_field("kind", kind)?;
                value.serialize_field("message", message)?;
                value.serialize_field("details", details)?;
            }
        }
        value.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::Io(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        AppError::Serde(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_errors_keep_the_kind_and_message_wire_shape() {
        let value = serde_json::to_value(AppError::Fbx("bad mesh".into())).unwrap();
        assert_eq!(value["kind"], "fbx");
        assert_eq!(value["message"], "bad mesh");
        assert!(value.get("details").is_none());

        assert_eq!(
            serde_json::to_value(AppError::Cancelled).unwrap(),
            serde_json::json!({"kind": "cancelled"})
        );
        assert_eq!(
            serde_json::to_value(AppError::Timeout).unwrap(),
            serde_json::json!({"kind": "timeout"})
        );
    }

    #[test]
    fn native_error_details_are_top_level_and_structured() {
        let value = serde_json::to_value(AppError::rhino3dm(
            "memoryLimit",
            "budget exceeded",
            Rhino3dmErrorDetails {
                stage: Some("mesh".into()),
                limit: Some(10),
                observed: Some(11),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(value["kind"], "memoryLimit");
        assert_eq!(value["message"], "budget exceeded");
        assert_eq!(value["details"]["stage"], "mesh");
        assert_eq!(value["details"]["limit"], 10);
        assert_eq!(value["details"]["observed"], 11);
    }
}
