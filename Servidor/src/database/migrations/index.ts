import type { Migration } from './001_initial.js'
import { initialMigration } from './001_initial.js'
import { createPacientesMigration } from './002_create_pacientes.js'
import { createMedicosMigration } from './003_create_medicos.js'
import { createTurnosMigration } from './004_create_turnos.js'
import { createPagosMigration } from './005_create_pagos.js'
import { createAfiliadosMigration } from './006_create_afiliados.js'
import { createCuotasMigration } from './007_create_cuotas.js'
import { createRolesMigration } from './008_create_roles.js'
import { createUsuariosMigration } from './009_create_usuarios.js'
import { createPlanesMigration } from './010_create_planes.js'
import { addCompoundIndexesMigration } from './011_add_compound_indexes.js'

export type { Migration } from './001_initial.js'

export const migrations: Migration[] = [
  initialMigration,
  createPacientesMigration,
  createMedicosMigration,
  createTurnosMigration,
  createPagosMigration,
  createAfiliadosMigration,
  createCuotasMigration,
  createRolesMigration,
  createUsuariosMigration,
  createPlanesMigration,
  addCompoundIndexesMigration,
]
