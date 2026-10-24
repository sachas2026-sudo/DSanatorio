pub mod connection;
pub mod migrations;

pub use connection::{open_connection, db_file_path, json_export_path, DB_FILE, backup_db_safe};

use rusqlite::Transaction;
use crate::core::error::AppError;

pub fn delete_orphans(
    tx: &Transaction<'_>,
    table: &str,
    id_column: &str,
    keep_ids: &[String],
) -> Result<(), AppError> {
    if keep_ids.is_empty() {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
        return Ok(());
    }

    for chunk in keep_ids.chunks(400) {
        let placeholders = std::iter::repeat("?")
            .take(chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("DELETE FROM {table} WHERE {id_column} NOT IN ({placeholders})");
        let mut stmt = tx.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        stmt.execute(rusqlite::params_from_iter(params))?;
    }
    Ok(())
}
