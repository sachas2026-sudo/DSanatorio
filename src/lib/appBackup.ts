import { invoke, isTauri } from '@tauri-apps/api/core'
import { STORAGE_KEY } from './appStorage'

export const BACKUP_SLOTS = [1, 2, 3] as const
export type BackupSlot = (typeof BACKUP_SLOTS)[number]

export const DAILY_BACKUP_RETENTION_DAYS = 30
export const DAILY_BACKUP_SUBDIR = 'diario'

const DAILY_KEY_PREFIX = `${STORAGE_KEY}-diario-`

export type BackupEntry = {
  slot: BackupSlot
  exists: boolean
  modifiedMs?: number
  path: string
}

export type DailyBackupEntry = {
  date: string
  path: string
  modifiedMs?: number
}

const BACKUP_KEYS: Record<BackupSlot, string> = {
  1: `${STORAGE_KEY}-respaldo-1`,
  2: `${STORAGE_KEY}-respaldo-2`,
  3: `${STORAGE_KEY}-respaldo-3`,
}

function isValidBackupDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
}

function subtractDaysFromDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y!, m! - 1, d!)
  dt.setDate(dt.getDate() - days)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function pruneLocalDailyBackups(today: string): void {
  const cutoff = subtractDaysFromDate(today, DAILY_BACKUP_RETENTION_DAYS)
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(DAILY_KEY_PREFIX)) keys.push(key)
  }
  for (const key of keys) {
    const date = key.slice(DAILY_KEY_PREFIX.length)
    if (date < cutoff) localStorage.removeItem(key)
  }
}

function normalizeBackupSlot(slot: number): BackupSlot {
  if (slot === 2 || slot === 3) return slot
  return 1
}

function rotateLocalBackups(json: string): void {
  const prev1 = localStorage.getItem(BACKUP_KEYS[1])
  const prev2 = localStorage.getItem(BACKUP_KEYS[2])
  if (prev2) localStorage.setItem(BACKUP_KEYS[3], prev2)
  if (prev1) localStorage.setItem(BACKUP_KEYS[2], prev1)
  localStorage.setItem(BACKUP_KEYS[1], json)
}

export async function getBackupDir(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await invoke<string>('get_backup_dir')
  } catch {
    return null
  }
}

export async function getBackupLocations(): Promise<string[]> {
  if (!isTauri()) return []
  try {
    return await invoke<string[]>('get_backup_locations')
  } catch {
    return []
  }
}

export async function listDataBackups(): Promise<BackupEntry[]> {
  if (!isTauri()) {
    return BACKUP_SLOTS.map((slot) => {
      const key = BACKUP_KEYS[slot]
      const raw = localStorage.getItem(key)
      return {
        slot,
        exists: Boolean(raw),
        modifiedMs: undefined,
        path: key,
      }
    })
  }
  const rows = await invoke<
    { slot: number; exists: boolean; modifiedMs?: number; path: string }[]
  >('list_data_backups')
  return rows.map((r) => ({
    slot: normalizeBackupSlot(r.slot),
    exists: r.exists,
    modifiedMs: r.modifiedMs,
    path: r.path,
  }))
}

export async function finalizeExitBackup(json: string): Promise<void> {
  if (isTauri()) {
    await invoke('finalize_exit', { json })
    return
  }
  localStorage.setItem(STORAGE_KEY, json)
  rotateLocalBackups(json)
}

/** Rota las 3 copias de resguardo (manual o periódico). El archivo principal debe estar guardado antes. */
export async function rotateDataBackups(json: string): Promise<void> {
  if (isTauri()) {
    await invoke('rotate_data_backups', { json })
    return
  }
  rotateLocalBackups(json)
}

export async function restoreDataBackup(slot: BackupSlot): Promise<string> {
  if (isTauri()) {
    return await invoke<string>('restore_data_backup', { slot })
  }
  const raw = localStorage.getItem(BACKUP_KEYS[slot])
  if (!raw) {
    throw new Error(`No existe el respaldo ${slot}.`)
  }
  localStorage.setItem(STORAGE_KEY, raw)
  return raw
}

/** Copia fechada del día en carpeta diario/ (conserva 30 días). */
export async function saveDailyDataBackup(
  json: string,
  date: string,
): Promise<void> {
  if (!isValidBackupDate(date)) {
    throw new Error('Fecha de respaldo inválida (use YYYY-MM-DD).')
  }
  if (isTauri()) {
    await invoke('save_daily_data_backup', { json, date })
    return
  }
  localStorage.setItem(`${DAILY_KEY_PREFIX}${date}`, json)
  pruneLocalDailyBackups(date)
}

export async function listDailyDataBackups(): Promise<DailyBackupEntry[]> {
  if (!isTauri()) {
    const out: DailyBackupEntry[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(DAILY_KEY_PREFIX)) continue
      const date = key.slice(DAILY_KEY_PREFIX.length)
      if (!isValidBackupDate(date)) continue
      out.push({ date, path: key })
    }
    out.sort((a, b) => b.date.localeCompare(a.date))
    return out
  }
  return await invoke<DailyBackupEntry[]>('list_daily_data_backups')
}
