import {
  addDays,
  endOfDay,
  endOfMonth,
  format,
  isSameDay,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfMonth,
} from 'date-fns'
import { isDoctorAgendaMensual } from './doctorAgenda'
import {
  sumPagosNetTotalByDoctor,
} from './pagosPdfLayout'
import type { AppData, Payment } from '../types'

export type PanelCobranzasMes = {
  total: number
  cantidad: number
  totalFacturado: number
}

export type PanelCobranzasDia = {
  total: number
  totalConDescuentos: number
  cantidad: number
}

export type PanelPagoDiaBar = {
  /** Día en formato dd-MM */
  dia: string
  total: number
}

function parseDayInMonth(ymd: string, monthStart: Date, monthEnd: Date): Date | null {
  try {
    const d = parseISO(`${ymd}T12:00:00`)
    if (!isWithinInterval(d, { start: monthStart, end: monthEnd })) return null
    return endOfDay(d)
  } catch {
    return null
  }
}

/** Último día del mes en que el médico cobró / atendió (tope: hoy o fin de mes). */
export function doctorCobroCutoffInMonth(
  doctorId: string,
  data: AppData,
  monthStart: Date,
  monthEnd: Date,
  refDate: Date,
): Date | null {
  const doctor = data.doctors.find((d) => d.id === doctorId)
  if (!doctor) return null

  const cap = endOfDay(refDate.getTime() <= monthEnd.getTime() ? refDate : monthEnd)
  const candidates: Date[] = []

  const pushPaymentDays = () => {
    for (const p of data.payments) {
      if (p.doctorId !== doctorId) continue
      const t = parseISO(p.fecha)
      if (!isWithinInterval(t, { start: monthStart, end: monthEnd })) continue
      candidates.push(endOfDay(t))
    }
  }

  const pushAppointmentDays = () => {
    for (const c of data.appointments) {
      if (c.doctorId !== doctorId || c.estado === 'cancelado') continue
      const t = parseISO(c.fechaHora)
      if (!isWithinInterval(t, { start: monthStart, end: monthEnd })) continue
      candidates.push(endOfDay(t))
    }
  }

  const pushAtencionDays = () => {
    for (const a of data.atencionesMensuales) {
      if (a.doctorId !== doctorId) continue
      const d = parseDayInMonth(a.fecha, monthStart, monthEnd)
      if (d) candidates.push(d)
    }
  }

  if (isDoctorAgendaMensual(doctor)) {
    pushAtencionDays()
    if (candidates.length === 0) {
      pushAppointmentDays()
      pushPaymentDays()
    }
  } else {
    pushAppointmentDays()
    pushPaymentDays()
  }

  if (candidates.length === 0) return null

  const max = candidates.reduce((best, d) => (d.getTime() > best.getTime() ? d : best))
  return max.getTime() <= cap.getTime() ? max : cap
}

/** Pagos del mes por médico: del día 1 hasta su fecha de cobro/atención. */
export function filterPaymentsPanelMes(
  data: AppData,
  refDate: Date = new Date(),
): Payment[] {
  const monthStart = startOfMonth(refDate)
  const monthEnd = endOfMonth(refDate)
  const doctorIds = [...new Set(data.payments.map((p) => p.doctorId))]

  const out: Payment[] = []
  for (const doctorId of doctorIds) {
    const cutoff = doctorCobroCutoffInMonth(
      doctorId,
      data,
      monthStart,
      monthEnd,
      refDate,
    )
    if (!cutoff) continue

    for (const p of data.payments) {
      if (p.doctorId !== doctorId) continue
      const t = parseISO(p.fecha)
      if (
        isWithinInterval(t, {
          start: monthStart,
          end: cutoff,
        })
      ) {
        out.push(p)
      }
    }
  }

  return out
}

/** Pagos del mes calendario (todos los del mes), igual pastilla Pagos del Mes. */
export function filterPaymentsMesCalendario(
  data: AppData,
  refDate: Date = new Date(),
): Payment[] {
  const monthStart = startOfMonth(refDate)
  const monthEnd = endOfMonth(refDate)
  return data.payments.filter((p) => {
    const t = parseISO(p.fecha)
    return isWithinInterval(t, { start: monthStart, end: monthEnd })
  })
}

/** Pagos del día calendario (pastilla Pagos del Día). */
export function filterPaymentsDia(
  data: AppData,
  refDate: Date = new Date(),
): Payment[] {
  const dayStart = startOfDay(refDate)
  const dayEnd = endOfDay(refDate)
  return data.payments.filter((p) => {
    const t = parseISO(p.fecha)
    return isWithinInterval(t, { start: dayStart, end: dayEnd })
  })
}

/** Pagos del día calendario (pastilla Pagos del Día). */
export function computePagosDia(
  data: AppData,
  refDate: Date = new Date(),
): PanelCobranzasDia {
  const payments = filterPaymentsDia(data, refDate)
  const total = payments.reduce((s, p) => s + p.monto, 0)
  const totalConDescuentos = sumPagosNetTotalByDoctor(payments, (doctorId) =>
    data.doctors.find((d) => d.id === doctorId)?.porcentaje,
  )
  return {
    total: Math.round(total * 100) / 100,
    totalConDescuentos,
    cantidad: payments.length,
  }
}

/** Cobranza bruta por día del mes. */
export function computePagosPorDiaMes(
  data: AppData,
  refDate: Date = new Date(),
): PanelPagoDiaBar[] {
  const monthStart = startOfMonth(refDate)
  const monthEnd = endOfMonth(refDate)
  const cap = endOfDay(
    refDate.getTime() <= monthEnd.getTime() ? refDate : monthEnd,
  )
  const out: PanelPagoDiaBar[] = []

  for (let d = monthStart; d.getTime() <= cap.getTime(); d = addDays(d, 1)) {
    const total = data.payments
      .filter((p) => {
        try {
          return isSameDay(parseISO(p.fecha), d)
        } catch {
          return false
        }
      })
      .reduce((s, p) => s + p.monto, 0)
    out.push({
      dia: format(d, 'dd-MM'),
      total: Math.round(total * 100) / 100,
    })
  }

  return out
}

/** Total con descuentos del mes (pastilla Pagos del Mes). */
export function computePagosMesConDescuentos(
  data: AppData,
  refDate: Date = new Date(),
  doctorIdFilter?: string,
): PanelCobranzasMes {
  let payments = filterPaymentsMesCalendario(data, refDate)
  if (doctorIdFilter) {
    payments = payments.filter((p) => p.doctorId === doctorIdFilter)
  }
  const totalFacturado = payments.reduce((s, p) => s + p.monto, 0)
  const total = sumPagosNetTotalByDoctor(payments, (doctorId) =>
    data.doctors.find((d) => d.id === doctorId)?.porcentaje,
  )

  return {
    total,
    cantidad: payments.length,
    totalFacturado: Math.round(totalFacturado * 100) / 100,
  }
}

/** Total neto del mes por médico hasta su fecha de cobro (criterio PDF «Total general»). */
export function computePanelCobranzasMes(
  data: AppData,
  refDate: Date = new Date(),
): PanelCobranzasMes {
  const payments = filterPaymentsPanelMes(data, refDate)
  const totalFacturado = payments.reduce((s, p) => s + p.monto, 0)
  const total = sumPagosNetTotalByDoctor(payments, (doctorId) =>
    data.doctors.find((d) => d.id === doctorId)?.porcentaje,
  )

  return {
    total,
    cantidad: payments.length,
    totalFacturado: Math.round(totalFacturado * 100) / 100,
  }
}
