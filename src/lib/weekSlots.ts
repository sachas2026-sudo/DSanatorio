import type { AppData, Doctor } from '../types'
import {
  dateToYmd,
  doctorDuracionTurno,
  doctorTipoAgenda,
  minutesToHHmm,
} from './doctorAgenda'
import { validateAppointmentSlot } from './agendaRules'
import { isDoctorOffOnWeekday } from './diasLibres'

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((x) => Number(x))
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN
  return h * 60 + m
}

export type DaySlotPlan =
  | { kind: 'slots'; ranges: [number, number][] }
  | { kind: 'no-day' }
  | { kind: 'no-doctor' }

type AgendaDataSlice = Pick<
  AppData,
  'horarios' | 'diasLibres' | 'atencionesMensuales' | 'doctors'
>

/** Médico con franja ese día y sin día de la semana marcado como libre (semanal). */
export function isDoctorAvailableOnDate(
  doctorId: string,
  date: Date,
  data: AgendaDataSlice,
): boolean {
  if (!doctorId) return false
  const doctor = data.doctors.find((d) => d.id === doctorId)
  if (!doctor) return false

  if (doctorTipoAgenda(doctor) === 'mensual') {
    const plan = planDoctorDay(doctorId, date, data)
    return plan.kind === 'slots' && plan.ranges.length > 0
  }

  if (isDoctorOffOnWeekday(doctorId, date, data.diasLibres)) {
    return false
  }
  const plan = planDoctorDay(doctorId, date, data)
  return plan.kind === 'slots' && plan.ranges.length > 0
}

/** Médicos que atienden ese día (franja / atención mensual), sin depender de turnos reservados. */
export function doctorsAvailableOnDate(
  date: Date,
  data: AgendaDataSlice,
): Doctor[] {
  return data.doctors
    .filter((d) => isDoctorAvailableOnDate(d.id, date, data))
    .sort((a, b) => {
      const byEsp = (a.especialidad ?? '').localeCompare(
        b.especialidad ?? '',
        'es',
        { sensitivity: 'base' },
      )
      if (byEsp !== 0) return byEsp
      return `${a.apellido} ${a.nombre}`.localeCompare(
        `${b.apellido} ${b.nombre}`,
        'es',
        { sensitivity: 'base' },
      )
    })
}

export function planDoctorDay(
  doctorId: string,
  date: Date,
  data: Pick<AppData, 'horarios' | 'atencionesMensuales' | 'doctors'>,
): DaySlotPlan {
  if (!doctorId) return { kind: 'no-doctor' }
  const doctor = data.doctors.find((d) => d.id === doctorId)

  if (doctor && doctorTipoAgenda(doctor) === 'mensual') {
    const ymd = dateToYmd(date)
    const delDia = data.atencionesMensuales.filter(
      (a) => a.doctorId === doctorId && a.fecha === ymd,
    )
    if (delDia.length === 0) return { kind: 'no-day' }
    const ranges: [number, number][] = []
    for (const s of delDia) {
      const a = timeToMinutes(s.horaInicio)
      const b = timeToMinutes(s.horaFin)
      if (Number.isNaN(a) || Number.isNaN(b) || b <= a) continue
      ranges.push([a, b])
    }
    ranges.sort((x, y) => x[0] - y[0])
    return ranges.length > 0 ? { kind: 'slots', ranges } : { kind: 'no-day' }
  }

  const dow = date.getDay()
  const delDoctor = data.horarios.filter((h) => h.doctorId === doctorId)
  const daySlots = delDoctor.filter((h) => h.diaSemana === dow)
  if (delDoctor.length > 0 && daySlots.length === 0) {
    return { kind: 'no-day' }
  }
  if (daySlots.length === 0) {
    return { kind: 'slots', ranges: DEFAULT_AGENDA_RANGES }
  }
  const ranges: [number, number][] = []
  for (const s of daySlots) {
    const a = timeToMinutes(s.horaInicio)
    const b = timeToMinutes(s.horaFin)
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) continue
    ranges.push([a, b])
  }
  ranges.sort((x, y) => x[0] - y[0])
  return { kind: 'slots', ranges }
}

