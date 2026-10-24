import { isTauri } from '@tauri-apps/api/core'

let bypassCloseGuard = false

/** Evita doble confirmación cuando la app ya guardó y va a cerrar. */
export function setExitBypassCloseGuard(value: boolean): void {
  bypassCloseGuard = value
}

export function consumeExitBypassCloseGuard(): boolean {
  if (!bypassCloseGuard) return false
  bypassCloseGuard = false
  return true
}

export async function exitApp(): Promise<void> {
  if (!isTauri()) {
    window.close()
    return
  }
  setExitBypassCloseGuard(true)
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().destroy()
    return
  } catch (err) {
    console.warn('[exit] window.destroy:', err)
    setExitBypassCloseGuard(false)
  }
  try {
    const { exit } = await import('@tauri-apps/plugin-process')
    await exit(0)
  } catch (err) {
    console.error('[exit] process.exit:', err)
    throw err
  }
}
