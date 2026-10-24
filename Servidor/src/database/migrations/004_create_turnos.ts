import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea la tabla de turnos y sus relaciones con pacientes y médicos. */
export const createTurnosMigration: Migration = {
  version: 4,
  name: '004_create_turnos',
  description: 'Crea la tabla de turnos, relaciones e índices de agenda',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE turnos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        paciente_id INTEGER NOT NULL,
        medico_id INTEGER NOT NULL,
        fechaHora TEXT NOT NULL,
        duracionMinutos INTEGER NOT NULL DEFAULT 30,
        notas TEXT NOT NULL DEFAULT '',
        estado TEXT NOT NULL DEFAULT 'programado'
          CHECK (estado IN ('programado', 'cancelado', 'atendido')),
        whatsappRecordatorioEnviadoEn TEXT,
        cancelado_en TEXT,
        motivo_cancelacion TEXT,
        reprogramado_desde_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE,
        FOREIGN KEY (reprogramado_desde_id) REFERENCES turnos(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_turnos_fecha_hora ON turnos (fechaHora);
      CREATE INDEX idx_turnos_medico ON turnos (medico_id);
      CREATE INDEX idx_turnos_paciente ON turnos (paciente_id);
      CREATE INDEX idx_turnos_estado ON turnos (estado);
    `)
  },
}