export type GeneratedSlot = {
  hm: string
  available: boolean
  reason?: string
}

/** Mañana 08:00–11:30 y tarde 15:00–20:00 (minutos desde medianoche) */
export const DEFAULT_AGENDA_RANGES: [number, number][] = [
  [8 * 60, 11 * 60 + 30],
  [15 * 60, 20 * 60],
]

/** @deprecated Usar doctorDuracionTurno por médico */
export const SLOT_STEP_MINUTES = 30

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map((x) => Number(x))
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN
  return h * 60 + m
}

function rangesOverlapFranja(
  ranges: [number, number][],
  [desde, hasta]: [number, number],
): boolean {
  return ranges.some(([a, b]) => a < hasta && b > desde)
}

/** El médico atiende en esa franja (mañana o tarde), según horarios del día */
export function doctorAtiendeEnFranja(
  doctorId: string,
  date: Date,
  franja: [number, number],
  data: AppData,
): boolean {
  if (!isDoctorAvailableOnDate(doctorId, date, data)) {
    return false
  }
  const plan = planDoctorDay(doctorId, date, data)
  if (plan.kind !== 'slots') return false
  return rangesOverlapFranja(plan.ranges, franja)
}

/** Algún horario libre para reservar en la franja (mañana o tarde) */
export function hasTurnosDisponiblesEnFranja(
  doctorId: string,
  date: Date,
  franja: [number, number],
  data: AppData,
): boolean {
  if (!doctorAtiendeEnFranja(doctorId, date, franja, data)) {
    return false
  }
  const [desde, hasta] = franja
  const doctor = data.doctors.find((d) => d.id === doctorId)
  const step = doctorDuracionTurno(doctor)
  const slots = generateSlotsForDay({
    date,
    doctorId,
    duracionMinutos: step,
    data,
  })
  return slots.some((s) => {
    if (!s.available) return false
    const m = hmToMinutes(s.hm)
    return !Number.isNaN(m) && m >= desde && m <= hasta
  })
}

/** Huecos libres para reservar en una franja (mañana o tarde). */
export function listTurnosLibresEnFranja(
  doctorId: string,
  date: Date,
  franja: [number, number],
  data: AppData,
): string[] {
  if (!doctorAtiendeEnFranja(doctorId, date, franja, data)) return []
  const doctor = data.doctors.find((d) => d.id === doctorId)
  const step = doctorDuracionTurno(doctor)
  const [desde, hasta] = franja
  const slots = generateSlotsForDay({
    date,
    doctorId,
    duracionMinutos: step,
    data,
  })
  return slots
    .filter((s) => {
      if (!s.available) return false
      const m = hmToMinutes(s.hm)
      return !Number.isNaN(m) && m >= desde && m <= hasta
    })
    .map((s) => s.hm)
}

export function countTurnosLibresEnFranja(
  doctorId: string,
  date: Date,
  franja: [number, number],
  data: AppData,
): number {
  return listTurnosLibresEnFranja(doctorId, date, franja, data).length
}

export type TurnosLibresFranjaInfo = {
  atiende: boolean
  count: number
  horas: string[]
}

export type TurnosLibresMedicoDia = {
  manana: TurnosLibresFranjaInfo
  tarde: TurnosLibresFranjaInfo
}

export function turnosLibresMedicoDia(
  doctorId: string,
  date: Date,
  data: AppData,
): TurnosLibresMedicoDia | null {
  if (!isDoctorAvailableOnDate(doctorId, date, data)) return null
  const mananaFranja = DEFAULT_AGENDA_RANGES[0]!
  const tardeFranja = DEFAULT_AGENDA_RANGES[1]!
  const atiendeManana = doctorAtiendeEnFranja(
    doctorId,
    date,
    mananaFranja,
    data,
  )
  const atiendeTarde = doctorAtiendeEnFranja(
    doctorId,
    date,
    tardeFranja,
    data,
  )
  if (!atiendeManana && !atiendeTarde) return null

  const horasManana = atiendeManana
    ? listTurnosLibresEnFranja(doctorId, date, mananaFranja, data)
    : []
  const horasTarde = atiendeTarde
    ? listTurnosLibresEnFranja(doctorId, date, tardeFranja, data)
    : []

  return {
    manana: {
      atiende: atiendeManana,
      count: horasManana.length,
      horas: horasManana,
    },
    tarde: {
      atiende: atiendeTarde,
      count: horasTarde.length,
      horas: horasTarde,
    },
  }
}

