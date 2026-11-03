import { isTauri, invoke } from '@tauri-apps/api/core'
import './window-minimize.css'

export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().minimize()
    return
  } catch {
    // fallback
  }
  try {
    await invoke('minimize_window')
  } catch (err) {
    console.warn('Error al minimizar ventana:', err)
  }
}

export function WindowMinimizeButton() {
  if (!isTauri()) return null

  return (
    <button
      type="button"
      className="window-minimize-btn"
      onClick={() => void minimizeWindow()}
      title="Minimizar ventana"
      aria-label="Minimizar ventana"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  )
}
