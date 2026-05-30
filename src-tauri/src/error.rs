use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),

    #[error("USD error: {0}")]
    Usd(String),

    #[error("Serialization error: {0}")]
    Serde(String),

    #[error("Operation timed out")]
    Timeout,

    #[error("{0}")]
    Internal(String),
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
