import { isSameDay, parseISO } from 'date-fns'
import type { AppData, Appointment } from '../types'
import {
  DEFAULT_AGENDA_RANGES,
  doctorAtiendeEnFranja,
  hasTurnosDisponiblesEnFranja,
  isDoctorAvailableOnDate,
} from './weekSlots'

export function appointmentStartMinutes(c: Appointment): number {
  const t = parseISO(c.fechaHora)
  return t.getHours() * 60 + t.getMinutes()
}

/** Devuelve la etiqueta del turno ('Mañana', 'Tarde', 'Noche') según la fecha/hora. */
export function getTurnoFromFecha(fechaIsoOrDate: string | Date | undefined | null): string {
  if (!fechaIsoOrDate) return '—'
  const t = typeof fechaIsoOrDate === 'string' ? parseISO(fechaIsoOrDate) : fechaIsoOrDate
  if (isNaN(t.getTime())) return '—'
  const mins = t.getHours() * 60 + t.getMinutes()
  if (mins < 810) return 'Mañana' // Hasta 13:30 hs (810 min)
  if (mins < 1260) return 'Tarde' // 13:30 hs a 21:00 hs (1260 min)
  return 'Noche' // 21:00 hs en adelante
}

export function citasDelDia(
  appointments: Appointment[],
  day: Date,
  options?: { includeCancelled?: boolean },
): Appointment[] {
  return [...appointments]
    .filter(
      (c) =>
        (options?.includeCancelled || c.estado !== 'cancelado') &&
        isSameDay(parseISO(c.fechaHora), day),
    )
    .sort(
      (a, b) =>
        parseISO(a.fechaHora).getTime() - parseISO(b.fechaHora).getTime(),
    )
}

export function citasEnFranja(
  citas: Appointment[],
  [desde, hasta]: [number, number],
): Appointment[] {
  return citas.filter((c) => {
    const m = appointmentStartMinutes(c)
    return m >= desde && m <= hasta
  })
}

/** Separa turnos del día en mañana y tarde (misma lógica que la agenda y el PDF). */
export function splitCitasMananaTarde(citas: Appointment[]): {
  manana: Appointment[]
  tarde: Appointment[]
} {
  const mananaFranja = DEFAULT_AGENDA_RANGES[0]!
  const tardeFranja = DEFAULT_AGENDA_RANGES[1]!
  const manana: Appointment[] = []
  const tarde: Appointment[] = []

  for (const c of citas) {
    const m = appointmentStartMinutes(c)
    if (m >= mananaFranja[0] && m <= mananaFranja[1]) {
      manana.push(c)
    } else if (m >= tardeFranja[0] && m <= tardeFranja[1]) {
      tarde.push(c)
    } else if (m < tardeFranja[0]) {
      manana.push(c)
    } else {
      tarde.push(c)
    }
  }

  return { manana, tarde }
}

export type DoctorCitaGroup = {
  key: string
  label: string
  citas: Appointment[]
  /** Sin huecos libres para reservar en esa franja (mañana o tarde) */
  sinTurnosDisponibles?: boolean
}

