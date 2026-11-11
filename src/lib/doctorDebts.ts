import { parseISO, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { aggregateResumenSettlementForPayments } from './paymentPorcentaje'
import type { Doctor, DoctorDebtPayment, Payment } from '../types'

export type DebtRow = {
  key: string
  doctorId: string
  doctorLabel: string
  fecha: string
  fechaLabel: string
  concepto: string
  deuda: number
  pagado: number
  fechaPago: string
  saldo: number
}

function dateKey(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * Construye las deudas por médico a partir de los pagos cobrados, cruzándolas
 * con los pagos de deuda que ya se registraron en "Gestión de Deudas por
 * Médico". Reusado por el modal y por el listado de pagos (para marcar el
 * "% Cuidar" negativo como pagado en verde).
 */
export function buildDebtRows(
  payments: Payment[],
  debtPayments: DoctorDebtPayment[],
  doctors: Doctor[],
): DebtRow[] {
  const doctorById = new Map(doctors.map((doctor) => [doctor.id, doctor]))
  const grouped = new Map<string, Payment[]>()
  for (const payment of payments) {
    if (payment.monto <= 0) continue
    const key = `${payment.doctorId}__${dateKey(payment.fecha)}`
    const list = grouped.get(key) ?? []
    list.push(payment)
    grouped.set(key, list)
  }

  return [...grouped.entries()]
    .map(([key, list]) => {
      const doctor = doctorById.get(list[0]?.doctorId ?? '')
      const settlement = aggregateResumenSettlementForPayments(
        list,
        () => doctor?.porcentaje,
        () => doctor,
      )
      const deuda = Math.max(0, -settlement.efectivoAEntregar)
      const pagosDeuda = debtPayments.filter((payment) => payment.deudaKey === key)
      const pagado = pagosDeuda.reduce((sum, payment) => sum + payment.monto, 0)
      const fecha = dateKey(list[0]?.fecha ?? '')
      // Último pago aplicado: la fecha más reciente de los que cancelaron
      // esta deuda. Vacía si todavía no se pagó nada.
      const fechaPago = pagosDeuda.reduce((ultima, payment) => {
        const d = dateKey(payment.fecha ?? '')
        return d > ultima ? d : ultima
      }, '')
      return {
        key,
        doctorId: list[0]?.doctorId ?? '',
        doctorLabel: doctor
          ? `${doctor.apellido}, ${doctor.nombre}`
          : 'Médico no encontrado',
        fecha,
        fechaLabel: fecha ? format(parseISO(`${fecha}T12:00:00`), 'dd/MM/yyyy', { locale: es }) : 'Sin fecha',
        concepto: 'Comisión pendiente',
        deuda,
        pagado: Math.min(deuda, pagado),
        fechaPago: fechaPago
          ? format(parseISO(`${fechaPago}T12:00:00`), 'dd-MM-yy', { locale: es })
          : '',
        saldo: Math.max(0, deuda - pagado),
      }
    })
    .filter((row) => row.deuda > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.doctorLabel.localeCompare(b.doctorLabel, 'es'))
}
