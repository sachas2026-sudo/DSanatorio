import type { AppData, Doctor, DoctorAtencionMensual, DoctorDiaLibre, DoctorHorario } from '../types'
import { diaSemanaLabel, diaSemanaLabelLargo, DIAS_SEMANA_FORM } from './diasSemana'
import { DEFAULT_AGENDA_RANGES } from './weekSlots'

/** Lun–Sáb: mismo criterio que la grilla de agenda (sin domingo por defecto). */
const DIAS_ATENCION_BASE = DIAS_SEMANA_FORM.filter((d) => d !== 0)

/** Horario básico “general” de la clínica (para listados cuando no hay franjas específicas). */
const HORARIO_BASICO_CLINICA = '08:00–11:00 · 15:00–19:30 hs'
const HORARIO_BASICO_CLINICA_PDF = '08:00–11:00 · 15:00–19:30'
const HORARIO_BASICO_FRANJAS = ['08:00–11:00', '15:00–19:30'] as const

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

function formatDiasAtencionGroupPdf(g: number[]): string {
  if (g.length === 1) return diaSemanaLabelLargo(g[0]!)
  if (g.length === 2) {
    return `${diaSemanaLabelLargo(g[0]!)}\ny ${diaSemanaLabelLargo(g[1]!)}`
  }
  return `${diaSemanaLabelLargo(g[0]!)}\na ${diaSemanaLabelLargo(g[g.length - 1]!)}`
}

/** PDF: rangos en dos líneas (`Lunes` + `a Viernes`). */
export function formatDiasAtencionRangePdf(dias: number[]): string {
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

  return groups.map(formatDiasAtencionGroupPdf).join(',\n')
}

/** Franjas por día (Lun, Mar…) para PDF y listados con muchas franjas. */
export function buildHorariosFranjasByDay(
  horarios: Pick<DoctorHorario, 'diaSemana' | 'horaInicio' | 'horaFin'>[],
): Map<number, string[]> {
  const byDay = new Map<number, string[]>()
  for (const h of horarios) {
    const franja = `${h.horaInicio}–${h.horaFin}`
    const list = byDay.get(h.diaSemana) ?? []
    if (!list.includes(franja)) list.push(franja)
    byDay.set(h.diaSemana, list)
  }
  for (const [dow, list] of byDay) {
    list.sort((a, b) => a.localeCompare(b))
    byDay.set(dow, list)
  }
  return byDay
}

/** Ej. `Lun 08:00–11:30, 15:00–20:00 · Mar 08:00–11:30` */
export function formatHorarioCompactoPorDia(byDay: Map<number, string[]>): string {
  const partes: string[] = []
  for (const dow of DIAS_SEMANA_FORM) {
    const franjas = byDay.get(dow)
    if (!franjas?.length) continue
    partes.push(`${diaSemanaLabel(dow)} ${franjas.join(', ')}`)
  }
  return partes.join(' · ')
}

function formatFranjasHorarioDiaPdf(franjas: string[]): string {
  if (franjas.length <= 1) return franjas[0] ?? ''
  if (franjas.length === 2) {
    return `${franjas[0]}  · ${franjas[1]}`
  }
  return franjas.join(', ')
}

/** PDF: dos días por línea (`Lun …· Mar …`), saltos de línea entre pares. */
export function formatHorarioCompactoPorDiaPdf(byDay: Map<number, string[]>): string {
  const dayParts: string[] = []
  for (const dow of DIAS_SEMANA_FORM) {
    const franjas = byDay.get(dow)
    if (!franjas?.length) continue
    dayParts.push(`${diaSemanaLabel(dow)} ${formatFranjasHorarioDiaPdf(franjas)}`)
  }
  if (dayParts.length === 0) return ''
  if (dayParts.length === 1) return dayParts[0]!
  const lines: string[] = []
  for (let i = 0; i < dayParts.length; i += 2) {
    lines.push(dayParts.slice(i, i + 2).join('· '))
  }
  return lines.join('\n')
}

export const DURACION_TURNO_OPCIONES = [10, 15, 20, 30, 45, 60] as const

/** Duración para turnos de urgencia / fuera de grilla (mínimo 5 min). */
export const URGENCIA_DURACION_OPCIONES = [5, 10, 15, 20, 30, 45, 60] as const

