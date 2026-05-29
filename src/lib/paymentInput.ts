import { formatMonto } from './formatMonto'

export const PAYMENT_METODOS = [
  'Efectivo',
  'Tarjeta',
  'Transferencia',
  'Obra social',
  'Otro',
] as const

export type PaymentMetodo = (typeof PAYMENT_METODOS)[number]

export function parseMontoInput(value: string): number {
  const norm = (value ?? '').replace(/\./g, '').replace(/\$/g, '').trim()
  const n = Number(norm.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function formatMontoFieldInput(raw: string): string {
  if (!raw.trim()) return ''
  const norm = raw.replace(/\./g, '').replace(/\$/g, '').trim()
  const parsed = Number(norm.replace(',', '.'))
  if (!Number.isFinite(parsed)) return raw
  return parsed <= 0 ? '' : formatMonto(parsed)
}
