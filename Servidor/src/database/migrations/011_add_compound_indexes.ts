import type { DatabaseHandle } from '../database.js'
import type { Migration } from './001_initial.js'

/** Agrega indices compuestos para consultas frecuentes de agenda y cobros. */
export const addCompoundIndexesMigration: Migration = {
  version: 11,
  name: '011_add_compound_indexes',
  description: 'Agrega indices compuestos para turnos, pagos y cuotas',
  up: (db: DatabaseHandle) => {
    db.exec(`
      CREATE INDEX idx_turnos_medico_fecha ON turnos (medico_id, fechaHora);
      CREATE INDEX idx_pagos_paciente_fecha ON pagos (paciente_id, fecha);
      CREATE INDEX idx_cuotas_afiliado_periodo ON cuotas (afiliado_id, anio, mes);
    `)
  },
}
