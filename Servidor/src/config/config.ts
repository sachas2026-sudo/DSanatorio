import 'dotenv/config'

export type ServerConfig = {
  port: number
  host: string
  dbDir: string
  backupsDir: string
  logsDir: string
  dbPath: string
  apiPrefix: string
  corsOrigin: string
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  version: string
}

function requiredPositivePort(raw: string | undefined): number {
  const port = Number(raw ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Puerto inválido: ${raw}`)
  return port
}

function logLevel(raw: string | undefined): ServerConfig['logLevel'] {
  const value = raw?.trim() || 'info'
  const levels: ServerConfig['logLevel'][] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']
  if (!levels.includes(value as ServerConfig['logLevel'])) throw new Error(`LOG_LEVEL inválido: ${raw}`)
  return value as ServerConfig['logLevel']
}

export function loadConfig(): ServerConfig {
  const dbDir = process.env.DB_DIR?.trim() || String.raw`C:\Sanatorio\DB`
  const backupsDir = process.env.BACKUPS_DIR?.trim() || String.raw`C:\Sanatorio\Backups`
  const logsDir = process.env.LOGS_DIR?.trim() || String.raw`C:\Sanatorio\Logs`
  return {
    port: requiredPositivePort(process.env.PORT), host: process.env.HOST?.trim() || '0.0.0.0', dbDir, backupsDir, logsDir,
    dbPath: `${dbDir}\\sanatorio.db`, apiPrefix: '/api/v1', corsOrigin: process.env.CORS_ORIGIN?.trim() || '*',
    logLevel: logLevel(process.env.LOG_LEVEL), version: process.env.APP_VERSION?.trim() || '3.0.0',
  }
}