import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type DatabaseHandle = Database.Database

export function openDatabase(dbPath: string): DatabaseHandle {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.prepare('SELECT 1').get()
  return db
}
