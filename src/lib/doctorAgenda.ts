import type { AppData, Doctor, DoctorAtencionMensual, DoctorDiaLibre, DoctorHorario } from '../types'
import { diaSemanaLabel, diaSemanaLabelLargo, DIAS_SEMANA_FORM } from './diasSemana'
import { DEFAULT_AGENDA_RANGES } from './weekSlots'

/** Lun–Sáb: mismo criterio que la grilla de agenda (sin domingo por defecto). */
const DIAS_ATENCION_BASE = DIAS_SEMANA_FORM.filter((d) => d !== 0)

function sortDiasSemana(dias: number[]): number[] {
  return [...dias].sort(
    (a, b) =>
      DIAS_SEMANA_FORM.indexOf(a as (typeof DIAS_SEMANA_FORM)[number]) -
      DIAS_SEMANA_FORM.indexOf(b as (typeof DIAS_SEMANA_FORM)[number]),
  )
}

function formatDiasAtencionRange(dias: number[]): string {
  const sorted = sortDiasSemana(dias)
  if (sorted.length === 0) return 'Sin días de atención'
  if (sorted.length === 1) return diaSemanaLabelLargo(sorted[0]!)

  const groups: number[][] = []
  let current: number[] = [sorted[0]!]

  for (let i = 1; i < sorted.length; i++) {
    const prevIdx = DIAS_SEMANA_FORM.indexOf(
      current[current.length - 1]! as (typeof DIAS_SEMANA_FORM)[number],
    )
    const currIdx = DIAS_SEMANA_FORM.indexOf(
      sorted[i]! as (typeof DIAS_SEMANA_FORM)[number],
    )
    if (currIdx === prevIdx + 1) {
      current.push(sorted[i]!)
    } else {
      groups.push(current)
      current = [sorted[i]!]
    }
  }
  groups.push(current)

  const formatGroup = (g: number[]) => {
    if (g.length === 1) return diaSemanaLabelLargo(g[0]!)
    if (g.length === 2) {
      return `${diaSemanaLabelLargo(g[0]!)} y ${diaSemanaLabelLargo(g[1]!)}`
    }
    return `${diaSemanaLabelLargo(g[0]!)} a ${diaSemanaLabelLargo(g[g.length - 1]!)}`
  }

  return groups.map(formatGroup).join(', ')
}

export const DURACION_TURNO_OPCIONES = [10, 15, 20, 30, 45, 60] as const

export function doctorDuracionTurno(doctor: Doctor | undefined): number {
  const n = doctor?.duracionTurnoMinutos ?? 30
  return n > 0 ? Math.round(n) : 30
}

export function doctorTipoAgenda(doctor: Doctor | undefined): 'semanal' | 'mensual' {
  return doctor?.tipoAgenda === 'mensual' ? 'mensual' : 'semanal'
}

export function isDoctorAgendaMensual(doctor: Doctor | undefined): boolean {
  return doctorTipoAgenda(doctor) === 'mensual'
}

