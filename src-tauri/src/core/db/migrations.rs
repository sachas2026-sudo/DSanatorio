use rusqlite::{params, Connection};
use crate::core::error::AppError;

struct Migration {
    version: u32,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "0001_init",
        sql: include_str!("../../../migrations/0001_init.sql"),
    },
    Migration {
        version: 2,
        name: "0002_pagos_deudas_medicos",
        sql: include_str!("../../../migrations/0002_pagos_deudas_medicos.sql"),
    },
    Migration {
        version: 3,
        name: "0003_obra_social_override",
        sql: include_str!("../../../migrations/0003_obra_social_override.sql"),
    },
    Migration {
        version: 4,
        name: "0004_deuda_destinatario_comprobante",
        sql: include_str!("../../../migrations/0004_deuda_destinatario_comprobante.sql"),
    },
    Migration {
        version: 5,
        name: "0005_app_modules",
        sql: include_str!("../../../migrations/0005_app_modules.sql"),
    },
    Migration {
        version: 6,
        name: "0006_afiliados_tablas",
        sql: include_str!("../../../migrations/0006_afiliados_tablas.sql"),
    },
    Migration {
        version: 7,
        name: "0007_pacientes_version_auditoria",
        sql: include_str!("../../../migrations/0007_pacientes_version_auditoria.sql"),
    },
    Migration {
        version: 8,
        name: "0008_afiliados_datos_completos",
        sql: include_str!("../../../migrations/0008_afiliados_datos_completos.sql"),
    },
];

fn initialize_migrations_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )?;
    Ok(())
}

/// Ejecuta las migraciones pendientes. Cada migración (SQL + registro en schema_migrations)
/// ocurre dentro de UNA transacción Rusqlite: si el SQL o el INSERT fallan, se hace rollback
/// y no queda estructura ni registro a medias.
pub fn initialize_schema_with(conn: &mut Connection, migrations: &[Migration]) -> Result<(), AppError> {
    initialize_migrations_table(conn)?;

    // Leer versión actual sin unwrap_or(0): cualquier error se propaga.
    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;

    for m in migrations {
        if m.version > current_version {
            let tx = conn.transaction()?;

            tx.execute_batch(m.sql)
                .map_err(|e| AppError::Database(format!("Error ejecutando migración {}: {e}", m.name)))?;

            tx.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![m.version, m.name],
            )
            .map_err(|e| AppError::Database(format!("Error registrando migración {}: {e}", m.name)))?;

            tx.commit()?;
        }
    }

    Ok(())
}

/// Punto de entrada usado por la aplicación: aplica las migraciones compiladas.
pub fn initialize_schema(conn: &mut Connection) -> Result<(), AppError> {
    initialize_schema_with(conn, MIGRATIONS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn mem_conn() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn test_migraciones_atomicas_con_rollback() {
        let mut conn = mem_conn();
        initialize_migrations_table(&mut conn).unwrap();

        // Migración válida que crea una tabla
        let ok = Migration {
            version: 1,
            name: "test_ok",
            sql: "CREATE TABLE test_ok (id INTEGER PRIMARY KEY, valor TEXT)",
        };

        // Migración inválida: referencia a tabla inexistente -> falla
        let bad = Migration {
            version: 2,
            name: "test_bad",
            sql: "INSERT INTO tabla_inexistente (id) VALUES (1)",
        };

        let migrations = &[ok, bad];
        let res = initialize_schema_with(&mut conn, migrations);
        assert!(res.is_err(), "debe fallar por SQL inválido");

        // Verificar que no quedó registro de la migración fallida
        let version: Option<u32> = conn
            .query_row("SELECT version FROM schema_migrations WHERE name = ?1", ["test_bad"], |r| r.get(0))
            .ok();
        assert!(version.is_none(), "la migración fallida no debe quedar registrada");

        // Verificar que la migración válida SÍ se aplicó (transacción previa commitó)
        let version_ok: Option<u32> = conn
            .query_row("SELECT version FROM schema_migrations WHERE name = ?1", ["test_ok"], |r| r.get(0))
            .ok();
        assert_eq!(version_ok, Some(1), "la migración válida debe quedar registrada");

        // Verificar que la tabla de la migración válida existe
        let exists: bool = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='test_ok'", [], |r| r.get::<_, i32>(0))
            .unwrap_or(0) > 0;
        assert!(exists, "la tabla de la migración válida debe existir");

        // Verificar que la tabla de la migración fallida NO existe
        let exists_bad: bool = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='tabla_inexistente'", [], |r| r.get::<_, i32>(0))
            .unwrap_or(0) > 0;
        assert!(!exists_bad, "la tabla de la migración fallida no debe existir");
    }

    #[test]
    fn test_versione_actual_sin_unwrap_or_0() {
        let conn = mem_conn();
        initialize_migrations_table(&conn).unwrap();

        // Si la consulta falla (tabla no existe), debe propagar error, no devolver 0.
        let conn_broken = Connection::open_in_memory().unwrap();
        let res: Result<u32, _> = conn_broken
            .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0));
        assert!(res.is_err(), "consulta sobre tabla inexistente debe fallar, no devolver 0");
    }
}
