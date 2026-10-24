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

pub fn initialize_schema(conn: &Connection) -> Result<(), AppError> {
    initialize_migrations_table(conn)?;

    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for m in MIGRATIONS {
        if m.version > current_version {
            conn.execute_batch(m.sql)
                .map_err(|e| AppError::Database(format!("Error ejecutando migración {}: {e}", m.name)))?;

            conn.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![m.version, m.name],
            )?;
        }
    }

    Ok(())
}
