import type { PagoCancelado, Payment } from '../types'
import {
  computeDoctorPorcentajeSettlement,
  countDistinctPagos,
  esPagoTransferencia,
  resolvePaymentPorcentaje,
  sumPagosEfectivo,
  sumPagosTransferencia,
  type DoctorPorcentajeSettlement,
  type DoctorResumenSettlement,
} from './pagosPdfLayout'

export { parsePorcentajeAplicado } from './paymentPorcentajeParse'

export type RendicionDoctorRow = {
  medico: string
  porcentajeLabel: string
  cantidadPagos: number
  transferencias: number
  efectivo: number
  totalCobrado: number
  totalMedico: number
  totalCentroCuidar: number
}

function rendicionPorcentajeCell(porcentajeLabel: string): string {
  if (porcentajeLabel === 'Var.') return porcentajeLabel
  return porcentajeLabel.replace(/%$/, '')
}

/** Filas del resumen «Rendición» por médico (última hoja PDF todos los médicos). */
export function buildRendicionDoctorRows(
  payments: Payment[],
  doctorLabel: (doctorId: string) => string,
  doctorPorcentaje?: (doctorId: string) => number | undefined,
): RendicionDoctorRow[] {
  const byDoctor = new Map<string, Payment[]>()
  for (const p of payments) {
    const list = byDoctor.get(p.doctorId) ?? []
    list.push(p)
    byDoctor.set(p.doctorId, list)
  }

  return [...byDoctor.keys()]
    .sort((a, b) => doctorLabel(a).localeCompare(doctorLabel(b), 'es'))
    .map((doctorId) => {
      const list = byDoctor.get(doctorId) ?? []
      const pctFallback = () => doctorPorcentaje?.(doctorId)
      const settlement = aggregateResumenSettlementForPayments(list, pctFallback)
      const pctAgg = aggregatePorcentajeSettlementForPayments(list, pctFallback)
      const efectivo = Math.round(sumPagosEfectivo(list) * 100) / 100
      return {
        medico: doctorLabel(doctorId),
        porcentajeLabel: rendicionPorcentajeCell(pctAgg.porcentajeLabel),
        cantidadPagos: list.length,
        transferencias: settlement.transferencias,
        efectivo,
        totalCobrado: settlement.facturado,
        totalMedico: settlement.efectivoAEntregar,
        totalCentroCuidar: settlement.comision,
      }
    })
}

export type AggregatedPorcentajeSettlement = DoctorPorcentajeSettlement & {
  porcentajeLabel: string
}

export function aggregatePorcentajeSettlementForPayments(
  payments: Payment[],
  doctorPorcentaje?: (doctorId: string) => number | undefined,
): AggregatedPorcentajeSettlement {
  let totalPorcentaje = 0
  let totalGeneral = 0
  const pctSet = new Set<number>()
  for (const p of payments) {
    if (p.monto <= 0) continue
    const pct =
      resolvePaymentPorcentaje(p, doctorPorcentaje?.(p.doctorId)) ?? 0
    pctSet.add(pct)
    const s = computeDoctorPorcentajeSettlement(p.monto, pct)
    totalPorcentaje += s.totalPorcentaje
    totalGeneral += s.totalGeneral
  }
  totalPorcentaje = Math.round(totalPorcentaje * 100) / 100
  totalGeneral = Math.round(totalGeneral * 100) / 100
  const porcentaje = pctSet.size === 1 ? ([...pctSet][0] ?? 0) : 0
  const porcentajeLabel =
    pctSet.size === 0
      ? '0%'
      : pctSet.size === 1
        ? `${porcentaje}%`
        : 'Var.'
  return { porcentaje, totalPorcentaje, totalGeneral, porcentajeLabel }
}

export function aggregateResumenSettlementForPayments(
  payments: Payment[],
  doctorPorcentaje?: (doctorId: string) => number | undefined,
): DoctorResumenSettlement {
  const agg = aggregatePorcentajeSettlementForPayments(payments, doctorPorcentaje)
  const facturado = payments.reduce((s, p) => s + p.monto, 0)
  const transferencias = sumPagosTransferencia(payments)
  const efectivoAEntregar =
    Math.round((facturado - agg.totalPorcentaje - transferencias) * 100) / 100
  return {
    facturado,
    porcentaje: agg.porcentaje,
    comision: agg.totalPorcentaje,
    transferencias,
    efectivoAEntregar,
  }
}

/**
 * ¿Todos los pagos del listado son por transferencia?
 *
 * Cuando sí, la columna "% Cuidar" muestra el importe en negativo: si la plata
 * nunca pasa por caja, lo que se le separa al médico sale del lado del centro
 * y no es una deuda para él. Con un solo pago en efectivo el listado vuelve a
 * mostrar los importes positivos.
 */
export function sonTodosTransferencia(payments: Payment[]): boolean {
  return payments.length > 0 && payments.every((p) => esPagoTransferencia(p.metodo))
}

export function migratePaymentsPorcentajeAplicado(data: {
  doctors: { id: string; porcentaje?: number }[]
  payments: Payment[]
  pagosCancelados: PagoCancelado[]
}): {
  payments: Payment[]
  pagosCancelados: PagoCancelado[]
  changed: boolean
} {
  const doctorsById = new Map(data.doctors.map((d) => [d.id, d]))
  let changed = false

  const payments = data.payments.map((p) => {
    if (p.porcentajeAplicado != null) return p
    const pct = doctorsById.get(p.doctorId)?.porcentaje
    if (pct == null) return p
    changed = true
    return { ...p, porcentajeAplicado: pct }
  })

  const pagosCancelados = data.pagosCancelados.map((row) => {
    const p = row.payment
    if (p.porcentajeAplicado != null) return row
    const pct = doctorsById.get(p.doctorId)?.porcentaje
    if (pct == null) return row
    changed = true
    return { ...row, payment: { ...p, porcentajeAplicado: pct } }
  })

  return { payments, pagosCancelados, changed }
}
