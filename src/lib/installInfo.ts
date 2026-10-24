import { invoke, isTauri } from '@tauri-apps/api/core'

export type InstallInfo = {
  appVersion: string
  dataDir: string
  updatedAtMs?: number
  previousVersion?: string
}

export async function getInstallInfo(): Promise<InstallInfo | null> {
  if (!isTauri()) return null
  try {
    return await invoke<InstallInfo>('get_install_info')
  } catch {
    return null
  }
}
