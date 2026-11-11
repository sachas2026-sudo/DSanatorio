import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  formatYMD,
  getNextMonth,
  getPrevMonth,
  parseYMD,
  type DateRangeState,
} from '../../../lib/pagosDateRange'

export interface PagosCustomCalendarProps {
  range: DateRangeState
  onSelectDate: (dateStr: string) => void
  onClear: () => void
  onToday: () => void
  onClose?: () => void
  /** Opcional para forzar mes visible al cambiar atajo */
  targetMonthDate?: string
}

export function PagosCustomCalendar({
  range,
  onSelectDate,
  onClear,
  onToday,
  onClose,
  targetMonthDate,
}: PagosCustomCalendarProps) {
  const [viewDate, setViewDate] = useState<Date>(() => {
    const ref = range.activeTarget === 'hasta' ? range.hasta || range.desde : range.desde || range.hasta
    const p = parseYMD(ref)
    if (p) {
      return new Date(p.year, p.month - 1, 1)
    }
    return new Date()
  })

  // Sincronizar viewDate si targetMonthDate cambia (p. ej. por un atajo como 'mes-anterior')
  useEffect(() => {
    if (targetMonthDate) {
      const p = parseYMD(targetMonthDate)
      if (p) {
        setViewDate(new Date(p.year, p.month - 1, 1))
      }
    }
  }, [targetMonthDate])

  // Soporte para tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth() // 0-11

  // Primer día del mes y cantidad de días
  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)

  // En español la semana comienza en Lunes: LU=0, MA=1, ..., DO=6
  let startingDay = firstDayOfMonth.getDay() // 0 = Domingo, 1 = Lunes...
  startingDay = startingDay === 0 ? 6 : startingDay - 1

  const prevMonthInfo = getPrevMonth(year, month)
  const nextMonthInfo = getNextMonth(year, month)

  const prevMonthLastDay = new Date(year, month, 0).getDate()
  const daysInMonth = lastDayOfMonth.getDate()

  // Días previos de relleno (mes anterior)
  const prevDays: { day: number; dateStr: string }[] = []
  for (let i = startingDay - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i
    prevDays.push({
      day: d,
      dateStr: formatYMD(prevMonthInfo.year, prevMonthInfo.monthZeroBased + 1, d),
    })
  }

  // Días del mes actual
  const currentDays: { day: number; dateStr: string }[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    currentDays.push({
      day: d,
      dateStr: formatYMD(year, month + 1, d),
    })
  }

  // Días posteriores para completar la cuadrícula (múltiplo de 7)
  const totalSlots = prevDays.length + currentDays.length
  const nextDaysCount = (7 - (totalSlots % 7)) % 7
  const nextDays: { day: number; dateStr: string }[] = []
  for (let d = 1; d <= nextDaysCount; d++) {
    nextDays.push({
      day: d,
      dateStr: formatYMD(nextMonthInfo.year, nextMonthInfo.monthZeroBased + 1, d),
    })
  }

  const now = new Date()
  const todayStr = formatYMD(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const monthName = format(viewDate, "MMMM 'de' yyyy", { locale: es })

  const handlePrevMonth = () => {
    setViewDate(new Date(prevMonthInfo.year, prevMonthInfo.monthZeroBased, 1))
  }

  const handleNextMonth = () => {
    setViewDate(new Date(nextMonthInfo.year, nextMonthInfo.monthZeroBased, 1))
  }

  const handleSelectDay = (dateStr: string, isFromNeighborMonth = false) => {
    if (isFromNeighborMonth) {
      const p = parseYMD(dateStr)
      if (p) {
        setViewDate(new Date(p.year, p.month - 1, 1))
      }
    }
    onSelectDate(dateStr)
  }

  const getDayClasses = (dateStr: string, isOutside: boolean) => {
    const classes: string[] = ['pagos-calendar-day']
    if (isOutside) classes.push('is-outside')

    const isToday = dateStr === todayStr
    if (isToday) classes.push('is-today')

    const { desde, hasta, isRangeComplete } = range

    if (desde && hasta) {
      if (desde === hasta && dateStr === desde) {
        classes.push('is-selected', 'is-range-start', 'is-range-end', 'is-single-day')
      } else if (dateStr === desde) {
        classes.push('is-selected', 'is-range-start')
      } else if (dateStr === hasta) {
        classes.push('is-selected', 'is-range-end')
      } else if (dateStr > desde && dateStr < hasta) {
        classes.push('is-in-range')
      }
    } else if (desde && dateStr === desde) {
      classes.push('is-selected', 'is-range-start', 'is-single-day')
    } else if (hasta && dateStr === hasta) {
      classes.push('is-selected', 'is-range-end', 'is-single-day')
    }

    if (isRangeComplete && ((desde && dateStr === desde) || (hasta && dateStr === hasta))) {
      classes.push('is-complete-bound')
    }

    return classes.join(' ')
  }

  return (
    <div
      className={`pagos-calendar-box${range.isRangeComplete ? ' is-range-ready' : ''}`}
      role="region"
      aria-label="Calendario de pagos"
    >
      {/* Texto auxiliar / paso interactivo */}
      <div className="pagos-calendar-step-hint" aria-live="polite">
        {range.isRangeComplete ? (
          <span className="pagos-calendar-step-hint--ready">Rango listo</span>
        ) : range.activeTarget === 'desde' ? (
          <span>Paso 1 de 2 · Elegí la fecha DESDE</span>
        ) : (
          <span>Paso 2 de 2 · Ahora elegí la fecha HASTA</span>
        )}
      </div>

      <div className="pagos-calendar-header">
        <span className="pagos-calendar-month-title">{monthName}</span>
        <div className="pagos-calendar-nav">
          <button
            type="button"
            className="pagos-calendar-nav-btn"
            onClick={handlePrevMonth}
            title="Mes anterior"
            aria-label="Mes anterior"
          >
            ↑
          </button>
          <button
            type="button"
            className="pagos-calendar-nav-btn"
            onClick={handleNextMonth}
            title="Mes siguiente"
            aria-label="Mes siguiente"
          >
            ↓
          </button>
        </div>
      </div>

      <div className="pagos-calendar-weekdays" aria-hidden="true">
        <span>LU</span>
        <span>MA</span>
        <span>MI</span>
        <span>JU</span>
        <span>VI</span>
        <span>SA</span>
        <span>DO</span>
      </div>

      <div className="pagos-calendar-grid" role="grid">
        {prevDays.map((item) => (
          <button
            key={`prev-${item.dateStr}`}
            type="button"
            className={getDayClasses(item.dateStr, true)}
            onClick={() => handleSelectDay(item.dateStr, true)}
            aria-label={`${item.day} de mes anterior`}
          >
            {item.day}
          </button>
        ))}

        {currentDays.map((item) => {
          const isSelected = item.dateStr === range.desde || item.dateStr === range.hasta
          return (
            <button
              key={`curr-${item.dateStr}`}
              type="button"
              className={getDayClasses(item.dateStr, false)}
              onClick={() => handleSelectDay(item.dateStr, false)}
              aria-label={`${item.day} de ${monthName}`}
              aria-pressed={isSelected}
            >
              {item.day}
            </button>
          )
        })}

        {nextDays.map((item) => (
          <button
            key={`next-${item.dateStr}`}
            type="button"
            className={getDayClasses(item.dateStr, true)}
            onClick={() => handleSelectDay(item.dateStr, true)}
            aria-label={`${item.day} de mes siguiente`}
          >
            {item.day}
          </button>
        ))}
      </div>

      <div className="pagos-calendar-footer">
        <button
          type="button"
          className="pagos-calendar-footer-btn"
          onClick={onClear}
        >
          Borrar
        </button>
        <button
          type="button"
          className="pagos-calendar-footer-btn"
          onClick={onToday}
        >
          Hoy
        </button>
      </div>
    </div>
  )
}
