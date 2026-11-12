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
  errorKind: string | null
  lastSuccessfulCommunication: string | null
}

export interface ConnectedDevice {
  deviceId: string
  deviceName: string
  username: string
  displayName: string
  role: string
  connectedAt: number
  lastSeen: number
  status: 'pending' | 'approved' | 'connected' | 'revoked'
  connected: boolean
}

export interface ClientDeviceAccessInfo {
  status: 'pending' | 'approved' | 'revoked' | 'invalid_code'
  serverName: string
  message: string
}

export interface DiagnosticCheck {
  name: string
  status: 'ok' | 'error' | 'skipped'
  detail: string
}

export interface ConnectionDiagnostic {
  serverUrl: string | null
  checks: DiagnosticCheck[]
  completedAt: string
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
      errorKind: null,
      lastSuccessfulCommunication: null,
    }
  }
  return invoke<NetworkStatusInfo>('get_network_connection_status')
}

export async function getInstallProfile(): Promise<InstallProfile | null> {
  if (!isTauri()) return null
  return invoke<InstallProfile | null>('get_install_profile')
}

export async function getConnectedDevices(): Promise<ConnectedDevice[]> {
  if (!isTauri()) return []
  return invoke<ConnectedDevice[]>('get_connected_devices')
}

export async function requestClientDeviceAccess(pairingCode: string): Promise<ClientDeviceAccessInfo> {
  if (!isTauri()) {
    throw new Error('La solicitud de acceso requiere la aplicación de escritorio.')
  }
  return invoke<ClientDeviceAccessInfo>('request_client_device_access', { pairingCode })
}

export async function approveClientDevice(deviceId: string): Promise<void> {
  return invoke('approve_client_device', { deviceId })
}

export async function revokeClientDevice(deviceId: string): Promise<void> {
  return invoke('revoke_client_device', { deviceId })
}

export async function getServerPairingCode(): Promise<string> {
  return invoke<string>('get_server_pairing_code')
}

export async function regenerateServerPairingCode(): Promise<string> {
  return invoke<string>('regenerate_server_pairing_code')
}

export async function hideServerPairingCode(): Promise<void> {
  return invoke('hide_server_pairing_code')
}

export async function diagnoseConnection(): Promise<ConnectionDiagnostic> {
  if (!isTauri()) {
    throw new Error('El diagnóstico de conectividad está disponible en la aplicación de escritorio.')
  }
  return invoke<ConnectionDiagnostic>('diagnose_connection')
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

export async function setManualServerUrl(
  url: string,
  certPem?: string,
): Promise<void> {
  if (!isTauri()) return
  return invoke('set_manual_server_url', {
    url,
    certPem: certPem ?? null,
  })
}

export interface NetworkInterfaceInfo {
  name: string
  ip: string
  mask: string
  gateway: string | null
  serverEndpoint: string
  isPrimary: boolean
}

export interface LocalNetworkInfo {
  interfaces: NetworkInterfaceInfo[]
  primaryIp: string | null
}

export type InstallProfile = 'server' | 'contratantes' | 'administracion'

export async function getLocalNetworkInfo(): Promise<LocalNetworkInfo> {
  if (!isTauri()) {
    return {
      interfaces: [
        {
          name: 'Ethernet',
          ip: '127.0.0.1',
          mask: '255.255.255.0',
          gateway: '127.0.0.1',
          serverEndpoint: '127.0.0.1:8787',
          isPrimary: true,
        },
      ],
      primaryIp: '127.0.0.1',
    }
  }
  return invoke<LocalNetworkInfo>('get_local_network_info')
}

export async function setServerPrimaryIp(ip: string): Promise<LocalNetworkInfo> {
  if (!isTauri()) {
    throw new Error('La selección de la interfaz principal requiere la aplicación de escritorio.')
  }
  return invoke<LocalNetworkInfo>('set_server_primary_ip', { ip })
}

