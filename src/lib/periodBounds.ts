import {
  endOfDay,
  endOfMonth,
  endOfYear,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
} from 'date-fns'
import { es } from 'date-fns/locale'

export type Periodo = 'dia' | 'mes' | 'anio'

export function periodBounds(p: Periodo, ref: Date) {
  if (p === 'dia') {
    const a = startOfDay(ref)
    const b = endOfDay(ref)
    return { start: a, end: b, label: format(a, "d MMMM yyyy", { locale: es }) }
  }
  if (p === 'mes') {
    const a = startOfMonth(ref)
    const b = endOfMonth(ref)
    return {
      start: a,
      end: b,
      label: format(a, 'MMMM yyyy', { locale: es }),
    }
  }
  const a = startOfYear(ref)
  const b = endOfYear(ref)
  return {
    start: a,
    end: b,
    label: format(a, 'yyyy', { locale: es }),
  }
}

/** Rango libre entre dos fechas (yyyy-MM-dd), inclusive. */
export function dateRangeBounds(desde: string, hasta: string) {
  let start = parseISO(`${desde}T00:00:00`)
  let end = parseISO(`${hasta}T23:59:59.999`)
  if (end.getTime() < start.getTime()) {
    start = parseISO(`${hasta}T00:00:00`)
    end = parseISO(`${desde}T23:59:59.999`)
    ;[desde, hasta] = [hasta, desde]
  }
  const label =
    desde === hasta
      ? format(start, "d MMMM yyyy", { locale: es })
      : `${format(start, 'd MMMM', { locale: es })} al ${format(end, 'd MMMM yyyy', { locale: es })}`
  return { start, end, label }
}
