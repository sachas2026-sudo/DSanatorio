/** URL pública del panel (build: VITE_PANEL_GERENTE_URL en .env). Pre-rellena Configuración si está vacía. */
function readVitePanelUrlDefault(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
      .env
    const raw = env?.VITE_PANEL_GERENTE_URL
    return typeof raw === 'string' ? raw.trim() : ''
  } catch {
    return ''
  }
}

export const PANEL_GERENTE_URL_DEFAULT = readVitePanelUrlDefault()
export function resolvePanelUrl(stored: string | undefined): string {
  const trimmed = stored?.trim() ?? ''
  return trimmed || PANEL_GERENTE_URL_DEFAULT
}
