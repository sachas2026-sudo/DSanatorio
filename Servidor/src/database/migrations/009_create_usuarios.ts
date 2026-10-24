import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea la estructura de usuarios sin implementar autenticación todavía. */
export const createUsuariosMigration: Migration = {
  version: 9,
  name: '009_create_usuarios',
  description: 'Crea la tabla de usuarios relacionada con roles',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        rol_id INTEGER NOT NULL,
        nombre TEXT NOT NULL DEFAULT '',
        apellido TEXT NOT NULL DEFAULT '',
        usuario TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT,
        password_hash TEXT NOT NULL,
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        ultimo_login TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT
      );

      CREATE INDEX idx_usuarios_rol ON usuarios (rol_id);
      CREATE INDEX idx_usuarios_activo ON usuarios (activo);
    `)
  },
}
