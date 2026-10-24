CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL,
  rol TEXT NOT NULL,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id TEXT,
  fecha_hora TEXT NOT NULL DEFAULT (datetime('now')),
  detalle TEXT
);

ALTER TABLE patients ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE patients ADD COLUMN deleted_at TEXT;
