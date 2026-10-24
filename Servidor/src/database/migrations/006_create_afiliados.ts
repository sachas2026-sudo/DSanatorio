import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea la tabla de afiliados vinculada a pacientes, sin importar datos todavía. */
export const createAfiliadosMigration: Migration = {
  version: 6,
  name: '006_create_afiliados',
  description: 'Crea la tabla de afiliados y sus índices de cobertura',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE afiliados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        paciente_id INTEGER NOT NULL,
        plan_id TEXT NOT NULL DEFAULT '',
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
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_afiliados_paciente ON afiliados (paciente_id);
      CREATE INDEX idx_afiliados_plan ON afiliados (plan_id);
      CREATE INDEX idx_afiliados_numero ON afiliados (numero_afiliado);
      CREATE INDEX idx_afiliados_cobertura ON afiliados (nombre_cobertura);
      CREATE INDEX idx_afiliados_estado ON afiliados (estado);
    `)
  },
}
