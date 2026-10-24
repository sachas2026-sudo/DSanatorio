import { mkdirSync } from 'node:fs'

export function ensureServerDirectories(paths: {
  dbDir: string
  backupsDir: string
  logsDir: string
}): void {
  mkdirSync(paths.dbDir, { recursive: true })
  mkdirSync(paths.backupsDir, { recursive: true })
  mkdirSync(paths.logsDir, { recursive: true })
}
