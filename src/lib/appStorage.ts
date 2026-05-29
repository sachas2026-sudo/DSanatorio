import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AppData } from '../types'

export const STORAGE_KEY = 'sanatorio-clinica-v1'

export async function loadStorageRaw(): Promise<string | null> {
  if (isTauri()) {
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
    settings: { ...data.settings, clave: '' },
  })
}
