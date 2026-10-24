import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea la tabla central de pacientes, sin importar datos todavía. */
export const createPacientesMigration: Migration = {
  version: 2,
  name: '002_create_pacientes',
  description: 'Crea la tabla de pacientes e índices de búsqueda',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE pacientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        nombre TEXT NOT NULL DEFAULT '',
        apellido TEXT NOT NULL DEFAULT '',
        dni TEXT NOT NULL DEFAULT '',
        telefono TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        domicilio TEXT NOT NULL DEFAULT '',
        localidad TEXT NOT NULL DEFAULT '',
        fechaNacimiento TEXT NOT NULL DEFAULT '',
        obraSocial TEXT NOT NULL DEFAULT '',
        notas TEXT NOT NULL DEFAULT '',
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_pacientes_apellido ON pacientes (apellido);
      CREATE INDEX idx_pacientes_nombre ON pacientes (nombre);
      CREATE INDEX idx_pacientes_dni ON pacientes (dni);
    `)
  },
}