export function dateToYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function minutesToHHmm(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function formatAgendaRanges(ranges: [number, number][]): string {
  return ranges.map(([a, b]) => `${minutesToHHmm(a)}–${minutesToHHmm(b)}`).join(' · ')
}

type AgendaDataSlice = Pick<
  AppData,
  'horarios' | 'diasLibres' | 'atencionesMensuales' | 'doctors'
>

export type DoctorAgendaIndex = {
  horariosByDoctor: Map<string, DoctorHorario[]>
  libresByDoctor: Map<string, DoctorDiaLibre[]>
  atencionesByDoctor: Map<string, DoctorAtencionMensual[]>
}

export function buildDoctorAgendaIndex(
  data: AgendaDataSlice,
): DoctorAgendaIndex {
  const horariosByDoctor = new Map<string, DoctorHorario[]>()
  const libresByDoctor = new Map<string, DoctorDiaLibre[]>()
  const atencionesByDoctor = new Map<string, DoctorAtencionMensual[]>()
  for (const h of data.horarios) {
    const list = horariosByDoctor.get(h.doctorId)
    if (list) list.push(h)
    else horariosByDoctor.set(h.doctorId, [h])
  }
  for (const d of data.diasLibres) {
    const list = libresByDoctor.get(d.doctorId)
    if (list) list.push(d)
    else libresByDoctor.set(d.doctorId, [d])
  }
  for (const a of data.atencionesMensuales) {
    const list = atencionesByDoctor.get(a.doctorId)
    if (list) list.push(a)
    else atencionesByDoctor.set(a.doctorId, [a])
  }
  return { horariosByDoctor, libresByDoctor, atencionesByDoctor }
}

function fechaYmdToDmY(fecha: string): string {
  const [y, m, d] = fecha.split('-')
  if (!y || !m || !d) return fecha
  return `${Number(d)}/${Number(m)}/${y}`
}

/** Texto breve de agenda por médico (Agenda y validaciones). */
export function formatDoctorAgendaResumen(
  doctorOrId: Doctor | string,
  data: AgendaDataSlice,
  index?: DoctorAgendaIndex,
): string {
  const doctor =
    typeof doctorOrId === 'string'
      ? data.doctors.find((d) => d.id === doctorOrId)
      : doctorOrId
  if (!doctor) return '—'
  const doctorId = doctor.id

  const dur = doctorDuracionTurno(doctor)
  const durTxt = ` · Turnos cada ${dur} min`

  const horarios =
    index?.horariosByDoctor.get(doctorId) ??
    data.horarios.filter((h) => h.doctorId === doctorId)
  const libres =
    index?.libresByDoctor.get(doctorId) ??
    data.diasLibres.filter((d) => d.doctorId === doctorId)

  if (isDoctorAgendaMensual(doctor)) {
    const fechas = [
      ...(index?.atencionesByDoctor.get(doctorId) ??
        data.atencionesMensuales.filter((a) => a.doctorId === doctorId)),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha))
    if (fechas.length === 0) {
      return `Atención mensual · Sin fechas cargadas${durTxt}`
    }
    const visibles = fechas.slice(0, 5).map((a) => {
      return `${fechaYmdToDmY(a.fecha)} ${a.horaInicio}–${a.horaFin}`
    })
    const resto =
      fechas.length > 5 ? ` (+${fechas.length - 5} fecha${fechas.length - 5 === 1 ? '' : 's'} más)` : ''
    return `Atención mensual: ${visibles.join(' · ')}${resto}${durTxt}`
  }

  if (horarios.length === 0) {
    const libresTxt =
      libres.length > 0
        ? ` · No atiende: ${libres.map((l) => diaSemanaLabel(l.diaSemana)).join(', ')}`
        : ''
    return `Horario general ${formatAgendaRanges(DEFAULT_AGENDA_RANGES)}${libresTxt}${durTxt}`
  }

  const byDay = new Map<number, string[]>()
  for (const h of horarios) {
    const franja = `${h.horaInicio}–${h.horaFin}`
    const list = byDay.get(h.diaSemana) ?? []
    list.push(franja)
    byDay.set(h.diaSemana, list)
  }

  const dayOrder = [1, 2, 3, 4, 5, 6, 0] as const
  const partes: string[] = []
  for (const dow of dayOrder) {
    const franjas = byDay.get(dow)
    if (!franjas?.length) continue
    partes.push(`${diaSemanaLabel(dow)} ${franjas.join(', ')}`)
  }

  let txt = partes.join(' · ')
  if (libres.length > 0) {
    txt += ` · No atiende: ${libres.map((l) => diaSemanaLabel(l.diaSemana)).join(', ')}`
  }
  return `${txt}${durTxt}`
}