/** Etiqueta «Libre X T. Mañana y Y T. Tarde» para la agenda del día. */
export function labelTurnosLibresMananaTarde(
  doctorId: string,
  date: Date,
  data: AppData,
): string | null {
  if (!isDoctorAvailableOnDate(doctorId, date, data)) return null
  const mananaFranja = DEFAULT_AGENDA_RANGES[0]!
  const tardeFranja = DEFAULT_AGENDA_RANGES[1]!
  const atiendeManana = doctorAtiendeEnFranja(
    doctorId,
    date,
    mananaFranja,
    data,
  )
  const atiendeTarde = doctorAtiendeEnFranja(
    doctorId,
    date,
    tardeFranja,
    data,
  )
  if (!atiendeManana && !atiendeTarde) return null

  const libresManana = atiendeManana
    ? countTurnosLibresEnFranja(doctorId, date, mananaFranja, data)
    : 0
  const libresTarde = atiendeTarde
    ? countTurnosLibresEnFranja(doctorId, date, tardeFranja, data)
    : 0

  if (atiendeManana && atiendeTarde) {
    return `Libre ${libresManana} T. Mañana y ${libresTarde} T. Tarde`
  }
  if (atiendeManana) {
    return `Libre ${libresManana} T. Mañana`
  }
  return `Libre ${libresTarde} T. Tarde`
}

/** Huecos libres para reservar en todo el día (mañana + tarde). */
export function countTurnosLibresDelDia(
  doctorId: string,
  date: Date,
  data: AppData,
): number {
  if (!isDoctorAvailableOnDate(doctorId, date, data)) return 0
  const doctor = data.doctors.find((d) => d.id === doctorId)
  const step = doctorDuracionTurno(doctor)
  const slots = generateSlotsForDay({
    date,
    doctorId,
    duracionMinutos: step,
    data,
  })
  return slots.filter((s) => s.available).length
}

export function generateSlotsForDay(params: {
  date: Date
  doctorId: string
  duracionMinutos: number
  data: AppData
  excludeAppointmentId?: string
}): GeneratedSlot[] {
  const { date, doctorId, duracionMinutos, data, excludeAppointmentId } = params
  const plan = planDoctorDay(doctorId, date, data)
  if (plan.kind === 'no-doctor') return []
  if (plan.kind === 'no-day') return []

  const doctor = data.doctors.find((d) => d.id === doctorId)
  const step = doctorDuracionTurno(doctor)
  const slotDur =
    duracionMinutos > 0 ? Math.round(duracionMinutos) : step

  const out: GeneratedSlot[] = []
  const y = date.getFullYear()
  const mo = date.getMonth()
  const d = date.getDate()

  for (const [a, b] of plan.ranges) {
    for (let t = a; t + slotDur <= b; t += step) {
      const local = new Date(y, mo, d, Math.floor(t / 60), t % 60, 0, 0)
      const fechaHora = local.toISOString()
      const check = validateAppointmentSlot({
        fechaHora,
        doctorId,
        data,
        excludeAppointmentId,
        duracionMinutos: slotDur,
      })
      const hm = minutesToHHmm(t)
      if (check.ok) {
        out.push({ hm, available: true })
      } else {
        out.push({ hm, available: false, reason: check.message })
      }
    }
  }
  return out
}

/** Normaliza entrada HH:MM o H:MM; devuelve null si no es válida. */
export function normalizeHmInput(raw: string): string | null {
  const t = raw.trim()
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function combineDateAndTimeLocal(date: Date, hm: string): string {
  const [hh, mm] = hm.split(':').map((x) => Number(x))
  const d = new Date(date)
  d.setHours(hh || 0, mm || 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
