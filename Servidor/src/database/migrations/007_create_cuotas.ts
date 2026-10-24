import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Crea la tabla de cuotas vinculada a afiliados, pacientes y pagos. */
export const createCuotasMigration: Migration = {
  version: 7,
  name: '007_create_cuotas',
  description: 'Crea la tabla de cuotas, relaciones e índices de vencimiento',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE TABLE cuotas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        legacy_id TEXT UNIQUE,
        paciente_id INTEGER NOT NULL,
        afiliado_id INTEGER NOT NULL,
        pago_id INTEGER,
        numero_cuota INTEGER,
        mes INTEGER NOT NULL,
        anio INTEGER NOT NULL,
        monto REAL NOT NULL DEFAULT 0,
        saldo REAL NOT NULL DEFAULT 0,
        fecha_emision TEXT,
        fecha_vencimiento TEXT,
        fechaPago TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente'
          CHECK (estado IN ('pagado', 'pendiente', 'vencido')),
        formaPago TEXT,
        comprobante INTEGER NOT NULL DEFAULT 0 CHECK (comprobante IN (0, 1)),
        notas TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
        FOREIGN KEY (afiliado_id) REFERENCES afiliados(id) ON DELETE CASCADE,
        FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_cuotas_paciente ON cuotas (paciente_id);
      CREATE INDEX idx_cuotas_afiliado ON cuotas (afiliado_id);
      CREATE INDEX idx_cuotas_pago ON cuotas (pago_id);
      CREATE INDEX idx_cuotas_vencimiento ON cuotas (fecha_vencimiento);
      CREATE INDEX idx_cuotas_estado ON cuotas (estado);
    `)
  },
}
