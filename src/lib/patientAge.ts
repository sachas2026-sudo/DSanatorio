import { differenceInYears, format, parseISO } from 'date-fns'

/** yyyy-MM-dd del input type="date", interpretado en calendario local. */
function parseBirthDateLocal(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const birth = parseISO(`${ymd}T12:00:00`)
  return Number.isNaN(birth.getTime()) ? null : birth
}

function parseTodayLocal(refDate: Date): Date {
  return parseISO(`${format(refDate, 'yyyy-MM-dd')}T12:00:00`)
}

/** Edad en años cumplidos: fecha actual − F. nacimiento. */
export function edadDesdeFechaNacimiento(
  fechaNacimiento: string,
  refDate: Date = new Date(),
): number | null {
  const raw = fechaNacimiento?.trim() ?? ''
  if (!raw) return null

  const birth = parseBirthDateLocal(raw)
  if (!birth) return null

  const today = parseTodayLocal(refDate)
  if (birth > today) return null

  const years = differenceInYears(today, birth)
  return Number.isFinite(years) && years >= 0 ? years : null
}

export function edadDesdeFechaNacimientoLabel(
  fechaNacimiento: string,
  refDate: Date = new Date(),
): string {
  const years = edadDesdeFechaNacimiento(fechaNacimiento, refDate)
  return years == null ? '' : String(years)
}
