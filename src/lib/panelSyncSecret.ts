import { invoke, isTauri } from '@tauri-apps/api/core'

const PANEL_SYNC_SECRET_KEY = 'sanatorio-panel-sync-secret-v1'

export async function loadPanelSyncSecret(): Promise<string> {
  if (isTauri()) {
    try {
      return await invoke<string>('load_panel_sync_secret')
    } catch {
      return ''
    }
  }
  return localStorage.getItem(PANEL_SYNC_SECRET_KEY) ?? ''
}

export async function savePanelSyncSecret(secret: string): Promise<void> {
  const trimmed = secret.trim()
  if (isTauri()) {
    await invoke('save_panel_sync_secret', { secret: trimmed })
    return
  }
  if (trimmed) {
    localStorage.setItem(PANEL_SYNC_SECRET_KEY, trimmed)
  } else {
    localStorage.removeItem(PANEL_SYNC_SECRET_KEY)
  }
}
