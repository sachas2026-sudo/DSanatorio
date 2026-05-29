import { addDays, isWithinInterval, subMonths } from 'date-fns'
import { periodBounds } from './periodBounds'
import { safeParseISO } from './safeParseDate'
import type { AppData, Appointment } from '../types'

export type HomeStats = {
  ingresosHoy: number
  ingresosMes: number
  ingresosMesAnterior: number
  mesLabel: string
  mesAnteriorLabel: string
  turnosMes: { programado: number; atendido: number; cancelado: number }
  topObrasSociales: { nombre: string; cantidad: number }[]
}

export type HomeAlertTurno = {
  id: string
  fechaHora: string
  patientLabel: string
  doctorLabel: string
}

export type HomeAlerts = {
  turnosManana: HomeAlertTurno[]
  atendidosSinPago: HomeAlertTurno[]
}

function sumPaymentsInInterval(
  payments: AppData['payments'],
  start: Date,
  end: Date,
): number {
  return payments.reduce((s, p) => {
    const t = safeParseISO(p.fecha)
    if (!t) return s
    return isWithinInterval(t, { start, end }) ? s + p.monto : 0
  }, 0)
}

function countTurnosMes(
  appointments: Appointment[],
  start: Date,
  end: Date,
): HomeStats['turnosMes'] {
  const out = { programado: 0, atendido: 0, cancelado: 0 }
  for (const c of appointments) {
    const t = safeParseISO(c.fechaHora)
    if (!t || !isWithinInterval(t, { start, end })) continue
    if (c.estado === 'programado') out.programado += 1
    else if (c.estado === 'atendido') out.atendido += 1
    else if (c.estado === 'cancelado') out.cancelado += 1
  }
  return out
}

export function computeHomeStats(data: AppData, ref = new Date()): HomeStats {
  const hoy = periodBounds('dia', ref)
  const mes = periodBounds('mes', ref)
  const mesAnt = periodBounds('mes', subMonths(ref, 1))

  const topMap = new Map<string, number>()
  for (const p of data.patients) {
    const os = p.obraSocial?.trim()
    if (!os) continue
    topMap.set(os, (topMap.get(os) ?? 0) + 1)
  }
  const topObrasSociales = [...topMap.entries()]
    .map(([nombre, cantidad]) => ({ nombre, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5)

  return {
    ingresosHoy: sumPaymentsInInterval(data.payments, hoy.start, hoy.end),
    ingresosMes: sumPaymentsInInterval(data.payments, mes.start, mes.end),
    ingresosMesAnterior: sumPaymentsInInterval(
      data.payments,
      mesAnt.start,
      mesAnt.end,
    ),
    mesLabel: mes.label,
    mesAnteriorLabel: mesAnt.label,
    turnosMes: countTurnosMes(data.appointments, mes.start, mes.end),
    topObrasSociales,
  }
}

export function computeHomeAlerts(
  data: AppData,
  labels: {
    patientLabel: (id: string) => string
    doctorLabel: (id: string) => string
  },
  ref = new Date(),
): HomeAlerts {
  const manana = addDays(ref, 1)
  const mananaBounds = periodBounds('dia', manana)
  const paidCitaIds = new Set(
    data.payments.map((p) => p.citaId).filter((id): id is string => Boolean(id)),
  )

  const turnosManana: HomeAlertTurno[] = []
  const atendidosSinPago: HomeAlertTurno[] = []

  const sortedAppts = [...data.appointments].sort((a, b) => {
    const ta = safeParseISO(a.fechaHora)?.getTime() ?? 0
    const tb = safeParseISO(b.fechaHora)?.getTime() ?? 0
    return ta - tb
  })

  for (const c of sortedAppts) {
    const t = safeParseISO(c.fechaHora)
    if (!t) continue
    const row: HomeAlertTurno = {
      id: c.id,
      fechaHora: c.fechaHora,
      patientLabel: labels.patientLabel(c.patientId),
      doctorLabel: labels.doctorLabel(c.doctorId),
    }
    if (
      c.estado !== 'cancelado' &&
      isWithinInterval(t, { start: mananaBounds.start, end: mananaBounds.end })
    ) {
      turnosManana.push(row)
    }
    if (c.estado === 'atendido' && !paidCitaIds.has(c.id)) {
      atendidosSinPago.push(row)
    }
  }

  return { turnosManana, atendidosSinPago }
}
