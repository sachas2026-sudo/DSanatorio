import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import {
  approveClientDevice,
  discoverServers,
  getConnectedDevices,
  getLocalNetworkInfo,
  getNetworkConnectionStatus,
  revokeClientDevice,
  setManualServerUrl,
  setServerPrimaryIp,
  type ConnectedDevice,
  type DiscoveredServer,
  type LocalNetworkInfo,
  type NetworkStatusInfo,
} from '../../lib/networkDiscovery'
import './network-selector.css'

const DEFAULT_HTTPS_PORT = 8787

function splitServerAddress(address: string | null): { host: string; port: string } | null {
  if (!address) return null
  try {
    const parsed = new URL(address)
    return {
      host: parsed.hostname.replace(/^\[|\]$/g, ''),
      port: parsed.port || String(DEFAULT_HTTPS_PORT),
    }
  } catch {
    return null
  }
}

function serverUrl(host: string, port: number): string {
  const cleanHost = host.trim().replace(/^\[|\]$/g, '')
  const urlHost = cleanHost.includes(':') ? `[${cleanHost}]` : cleanHost
  return `https://${urlHost}:${port}`
}

export function NetworkSettingsPanel() {
  const [status, setStatus] = useState<NetworkStatusInfo | null>(null)
  const [network, setNetwork] = useState<LocalNetworkInfo | null>(null)
  const [manualHost, setManualHost] = useState('')
  const [manualPort, setManualPort] = useState(String(DEFAULT_HTTPS_PORT))
  const [foundServers, setFoundServers] = useState<DiscoveredServer[]>([])
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([getNetworkConnectionStatus(), getLocalNetworkInfo()])
      .then(([nextStatus, nextNetwork]) => {
        if (!active) return
        setStatus(nextStatus)
        setNetwork(nextNetwork)
        if (nextStatus.mode === 'client') {
          const saved = splitServerAddress(nextStatus.serverUrl)
          if (saved) {
            setManualHost(saved.host)
            setManualPort(saved.port)
          }
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setMessage({
          type: 'err',
          text: error instanceof Error ? error.message : 'No se pudo consultar la configuración de red.',
        })
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (status?.mode !== 'local') return

    let active = true
    const refresh = async () => {
      try {
        const devices = await getConnectedDevices()
        if (active) setConnectedDevices(devices)
      } catch (error) {
        if (active) {
          setMessage({
            type: 'err',
            text: error instanceof Error ? error.message : 'No se pudieron consultar los dispositivos conectados.',
          })
        }
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [status?.mode])

  const isServer = status?.mode === 'local'
  const selectedInterface = network?.interfaces.find((iface) => iface.isPrimary)
  const serverPort = splitServerAddress(status?.serverUrl ?? null)?.port ?? String(DEFAULT_HTTPS_PORT)
  const selectedServerAddress = selectedInterface
    ? serverUrl(selectedInterface.ip, Number(serverPort))
    : null

  async function refreshStatus(): Promise<string | null> {
    try {
      const [nextStatus, nextNetwork] = await Promise.all([
        getNetworkConnectionStatus(),
        getLocalNetworkInfo(),
      ])
      setStatus(nextStatus)
      setNetwork(nextNetwork)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'No se pudo actualizar el estado de red.'
    }
  }

  async function handleSelectPrimaryIp(ip: string) {
    setBusy(true)
    setMessage(null)
    try {
      const updated = await setServerPrimaryIp(ip)
      setNetwork(updated)
      setMessage({ type: 'ok', text: `Dirección principal guardada: ${ip}:${DEFAULT_HTTPS_PORT}.` })
    } catch (error) {
      setMessage({
        type: 'err',
        text: error instanceof Error ? error.message : 'No se pudo guardar la interfaz principal.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleCopyServerAddress() {
    if (!selectedServerAddress) return
    try {
      await navigator.clipboard.writeText(selectedServerAddress)
      setMessage({ type: 'ok', text: 'Dirección HTTPS copiada.' })
    } catch {
      setMessage({ type: 'err', text: 'No se pudo copiar la dirección al portapapeles.' })
    }
  }

  async function handleManualConnect() {
    const port = Number(manualPort)
    if (!manualHost.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
      setMessage({ type: 'err', text: 'Ingresá una IP/host y un puerto entre 1 y 65535.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await setManualServerUrl(serverUrl(manualHost, port))
      const refreshError = await refreshStatus()
      setMessage(
        refreshError
          ? { type: 'err', text: `Dirección guardada tras verificar TLS/API. ${refreshError}` }
          : { type: 'ok', text: 'HTTPS y /api/health verificados. Dirección guardada para próximos inicios.' },
      )
    } catch (error) {
      setMessage({
        type: 'err',
        text: error instanceof Error ? error.message : 'No se pudo verificar el servidor.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscover() {
    setBusy(true)
    setMessage(null)
    try {
      const servers = await discoverServers(3000)
      setFoundServers(servers)
      setMessage(
        servers.length
          ? { type: 'ok', text: `Se encontraron ${servers.length} candidato(s). La conexión valida la identidad TLS anunciada por el servidor.` }
          : { type: 'err', text: 'No se encontraron servidores por UDP 8788. Podés configurar IP y puerto manualmente.' },
      )
    } catch (error) {
      setMessage({
        type: 'err',
        text: error instanceof Error ? error.message : 'Falló el descubrimiento UDP.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function prepareDiscoveredServer(server: DiscoveredServer) {
    setManualHost(server.ip)
    setManualPort(String(server.port))
    setBusy(true)
    setMessage(null)
    try {
      await setManualServerUrl(server.serverUrl, server.certPem)
      await refreshStatus()
      setMessage({ type: 'ok', text: `Servidor ${server.serverName} verificado y guardado.` })
    } catch (error) {
      setMessage({
        type: 'err',
        text: error instanceof Error ? error.message : 'No se pudo verificar el servidor descubierto.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeviceAccess(device: ConnectedDevice, approve: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      if (approve) await approveClientDevice(device.deviceId)
      else await revokeClientDevice(device.deviceId)
      setConnectedDevices(await getConnectedDevices())
      setMessage({
        type: 'ok',
        text: approve
          ? `Se autorizó ${device.deviceName}.`
          : `Se revocó el acceso de ${device.deviceName}.`,
      })
    } catch (error) {
      setMessage({
        type: 'err',
        text: error instanceof Error ? error.message : 'No se pudo actualizar el acceso del dispositivo.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel panel--config network-settings-panel">
      <h2>Red y conexión</h2>
      <p className="network-settings-panel__intro">
        Configuración LAN HTTPS. Los cambios manuales se guardan solo después de verificar TLS y la API.
      </p>

      {status && (
        <div className="network-dialog__rows">
          <div className="network-dialog__row">
            <span className="network-dialog__label">Modo</span>
            <span className="network-dialog__value">
              {isServer ? 'Servidor' : 'Cliente'} · {status.isOnline ? 'API operativa' : 'Sin conexión verificada'}
            </span>
          </div>
          {isServer && (
            <div className="network-dialog__row">
              <span className="network-dialog__label">Nombre del servidor</span>
              <span className="network-dialog__value">{status.serverName}</span>
            </div>
          )}
          {status.serverUrl && (
            <div className="network-dialog__row">
              <span className="network-dialog__label">
                {isServer ? 'Dirección HTTPS del servidor' : 'Servidor configurado'}
              </span>
              <span className="network-dialog__value font-mono">{status.serverUrl}</span>
            </div>
          )}
          {isServer && (
            <div className="network-dialog__row">
              <span className="network-dialog__label">Puerto HTTPS</span>
              <span className="network-dialog__value">
                {status.isOnline ? `${serverPort} (activo y verificado)` : `${serverPort} (sin escucha confirmada)`}
              </span>
            </div>
          )}
          {!isServer && (
            <div className="network-dialog__row">
              <span className="network-dialog__label">Estado</span>
              <span className="network-dialog__value">{status.message}</span>
            </div>
          )}
        </div>
      )}

      {!status ? (
        <p role="status">Consultando estado e interfaces de red…</p>
      ) : isServer ? (
        <>
          <div className="network-section-title">Interfaces LAN disponibles</div>
          {network?.interfaces.length ? (
            <>
              <label className="network-settings-panel__field" htmlFor="server-primary-ip">
                Dirección principal para compartir
                <select
                  id="server-primary-ip"
                  value={selectedInterface?.ip ?? ''}
                  onChange={(event) => void handleSelectPrimaryIp(event.target.value)}
                  disabled={busy}
                >
                  {network.interfaces.map((iface) => (
                    <option key={iface.ip} value={iface.ip}>
                      {iface.name} — {iface.ip}{iface.gateway ? ` (gateway ${iface.gateway})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="network-cards-grid">
                {network.interfaces.map((iface) => (
                  <div
                    className={`network-card ${iface.isPrimary ? 'network-card--primary' : ''}`}
                    key={`${iface.name}-${iface.ip}`}
                  >
                    <div className="network-card__header">
                      <span>{iface.name}</span>
                      {iface.isPrimary && <span className="network-card__badge-primary">Principal</span>}
                    </div>
                    <div className="network-card__details">
                      <div className="network-card__detail-item"><span>IP LAN:</span><strong>{iface.ip}</strong></div>
                      <div className="network-card__detail-item"><span>Máscara:</span><strong>{iface.mask}</strong></div>
                      <div className="network-card__detail-item"><span>Gateway:</span><strong>{iface.gateway || '—'}</strong></div>
                      <div className="network-card__detail-item"><span>HTTPS:</span><strong>{iface.serverEndpoint}</strong></div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="network-action-btn network-action-btn--secondary"
                type="button"
                onClick={() => void handleCopyServerAddress()}
                disabled={!selectedServerAddress || !status?.isOnline}
              >
                Copiar dirección HTTPS completa
              </button>
            </>
          ) : (
            <p role="status">No se detectaron interfaces LAN físicas activas.</p>
          )}
          <section className="network-connected-devices" aria-labelledby="connected-devices-title">
            <div className="network-connected-devices__header">
              <div>
                <h3 id="connected-devices-title">Dispositivos autorizados y solicitudes</h3>
                <p>El acceso permanece hasta que el servidor lo revoque. La clave nueva solo afecta futuras autorizaciones.</p>
              </div>
              <button
                className="network-action-btn network-action-btn--secondary"
                type="button"
                onClick={() => void getConnectedDevices().then(setConnectedDevices).catch((error: unknown) => {
                  setMessage({
                    type: 'err',
                    text: error instanceof Error ? error.message : 'No se pudieron consultar los dispositivos conectados.',
                  })
                })}
                disabled={busy}
              >
                Actualizar
              </button>
            </div>
            {connectedDevices.length > 0 ? (
              <div className="network-connected-devices__list">
                {connectedDevices.map((device) => (
                  <article className="network-connected-device" key={`${device.deviceId}-${device.username}`}>
                    <div className="network-connected-device__main">
                      <strong>{device.deviceName}</strong>
                      <span>
                        {device.connected
                          ? `${device.displayName} · ${device.role}`
                          : device.status === 'pending'
                            ? 'Solicitud pendiente'
                            : device.status === 'revoked'
                              ? 'Acceso revocado'
                              : 'Autorizado; sin sesión activa'}
                      </span>
                    </div>
                    <div className="network-connected-device__meta">
                      <span>Estado: {device.connected ? 'Conectado' : device.status}</span>
                      {device.username && <span>Usuario: {device.username}</span>}
                      {device.lastSeen > 0 && (
                        <span>Último contacto: {new Date(device.lastSeen * 1000).toLocaleString('es-AR')}</span>
                      )}
                    </div>
                    <div className="network-connected-device__actions">
                      {device.status === 'pending' || device.status === 'revoked' ? (
                        <button
                          type="button"
                          className="network-action-btn network-action-btn--primary"
                          onClick={() => void handleDeviceAccess(device, true)}
                          disabled={busy}
                        >
                          Autorizar
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="network-action-btn network-action-btn--secondary"
                          onClick={() => void handleDeviceAccess(device, false)}
                          disabled={busy}
                        >
                          Revocar
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="network-connected-devices__empty">Todavía no hay dispositivos autorizados ni solicitudes.</p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="network-section-title">Conexión manual del cliente</div>
          <div className="network-settings-panel__address-fields">
            <label className="network-settings-panel__field" htmlFor="network-manual-host">
              IP o nombre del servidor
              <input
                id="network-manual-host"
                value={manualHost}
                onChange={(event) => setManualHost(event.target.value)}
                placeholder="Ej.: 192.168.1.100"
                disabled={busy}
                autoComplete="url"
              />
            </label>
            <label className="network-settings-panel__field" htmlFor="network-manual-port">
              Puerto HTTPS
              <input
                id="network-manual-port"
                type="number"
                min={1}
                max={65535}
                value={manualPort}
                onChange={(event) => setManualPort(event.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <div className="network-settings-panel__actions">
            <button
              className="network-action-btn network-action-btn--primary"
              type="button"
              onClick={() => void handleManualConnect()}
              disabled={busy || !manualHost.trim()}
            >
              {busy ? 'Verificando…' : 'Verificar y guardar'}
            </button>
            <button
              className="network-action-btn network-action-btn--secondary"
              type="button"
              onClick={() => void handleDiscover()}
              disabled={busy}
            >
              Buscar servidor por UDP
            </button>
          </div>
          {foundServers.length > 0 && (
            <div className="network-multiple-servers">
              <div className="network-multiple-servers__title">Servidores descubiertos</div>
              {foundServers.map((server) => (
                <div className="network-server-choice-item" key={server.serverUrl}>
                  <span>
                    <strong>{server.serverName}</strong> — {server.ip}:{server.port}
                  </span>
                  <button type="button" onClick={() => void prepareDiscoveredServer(server)} disabled={busy}>
                    Conectar
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {message && (
        <div className={`network-message network-message--${message.type}`} role="status">
          {message.text}
        </div>
      )}
      {!isTauri() && (
        <p className="field-hint">La configuración LAN solo puede guardarse desde la aplicación de escritorio.</p>
      )}
    </section>
  )
}