export const URGENCIA_DURACION_DEFAULT = 5

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

/** Lunes a viernes: atención por defecto al dar de alta un médico. */
export const DEFAULT_DOCTOR_WEEKDAYS = [1, 2, 3, 4, 5] as const

/** Mañana y tarde estándar (DEFAULT_AGENDA_RANGES) para cada día laborable. */
export function buildDefaultDoctorHorarios(
  doctorId: string,
  newId: () => string,
): DoctorHorario[] {
  const franjas = DEFAULT_AGENDA_RANGES.map(([desde, hasta]) => ({
    horaInicio: minutesToHHmm(desde),
    horaFin: minutesToHHmm(hasta),
  }))
  const out: DoctorHorario[] = []
  for (const diaSemana of DEFAULT_DOCTOR_WEEKDAYS) {
    for (const franja of franjas) {
      out.push({
        id: newId(),
        doctorId,
        diaSemana,
        horaInicio: franja.horaInicio,
        horaFin: franja.horaFin,
      })
    }
  }
  return out
}

function normalizeHorarioHm(t: string): string {
  const parts = t.trim().split(':')
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (Number.isNaN(h) || Number.isNaN(m)) return t.trim()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Franjas idénticas a las que se generan al dar de alta un médico (lun–vie mañana y tarde). */
export function isAutoGeneratedDefaultHorarios(
  doctorId: string,
  horarios: DoctorHorario[],
): boolean {
  const del = horarios.filter((h) => h.doctorId === doctorId)
  if (del.length !== DEFAULT_DOCTOR_WEEKDAYS.length * 2) return false
  const expected = new Set<string>()
  for (const diaSemana of DEFAULT_DOCTOR_WEEKDAYS) {
    for (const [desde, hasta] of DEFAULT_AGENDA_RANGES) {
      expected.add(
        `${diaSemana}|${minutesToHHmm(desde)}|${minutesToHHmm(hasta)}`,
      )
    }
  }
  const actual = new Set(
    del.map(
      (h) =>
        `${h.diaSemana}|${normalizeHorarioHm(h.horaInicio)}|${normalizeHorarioHm(h.horaFin)}`,
    ),
  )
  if (actual.size !== expected.size) return false
  for (const key of expected) {
    if (!actual.has(key)) return false
  }
  return true
}

/** Horarios que definen la agenda; el set automático lun–vie se trata como “horario general”. */
export function horariosEfectivosDoctor(
  doctorId: string,
  horarios: DoctorHorario[],
): DoctorHorario[] {
  const del = horarios.filter((h) => h.doctorId === doctorId)
  if (del.length === 0) return []
  if (isAutoGeneratedDefaultHorarios(doctorId, horarios)) return []
  return del
}

/** Franjas de un médico agrupadas por día (lun → dom), ordenadas por hora. */
export function groupHorariosByWeekday(
  horarios: DoctorHorario[],
): { diaSemana: number; franjas: DoctorHorario[] }[] {
  const byDay = new Map<number, DoctorHorario[]>()
  for (const h of horarios) {
    const list = byDay.get(h.diaSemana) ?? []
    list.push(h)
    byDay.set(h.diaSemana, list)
  }
  const out: { diaSemana: number; franjas: DoctorHorario[] }[] = []
  for (const diaSemana of DIAS_SEMANA_FORM) {
    const franjas = byDay.get(diaSemana)
    if (!franjas?.length) continue
    franjas.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
    out.push({ diaSemana, franjas })
  }
  return out
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
  for (const doc of data.doctors) {
    const eff = horariosEfectivosDoctor(doc.id, data.horarios)
    if (eff.length > 0) horariosByDoctor.set(doc.id, eff)
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
    horariosEfectivosDoctor(doctorId, data.horarios)
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
    horariosEfectivosDoctor(doctorId, data.horarios)
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

/** Días de atención para PDF de especialidades (saltos de línea en rangos). */
export function doctorDiasAtencionLabelForPdf(
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
    horariosEfectivosDoctor(doctorId, data.horarios)
  const libres = new Set(
    (
      index?.libresByDoctor.get(doctorId) ??
      data.diasLibres.filter((d) => d.doctorId === doctorId)
    ).map((d) => d.diaSemana),
  )

  if (isDoctorAgendaMensual(doctor)) {
    return doctorDiasAtencionLabel(doctor, data, index)
  }

  if (horarios.length > 0) {
    const dias = [...new Set(horarios.map((h) => h.diaSemana))]
    return formatDiasAtencionRangePdf(dias)
  }

  const activos = DIAS_ATENCION_BASE.filter((d) => !libres.has(d))
  return formatDiasAtencionRangePdf(activos)
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
    horariosEfectivosDoctor(doctorId, data.horarios)

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
    const byDay = buildHorariosFranjasByDay(horarios)
    const diasConFranjas = [...byDay.values()].filter((f) => f.length > 0)
    const franjasUnicas = [...new Set(diasConFranjas.flat())]

    if (diasConFranjas.length === 1 && franjasUnicas.length === 1) {
      return franjasUnicas[0]!
    }

    // Siempre mostrar el horario básico + extras (franjas “no normales”) si existen.
    const extrasByDay = new Map<number, string[]>()
    for (const [dow, franjas] of byDay.entries()) {
      const extras = franjas.filter(
        (f) => !HORARIO_BASICO_FRANJAS.includes(f as (typeof HORARIO_BASICO_FRANJAS)[number]),
      )
      if (extras.length > 0) extrasByDay.set(dow, extras)
    }
    const extrasTxt = formatHorarioCompactoPorDia(extrasByDay)
    return extrasTxt ? `${HORARIO_BASICO_CLINICA} · ${extrasTxt}` : HORARIO_BASICO_CLINICA
  }

  // Si no hay franjas específicas (o es el set autogenerado), mostrar el horario básico.
  return HORARIO_BASICO_CLINICA
}

/** Horario para PDF de especialidades (saltos de línea y `·` entre días). */
export function doctorHorarioAtencionLabelForPdf(
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
    horariosEfectivosDoctor(doctorId, data.horarios)

  if (isDoctorAgendaMensual(doctor)) {
    return doctorHorarioAtencionLabel(doctor, data, index)
  }

  if (horarios.length > 0) {
    const byDay = buildHorariosFranjasByDay(horarios)
    const diasConFranjas = [...byDay.values()].filter((f) => f.length > 0)
    const franjasUnicas = [...new Set(diasConFranjas.flat())]

    if (diasConFranjas.length === 1 && franjasUnicas.length === 1) {
      return franjasUnicas[0]!
    }

    const extrasByDay = new Map<number, string[]>()
    for (const [dow, franjas] of byDay.entries()) {
      const extras = franjas.filter(
        (f) => !HORARIO_BASICO_FRANJAS.includes(f as (typeof HORARIO_BASICO_FRANJAS)[number]),
      )
      if (extras.length > 0) extrasByDay.set(dow, extras)
    }
    const extrasTxt = formatHorarioCompactoPorDiaPdf(extrasByDay)
    return extrasTxt ? `${HORARIO_BASICO_CLINICA_PDF}\n${extrasTxt}` : HORARIO_BASICO_CLINICA_PDF
  }

  return HORARIO_BASICO_CLINICA_PDF
}

export type MedicoEspecialidadListRow = {
  id: string
  medico: string
  especialidad: string
  obrasSociales: string
  dias: string
  horario: string
  duracion: string
}

function doctorObrasSocialesLista(doctor: Doctor): string[] {
  return (doctor.obrasSociales?.length
    ? doctor.obrasSociales
    : doctor.obraSocial
      ? [doctor.obraSocial]
      : []
  )
    .map((x) => x.trim())
    .filter(Boolean)
}

/** Obras sociales del médico para la fila bajo los días en Agenda (texto chico). */
export function doctorObrasSocialesSemanaLabel(doc: Doctor): string {
  const list = doctorObrasSocialesLista(doc)
  return list.length > 0 ? list.join(' · ') : ''
}

function doctorObrasSocialesLabel(doctor: Doctor): string {
  const list = doctorObrasSocialesLista(doctor)

  if (list.length === 0) return ''
  if (list.length <= 3) return list.join(', ')
  return `${list.slice(0, 3).join(', ')}…`
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
      obrasSociales: doctorObrasSocialesLabel(d),
      dias: doctorDiasAtencionLabel(d, data, index),
      horario: doctorHorarioAtencionLabel(d, data, index),
      duracion: `${doctorDuracionTurno(d)} min`,
    }))
}
