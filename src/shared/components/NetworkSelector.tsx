import { useCallback, useEffect, useState } from 'react'
import {
  autoConnectServer,
  getNetworkConnectionStatus,
  type NetworkStatusInfo,
} from '../../lib/networkDiscovery'
import './network-selector.css'

export function NetworkSelector() {
  const [status, setStatus] = useState<NetworkStatusInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

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

  const isOnline = status?.isOnline ?? false
  const isHost = status?.isServerHost ?? false

  const tooltipText = isHost
    ? 'Servidor principal (en línea)'
    : isOnline
      ? `Conectado al servidor (${status?.serverUrl ?? ''})`
      : 'Servidor desconectado (buscando en red local)'

  const displayText = isHost
    ? 'Servidor local activo'
    : isOnline
      ? 'Servidor en red'
      : 'Buscando servidor...'

  return (
    <>
      <button
        type="button"
        className={`network-indicator ${isOnline ? 'network-indicator--online' : 'network-indicator--offline'}`}
        onClick={() => {
          setMessage(null)
          setOpen(true)
        }}
        title={tooltipText}
        aria-label={tooltipText}
      >
        <span className="network-indicator__icon-wrap">
          <svg
            className="network-indicator__icon"
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
          <span
            className={`network-indicator__dot ${
              isOnline ? 'network-indicator__dot--online' : 'network-indicator__dot--offline'
            }`}
          />
        </span>
        <span className="network-indicator__text">{displayText}</span>
      </button>

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
                    className={`network-dialog__badge ${
                      isOnline ? 'network-dialog__badge--online' : 'network-dialog__badge--offline'
                    }`}
                  >
                    {isOnline ? '● En línea' : '○ Desconectado'}
                  </span>
                  <span>{status?.serverName ?? 'Verificando…'}</span>
                </div>
                {status?.message && (
                  <span className="network-dialog__msg">{status.message}</span>
                )}
              </div>

              <div className="network-dialog__row">
                <span className="network-dialog__label">Dirección del Servidor</span>
                <span className="network-dialog__value">
                  {status?.serverUrl || '(Buscando automáticamente…)'}
                </span>
              </div>

              <div className="network-dialog__row">
                <span className="network-dialog__label">Modo de esta terminal</span>
                <span className="network-dialog__value">
                  {isHost
                    ? 'Servidor principal (base de datos local)'
                    : 'Terminal cliente (sincronizada en red)'}
                </span>
              </div>
            </div>

            {message && (
              <div
                className={
                  message.type === 'ok'
                    ? 'network-dialog__success'
                    : 'network-dialog__error'
                }
              >
                {message.text}
              </div>
            )}

            <div className="network-dialog__actions">
              {!isHost && (
                <button
                  type="button"
                  className="btn-network-primary"
                  onClick={() => void handleAutoConnect()}
                  disabled={busy}
                >
                  {busy ? 'Buscando en la red…' : 'Buscar y vincular servidor automáticamente'}
                </button>
              )}

              <button
                type="button"
                className="btn-network-secondary"
                onClick={() => void checkStatus()}
                disabled={busy}
              >
                Actualizar verificación
              </button>

              <button
                type="button"
                className="btn-network-secondary"
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

