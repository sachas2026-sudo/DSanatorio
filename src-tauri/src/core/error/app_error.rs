use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    Database(String),
    Io(String),
    Validation(String),
    Auth(String),
    Email(String),
    WhatsApp(String),
    Config(String),
    NotFound(String),
    Generic(String),
}

impl std::error::Error for AppError {}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Database(msg) => write!(f, "Error de base de datos: {msg}"),
            AppError::Io(msg) => write!(f, "Error de E/S: {msg}"),
            AppError::Validation(msg) => write!(f, "Error de validación: {msg}"),
            AppError::Auth(msg) => write!(f, "Error de autorización: {msg}"),
            AppError::Email(msg) => write!(f, "Error de correo electrónico: {msg}"),
            AppError::WhatsApp(msg) => write!(f, "Error de WhatsApp: {msg}"),
            AppError::Config(msg) => write!(f, "Error de configuración: {msg}"),
            AppError::NotFound(msg) => write!(f, "No encontrado: {msg}"),
            AppError::Generic(msg) => write!(f, "{msg}"),
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Validation(err.to_string())
    }
}

impl From<base64::DecodeError> for AppError {
    fn from(err: base64::DecodeError) -> Self {
        AppError::Validation(err.to_string())
    }
}

impl From<String> for AppError {
    fn from(err: String) -> Self {
        AppError::Generic(err)
    }
}

impl From<&str> for AppError {
    fn from(err: &str) -> Self {
        AppError::Generic(err.to_string())
    }
}
