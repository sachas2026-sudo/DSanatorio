import { invoke, isTauri } from '@tauri-apps/api/core'

export type AppMode = 'local' | 'client'

export type AppModeInfo = {
  mode: AppMode
  serverUrl: string | null
}

let cached: AppModeInfo | null = null
let pending: Promise<AppModeInfo> | null = null

/** Solo tests: olvida el modo detectado para volver a consultarlo. */
export function resetAppModeCacheForTests(): void {
  cached = null
  pending = null
}

/**
 * Modo de ejecución de esta PC. En local los datos viven en esta máquina; en
 * cliente se leen y guardan contra el servidor configurado.
 */
export async function getAppModeInfo(): Promise<AppModeInfo> {
  if (!isTauri()) return { mode: 'local', serverUrl: null }
  if (cached) return cached
  if (!pending) {
    pending = invoke<Partial<AppModeInfo>>('get_app_mode')
      .then((info) => {
        const normalized: AppModeInfo = {
          mode: info?.mode === 'client' ? 'client' : 'local',
          serverUrl: info?.serverUrl ?? null,
        }
        cached = normalized
        return normalized
      })
      .catch(() => {
        const local: AppModeInfo = { mode: 'local', serverUrl: null }
        cached = local
        return local
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export async function isClientMode(): Promise<boolean> {
  return (await getAppModeInfo()).mode === 'client'
}

export function clearAppModeCache(): void {
  cached = null
  pending = null
}

export async function setModeLocal(): Promise<void> {
  if (isTauri()) {
    await invoke('set_mode_local')
  }
  clearAppModeCache()
}

export async function autoConnectServer(): Promise<{ serverUrl: string; serverName: string }> {
  if (isTauri()) {
    const res = await invoke<{ serverUrl: string; serverName: string }>('auto_connect_sanatorio_server')
    clearAppModeCache()
    return res
  }
  return { serverUrl: 'http://localhost:8787', serverName: 'Local' }
}

