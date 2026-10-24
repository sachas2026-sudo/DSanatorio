import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea la tabla de médicos sin importar datos todavía. */
export const createMedicosMigration: Migration = {
  version: 3,
  name: '003_create_medicos',
  description: 'Crea la tabla de médicos e índices de búsqueda',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE medicos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        nombre TEXT NOT NULL DEFAULT '',
        apellido TEXT NOT NULL DEFAULT '',
        dni TEXT NOT NULL DEFAULT '',
        matricula TEXT NOT NULL DEFAULT '',
        especialidad TEXT NOT NULL DEFAULT '',
        obraSocial TEXT NOT NULL DEFAULT '',
        obrasSociales TEXT NOT NULL DEFAULT '[]',
        telefono TEXT NOT NULL DEFAULT '',
        localidad TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        porcentaje REAL NOT NULL DEFAULT 0,
        duracionTurnoMinutos INTEGER NOT NULL DEFAULT 30,
        tipoAgenda TEXT NOT NULL DEFAULT 'semanal' CHECK (tipoAgenda IN ('semanal', 'mensual')),
        activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_medicos_apellido ON medicos (apellido);
      CREATE INDEX idx_medicos_nombre ON medicos (nombre);
      CREATE INDEX idx_medicos_matricula ON medicos (matricula);
      CREATE INDEX idx_medicos_especialidad ON medicos (especialidad);
    `)
  },
}
