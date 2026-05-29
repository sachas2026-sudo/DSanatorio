import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData } from '../types'

const invokeMock = vi.fn()
const isTauriMock = vi.fn(() => false)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}))

import {
  STORAGE_KEY,
  getAppDataFilePath,
  loadStorageRaw,
  saveStorageRaw,
  serializeAppData,
} from './appStorage'

const sampleData: AppData = {
  patients: [],
  doctors: [],
  horarios: [],
  diasLibres: [],
  atencionesMensuales: [],
  appointments: [],
  payments: [],
  pagosCancelados: [],
  especialidadesCustom: [],
  obrasSocialesCustom: [],
  localidadesCustom: [],
  settings: {
    email: '',
    emailGerente: '',
    telefonoGerente: '',
    clave: '',
    telefono: '',
    cuit: '',
  },
}

describe('appStorage (navegador)', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(false)
    invokeMock.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('serializeAppData produce JSON estable sin clave SMTP', () => {
    const withClave = {
      ...sampleData,
      settings: { ...sampleData.settings, clave: 'secret' },
    }
    const json = serializeAppData(withClave)
    const parsed = JSON.parse(json) as AppData
    expect(parsed.settings.clave).toBe('')
    expect(parsed.patients).toEqual(sampleData.patients)
  })

  it('saveStorageRaw y loadStorageRaw usan localStorage', async () => {
    const json = serializeAppData(sampleData)
    await saveStorageRaw(json)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(json)
    await expect(loadStorageRaw()).resolves.toBe(json)
  })

  it('loadStorageRaw devuelve null si no hay datos', async () => {
    await expect(loadStorageRaw()).resolves.toBeNull()
  })

  it('getAppDataFilePath devuelve null fuera de Tauri', async () => {
    await expect(getAppDataFilePath()).resolves.toBeNull()
  })
})

describe('appStorage (Tauri)', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true)
    invokeMock.mockReset()
    localStorage.clear()
  })

  it('loadStorageRaw lee del disco y migra legacy localStorage', async () => {
    invokeMock.mockResolvedValueOnce(null)
    localStorage.setItem(STORAGE_KEY, '{"patients":[],"doctors":[]}')

    const raw = await loadStorageRaw()
    expect(raw).toBe('{"patients":[],"doctors":[]}')
    expect(invokeMock).toHaveBeenCalledWith('save_app_data', {
      json: '{"patients":[],"doctors":[]}',
    })
  })

  it('saveStorageRaw invoca save_app_data', async () => {
    await saveStorageRaw('{"ok":true}')
    expect(invokeMock).toHaveBeenCalledWith('save_app_data', {
      json: '{"ok":true}',
    })
  })

  it('getAppDataFilePath invoca get_app_data_file_path', async () => {
    invokeMock.mockResolvedValueOnce('C:\\data\\app.json')
    await expect(getAppDataFilePath()).resolves.toBe('C:\\data\\app.json')
  })
})