export function agruparPorMedico(
  citas: Appointment[],
  doctorLabel: (doctorId: string) => string,
): DoctorCitaGroup[] {
  const map = new Map<string, Appointment[]>()
  for (const c of citas) {
    const list = map.get(c.doctorId) ?? []
    list.push(c)
    map.set(c.doctorId, list)
  }
  return [...map.entries()]
    .map(([doctorId, lista]) => ({
      key: doctorId,
      label: doctorLabel(doctorId),
      citas: [...lista].sort(
        (a, b) =>
          parseISO(a.fechaHora).getTime() - parseISO(b.fechaHora).getTime(),
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function medicoGroupsEnFranja(params: {
  citasFranja: Appointment[]
  selectedDay: Date
  franja: [number, number]
  data: AppData
  doctorLabel: (doctorId: string) => string
}): DoctorCitaGroup[] {
  const { citasFranja, selectedDay, franja, data, doctorLabel } = params
  const conCitas = agruparPorMedico(citasFranja, doctorLabel)
  const byKey = new Map(conCitas.map((g) => [g.key, g]))

  const mostrarSinTurnos = (doctorId: string) =>
    doctorAtiendeEnFranja(doctorId, selectedDay, franja, data) &&
    !hasTurnosDisponiblesEnFranja(doctorId, selectedDay, franja, data)

  const disponibles = data.doctors
    .filter((d) =>
      isDoctorAvailableOnDate(d.id, selectedDay, data),
    )
    .sort((a, b) =>
      `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es'),
    )

  const out: DoctorCitaGroup[] = []

  for (const d of disponibles) {
    const g = byKey.get(d.id)
    const aviso = mostrarSinTurnos(d.id)
    if (g) {
      out.push({ ...g, sinTurnosDisponibles: aviso })
    } else if (aviso) {
      out.push({
        key: d.id,
        label: doctorLabel(d.id),
        citas: [],
        sinTurnosDisponibles: true,
      })
    }
  }

  for (const g of conCitas) {
    if (!out.some((x) => x.key === g.key)) {
      out.push({ ...g, sinTurnosDisponibles: mostrarSinTurnos(g.key) })
    }
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

/**
 * Todos los turnos del día por médico (sin filtrar por franja 08–11:30 / 15–20).
 * Incluye horarios de mediodía (ej. 12:30). Usado en agenda y PDF Turnos.
 */
export function medicoGroupsCitasDelDia(params: {
  citas: Appointment[]
  selectedDay: Date
  data: AppData
  doctorLabel: (doctorId: string) => string
}): DoctorCitaGroup[] {
  const { citas, selectedDay, data, doctorLabel } = params
  const mananaFranja = DEFAULT_AGENDA_RANGES[0]!
  const tardeFranja = DEFAULT_AGENDA_RANGES[1]!
  const conTodas = agruparPorMedico(citas, doctorLabel)
  const byKey = new Map(conTodas.map((g) => [g.key, g]))

  const avisoSinTurnos = (doctorId: string) =>
    (doctorAtiendeEnFranja(doctorId, selectedDay, mananaFranja, data) &&
      !hasTurnosDisponiblesEnFranja(doctorId, selectedDay, mananaFranja, data)) ||
    (doctorAtiendeEnFranja(doctorId, selectedDay, tardeFranja, data) &&
      !hasTurnosDisponiblesEnFranja(doctorId, selectedDay, tardeFranja, data))

  const disponibles = data.doctors
    .filter((d) => isDoctorAvailableOnDate(d.id, selectedDay, data))
    .sort((a, b) =>
      `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es'),
    )

  const out: DoctorCitaGroup[] = []

  for (const d of disponibles) {
    const g = byKey.get(d.id)
    const aviso = avisoSinTurnos(d.id)
    if (g) {
      out.push({ ...g, sinTurnosDisponibles: aviso })
    } else if (aviso) {
      out.push({
        key: d.id,
        label: doctorLabel(d.id),
        citas: [],
        sinTurnosDisponibles: true,
      })
    }
  }

  for (const g of conTodas) {
    if (!out.some((x) => x.key === g.key)) {
      out.push({ ...g, sinTurnosDisponibles: avisoSinTurnos(g.key) })
    }
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

/** Une grupos de mañana y tarde en un grupo por médico (día completo). */
export function mergeMedicoGroupsDia(
  manana: DoctorCitaGroup[],
  tarde: DoctorCitaGroup[],
): DoctorCitaGroup[] {
  const map = new Map<string, DoctorCitaGroup>()

  for (const g of [...manana, ...tarde]) {
    const prev = map.get(g.key)
    if (!prev) {
      map.set(g.key, { ...g, citas: [...g.citas] })
      continue
    }

    const ids = new Set(prev.citas.map((c) => c.id))
    const citas = [...prev.citas]
    for (const c of g.citas) {
      if (!ids.has(c.id)) citas.push(c)
    }
    citas.sort(
      (a, b) =>
        parseISO(a.fechaHora).getTime() - parseISO(b.fechaHora).getTime(),
    )

    const tieneCitas = citas.length > 0
    map.set(g.key, {
      ...prev,
      citas,
      sinTurnosDisponibles: tieneCitas
        ? false
        : Boolean(prev.sinTurnosDisponibles && g.sinTurnosDisponibles),
    })
  }

  return [...map.values()].sort((a, b) =>
    a.label.localeCompare(b.label, 'es'),
  )
}
