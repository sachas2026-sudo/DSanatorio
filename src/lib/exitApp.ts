import { isTauri } from '@tauri-apps/api/core'

export async function exitApp(): Promise<void> {
  if (isTauri()) {
    const { exit } = await import('@tauri-apps/plugin-process')
    await exit(0)
    return
  }
  window.close()
}
