import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AppData } from '../types'
import { isClientMode } from './appMode'
import { clientApi, ensureApiOk } from './clientApi'

export const STORAGE_KEY = 'sanatorio-clinica-v1'

export async function loadStorageRaw(): Promise<string | null> {
  if (isTauri()) {
    // En modo cliente los datos viven en el servidor de la PC1.
    if (await isClientMode()) {
      const reply = await clientApi('GET', '/api/app-data')
      ensureApiOk(reply)
      if (reply.body == null) return null
      return JSON.stringify(reply.body)
    }
    const fromDisk = await invoke<string | null>('load_app_data')
    if (fromDisk) return fromDisk
    const legacy = localStorage.getItem(STORAGE_KEY)
    if (legacy) {
      await invoke('save_app_data', { json: legacy })
      return legacy
    }
    return null
  }
  return localStorage.getItem(STORAGE_KEY)
}

export async function saveStorageRaw(json: string): Promise<void> {
  if (isTauri()) {
    if (await isClientMode()) {
      const payload = JSON.parse(json) as unknown
      const reply = await clientApi('POST', '/api/app-data', payload)
      ensureApiOk(reply)
      return
    }
    await invoke('save_app_data', { json })
    return
  }
  localStorage.setItem(STORAGE_KEY, json)
}

export async function getAppDataFilePath(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await invoke<string>('get_app_data_file_path')
  } catch {
    return null
  }
}

export function serializeAppData(data: AppData): string {
  return JSON.stringify({
    ...data,
    doctors: data.doctors.map((doctor) => ({
      ...doctor,
      porcentaje: doctor.porcentaje ?? null,
      valor: doctor.valor ?? null,
      particular: doctor.particular ?? null,
      cuidar: doctor.cuidar ?? null,
    })),
    settings: { ...data.settings, clave: '' },
  })
}

/** Igual que serializeAppData: JSON sin clave SMTP en settings (va en archivo companion). */
export function serializeAppDataForBackup(data: AppData): string {
  return serializeAppData(data)
}
