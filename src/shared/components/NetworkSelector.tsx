import { useCallback, useEffect, useState } from 'react'
import {
  autoConnectServer,
  getNetworkConnectionStatus,
  setManualServerUrl,
  type NetworkStatusInfo,
} from '../../lib/networkDiscovery'
import { APP_VERSION } from '../../lib/appVersion'
import './network-selector.css'

type NetworkSelectorProps = {
  onOpenInfo?: () => void
  appVersion?: string
}

export function NetworkSelector({ onOpenInfo, appVersion = APP_VERSION }: NetworkSelectorProps) {
  const [status, setStatus] = useState<NetworkStatusInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [manualIp, setManualIp] = useState('')

  const checkStatus = useCallback(async () => {
    try {
      const s = await getNetworkConnectionStatus()
      setStatus(s)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void checkStatus()
    const timer = setInterval(() => {
      void checkStatus()
    }, 12000)
    return () => clearInterval(timer)
  }, [checkStatus])

  async function handleAutoConnect() {
    setBusy(true)
    setMessage(null)
    try {
      const server = await autoConnectServer()
      setMessage({
        type: 'ok',
        text: `¡Conectado exitosamente al servidor en ${server.ip}!`,
      })
      await checkStatus()
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleManualConnect() {
    if (!manualIp.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      let target = manualIp.trim()
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        target = `https://${target}:8787`
      }
      await setManualServerUrl(target)
      setMessage({ type: 'ok', text: 'Servidor configurado manualmente.' })
      await checkStatus()
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const isOnline = status?.isOnline ?? false
  const isHost = status?.isServerHost ?? false

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
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isOnline ? 'var(--sidebar-online-green, #2E7D4F)' : 'var(--sidebar-offline-red, #B3261E)'}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <circle cx="12" cy="20" r="1.5" fill={isOnline ? 'var(--sidebar-online-green, #2E7D4F)' : 'var(--sidebar-offline-red, #B3261E)'} stroke="none" />
          </svg>
          <span
            className="sidebar-server-status-text"
            style={{
              color: isOnline ? 'var(--sidebar-online-green, #2E7D4F)' : 'var(--sidebar-offline-red, #B3261E)',
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
              Estado de Red y Servidor
            </h2>

            <div className="network-dialog__rows">
              <div className="network-dialog__row">
                <span className="network-dialog__label">Estado de conexión</span>
                <div className="network-dialog__value">
                  <span
                    className={`network-badge ${
                      isOnline ? 'network-badge--online' : 'network-badge--offline'
                    }`}
                  >
                    {isOnline ? 'En línea' : 'Desconectado'}
                  </span>
                </div>
              </div>

              <div className="network-dialog__row">
                <span className="network-dialog__label">Modo</span>
                <span className="network-dialog__value">
                  {isHost ? 'PC Servidor (Principal)' : 'Terminal Cliente'}
                </span>
              </div>

              {status?.serverUrl && (
                <div className="network-dialog__row">
                  <span className="network-dialog__label">Dirección servidor</span>
                  <span className="network-dialog__value font-mono">
                    {status.serverUrl}
                  </span>
                </div>
              )}

              <div className="network-dialog__row">
                <span className="network-dialog__label">Detalle</span>
                <span className="network-dialog__value">{status?.message || '—'}</span>
              </div>
            </div>

            {message && (
              <div
                className={`network-message network-message--${message.type}`}
                role="alert"
              >
                {message.text}
              </div>
            )}

            {!isHost && (
              <div className="network-dialog__actions">
                <button
                  type="button"
                  className="network-action-btn network-action-btn--primary"
                  onClick={() => void handleAutoConnect()}
                  disabled={busy}
                >
                  {busy ? 'Buscando en red...' : 'Reconectar automáticamente'}
                </button>

                <div className="network-manual-box">
                  <label htmlFor="manual-ip-input">O ingresar IP del Servidor:</label>
                  <div className="network-manual-row">
                    <input
                      id="manual-ip-input"
                      type="text"
                      placeholder="192.168.1.100"
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
                </div>
              </div>
            )}

            <div className="network-dialog__footer">
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
    </>
  )
}
