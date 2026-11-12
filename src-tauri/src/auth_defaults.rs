use std::fs;
use std::path::Path;
use std::sync::Mutex;

use serde_json::Value;

pub(crate) const MIGRATION_MARKER: &str = "auth-credentials-v2-migrated";
static MIGRATION_LOCK: Mutex<()> = Mutex::new(());

pub fn migrate_initial_credentials_file(path: &Path) -> Result<Option<String>, String> {
    let _guard = MIGRATION_LOCK
        .lock()
        .map_err(|error| format!("No se pudo bloquear la migración de cuentas: {error}"))?;
    let marker = path.with_file_name(MIGRATION_MARKER);
    if marker.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let (migrated, changed) = migrate_initial_credentials(&raw)?;
    if changed {
        write_atomic(path, migrated.as_bytes())?;
    }
    write_atomic(&marker, b"2\n")?;
    Ok(changed.then_some(migrated))
}

fn migrate_initial_credentials(raw: &str) -> Result<(String, bool), String> {
    let mut accounts: Value =
        serde_json::from_str(raw).map_err(|error| format!("Cuentas inválidas: {error}"))?;
    let Some(rows) = accounts.as_array_mut() else {
        return Err("El archivo de cuentas no contiene una lista.".to_string());
    };
    let mut changed = false;

    for row in rows.iter_mut() {
        let Some(account) = row.as_object_mut() else {
            continue;
        };
        let username = account
            .get("username")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        let role = account
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_lowercase();

        let credentials = match (username.as_str(), role.as_str()) {
            ("admi" | "admin", "admin") => Some((
                "Admi",
                "Admi",
                "P1U/65i0gOmqYowAPc3UnzYvQXvplu85GTJ6avQES30=",
                "fG8r56seNehNiM3JMddqSg==",
            )),
            ("aguirre mary", "secretaria") => Some((
                "Aguirre Mary",
                "Aguirre Mary",
                "+8z8K3Yq1ypaTr5lAHt8f+ZfzEGEDq++UAS4ok4UTCg=",
                "4atQN0lY+daonfSIg0516Q==",
            )),
            ("barua andrea", "secretaria") => Some((
                "Barua Andrea",
                "Barua Andrea",
                "YT572xmglGv/oF5MeUWRgq8Va1VuEQ4OaagUPXuVZNE=",
                "cvNyyRkx1ju95x/Clzdelg==",
            )),
            ("afiliados" | "contratantes", "afiliado") => Some((
                "Contratantes",
                "Contratantes",
                "XSB27daQ5HQsdh+d7XTLg4iFNc87l3R3U1WVUdb0gLs=",
                "QdWC1HoUiu6h8xqWq2JrKA==",
            )),
            _ => None,
        };

        if let Some((username, display_name, hash, salt)) = credentials {
            account.insert("username".to_string(), Value::String(username.to_string()));
            account.insert(
                "displayName".to_string(),
                Value::String(display_name.to_string()),
            );
            account.insert("passwordHash".to_string(), Value::String(hash.to_string()));
            account.insert("passwordSalt".to_string(), Value::String(salt.to_string()));
            account.insert("mustChangePassword".to_string(), Value::Bool(false));
            account.remove("password");
            changed = true;
        }
    }

    if rows.iter().filter(|row| {
        row.get("username")
            .and_then(Value::as_str)
            .is_some_and(|username| username.eq_ignore_ascii_case("Contratantes"))
            && row
                .get("role")
                .and_then(Value::as_str)
                .is_some_and(|role| role.eq_ignore_ascii_case("afiliado"))
    }).count() > 1 {
        let mut kept = false;
        rows.retain(|row| {
            let is_contratantes = row
                .get("username")
                .and_then(Value::as_str)
                .is_some_and(|username| username.eq_ignore_ascii_case("Contratantes"))
                && row
                    .get("role")
                    .and_then(Value::as_str)
                    .is_some_and(|role| role.eq_ignore_ascii_case("afiliado"));
            if !is_contratantes {
                return true;
            }
            if kept {
                false
            } else {
                kept = true;
                true
            }
        });
        changed = true;
    }

    if changed {
        serde_json::to_string_pretty(&accounts)
            .map(|json| (json, true))
            .map_err(|error| format!("No se pudieron serializar las cuentas: {error}"))
    } else {
        Ok((raw.to_string(), false))
    }
}

fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary_path = path.with_extension("tmp");
    fs::write(&temporary_path, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary_path, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migra_a_contratantes_y_no_repite_el_reseteo() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("auth-accounts.json");
        let original = serde_json::json!([
            {
                "username": "Afiliados",
                "role": "afiliado",
                "displayName": "Afiliados",
                "password": "456"
            },
            {
                "username": "Aguirre Mary",
                "role": "secretaria",
                "displayName": "Aguirre Mary",
                "password": "password-personalizado"
            }
        ]);
        fs::write(&path, original.to_string()).unwrap();

        migrate_initial_credentials_file(&path).unwrap();
        let migrated: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let rows = migrated.as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["username"], "Contratantes");
        assert_eq!(rows[0]["displayName"], "Contratantes");
        assert_eq!(
            rows[0]["passwordHash"],
            "XSB27daQ5HQsdh+d7XTLg4iFNc87l3R3U1WVUdb0gLs="
        );
        assert!(rows[0].get("password").is_none());
        assert_eq!(
            rows[1]["passwordHash"],
            "+8z8K3Yq1ypaTr5lAHt8f+ZfzEGEDq++UAS4ok4UTCg="
        );

        let mut customized = rows[0].clone();
        customized["passwordHash"] = Value::String("custom-hash".to_string());
        let mut rows = rows.clone();
        rows[0] = customized;
        fs::write(&path, serde_json::to_string(&rows).unwrap()).unwrap();
        assert!(migrate_initial_credentials_file(&path).unwrap().is_none());

        let after_restart: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after_restart[0]["passwordHash"], "custom-hash");
    }
}
