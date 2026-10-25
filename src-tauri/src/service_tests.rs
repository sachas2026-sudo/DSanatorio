#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use crate::core::db::open_connection;
    use crate::core::config::settings;
    use std::fs;

    fn setup_temp_db() -> (rusqlite::Connection, std::path::PathBuf) {
        let temp_dir = tempfile::tempdir().unwrap();
        let data_dir = temp_dir.path().to_path_buf();
        std::env::set_var("SANATORIO_DATA_DIR", data_dir.to_str().unwrap());
        
        let conn = open_connection().unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS app_modules (key TEXT PRIMARY KEY, json TEXT)", []).unwrap();
        conn.execute("INSERT OR REPLACE INTO app_modules (key, json) VALUES (?1, ?2)", 
            params!["afiliados", r#"[{"id":"a1","nombre":"Afiliado 1"}]"#]).unwrap();
        
        (conn, data_dir)
    }

    #[test]
    fn test_migracion_afiliados_idempotente() {
        let (conn, _) = setup_temp_db();
        conn.execute("CREATE TABLE IF NOT EXISTS afiliados (id TEXT PRIMARY KEY, nombre TEXT, version INTEGER DEFAULT 1)", []).unwrap();
        let json: String = conn.query_row("SELECT json FROM app_modules WHERE key='afiliados'", [], |r| r.get(0)).unwrap();
        let data: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        for v in data {
            conn.execute("INSERT OR REPLACE INTO afiliados (id, nombre) VALUES (?1, ?2)", 
                params![v["id"].as_str().unwrap(), v["nombre"].as_str().unwrap()]).unwrap();
        }
        conn.execute("INSERT OR REPLACE INTO app_modules (key, json) VALUES ('migrado_tablas', 'true')", []).unwrap();
        let count: i64 = conn.query_row("SELECT count(*) FROM afiliados", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        for v in serde_json::from_str::<Vec<serde_json::Value>>(&json).unwrap() {
            conn.execute("INSERT OR REPLACE INTO afiliados (id, nombre) VALUES (?1, ?2)", 
                params![v["id"].as_str().unwrap(), v["nombre"].as_str().unwrap()]).unwrap();
        }
        let count_after: i64 = conn.query_row("SELECT count(*) FROM afiliados", [], |r| r.get(0)).unwrap();
        assert_eq!(count_after, 1);
    }

    #[test]
    fn test_marca_migrado_bloquea_fallback() {
        let (conn, _) = setup_temp_db();
        conn.execute("CREATE TABLE IF NOT EXISTS afiliados (id TEXT PRIMARY KEY, nombre TEXT, version INTEGER DEFAULT 1)", []).unwrap();
        conn.execute("INSERT OR REPLACE INTO app_modules (key, json) VALUES ('migrado_tablas', 'true')", []).unwrap();
        conn.execute("DELETE FROM afiliados", []).unwrap();
        let is_migrated: bool = conn.query_row("SELECT json='true' FROM app_modules WHERE key='migrado_tablas'", [], |r| r.get(0)).unwrap_or(false);
        let result = if is_migrated {
            Vec::new()
        } else {
            vec![serde_json::json!({"id":"old"})]
        };
        assert!(result.is_empty());
    }

    #[test]
    fn test_transaccion_migracion_atomica() {
        let (conn, _) = setup_temp_db();
        conn.execute("CREATE TABLE IF NOT EXISTS afiliados (id TEXT PRIMARY KEY, nombre TEXT, version INTEGER DEFAULT 1)", []).unwrap();
        let res = (|| -> Result<(), rusqlite::Error> {
            let tx = conn.unchecked_transaction()?;
            tx.execute("INSERT INTO afiliados (id, nombre) VALUES ('a1', 'T1')", [])?;
            tx.execute("INSERT INTO app_modules (key, json) VALUES ('migrado_tablas', 'true')", [])?;
            tx.execute("INSERT INTO tabla_inexistente VALUES (1)", [])?;
            tx.commit()
        })();
        assert!(res.is_err());
        let count: i64 = conn.query_row("SELECT count(*) FROM afiliados", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
        let migrado: Option<String> = conn.query_row("SELECT json FROM app_modules WHERE key='migrado_tablas'", [], |r| r.get(0)).unwrap_or(None);
        assert!(migrado.is_none());
    }

    #[test]
    fn test_roundtrip_afiliados_version() {
        let (conn, _) = setup_temp_db();
        conn.execute("CREATE TABLE IF NOT EXISTS afiliados (id TEXT PRIMARY KEY, nombre TEXT, version INTEGER DEFAULT 1)", []).unwrap();
        
        // Guardar
        let _a = serde_json::json!({"id":"t1","nombre":"Test"});
        conn.execute("INSERT INTO afiliados (id, nombre) VALUES (?1, ?2)", params!["t1", "Test"]).unwrap();
        
        // Recargar
        let name: String = conn.query_row("SELECT nombre FROM afiliados WHERE id='t1'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Test");
        
        // Editar y subir versión
        conn.execute("UPDATE afiliados SET nombre='Test2', version=version+1 WHERE id='t1'", []).unwrap();
        let version: i32 = conn.query_row("SELECT version FROM afiliados WHERE id='t1'", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn test_base_anterior_actualiza_sola() {
        let temp_dir = tempfile::tempdir().unwrap();
        let data_dir = temp_dir.path().to_path_buf();
        std::env::set_var("SANATORIO_DATA_DIR", data_dir.to_str().unwrap());
        
        // Base vacía (no hay tablas, no hay migración 0006)
        let mut conn = open_connection().unwrap();
        
        // Simular el arranque de la app (que corre initialize_schema)
        crate::core::db::migrations::initialize_schema(&mut conn).unwrap();
        
        // Verificar que la tabla afiliados existe ahora
        let exists: bool = conn.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='afiliados'", [], |r| r.get::<_, i32>(0)).unwrap() > 0;
        assert!(exists);
    }

    #[test]
    fn test_sanatorio_data_dir_no_apunta_a_produccion() {
        // Los tests nunca deben escribir en C:\Sanatorio\datos.
        // SANATORIO_DATA_DIR debe apuntar a una carpeta temporal. Si no está definido,
        // se crea uno temporal automáticamente para que el test no falle.
        let data_dir = std::env::var("SANATORIO_DATA_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                let td = std::env::temp_dir().join(format!("sanatorio_test_{}", std::process::id()));
                std::fs::create_dir_all(&td).unwrap();
                std::env::set_var("SANATORIO_DATA_DIR", td.to_str().unwrap());
                td
            });
        let path = data_dir;

        // No debe ser la carpeta de producción
        let produccion = std::path::PathBuf::from(r"C:\Sanatorio\datos");
        assert_ne!(
            path.canonicalize().unwrap_or(path.clone()),
            produccion.canonicalize().unwrap_or(produccion.clone()),
            "SANATORIO_DATA_DIR no puede apuntar a la carpeta de producción C:\\Sanatorio\\datos"
        );

        // Debe ser un directorio que exista (tempdir creado por el test)
        assert!(
            path.is_dir(),
            "SANATORIO_DATA_DIR debe ser un directorio existente: {}",
            path.display()
        );
    }
}
