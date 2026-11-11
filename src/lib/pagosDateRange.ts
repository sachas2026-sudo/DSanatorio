/**
 * Lógica pura para el selector de rango de fechas de Pagos de Consultas.
 * Trabaja con fechas locales 'YYYY-MM-DD' para evitar desfases de huso horario (ej. UTC-3).
 */

export type DateRangeTarget = 'desde' | 'hasta'
export type DatePresetType = 'hoy' | 'ayer' | 'semana' | 'mes' | 'mes-anterior' | 'anio'

export interface DateRangeState {
  desde: string // 'YYYY-MM-DD' o ''
  hasta: string // 'YYYY-MM-DD' o ''
  activeTarget: DateRangeTarget
  isRangeComplete: boolean
}

export interface LocalDateParts {
  year: number
  month: number // 1-12
  day: number // 1-31
}

const SHORT_MONTHS_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

/**
 * Parsea una cadena 'YYYY-MM-DD' a componentes numéricos locales sin pasar por UTC.
 */
export function parseYMD(dateStr: string): LocalDateParts | null {
  if (!dateStr || typeof dateStr !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/**
 * Formatea componentes numéricos a 'YYYY-MM-DD'.
 */
export function formatYMD(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0')
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Crea una fecha Date local al mediodía (12:00) para evitar desbordes por horario de verano.
 */
export function toLocalNoonDate(dateStr: string): Date {
  const parsed = parseYMD(dateStr)
  if (!parsed) return new Date()
  return new Date(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0)
}

/**
 * Formato del recuadro: "05 nov 2026"
 */
export function formatRecuadroDate(dateStr: string): string {
  const parsed = parseYMD(dateStr)
  if (!parsed) return '—'
  const dayStr = String(parsed.day).padStart(2, '0')
  const monthStr = SHORT_MONTHS_ES[parsed.month - 1] || ''
  return `${dayStr} ${monthStr} ${parsed.year}`
}

/**
 * Formato dd/MM/yyyy: "05/11/2026"
 */
export function formatButtonDate(dateStr: string): string {
  const parsed = parseYMD(dateStr)
  if (!parsed) return '—'
  const dayStr = String(parsed.day).padStart(2, '0')
  const monthStr = String(parsed.month).padStart(2, '0')
  return `${dayStr}/${monthStr}/${parsed.year}`
}

/**
 * Formato del botón del selector: "05/11/2026 - 05/11/2026"
 */
export function formatDateRangeButtonText(desde: string, hasta: string): string {
  if (!desde && !hasta) return 'Seleccionar fechas'
  const d = formatButtonDate(desde)
  const h = formatButtonDate(hasta || desde)
  return `${d} - ${h}`
}

/**
 * Calcula el siguiente estado al tocar un día en el calendario según las reglas:
 * 1) Con rango completo: empieza un nuevo rango (desde=día, hasta=día, activo='hasta', no completo).
 * 2) Con activo 'desde': guarda 'desde'. Si 'hasta' estaba vacío o era anterior a ese día, hasta toma el mismo día. Pasa activo a 'hasta'.
 * 3) Con activo 'hasta': si día >= desde, guarda 'hasta', rango completo. Si día < desde, intercambia (día es desde, desde anterior es hasta), rango completo.
 */
export function nextRangeState(state: DateRangeState, clickedDate: string): DateRangeState {
  if (!clickedDate) return state

  // Regla 5: Si con el rango completo el usuario toca otro día: empieza un rango nuevo
  if (state.isRangeComplete) {
    return {
      desde: clickedDate,
      hasta: clickedDate,
      activeTarget: 'hasta',
      isRangeComplete: false,
    }
  }

  // Regla 2: Tocar un día con DESDE activo
  if (state.activeTarget === 'desde') {
    const newHasta = !state.hasta || state.hasta < clickedDate ? clickedDate : state.hasta
    return {
      desde: clickedDate,
      hasta: newHasta,
      activeTarget: 'hasta',
      isRangeComplete: false,
    }
  }

  // Regla 3: Tocar un día con HASTA activo
  const currentDesde = state.desde || clickedDate
  if (clickedDate >= currentDesde) {
    return {
      desde: currentDesde,
      hasta: clickedDate,
      activeTarget: 'hasta',
      isRangeComplete: true,
    }
  } else {
    // Si es anterior a DESDE, se intercambian
    return {
      desde: clickedDate,
      hasta: currentDesde,
      activeTarget: 'hasta',
      isRangeComplete: true,
    }
  }
}

/**
 * Regla 6: Tocar el recuadro DESDE o HASTA lo activa para editarlo (quita "rango completo", conserva fechas).
 */
export function activateTarget(state: DateRangeState, target: DateRangeTarget): DateRangeState {
  return {
    ...state,
    activeTarget: target,
    isRangeComplete: false,
  }
}

/**
 * Regla 9: "Borrar": vacía ambas fechas, activo = DESDE.
 */
export function clearRange(): DateRangeState {
  return {
    desde: '',
    hasta: '',
    activeTarget: 'desde',
    isRangeComplete: false,
  }
}

/**
 * Regla 9: "Hoy" (abajo a la derecha): DESDE = HASTA = hoy, rango completo.
 */
export function setTodayRange(todayStr: string): DateRangeState {
  return {
    desde: todayStr,
    hasta: todayStr,
    activeTarget: 'hasta',
    isRangeComplete: true,
  }
}

/**
 * Regla 11: "Listo": aplica el rango. Si DESDE está elegido pero HASTA no, o rango incompleto, usa HASTA = DESDE.
 */
export function resolveListoRange(state: DateRangeState): { desde: string; hasta: string } {
  if (!state.desde && !state.hasta) {
    return { desde: '', hasta: '' }
  }
  if (!state.desde && state.hasta) {
    return { desde: state.hasta, hasta: state.hasta }
  }
  if (!state.isRangeComplete || !state.hasta) {
    return { desde: state.desde, hasta: state.desde }
  }
  return { desde: state.desde, hasta: state.hasta }
}

/**
 * Divide el mes en semanas según la lógica de Pagos (días 1-7, 8-14, 15-21, 22-28, 29-fin).
 */
export function getSemanaMesRange(d: Date = new Date()): { desde: string; hasta: string } {
  const y = d.getFullYear()
  const m = d.getMonth()
  const day = d.getDate()
  const lastDayOfMonth = new Date(y, m + 1, 0).getDate()

  let startDay = 1
  let endDay = 7

  if (day <= 7) {
    startDay = 1
    endDay = Math.min(7, lastDayOfMonth)
  } else if (day <= 14) {
    startDay = 8
    endDay = Math.min(14, lastDayOfMonth)
  } else if (day <= 21) {
    startDay = 15
    endDay = Math.min(21, lastDayOfMonth)
  } else if (day <= 28) {
    startDay = 22
    endDay = Math.min(28, lastDayOfMonth)
  } else {
    startDay = 29
    endDay = lastDayOfMonth
  }

  const desde = formatYMD(y, m + 1, startDay)
  const hasta = formatYMD(y, m + 1, endDay)
  return { desde, hasta }
}

/**
 * Regla 8: Atajos (Hoy, Ayer, Esta semana, Este mes, Mes anterior, Este año).
 * Completan DESDE y HASTA de una vez, rango completo.
 */
export function getPresetDateRange(
  type: DatePresetType,
  now: Date = new Date(),
): { desde: string; hasta: string } {
  const y = now.getFullYear()
  const m = now.getMonth() // 0-11
  const d = now.getDate()

  if (type === 'hoy') {
    const str = formatYMD(y, m + 1, d)
    return { desde: str, hasta: str }
  } else if (type === 'ayer') {
    const yesterday = new Date(y, m, d - 1)
    const str = formatYMD(yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate())
    return { desde: str, hasta: str }
  } else if (type === 'semana') {
    return getSemanaMesRange(now)
  } else if (type === 'mes') {
    const firstStr = formatYMD(y, m + 1, 1)
    const lastDay = new Date(y, m + 1, 0).getDate()
    const lastStr = formatYMD(y, m + 1, lastDay)
    return { desde: firstStr, hasta: lastStr }
  } else if (type === 'mes-anterior') {
    const prevMonthDate = new Date(y, m - 1, 1)
    const prevY = prevMonthDate.getFullYear()
    const prevM = prevMonthDate.getMonth()
    const firstStr = formatYMD(prevY, prevM + 1, 1)
    const lastDay = new Date(prevY, prevM + 1, 0).getDate()
    const lastStr = formatYMD(prevY, prevM + 1, lastDay)
    return { desde: firstStr, hasta: lastStr }
  } else if (type === 'anio') {
    return {
      desde: formatYMD(y, 1, 1),
      hasta: formatYMD(y, 12, 31),
    }
  }

  const def = formatYMD(y, m + 1, d)
  return { desde: def, hasta: def }
}

/**
 * Navegación de mes del calendario (↑ mes anterior, ↓ mes siguiente).
 */
export function getPrevMonth(currentYear: number, currentMonthZeroBased: number): { year: number; monthZeroBased: number } {
  if (currentMonthZeroBased === 0) {
    return { year: currentYear - 1, monthZeroBased: 11 }
  }
  return { year: currentYear, monthZeroBased: currentMonthZeroBased - 1 }
}

export function getNextMonth(currentYear: number, currentMonthZeroBased: number): { year: number; monthZeroBased: number } {
  if (currentMonthZeroBased === 11) {
    return { year: currentYear + 1, monthZeroBased: 0 }
  }
  return { year: currentYear, monthZeroBased: currentMonthZeroBased + 1 }
}

