import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_APP_DATA,
  enrichLoadedData,
  parseStoredData,
  saveAppData,
} from './appStateLoad'
import { serializeAppData } from './appStorage'

vi.mock('./appStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appStorage')>()
  return {
    ...actual,
    saveStorageRaw: vi.fn(),
    loadStorageRaw: vi.fn(),
  }
})

vi.mock('./smtpSecret', () => ({
  migrateSmtpSecretFromSettings: vi.fn(async () => 'secret-from-file'),
}))

describe('appStateLoad', () => {
  it('EMPTY_APP_DATA tiene estructura mínima válida', () => {
    expect(EMPTY_APP_DATA.patients).toEqual([])
    expect(EMPTY_APP_DATA.settings.clave).toBe('')
  })

  it('parseStoredData no agrega datos inventados en base vacía', () => {
    const emptyJson = JSON.stringify(EMPTY_APP_DATA)
    const out = parseStoredData(emptyJson)
    expect(out.patients).toEqual([])
    expect(out.doctors).toEqual([])
    expect(out.appointments).toEqual([])
    expect(out.payments).toEqual([])
  })

  it('parseStoredData rechaza JSON inválido', () => {
    expect(() => parseStoredData('not json')).toThrow()
  })

  it('enrichLoadedData carga clave SMTP desde almacén separado', async () => {
    const out = await enrichLoadedData(EMPTY_APP_DATA)
    expect(out.settings.clave).toBe('secret-from-file')
  })

  it('saveAppData serializa sin secretos en JSON', async () => {
    const { saveStorageRaw } = await import('./appStorage')
    const data = {
      ...EMPTY_APP_DATA,
      settings: {
        ...EMPTY_APP_DATA.settings,
        clave: 'no-debe-quedar',
      },
    }
    await saveAppData(data)
    expect(saveStorageRaw).toHaveBeenCalledOnce()
    const json = vi.mocked(saveStorageRaw).mock.calls[0]![0]!
    const parsed = JSON.parse(json) as {
      settings: { clave: string }
    }
    expect(parsed.settings.clave).toBe('')
    expect(json).toBe(serializeAppData(data))
  })
})
