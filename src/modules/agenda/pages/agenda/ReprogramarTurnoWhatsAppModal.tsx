import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import './reprogramar-turno-whatsapp-modal.css'

type Props = {
  doctorName: string
  turnoCount: number
  /** Hora sugerida (HH:mm) del primer turno cancelado. */
  horaSugerida?: string
  onConfirm: (fechaNueva: string, horaNueva: string) => void
  onClose: () => void
}

export function ReprogramarTurnoWhatsAppModal({
  doctorName,
  turnoCount,
  horaSugerida = '',
  onConfirm,
  onClose,
}: Props) {
  const [fechaNueva, setFechaNueva] = useState('')
  const [horaNueva, setHoraNueva] = useState(horaSugerida)
  const fechaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHoraNueva(horaSugerida)
  }, [horaSugerida])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    requestAnimationFrame(() => fechaRef.current?.focus())
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!fechaNueva || !horaNueva) return
    onConfirm(fechaNueva, horaNueva)
  }

  const hoy = format(new Date(), 'yyyy-MM-dd')

  return (
    <div
      className="reprog-wa-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <form
        className="reprog-wa-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reprog-wa-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="reprog-wa__head">
          <div>
            <h2 id="reprog-wa-title">WhatsApp reprogramación</h2>
            <p className="reprog-wa__sub">
              {turnoCount} turno{turnoCount === 1 ? '' : 's'} cancelado
              {turnoCount === 1 ? '' : 's'} de {doctorName}
            </p>
          </div>
          <button
            type="button"
            className="reprog-wa__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="reprog-wa__body">
          <label className="reprog-wa__label" htmlFor="reprog-wa-fecha">
            Nueva fecha del turno
          </label>
          <input
            ref={fechaRef}
            id="reprog-wa-fecha"
            className="reprog-wa__input"
            type="date"
            min={hoy}
            required
            value={fechaNueva}
            onChange={(e) => setFechaNueva(e.target.value)}
          />
          <label className="reprog-wa__label" htmlFor="reprog-wa-hora">
            Horario
          </label>
          <input
            id="reprog-wa-hora"
            className="reprog-wa__input"
            type="time"
            required
            value={horaNueva}
            onChange={(e) => setHoraNueva(e.target.value)}
          />
          <p className="reprog-wa__hint">
            La fecha cancelada y el médico salen de la agenda. La nueva fecha y
            el horario se usan en el mensaje de WhatsApp.
          </p>
        </div>

        <div className="reprog-wa__actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!fechaNueva || !horaNueva}
          >
            Abrir WhatsApp
          </button>
        </div>
      </form>
    </div>
  )
}
