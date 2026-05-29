import { parseISO } from 'date-fns'

/** parseISO que no rompe la app si la fecha del JSON es inválida. */
export function safeParseISO(value: string): Date | null {
  if (!value?.trim()) return null
  const d = parseISO(value)
  return Number.isNaN(d.getTime()) ? null : d
}
