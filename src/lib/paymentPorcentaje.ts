import type { Doctor, PagoCancelado, Payment } from '../types'
import {
  buildPaymentsSettlementMap,
  computeDoctorPorcentajeSettlement,
  countDistinctPagos,
  esPagoTransferencia,
  resolveDoctorPaymentSettlement,
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
  if (!porcentajeLabel || porcentajeLabel.trim() === '') return '—'
  if (porcentajeLabel === 'Var.') return porcentajeLabel
  return porcentajeLabel.replace(/%$/, '')
}

/** Filas del resumen «Rendición» por médico (última hoja PDF todos los médicos). */
export function buildRendicionDoctorRows(
  payments: Payment[],
  doctorLabel: (doctorId: string) => string,
  doctorPorcentaje?: (doctorId: string) => number | undefined,
  doctorResolver?: (doctorId: string) => Doctor | undefined,
  obraSocialResolver?: (payment: Payment) => string | undefined,
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
      const doc = doctorResolver?.(doctorId)
      const docGetter = doc ? () => doc : undefined
      const settlement = aggregateResumenSettlementForPayments(
        list,
        pctFallback,
        docGetter,
        obraSocialResolver,
      )
      const pctAgg = aggregatePorcentajeSettlementForPayments(
        list,
        pctFallback,
        docGetter,
        obraSocialResolver,
      )
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
  doctorResolver?: (doctorId: string) => Doctor | undefined,
  obraSocialResolver?: (payment: Payment) => string | undefined,
): AggregatedPorcentajeSettlement {
  const settlementMap = buildPaymentsSettlementMap(
    payments,
    (doctorResolver ?? doctorPorcentaje) as any,
    obraSocialResolver,
  )
  let totalPorcentaje = 0
  let totalGeneral = 0
  const pctSet = new Set<number>()
  let hasFixed = false
  for (const p of payments) {
    if (p.monto <= 0) continue
    const s = settlementMap.get(p.id) ?? (
      doctorResolver?.(p.doctorId)
        ? resolveDoctorPaymentSettlement(p, doctorResolver(p.doctorId), obraSocialResolver?.(p))
        : computeDoctorPorcentajeSettlement(
            p.monto,
            resolvePaymentPorcentaje(p, doctorPorcentaje?.(p.doctorId)) ?? 0,
          )
    )
    if (s.esMontoFijo) {
      hasFixed = true
    } else if (s.porcentaje > 0) {
      pctSet.add(s.porcentaje)
    }
    totalPorcentaje += s.totalPorcentaje
    totalGeneral += s.totalGeneral
  }
  totalPorcentaje = Math.round(totalPorcentaje * 100) / 100
  totalGeneral = Math.round(totalGeneral * 100) / 100
  const porcentaje = pctSet.size === 1 ? ([...pctSet][0] ?? 0) : 0
  const porcentajeLabel = hasFixed
    ? pctSet.size === 0
      ? ''
      : 'Var.'
    : pctSet.size === 0
      ? '0%'
      : pctSet.size === 1
        ? `${porcentaje}%`
        : 'Var.'
  return {
    porcentaje,
    totalPorcentaje,
    totalGeneral,
    porcentajeLabel,
    esMontoFijo: hasFixed && pctSet.size === 0,
  }
}

export function aggregateResumenSettlementForPayments(
  payments: Payment[],
  doctorPorcentaje?: (doctorId: string) => number | undefined,
  doctorResolver?: (doctorId: string) => Doctor | undefined,
  obraSocialResolver?: (payment: Payment) => string | undefined,
): DoctorResumenSettlement {
  const agg = aggregatePorcentajeSettlementForPayments(
    payments,
    doctorPorcentaje,
    doctorResolver,
    obraSocialResolver,
  )
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
