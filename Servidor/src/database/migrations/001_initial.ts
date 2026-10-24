import type { DatabaseHandle } from '../database.js'

export type Migration = {
  version: number
  name: string
  description: string
  up: (db: DatabaseHandle) => void
}

/** Primera migración de infraestructura; no crea tablas de negocio. */
export const initialMigration: Migration = {
  version: 1,
  name: '001_initial',
  description: 'Infraestructura inicial de migraciones',
  up: () => {
    // Las tablas de negocio se agregarán en migraciones posteriores.
  },
}
