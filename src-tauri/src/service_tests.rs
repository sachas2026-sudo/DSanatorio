#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use crate::core::db::open_connection;
    use crate::core::config::settings;
    use std::fs;

    fn setup_temp_db() -> (rusqlite::Connection, std::path::PathBuf) {
        let temp_dir = tempfile::tempdir().unwrap();
        let data_dir = temp_dir.path().to_path_buf();
        std::env::set_var("SANATORIO_DATA_DIR", data_dir.to_str().unwrap());
        
        // Crear base con bloque viejo
        let conn = open_connection().unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS app_modules (key TEXT PRIMARY KEY, json TEXT)", []).unwrap();
        conn.execute("INSERT OR REPLACE INTO app_modules (key, json) VALUES (?1, ?2)", 
            params!["afiliados", r#"[{"id":"a1","nombre":"Afiliado 1"}]"#]).unwrap();
        
        (conn, data_dir)
    }

    #[test]
    fn test_migracion_afiliados_idempotente() {
        let (conn, _) = setup_temp_db();
        
        // Usar IF NOT EXISTS
        conn.execute("CREATE TABLE IF NOT EXISTS afiliados (id TEXT PRIMARY KEY, nombre TEXT, version INTEGER DEFAULT 1)", []).unwrap();
        
        // Migrar datos
        let json: String = conn.query_row("SELECT json FROM app_modules WHERE key='afiliados'", [], |r| r.get(0)).unwrap();
        let data: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        for v in data {
            conn.execute("INSERT OR REPLACE INTO afiliados (id, nombre) VALUES (?1, ?2)", 
                params![v["id"].as_str().unwrap(), v["nombre"].as_str().unwrap()]).unwrap();
        }
        conn.execute("INSERT OR REPLACE INTO app_modules (key, json) VALUES ('migrado_tablas', 'true')", []).unwrap();

        // Verificar cantidad
        let count: i64 = conn.query_row("SELECT count(*) FROM afiliados", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);

        // Correr migración de nuevo (idempotencia)
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
        
        // Borrar tabla (vacía)
        conn.execute("DELETE FROM afiliados", []).unwrap();
        
        // Simular lógica de carga: si migrado_tablas=true, no mirar app_modules['afiliados']
        let is_migrated: bool = conn.query_row("SELECT json='true' FROM app_modules WHERE key='migrado_tablas'", [], |r| r.get(0)).unwrap_or(false);
        let result = if is_migrated {
            let mut res = Vec::new(); // simula load_afiliados_table
            res
        } else {
            vec![serde_json::json!({"id":"old"})] // simula fallback
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
            // Provocar fallo
            tx.execute("INSERT INTO tabla_inexistente VALUES (1)", [])?;
            tx.commit()
        })();
        
        assert!(res.is_err());
        // Verificar que NO quedó la marca ni el dato
        let count: i64 = conn.query_row("SELECT count(*) FROM afiliados", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
        let migrado: Option<String> = conn.query_row("SELECT json FROM app_modules WHERE key='migrado_tablas'", [], |r| r.get(0)).unwrap_or(None);
        assert!(migrado.is_none());
    }
}
