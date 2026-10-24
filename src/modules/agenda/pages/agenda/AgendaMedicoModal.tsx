import { useEffect, useMemo } from 'react'
import { format, isSameDay, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { isDoctorOffOnWeekday } from '../../../../lib/diasLibres'
import { turnosLibresMedicoDia } from '../../../../lib/weekSlots'
import type { AppData, Doctor } from '../../../../types'
import './agenda-medico-modal.css'

type Props = {
  data: AppData
  doctors: Doctor[]
  doctorId: string
  onDoctorIdChange: (id: string) => void
  weekDays: Date[]
  weekLabel: string
  onPrevWeek: () => void
  onNextWeek: () => void
  onPdf: () => void
  onPickSlot: (doctorId: string, day: Date, hm: string) => void
  onClose: () => void
}

export function AgendaMedicoModal({
  data,
  doctors,
  doctorId,
  onDoctorIdChange,
  weekDays,
  weekLabel,
  onPrevWeek,
  onNextWeek,
  onPdf,
  onPickSlot,
  onClose,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const doctor = useMemo(
    () => doctors.find((d) => d.id === doctorId) ?? null,
    [doctors, doctorId],
  )

  const doctorLabel = doctor ? `${doctor.apellido}, ${doctor.nombre}` : 'Médico'
  const obrasSocialesLabel = useMemo(() => {
    if (!doctor) return ''
    const list = (doctor.obrasSociales?.length
      ? doctor.obrasSociales
      : doctor.obraSocial
        ? [doctor.obraSocial]
        : []
    )
      .map((x) => x.trim())
      .filter(Boolean)
    if (list.length === 0) return ''
    if (list.length <= 4) return list.join(' · ')
    return `${list.slice(0, 4).join(' · ')}…`
  }, [doctor])

  return (
    <div
      className="agenda-medico-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="agenda-medico-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agenda-medico-title"
      >
        <header className="agenda-medico-sheet__head">
          <div>
            <h2 id="agenda-medico-title">Agenda Médico</h2>
          </div>
          <button
            type="button"
            className="agenda-medico-sheet__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="agenda-medico-toolbar">
          <div className="field field--pill agenda-medico-toolbar__doctor">
            <label htmlFor="agenda-medico-doctor">Médico</label>
            <div className="agenda-medico-doctor-row">
              <select
                id="agenda-medico-doctor"
                value={doctorId}
                onChange={(e) => onDoctorIdChange(e.target.value)}
              >
                <option value="">Elegir…</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.apellido}, {d.nombre}
                  </option>
                ))}
              </select>
              {obrasSocialesLabel && (
                <div className="agenda-medico-doctor-os" title={obrasSocialesLabel}>
                  {obrasSocialesLabel}
                </div>
              )}
            </div>
          </div>

          <div className="agenda-medico-toolbar__week" aria-label="Semana">
            <div className="agenda-medico-toolbar__week-label">
              SEMANA {weekLabel}
            </div>
            <div className="agenda-medico-toolbar__week-actions">
              <button
                type="button"
                className="btn btn-pdf btn-pdf--mini agenda-medico-toolbar__pdf"
                onClick={onPdf}
                disabled={!doctorId}
                title="PDF de horarios libres (como la grilla)"
              >
                PDF
              </button>
              <button
                type="button"
                className="week-nav__arrow week-nav__btn--celeste"
                aria-label="Semana anterior"
                onClick={onPrevWeek}
              >
                ‹
              </button>
              <button
                type="button"
                className="week-nav__arrow week-nav__btn--lila"
                aria-label="Semana siguiente"
                onClick={onNextWeek}
              >
                ›
              </button>
            </div>
          </div>
        </div>

        <div className="agenda-medico-grid" aria-label={`Agenda de ${doctorLabel}`}>
          {weekDays.map((day) => {
            const off = doctorId ? isDoctorOffOnWeekday(doctorId, day, data.diasLibres) : false
            const libres = doctorId ? turnosLibresMedicoDia(doctorId, day, data) : null
            const ocupadas = new Set(
              doctorId
                ? data.appointments
                    .filter(
                      (c) =>
                        c.doctorId === doctorId &&
                        c.estado !== 'cancelado' &&
                        isSameDay(parseISO(c.fechaHora), day),
                    )
                    .map((c) => format(parseISO(c.fechaHora), 'HH:mm', { locale: es }))
                : [],
            )
            const horas = (libres
              ? [...(libres.manana.horas ?? []), ...(libres.tarde.horas ?? [])]
              : []
            ).filter((hm) => !ocupadas.has(hm))
            const title = format(day, "EEEE d 'de' MMMM", { locale: es })

            return (
              <section
                key={day.toISOString()}
                className={`agenda-medico-day${off ? ' agenda-medico-day--off' : ''}`}
                aria-label={title}
              >
                <header className="agenda-medico-day__head">
                  <div className="agenda-medico-day__meta">
                    <div className="agenda-medico-day__dow">
                      {format(day, 'd')}{' '}
                      {format(day, 'EEE', { locale: es }).toUpperCase()}
                    </div>
                    <div className="agenda-medico-day__month">
                      {format(day, 'MMM yyyy', { locale: es }).toUpperCase()}
                    </div>
                  </div>
                </header>

                {off ? (
                  <div className="agenda-medico-day__empty">Día libre</div>
                ) : !libres ? (
                  <div className="agenda-medico-day__empty">Sin atención</div>
                ) : horas.length === 0 ? (
                  <div className="agenda-medico-day__empty">Sin horarios libres</div>
                ) : (
                  <div className="agenda-medico-day__slots" role="list">
                    {horas.map((hm) => (
                      <button
                        key={hm}
                        type="button"
                        className="agenda-medico-slot"
                        role="listitem"
                        onClick={() => onPickSlot(doctorId, day, hm)}
                      >
                        {hm}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <footer className="agenda-medico-sheet__actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  )
}

