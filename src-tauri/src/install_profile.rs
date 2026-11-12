use crate::core::config::settings;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallProfile {
    Server,
    Contratantes,
    Administracion,
}

impl InstallProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Server => "server",
            Self::Contratantes => "contratantes",
            Self::Administracion => "administracion",
        }
    }

    pub fn is_client(self) -> bool {
        !matches!(self, Self::Server)
    }
}

pub fn load() -> Result<Option<InstallProfile>, String> {
    let path = settings::sanatorio_root().join("install-profile.ini");
    let profile = match std::fs::read_to_string(&path) {
        Ok(value) => value
            .lines()
            .find_map(|line| {
                let (key, value) = line.split_once('=')?;
                key.trim()
                    .eq_ignore_ascii_case("profile")
                    .then(|| value.trim().to_ascii_lowercase())
            })
            .unwrap_or_default(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("No se pudo leer el perfil de instalación: {error}")),
    };

    match profile.as_str() {
        "server" => Ok(Some(InstallProfile::Server)),
        "contratantes" => Ok(Some(InstallProfile::Contratantes)),
        "administracion" => Ok(Some(InstallProfile::Administracion)),
        _ => Err("El perfil de instalación no es válido.".to_string()),
    }
}

#[tauri::command]
pub fn get_install_profile() -> Result<Option<String>, String> {
    load().map(|profile| profile.map(|value| value.as_str().to_string()))
}
