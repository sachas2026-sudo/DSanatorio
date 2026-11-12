import { useCallback, useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import {
  diagnoseConnection,
  discoverServers,
  getInstallProfile,
  getServerPairingCode,
  getLocalNetworkInfo,
  getNetworkConnectionStatus,
  hideServerPairingCode,
  regenerateServerPairingCode,
  setManualServerUrl,
  type DiscoveredServer,
  type ConnectionDiagnostic,
  type InstallProfile,
  type LocalNetworkInfo,
  type NetworkStatusInfo,
} from '../../lib/networkDiscovery'
import { setModeLocal } from '../../lib/appMode'
import { APP_VERSION } from '../../lib/appVersion'
import './network-selector.css'

type NetworkSelectorProps = {
  onOpenInfo?: () => void
  appVersion?: string
}

function extractIpv4Number(ipOrUrl: string): number | null {
  if (!ipOrUrl) return null
  const clean = ipOrUrl
    .trim()
    .replace(/^https?:\/\//, '')
    .split(':')[0]
    .split('/')[0]
  const parts = clean.split('.')
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
    return parts.reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0)
  }
  return null
}

export function NetworkSelector({ onOpenInfo, appVersion = APP_VERSION }: NetworkSelectorProps) {
  const [status, setStatus] = useState<NetworkStatusInfo | null>(null)
  const [localNet, setLocalNet] = useState<LocalNetworkInfo | null>(null)
  const [multipleServers, setMultipleServers] = useState<DiscoveredServer[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [manualIp, setManualIp] = useState('')
  const [copiedDiag, setCopiedDiag] = useState(false)
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic | null>(null)
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [pairingCodeError, setPairingCodeError] = useState<string | null>(null)
  const [pairingCodeBusy, setPairingCodeBusy] = useState(false)
  const [installProfile, setInstallProfile] = useState<InstallProfile | null>(null)
  const [installProfileError, setInstallProfileError] = useState<string | null>(null)

  const checkStatus = useCallback(async () => {
    try {
      const s = await getNetworkConnectionStatus()
      setStatus(s)
      if (s?.serverUrl) {
        const clean = s.serverUrl.replace(/^https?:\/\//, '').split('/')[0]
        setManualIp(clean)
      }
    } catch {
      // ignore
    }
  }, [])

  const refreshLocalNet = useCallback(async () => {
    try {
      const info = await getLocalNetworkInfo()
      setLocalNet(info)
      return info
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void checkStatus()
    void refreshLocalNet()
    if (isTauri()) {
      void getInstallProfile()
        .then(setInstallProfile)
        .catch((error: unknown) => {
          setInstallProfileError(
            error instanceof Error ? error.message : 'No se pudo identificar el perfil de instalación.',
          )
        })
    }
    const timer = setInterval(() => {
      void checkStatus()
    }, 12000)
    return () => clearInterval(timer)
  }, [checkStatus, refreshLocalNet])

  useEffect(() => {
    if (open) {
      void checkStatus()
      void refreshLocalNet()
    }
  }, [open, checkStatus, refreshLocalNet])

  const isOnline = status?.isOnline ?? false
  const isHost = status?.mode === 'local' || status?.isServerHost === true
  const isServerInstall = installProfile === 'server'

  useEffect(() => {
    if (!open || !isServerInstall || !isTauri()) return

    let active = true
    const showCode = async () => {
      try {
        const code = await getServerPairingCode()
        if (active) {
          setPairingCode(code)
          setPairingCodeError(null)
        }
      } catch (error) {
        if (active) {
          setPairingCode(null)
          setPairingCodeError(
            error instanceof Error ? error.message : 'No se pudo mostrar el PIN de conexión.',
          )
        }
      }
    }
    const hideCode = async () => {
      setPairingCode(null)
      setPairingCodeError(null)
      try {
        await hideServerPairingCode()
      } catch (error) {
        if (active) {
          setPairingCodeError(
            error instanceof Error ? error.message : 'No se pudo ocultar el PIN de conexión.',
          )
        }
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void showCode()
      else void hideCode()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    handleVisibility()
    return () => {
      active = false
      setPairingCode(null)
      document.removeEventListener('visibilitychange', handleVisibility)
      void hideServerPairingCode().catch((error: unknown) => {
        console.error('No se pudo ocultar el PIN de conexión:', error)
      })
    }
  }, [open, isServerInstall])

  async function handleRefreshAndConnect() {
    if (busy) return
    setBusy(true)
    setMessage(null)
    setMultipleServers(null)

    try {
      // 1. Vuelve a leer las interfaces de red de esta PC y actualiza las tarjetas
      await refreshLocalNet()

      if (isHost) {
        const currentStatus = await getNetworkConnectionStatus()
        setStatus(currentStatus)
        setMessage({
          type: currentStatus.isOnline ? 'ok' : 'err',
          text: currentStatus.isOnline
            ? `API local operativa. ${currentStatus.message}`
            : currentStatus.message,
        })
      } else {
        // En PC Cliente: busca el servidor en la red actual en el orden especificado
        const servers = await discoverServers(3500)

        if (servers.length === 0) {
          // Si no lo encuentra: estado Desconectado y deja la IP anterior sin borrarla
          await checkStatus()
          setMessage({
            type: 'err',
            text: 'No se encontró servidor en esta red',
          })
        } else {
          setMultipleServers(servers)
          setMessage({
            type: 'ok',
            text: `Se encontraron ${servers.length} candidatos. La identidad TLS se verifica al conectarse.`,
          })
        }
      }
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo completar la búsqueda en la red.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleSelectServer(srv: DiscoveredServer) {
    setManualIp(`${srv.ip}:${srv.port}`)
    setBusy(true)
    setMessage(null)
    try {
      await setManualServerUrl(srv.serverUrl, srv.certPem)
      const currentStatus = await getNetworkConnectionStatus()
      setStatus(currentStatus)
      setMessage({
        type: currentStatus.isOnline ? 'ok' : 'err',
        text: currentStatus.isOnline
          ? `${srv.serverName} verificado y guardado.`
          : currentStatus.message,
      })
    } catch (error) {
      setMessage({
        type: 'err',
        text: error instanceof Error ? error.message : 'No se pudo verificar el servidor descubierto.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleManualConnect() {
    if (!manualIp.trim() || busy) return
    setBusy(true)
    setMessage(null)
    try {
      let target = manualIp.trim()
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        target = `https://${target}`
      }
      if (!target.includes(':8787') && !target.slice(8).includes(':')) {
        target = `${target}:8787`
      }
      await setManualServerUrl(target)
      const currentStatus = await getNetworkConnectionStatus()
      setStatus(currentStatus)
      setMessage({
        type: currentStatus.isOnline ? 'ok' : 'err',
        text: currentStatus.isOnline
          ? 'Dirección guardada; HTTPS y la API respondieron correctamente.'
          : `Dirección guardada. ${currentStatus.message}`,
      })
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo conectar a la dirección indicada.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDiagnoseConnection() {
    if (busy || isHost || status?.mode !== 'client') return
    setBusy(true)
    setMessage(null)
    try {
      const result = await diagnoseConnection()
      setDiagnostic(result)
      setShowDiagnosticModal(true)
      await checkStatus()
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo ejecutar el diagnóstico.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleRegeneratePairingCode() {
    if (pairingCodeBusy) return
    setPairingCodeBusy(true)
    setPairingCodeError(null)
    try {
      setPairingCode(await regenerateServerPairingCode())
    } catch (error) {
      setPairingCode(null)
      setPairingCodeError(
        error instanceof Error ? error.message : 'No se pudo regenerar el PIN de conexión.',
      )
    } finally {
      setPairingCodeBusy(false)
    }
  }

  // Verificación de subred entre la IP manual y las interfaces locales
  const manualIpNumber = extractIpv4Number(manualIp)
  const subnetInterfaces = (localNet?.interfaces || [])
    .map((iface) => ({
      ip: extractIpv4Number(iface.ip),
      mask: extractIpv4Number(iface.mask),
    }))
    .filter((item): item is { ip: number; mask: number } => item.ip !== null && item.mask !== null)
  const isDifferentSubnet =
    manualIpNumber !== null &&
    subnetInterfaces.length > 0 &&
    !subnetInterfaces.some(
      (iface) => (manualIpNumber & iface.mask) === (iface.ip & iface.mask),
    )

  function handleCopyDiagnostics() {
    const timestamp = new Date().toLocaleString('es-AR')
    const ifacesText = (localNet?.interfaces || [])
      .map(
        (i) =>
          `  - Adaptador: ${i.name} ${i.isPrimary ? '(Principal)' : ''}\n    IP: ${i.ip}\n    Máscara: ${i.mask}\n    Puerta de enlace: ${i.gateway || '—'}\n    Dirección Sanatorio: ${i.serverEndpoint}`,
      )
      .join('\n\n')

    const serversText = (multipleServers || [])
      .map((s) => `  - ${s.serverName} (${s.ip}:${s.port})`)
      .join('\n')

    const diag = `=== DIAGNÓSTICO DE RED SANATORIO ===
Fecha: ${timestamp}
Versión: v${appVersion}
Modo: ${isHost ? 'PC Servidor (Principal)' : 'Terminal Cliente'}
Estado de conexión: ${isOnline ? 'En línea' : 'Desconectado'}
Servidor configurado: ${status?.serverUrl || 'Ninguno'}
Detalle: ${status?.message || '—'}

--- Interfaces de Red de esta PC ---
${ifacesText || '  (No se detectaron interfaces)'}

--- Servidores detectados en la red ---
${serversText || '  (Ninguno)'}
======================================`

    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(diag)
      setCopiedDiag(true)
      setTimeout(() => setCopiedDiag(false), 3000)
    }
  }

  const tooltipText = isHost
    ? 'Servidor principal (en línea)'
    : isOnline
      ? `Conectado al servidor (${status?.serverUrl ?? ''})`
      : 'Servidor desconectado (buscando en red local)'

  return (
    <>
      <div className="sidebar-footer-row">
        <button
          type="button"
          className="sidebar-server-btn"
          onClick={() => {
            setMessage(null)
            setOpen(true)
          }}
          title={tooltipText}
          aria-label={isOnline ? 'Servidor activo' : 'Servidor inactivo'}
        >
          <svg
            className="sidebar-server-wifi-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isOnline ? 'var(--menu-ok, #2E7D4F)' : 'var(--menu-peligro, #B3261E)'}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <circle
              cx="12"
              cy="20"
              r="1.5"
              fill={isOnline ? 'var(--menu-ok, #2E7D4F)' : 'var(--menu-peligro, #B3261E)'}
              stroke="none"
            />
          </svg>
          <span
            className="sidebar-server-status-text"
            style={{
              color: isOnline ? 'var(--menu-ok, #2E7D4F)' : 'var(--menu-peligro, #B3261E)',
              fontWeight: 500,
            }}
          >
            {isOnline ? 'Servidor activo' : 'Servidor inactivo'}
          </span>
        </button>

        {onOpenInfo && (
          <button
            type="button"
            className="sidebar-f1-btn"
            title="Versión y atajos (F1)"
            onClick={onOpenInfo}
          >
            v{appVersion} · F1 ayuda
          </button>
        )}
      </div>

      {open && (
        <div className="network-dialog-overlay" onClick={() => setOpen(false)}>
          <div className="network-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>
              <span
                className={`network-indicator__dot ${
                  isOnline ? 'network-indicator__dot--online' : 'network-indicator__dot--offline'
                }`}
                style={{ position: 'static', display: 'inline-block' }}
              />
              {isHost ? 'Estado del servidor local' : 'Estado de conexión del cliente'}
            </h2>

            <div className="network-dialog__rows">
              <div className="network-dialog__row">
                <span className="network-dialog__label">
                  {isHost ? 'Estado de la API local' : 'Estado del servidor configurado'}
                </span>
                <div className="network-dialog__value">
                  <span
                    className={`network-badge ${
                      isOnline ? 'network-badge--online' : 'network-badge--offline'
                    }`}
                  >
                    {isHost
                      ? isOnline ? 'API local operativa' : 'API local no disponible'
                      : isOnline
                        ? status?.serverUrl
                          ? `Conectado a ${status.serverUrl.replace(/^https?:\/\//, '').split('/')[0]}`
                          : 'En línea'
                        : 'Servidor remoto desconectado'}
                  </span>
                </div>
              </div>

              <div className="network-dialog__row">
                <span className="network-dialog__label">Tipo de equipo</span>
                <span className="network-dialog__value">
                  {isHost ? 'PC Servidor (Principal)' : 'Terminal Cliente'}
                </span>
              </div>

              {status?.serverUrl && (
                <div className="network-dialog__row">
                  <span className="network-dialog__label">
                    {isHost ? 'Dirección HTTPS para clientes' : 'Dirección del servidor configurado'}
                  </span>
                  <span className="network-dialog__value font-mono">
                    {status.serverUrl}
                  </span>
                </div>
              )}

              {isServerInstall && isTauri() && (
                <div className="network-dialog__row network-dialog__pairing-row">
                  <span className="network-dialog__label">PIN de conexión para clientes</span>
                  <div className="network-dialog__pairing-content">
                    <strong className="network-dialog__pairing-code" aria-live="polite">
                      {pairingCode ?? (pairingCodeError ? 'No disponible' : 'Generando…')}
                    </strong>
                    <button
                      type="button"
                      className="network-action-btn network-action-btn--secondary"
                      onClick={() => void handleRegeneratePairingCode()}
                      disabled={pairingCodeBusy}
                    >
                      {pairingCodeBusy ? 'Regenerando…' : 'Regenerar PIN'}
                    </button>
                  </div>
                  <span className="network-dialog__pairing-help">
                    Ingresá este PIN en los clientes nuevos mientras esta ventana esté visible.
                    Regenerarlo no desconecta dispositivos ya autorizados.
                  </span>
                  {pairingCodeError && (
                    <span className="network-dialog__error" role="alert">
                      {pairingCodeError}
                    </span>
                  )}
                </div>
              )}
              {isHost && isTauri() && installProfile !== 'server' && installProfileError && (
                <div className="network-dialog__error" role="alert">
                  No se muestra el PIN porque no se pudo confirmar que esta instalación sea Servidor.
                  {' '}{installProfileError}
                </div>
              )}

              <div className="network-dialog__row">
                <span className="network-dialog__label">
                  {isHost ? 'Detalle del servidor local' : 'Detalle de conexión del cliente'}
                </span>
                <span className="network-dialog__value">{status?.message || '—'}</span>
              </div>
              <div className="network-dialog__row">
                <span className="network-dialog__label">
                  {isHost ? 'Última comprobación de la API local' : 'Última comunicación correcta'}
                </span>
                <span className="network-dialog__value">
                  {status?.lastSuccessfulCommunication
                    ? new Date(status.lastSuccessfulCommunication).toLocaleString('es-AR')
                    : 'Sin comunicación registrada en esta ejecución'}
                </span>
              </div>
            </div>

            {/* SECCIÓN: Configuración IP de esta PC */}
            <div className="network-section-title">
              <span>{isHost ? 'Interfaces LAN del servidor' : 'Interfaces de red de esta PC cliente'}</span>
            </div>

            {localNet && localNet.interfaces.length > 0 ? (
              <div className="network-cards-grid">
                {localNet.interfaces.map((iface, idx) => (
                  <div
                    key={`${iface.ip}-${idx}`}
                    className={`network-card ${iface.isPrimary ? 'network-card--primary' : ''}`}
                  >
                    <div className="network-card__header">
                      <span>{iface.name}</span>
                      {iface.isPrimary && (
                        <span className="network-card__badge-primary">Principal</span>
                      )}
                    </div>
                    <div className="network-card__details">
                      <div className="network-card__detail-item">
                        <span>IP:</span>
                        <strong>{iface.ip}</strong>
                      </div>
                      <div className="network-card__detail-item">
                        <span>Máscara:</span>
                        <strong>{iface.mask}</strong>
                      </div>
                      <div className="network-card__detail-item">
                        <span>Gateway:</span>
                        <strong>{iface.gateway || '—'}</strong>
                      </div>
                      <div className="network-card__detail-item">
                        <span>Dirección:</span>
                        <strong>{iface.serverEndpoint}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0.4rem 0' }}>
                Cargando adaptadores de red de esta PC...
              </p>
            )}

            {/* Mensajes de estado */}
            {message && (
              <div
                className={`network-message network-message--${message.type}`}
                role="alert"
              >
                {message.text}
              </div>
            )}

            {/* Lista interactiva si se encontraron múltiples servidores en la red */}
            {multipleServers && multipleServers.length > 0 && (
              <div className="network-multiple-servers">
                <div className="network-multiple-servers__title">
                  Servidores disponibles en la red local:
                </div>
                {multipleServers.map((srv, idx) => (
                  <div key={`${srv.serverUrl}-${idx}`} className="network-server-choice-item">
                    <div>
                      <strong>{srv.serverName}</strong> — <code>{srv.ip}:{srv.port}</code>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSelectServer(srv)}
                      disabled={busy}
                    >
                      Usar candidato
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Conexión manual o conmutación a local */}
            {!isHost && (
              <div className="network-dialog__actions">
                <div style={{ marginBottom: '8px' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await setModeLocal()
                        setMessage({ type: 'ok', text: 'Esta PC ahora actúa como Servidor Local.' })
                        await checkStatus()
                        await refreshLocalNet()
                      } catch (e) {
                        setMessage({ type: 'err', text: String(e) })
                      } finally {
                        setBusy(false)
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: '#0D766E',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                    }}
                    disabled={busy}
                  >
                    💻 Usar esta PC como Servidor Local (Principal)
                  </button>
                </div>

                <div className="network-manual-box">
                  <label htmlFor="manual-ip-input">Ingresar IP del Servidor manualmente:</label>
                  <div className="network-manual-row">
                    <input
                      id="manual-ip-input"
                      type="text"
                      placeholder="Ej: 192.168.1.100 o 192.168.1.100:8787"
                      value={manualIp}
                      onChange={(e) => setManualIp(e.target.value)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => void handleManualConnect()}
                      disabled={busy || !manualIp.trim()}
                    >
                      Guardar IP
                    </button>
                  </div>
                  {isDifferentSubnet && (
                    <div className="network-subnet-warning" role="alert">
                      <span>⚠️</span>
                      <span>
                        Esa IP no pertenece a ninguna subred detectada en las interfaces locales.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Footer con Actualizar y conectar, Copiar diagnóstico y Cerrar */}
            <div className="network-dialog__footer">
              <button
                type="button"
                className="network-action-btn network-action-btn--primary"
                onClick={() => void handleRefreshAndConnect()}
                disabled={busy}
                title="Actualiza los adaptadores de red y busca el servidor Sanatorio"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                  <circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none" />
                </svg>
                {busy ? 'Buscando...' : 'Actualizar y conectar'}
              </button>

              {!isHost && status?.mode === 'client' && (
                <button
                  type="button"
                  className="network-action-btn network-action-btn--secondary"
                  onClick={() => void handleDiagnoseConnection()}
                  disabled={busy}
                  title="Prueba DNS, TCP, TLS y disponibilidad de la API sin enviar credenciales"
                >
                  {busy ? 'Probando...' : 'Diagnosticar conexión'}
                </button>
              )}

              <button
                type="button"
                className="network-action-btn network-action-btn--secondary"
                onClick={handleCopyDiagnostics}
                title="Copiar información técnica al portapapeles"
              >
                {copiedDiag ? '✓ Copiado' : 'Copiar diagnóstico'}
              </button>

              <button
                type="button"
                className="network-action-btn network-action-btn--secondary"
                onClick={() => setOpen(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showDiagnosticModal && diagnostic && (
        <div
          className="network-diagnostic-overlay"
          onClick={() => setShowDiagnosticModal(false)}
        >
          <section
            className="network-diagnostic-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="network-diagnostic-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="network-diagnostic-title">Diagnóstico de conexión del cliente</h2>
            <p className="network-diagnostic-dialog__meta">
              Finalizado {new Date(diagnostic.completedAt).toLocaleString('es-AR')}
            </p>
            {diagnostic.serverUrl && (
              <div className="network-dialog__row">
                <strong className="network-dialog__label">Servidor probado</strong>
                <span className="network-dialog__value font-mono">{diagnostic.serverUrl}</span>
              </div>
            )}
            <div className="network-diagnostic-dialog__checks" aria-live="polite">
              {diagnostic.checks.map((check, idx) => (
                <div
                  key={`${check.name}-${idx}`}
                  className={`network-diagnostic-check network-diagnostic-check--${check.status}`}
                >
                  <strong className="network-dialog__label">
                    {check.status === 'ok' ? '✓' : check.status === 'error' ? '!' : '–'} {check.name}
                  </strong>
                  <span className="network-dialog__value">{check.detail}</span>
                </div>
              ))}
            </div>
            <div className="network-dialog__footer">
              <button
                type="button"
                className="network-action-btn network-action-btn--primary"
                onClick={() => setShowDiagnosticModal(false)}
              >
                Cerrar diagnóstico
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
