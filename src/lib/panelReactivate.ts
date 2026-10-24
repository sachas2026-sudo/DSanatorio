import { invoke, isTauri } from '@tauri-apps/api/core'

export type PanelReactivateResult = {
  ok: boolean
  panelUrl?: string
  error?: string
}

export async function reactivatePanelService(): Promise<PanelReactivateResult> {
  if (!isTauri()) {
    return {
      ok: false,
      error: 'Reactivar panel solo está disponible en la app de escritorio.',
    }
  }
  try {
    return await invoke<PanelReactivateResult>('reactivate_panel')
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'No se pudo reactivar el panel.',
    }
  }
}
