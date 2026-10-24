export function createHealthService(repository: { isConnected(): boolean }, version: string) {
  return { getStatus: () => ({ status: 'ok' as const, database: repository.isConnected() ? 'connected' as const : 'disconnected' as const, version }) }
}