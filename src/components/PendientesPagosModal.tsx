import { useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import './pendientes-pagos-modal.css'

export type PendientePagoRow = {
  id: string
  fechaHora: string
  patientLabel: string
  doctorLabel: string
}

type Props = {
  title: string
  rows: PendientePagoRow[]
  onClose: () => void
}

export function PendientesPagosModal({ title, rows, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="pendientes-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="pendientes-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pendientes-title"
      >
        <header className="pendientes-sheet__head">
          <div>
            <h2 id="pendientes-title">{title}</h2>
            <p className="pendientes-sheet__sub">
              {rows.length} pendiente{rows.length === 1 ? '' : 's'} de pago
            </p>
          </div>
          <button
            type="button"
            className="pendientes-sheet__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {rows.length === 0 ? (
          <div className="pendientes-sheet__empty">
            No hay pacientes pendientes por ahora.
          </div>
        ) : (
          <ul className="pendientes-list">
            {rows.map((r) => (
              <li key={r.id} className="pendientes-item">
                <span className="pendientes-item__time">
                  {format(parseISO(r.fechaHora), 'dd/MM HH:mm', { locale: es })}
                </span>
                <span className="pendientes-item__main">
                  <span className="pendientes-item__patient">{r.patientLabel}</span>
                  <span className="pendientes-item__doctor">{r.doctorLabel}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <footer className="pendientes-sheet__actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  )
}

