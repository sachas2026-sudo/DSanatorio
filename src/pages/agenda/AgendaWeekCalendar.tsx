import { format, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { doctorObrasSocialesSemanaLabel } from '../../lib/doctorAgenda'
import type { Doctor } from '../../types'

function formatWeekDayPillLabel(day: Date): string {
  const dow = format(day, 'EEE', { locale: es }).replace(/\./g, '').toUpperCase()
  const monRaw = format(day, 'MMM', { locale: es }).replace(/\./g, '')
  const mon = monRaw.charAt(0).toUpperCase() + monRaw.slice(1).toLowerCase()
  return `${dow} ${format(day, 'd')} ${mon}`
}

type Props = {
  weekDays: Date[]
  selectedWeekDay: Date | null
  onSelectDay: (day: Date) => void
  onOpenBooking: (day: Date) => void
  countTurnosDia: (day: Date) => number
  medicosDiaSeleccionado: Doctor[]
  medicoAgendaWeekLine: (doc: Doctor) => string
}

export function AgendaWeekCalendar({
  weekDays,
  selectedWeekDay,
  onSelectDay,
  onOpenBooking,
  countTurnosDia,
  medicosDiaSeleccionado,
  medicoAgendaWeekLine,
}: Props) {
  return (
    <div className="day-list-week-inset">
      <div className="week-strip" role="list">
        {weekDays.map((day) => {
          const today = isSameDay(day, new Date())
          const selected =
            selectedWeekDay !== null && isSameDay(day, selectedWeekDay)
          const n = countTurnosDia(day)
          return (
            <div
              key={day.toISOString()}
              role="listitem"
              className={`week-day${day.getDay() === 6 ? ' week-day--sabado' : ''}${today ? ' week-day--today' : ''}${selected ? ' week-day--selected' : ''}`}
              title="Clic para marcar · doble clic para reservar"
              onClick={() => onSelectDay(day)}
              onDoubleClick={() => onOpenBooking(day)}
            >
              <div className="week-day__label">{formatWeekDayPillLabel(day)}</div>
              <div
                className={`week-day__turnos${n === 0 ? ' week-day__turnos--empty' : ''}`}
              >
                {n} turno{n === 1 ? '' : 's'}
              </div>
            </div>
          )
        })}
      </div>
      {selectedWeekDay && (
        <div
          className="week-medics-row"
          aria-label={`Médicos que atienden el ${format(selectedWeekDay, "EEEE d 'de' MMMM", { locale: es })}`}
        >
          {medicosDiaSeleccionado.length > 0 ? (
            medicosDiaSeleccionado.map((doc) => {
              const obrasSociales = doctorObrasSocialesSemanaLabel(doc)
              return (
                <div key={doc.id} className="week-medics-row__item">
                  <div className="week-medics-row__name">
                    {medicoAgendaWeekLine(doc)}
                  </div>
                  {obrasSociales ? (
                    <div
                      className="week-medics-row__os"
                      title={obrasSociales}
                    >
                      {obrasSociales}
                    </div>
                  ) : null}
                </div>
              )
            })
          ) : (
            <span className="week-medics-row__empty">
              Ningún médico atiende ese día
            </span>
          )}
        </div>
      )}
    </div>
  )
}
