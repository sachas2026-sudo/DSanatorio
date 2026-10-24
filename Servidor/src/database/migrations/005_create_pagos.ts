import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea la tabla de pagos y sus relaciones con pacientes, médicos y turnos. */
export const createPagosMigration: Migration = {
  version: 5,
  name: '005_create_pagos',
  description: 'Crea la tabla de pagos, relaciones e índices de consulta',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE pagos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        paciente_id INTEGER NOT NULL,
        medico_id INTEGER NOT NULL,
        turno_id INTEGER,
        monto REAL NOT NULL DEFAULT 0,
        moneda TEXT NOT NULL DEFAULT 'ARS',
        fecha TEXT NOT NULL,
        metodo TEXT NOT NULL DEFAULT '',
        estado TEXT NOT NULL DEFAULT 'registrado',
        descuento REAL NOT NULL DEFAULT 0,
        recargo REAL NOT NULL DEFAULT 0,
        notas TEXT NOT NULL DEFAULT '',
        numero_comprobante TEXT,
        referencia_externa TEXT,
        porcentajeAplicado REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE,
        FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_pagos_paciente ON pagos (paciente_id);
      CREATE INDEX idx_pagos_medico ON pagos (medico_id);
      CREATE INDEX idx_pagos_turno ON pagos (turno_id);
      CREATE INDEX idx_pagos_fecha ON pagos (fecha);
      CREATE INDEX idx_pagos_estado ON pagos (estado);
    `)
  },
}
