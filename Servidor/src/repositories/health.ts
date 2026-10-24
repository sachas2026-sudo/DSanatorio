import type { DatabaseHandle } from '../database/database.js'

export function createHealthRepository(db: DatabaseHandle) {
  return { isConnected: (): boolean => (db.prepare('SELECT 1 AS connected').get() as { connected: number }).connected === 1 }
}