import { addMonths, addWeeks, startOfWeek } from 'date-fns'
import type { Dispatch, SetStateAction } from 'react'

// Navegación de semana y días en Agenda Turnos
type WeekNavProps = {
  setWeekCursor: Dispatch<SetStateAction<Date>>
  onGoToday: () => void
}

export function AgendaTurnosWeekNav({ setWeekCursor, onGoToday }: WeekNavProps) {
  return (
    <div className="week-nav week-nav--after-day-title" aria-label="Cambiar semana">
      <button
        type="button"
        className="week-nav__arrow week-nav__btn--celeste"
        aria-label="Semana anterior"
        onClick={() => setWeekCursor((d) => addWeeks(d, -1))}
      >
        ‹
      </button>
      <button
        type="button"
        className="week-nav__pill week-nav__btn--verde"
        onClick={onGoToday}
      >
        Hoy
      </button>
      <button
        type="button"
        className="week-nav__arrow week-nav__btn--lila"
        aria-label="Semana siguiente"
        onClick={() => setWeekCursor((d) => addWeeks(d, 1))}
      >
        ›
      </button>
      <button
        type="button"
        className="week-nav__pill week-nav__btn--lila"
        onClick={() =>
          setWeekCursor((d) =>
            startOfWeek(addMonths(d, -1), { weekStartsOn: 1 }),
          )
        }
      >
        Mes Anterior
      </button>
      <button
        type="button"
        className="week-nav__pill week-nav__btn--naranja"
        onClick={() =>
          setWeekCursor((d) =>
            startOfWeek(addMonths(d, 1), { weekStartsOn: 1 }),
          )
        }
      >
        Mes Siguiente
      </button>
    </div>
  )
}

type DayNavProps = {
  goAdjacentDay: (delta: 1 | -1) => void
}

export function AgendaTurnosDayNavPrev({ goAdjacentDay }: DayNavProps) {
  return (
    <button
      type="button"
      className="day-list__day-nav-btn"
      aria-label="Día anterior"
      onClick={() => goAdjacentDay(-1)}
    >
      ‹
    </button>
  )
}

export function AgendaTurnosDayNavNext({ goAdjacentDay }: DayNavProps) {
  return (
    <button
      type="button"
      className="day-list__day-nav-btn"
      aria-label="Día siguiente"
      onClick={() => goAdjacentDay(1)}
    >
      ›
    </button>
  )
}
