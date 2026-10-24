import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AppSettings } from '../types'

export type GoogleDriveStatus = {
  detectedPath: string | null
  activePath: string | null
  source: 'auto' | 'custom' | 'none' | 'disabled'
  available: boolean
}

export function googleDriveInvokeArgs(settings: AppSettings): {
  customRoot: string | null
  disabled: boolean
} {
  const custom = settings.rutaGoogleDriveCustom?.trim()
  return {
    customRoot: custom || null,
    disabled: settings.googleDriveDeshabilitado === true,
  }
}

export async function getGoogleDriveStatus(
  settings: AppSettings,
): Promise<GoogleDriveStatus | null> {
  if (!isTauri()) return null
  const { customRoot, disabled } = googleDriveInvokeArgs(settings)
  return invoke<GoogleDriveStatus>('get_google_drive_status', {
    customRoot,
    disabled,
  })
}

export async function pickGoogleDriveFolder(): Promise<string | null> {
  if (!isTauri()) return null
  const picked = await invoke<string | null>('pick_google_drive_folder')
  return picked?.trim() || null
}

export function needsGoogleDriveSetup(settings: AppSettings): boolean {
  if (settings.googleDriveSetupCompletado === true) return false
  if (settings.googleDriveDeshabilitado === true) return false
  if (settings.rutaGoogleDriveCustom?.trim()) return false
  if (
    settings.carpetaBackupGoogleDrive?.trim() ||
    settings.carpetaExportarGoogleDrive?.trim() ||
    settings.carpetaPdfsGoogleDrive?.trim()
  ) {
    return false
  }
  return true
}

export function googleDriveStatusLabel(status: GoogleDriveStatus): string {
  if (status.source === 'disabled') {
    return 'Google Drive desactivado en esta PC'
  }
  if (status.available && status.activePath) {
    if (status.source === 'custom') {
      return `Carpeta personalizada: ${status.activePath}`
    }
    return `Detectado automáticamente: ${status.activePath}`
  }
  if (status.detectedPath) {
    return `No se pudo usar: ${status.detectedPath}`
  }
  return 'No se detectó Google Drive en esta PC'
}

export function googleDriveStatusTone(
  status: GoogleDriveStatus,
): 'ok' | 'warn' | 'off' {
  if (status.source === 'disabled') return 'off'
  if (status.available) return 'ok'
  return 'warn'
}
