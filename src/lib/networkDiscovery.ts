import { invoke, isTauri } from '@tauri-apps/api/core'

export interface DiscoveredServer {
  ip: string
  port: number
  serverName: string
  serverUrl: string
  certPem?: string
}

export interface NetworkStatusInfo {
  mode: 'local' | 'client'
  isOnline: boolean
  serverUrl: string | null
  serverName: string
  isServerHost: boolean
  message: string
}

export async function getNetworkConnectionStatus(): Promise<NetworkStatusInfo> {
  if (!isTauri()) {
    return {
      mode: 'local',
      isOnline: true,
      serverUrl: 'http://localhost:5173',
      serverName: 'Modo Web / Desarrollo',
      isServerHost: true,
      message: 'Ejecutando en navegador.',
    }
  }
  return invoke<NetworkStatusInfo>('get_network_connection_status')
}

export async function discoverServers(timeoutMs = 1500): Promise<DiscoveredServer[]> {
  if (!isTauri()) return []
  return invoke<DiscoveredServer[]>('discover_sanatorio_servers', { timeoutMs })
}

export async function autoConnectServer(): Promise<DiscoveredServer> {
  if (!isTauri()) {
    throw new Error('Solo disponible en la aplicación de escritorio')
  }
  return invoke<DiscoveredServer>('auto_connect_sanatorio_server')
}

export async function setManualServerUrl(url: string): Promise<void> {
  if (!isTauri()) return
  return invoke('set_manual_server_url', { url })
}

