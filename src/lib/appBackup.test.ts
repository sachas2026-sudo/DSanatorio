import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const isTauriMock = vi.fn(() => false)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}))

import { STORAGE_KEY } from './appStorage'
import {
  BACKUP_SLOTS,
  finalizeExitBackup,
  listDataBackups,
  listDailyDataBackups,
  restoreDataBackup,
  rotateDataBackups,
  saveDailyDataBackup,
} from './appBackup'

const backupKey = (slot: 1 | 2 | 3) => `${STORAGE_KEY}-respaldo-${slot}`

describe('appBackup (navegador)', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(false)
    invokeMock.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('listDataBackups refleja slots vacíos', async () => {
    const list = await listDataBackups()
    expect(list).toHaveLength(3)
    expect(list.every((b) => !b.exists)).toBe(true)
    expect(list.map((b) => b.slot)).toEqual([...BACKUP_SLOTS])
  })

  it('rotateDataBackups guarda en slot 1', async () => {
    await rotateDataBackups('{"v":1}')
    expect(localStorage.getItem(backupKey(1))).toBe('{"v":1}')
  })

  it('rotateDataBackups desplaza copias anteriores', async () => {
    localStorage.setItem(backupKey(1), '{"v":1}')
    localStorage.setItem(backupKey(2), '{"v":2}')

    await rotateDataBackups('{"v":3}')

    expect(localStorage.getItem(backupKey(1))).toBe('{"v":3}')
    expect(localStorage.getItem(backupKey(2))).toBe('{"v":1}')
    expect(localStorage.getItem(backupKey(3))).toBe('{"v":2}')
  })

  it('finalizeExitBackup guarda principal y rota respaldos', async () => {
    localStorage.setItem(backupKey(1), '{"prev":true}')

    await finalizeExitBackup('{"current":true}')

    expect(localStorage.getItem(STORAGE_KEY)).toBe('{"current":true}')
    expect(localStorage.getItem(backupKey(1))).toBe('{"current":true}')
    expect(localStorage.getItem(backupKey(2))).toBe('{"prev":true}')
  })

  it('restoreDataBackup copia slot al storage principal', async () => {
    localStorage.setItem(backupKey(2), '{"fromBackup":2}')

    const raw = await restoreDataBackup(2)
    expect(raw).toBe('{"fromBackup":2}')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{"fromBackup":2}')
  })

  it('restoreDataBackup falla si el slot no existe', async () => {
    await expect(restoreDataBackup(3)).rejects.toThrow(
      'No existe el respaldo 3.',
    )
  })

  it('saveDailyDataBackup guarda por fecha y lista', async () => {
    await saveDailyDataBackup('{"day":"1"}', '2026-05-29')
    const list = await listDailyDataBackups()
    expect(list).toHaveLength(1)
    expect(list[0]?.date).toBe('2026-05-29')
  })

  it('saveDailyDataBackup rechaza fecha inválida', async () => {
    await expect(saveDailyDataBackup('{}', '29-05-2026')).rejects.toThrow(
      'Fecha de respaldo inválida',
    )
  })

  it('saveDailyDataBackup elimina copias más viejas que 60 días', async () => {
    localStorage.setItem(`${STORAGE_KEY}-diario-2026-01-01`, '{"old":true}')
    await saveDailyDataBackup('{"today":true}', '2026-05-29')
    const list = await listDailyDataBackups()
    expect(list.some((e) => e.date === '2026-01-01')).toBe(false)
    expect(list.some((e) => e.date === '2026-05-29')).toBe(true)
  })
})

describe('appBackup (Tauri)', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true)
    invokeMock.mockReset()
  })

  it('finalizeExitBackup invoca finalize_exit', async () => {
    await finalizeExitBackup('{"x":1}')
    expect(invokeMock).toHaveBeenCalledWith('finalize_exit', { json: '{"x":1}' })
  })

  it('restoreDataBackup invoca read_data_backup sin escribir', async () => {
    invokeMock.mockResolvedValueOnce('{"restored":true}')
    await expect(restoreDataBackup(1)).resolves.toBe('{"restored":true}')
    expect(invokeMock).toHaveBeenCalledWith('read_data_backup', { slot: 1 })
  })

  it('saveDailyDataBackup invoca save_daily_data_backup', async () => {
    await saveDailyDataBackup('{"x":1}', '2026-05-29')
    expect(invokeMock).toHaveBeenCalledWith('save_daily_data_backup', {
      json: '{"x":1}',
      date: '2026-05-29',
    })
  })
})
