import type { Payment } from '../types'
import { formatMonto } from './formatMonto'

export function paymentsForCita(
  payments: Payment[],
  citaId: string,
): Payment[] {
  return payments.filter((p) => p.citaId === citaId)
}

/** Texto compacto: $1.500 · Efectivo + $500 · Tarjeta */
export function formatPagosLine(payments: Payment[]): string {
  if (payments.length === 0) return ''
  if (payments.length === 1) {
    const p = payments[0]!
    return `${formatMonto(p.monto)}${p.metodo ? ` · ${p.metodo}` : ''}`
  }
  return payments
    .map((p) => `${formatMonto(p.monto)}${p.metodo ? ` · ${p.metodo}` : ''}`)
    .join(' + ')
}

export function totalPagosMonto(payments: Payment[]): number {
  return payments.reduce((s, p) => s + p.monto, 0)
}
