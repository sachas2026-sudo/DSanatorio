import type { DatabaseHandle } from '../database.js'
import { migrations, type Migration } from './index.js'

const SCHEMA_VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    descripcion TEXT NOT NULL,
    fecha_ejecucion TEXT NOT NULL
  )
`

export function ensureSchemaVersionTable(db: DatabaseHandle): void {
  db.exec(SCHEMA_VERSION_TABLE)
}

function appliedVersions(db: DatabaseHandle): Set<number> {
  const rows = db
    .prepare('SELECT version FROM schema_version ORDER BY version')
    .all() as Array<{ version: number }>
  return new Set(rows.map(row => row.version))
}

function validateMigrations(list: Migration[]): void {
  const versions = new Set<number>()
  for (const migration of list) {
    if (versions.has(migration.version)) {
      throw new Error(`Versión de migración duplicada: ${migration.version}`)
    }
    versions.add(migration.version)
  }
}

export function runMigrations(
  db: DatabaseHandle,
  list: Migration[] = migrations,
): void {
  validateMigrations(list)
  ensureSchemaVersionTable(db)

  const applied = appliedVersions(db)
  const pending = [...list]
    .filter(migration => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version)

  if (pending.length === 0) {
    console.log('[Migration] No hay migraciones pendientes')
    return
  }

  const insertVersion = db.prepare(`
    INSERT INTO schema_version (version, descripcion, fecha_ejecucion)
    VALUES (@version, @description, @executedAt)
  `)

  for (const migration of pending) {
    const executeMigration = db.transaction(() => {
      migration.up(db)
      insertVersion.run({
        version: migration.version,
        description: migration.description,
        executedAt: new Date().toISOString(),
      })
    })

    executeMigration()
    console.log(`[Migration] ${migration.name} ejecutada correctamente`)
  }
}
