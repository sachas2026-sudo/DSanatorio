import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea el catalogo de planes y normaliza la relacion con afiliados. */
export const createPlanesMigration: Migration = {
  version: 10,
  name: '010_create_planes',
  description: 'Crea la tabla de planes y normaliza la relacion de afiliados',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE planes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        nombre TEXT NOT NULL COLLATE NOCASE UNIQUE,
        descripcion TEXT NOT NULL DEFAULT '',
        precio REAL NOT NULL DEFAULT 0,
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE afiliados RENAME TO afiliados_old;

      CREATE TABLE afiliados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        paciente_id INTEGER NOT NULL,
        plan_id INTEGER,
        fechaInicio TEXT NOT NULL DEFAULT '',
        tipo_cobertura TEXT,
        nombre_cobertura TEXT,
        numero_afiliado TEXT,
        plan TEXT,
        titular TEXT,
        parentesco TEXT,
        porcentaje_cobertura REAL,
        observaciones TEXT NOT NULL DEFAULT '',
        estado TEXT NOT NULL DEFAULT 'activo',
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE SET NULL
      );

      INSERT INTO afiliados (
        id,
        legacy_id,
        paciente_id,
        plan_id,
        fechaInicio,
        tipo_cobertura,
        nombre_cobertura,
        numero_afiliado,
        plan,
        titular,
        parentesco,
        porcentaje_cobertura,
        observaciones,
        estado,
        activo,
        created_at,
        updated_at
      )
      SELECT
        id,
        legacy_id,
        paciente_id,
        NULL,
        fechaInicio,
        tipo_cobertura,
        nombre_cobertura,
        numero_afiliado,
        plan,
        titular,
        parentesco,
        porcentaje_cobertura,
        observaciones,
        estado,
        activo,
        created_at,
        updated_at
      FROM afiliados_old;

      DROP TABLE afiliados_old;

      CREATE INDEX idx_afiliados_paciente ON afiliados (paciente_id);
      CREATE INDEX idx_afiliados_plan ON afiliados (plan_id);
      CREATE INDEX idx_afiliados_numero ON afiliados (numero_afiliado);
      CREATE INDEX idx_afiliados_cobertura ON afiliados (nombre_cobertura);
      CREATE INDEX idx_afiliados_estado ON afiliados (estado);
    `)
  },
}
