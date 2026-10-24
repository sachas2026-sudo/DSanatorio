export type PanelSyncUiStatus =
  | 'unconfigured'
  | 'idle'
  | 'syncing'
  | 'ok'
  | 'error'

export function formatPanelSyncStatusLabel(
  status: PanelSyncUiStatus,
  error: string | null,
  lastOkAt: number | null,
): string {
  switch (status) {
    case 'unconfigured':
      return 'Panel gerente sin configurar'
    case 'syncing':
      return 'Sincronizando panel…'
    case 'ok':
      if (lastOkAt) {
        const t = new Date(lastOkAt).toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        })
        return `Panel sincronizado (${t})`
      }
      return 'Panel sincronizado'
    case 'error':
      return error?.trim() || 'Error al sincronizar el panel'
    default:
      return 'Panel gerente'
  }
}
