import { loadConfig } from './config/config.js'
import { openDatabase } from './database/database.js'
import { runMigrations } from './database/migrations/migrationRunner.js'
import { ensureServerDirectories } from './services/directories.js'
import { buildApp } from './app.js'

try {
  const config = loadConfig()
  ensureServerDirectories(config)
  const db = openDatabase(config.dbPath)
  runMigrations(db)
  const app = buildApp(config, db)
  await app.listen({ port: config.port, host: config.host })
  app.log.info({ port: config.port, dbPath: config.dbPath }, 'Servidor iniciado')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}