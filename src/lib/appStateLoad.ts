import { parseAppDataJson } from './parseAppData'
import {
  loadStorageRaw,
  saveStorageRaw,
  serializeAppData,
} from './appStorage'
import { generateDemoDoctors, generateDemoPatients } from './seedData'
import { migrateSmtpSecretFromSettings } from './smtpSecret'
import type { AppData } from '../types'

export const LOAD_READ_TIMEOUT_MS = 25_000

export const EMPTY_APP_DATA: AppData = {
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

export function withDemoData(data: AppData): AppData {
  const needsPatients = data.patients.length === 0
  const needsDoctors = data.doctors.length === 0
  if (!needsPatients && !needsDoctors) return data
  return {
    ...data,
    patients: needsPatients ? generateDemoPatients() : data.patients,
    doctors: needsDoctors ? generateDemoDoctors() : data.doctors,
  }
}

export function parseStoredData(raw: string): AppData {
  return withDemoData(parseAppDataJson(raw))
}

export type StorageLoadResult =
  | { kind: 'ok'; data: AppData }
  | { kind: 'empty' }
  | { kind: 'corrupt'; message: string }

export async function loadFromStorage(): Promise<StorageLoadResult> {
  try {
    let timeoutId: ReturnType<typeof window.setTimeout> | undefined
    const raw = await Promise.race([
      loadStorageRaw(),
      new Promise<string | null>((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new Error(
                'Tardó demasiado en leer la base de datos. Cerrá otros programas que la usen o reiniciá la PC.',
              ),
            ),
          LOAD_READ_TIMEOUT_MS,
        )
      }),
    ])
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    if (!raw?.trim()) return { kind: 'empty' }
    try {
      const data = parseStoredData(raw)
      return { kind: 'ok', data }
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : 'Error al interpretar el archivo.'
      return {
        kind: 'corrupt',
        message: detail,
      }
    }
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : 'No se pudo leer el archivo de datos.'
    return { kind: 'corrupt', message: detail }
  }
}

export async function enrichLoadedData(data: AppData): Promise<AppData> {
  const clave = await migrateSmtpSecretFromSettings(data.settings)
  return {
    ...data,
    settings: { ...data.settings, clave },
  }
}

export async function saveAppData(data: AppData): Promise<void> {
  await saveStorageRaw(serializeAppData(data))
}