/** Días o fechas de atención (texto corto para listados). */
export function doctorDiasAtencionLabel(
  doctorOrId: Doctor | string,
  data: AgendaDataSlice,
  index?: DoctorAgendaIndex,
): string {
  const doctor =
    typeof doctorOrId === 'string'
      ? data.doctors.find((d) => d.id === doctorOrId)
      : doctorOrId
  if (!doctor) return '—'

  const doctorId = doctor.id
  const horarios =
    index?.horariosByDoctor.get(doctorId) ??
    data.horarios.filter((h) => h.doctorId === doctorId)
  const libres = new Set(
    (
      index?.libresByDoctor.get(doctorId) ??
      data.diasLibres.filter((d) => d.doctorId === doctorId)
    ).map((d) => d.diaSemana),
  )

  if (isDoctorAgendaMensual(doctor)) {
    const fechas = [
      ...(index?.atencionesByDoctor.get(doctorId) ??
        data.atencionesMensuales.filter((a) => a.doctorId === doctorId)),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha))
    if (fechas.length === 0) return 'Sin fechas cargadas'
    return fechas.map((a) => fechaYmdToDmY(a.fecha)).join(', ')
  }

  if (horarios.length > 0) {
    const dias = [...new Set(horarios.map((h) => h.diaSemana))]
    return formatDiasAtencionRange(dias)
  }

  const activos = DIAS_ATENCION_BASE.filter((d) => !libres.has(d))
  return formatDiasAtencionRange(activos)
}

/** Franjas horarias de atención (para listados). */
export function doctorHorarioAtencionLabel(
  doctorOrId: Doctor | string,
  data: AgendaDataSlice,
  index?: DoctorAgendaIndex,
): string {
  const doctor =
    typeof doctorOrId === 'string'
      ? data.doctors.find((d) => d.id === doctorOrId)
      : doctorOrId
  if (!doctor) return '—'

  const doctorId = doctor.id
  const horarios =
    index?.horariosByDoctor.get(doctorId) ??
    data.horarios.filter((h) => h.doctorId === doctorId)

  if (isDoctorAgendaMensual(doctor)) {
    const fechas = [
      ...(index?.atencionesByDoctor.get(doctorId) ??
        data.atencionesMensuales.filter((a) => a.doctorId === doctorId)),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha))
    if (fechas.length === 0) return '—'
    const franjas = fechas.map((a) => `${a.horaInicio}–${a.horaFin}`)
    const unicas = [...new Set(franjas)]
    if (unicas.length === 1) return unicas[0]!
    return fechas
      .map((a) => `${fechaYmdToDmY(a.fecha)} ${a.horaInicio}–${a.horaFin}`)
      .join(', ')
  }

  if (horarios.length > 0) {
    const byDay = new Map<number, string[]>()
    for (const h of horarios) {
      const franja = `${h.horaInicio}–${h.horaFin}`
      const list = byDay.get(h.diaSemana) ?? []
      list.push(franja)
      byDay.set(h.diaSemana, list)
    }

    const franjasPorDia = [...byDay.values()].map((f) =>
      [...new Set(f)].sort().join('|'),
    )
    const mismoHorario = new Set(franjasPorDia).size === 1

    if (mismoHorario) {
      const franjas = [...new Set(horarios.map((h) => `${h.horaInicio}–${h.horaFin}`))]
      return franjas.join(', ')
    }

    const partes: string[] = []
    for (const dow of DIAS_SEMANA_FORM) {
      const franjas = byDay.get(dow)
      if (!franjas?.length) continue
      partes.push(`${diaSemanaLabel(dow)} ${[...new Set(franjas)].join(', ')}`)
    }
    return partes.join(' · ')
  }

  return formatAgendaRanges(DEFAULT_AGENDA_RANGES)
}

export type MedicoEspecialidadListRow = {
  id: string
  medico: string
  especialidad: string
  dias: string
  horario: string
  duracion: string
}

export function buildMedicosEspecialidadesRows(
  data: AgendaDataSlice,
): MedicoEspecialidadListRow[] {
  const index = buildDoctorAgendaIndex(data)
  return [...data.doctors]
    .sort((a, b) =>
      `${a.apellido} ${a.nombre}`.localeCompare(
        `${b.apellido} ${b.nombre}`,
        'es',
        { sensitivity: 'base' },
      ),
    )
    .map((d) => ({
      id: d.id,
      medico: `${d.apellido}, ${d.nombre}`,
      especialidad: d.especialidad?.trim() ?? '',
      dias: doctorDiasAtencionLabel(d, data, index),
      horario: doctorHorarioAtencionLabel(d, data, index),
      duracion: `${doctorDuracionTurno(d)} min`,
    }))
}
