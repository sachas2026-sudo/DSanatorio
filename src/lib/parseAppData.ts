import { normalizeDiasLibres } from './diasLibres'
import type {
  AppData,
  AppSettings,
  Appointment,
  AppointmentEstado,
  Doctor,
  DoctorAtencionMensual,
  DoctorHorario,
  DoctorTipoAgenda,
  MotivoCancelacionPago,
  PagoCancelado,
  Patient,
  Payment,
} from '../types'

const APPOINTMENT_ESTADOS: AppointmentEstado[] = [
  'programado',
  'cancelado',
  'atendido',
]

const MOTIVOS_CANCELACION_VALIDOS = new Set<MotivoCancelacionPago>([
  'cancelacion_paciente',
  'cancelacion_doctor',
  'otros',
])

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function nonEmptyId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 ? s : null
}

export function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return fallback
}

export function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function asDiaSemana(v: unknown): number | null {
  const n = asNumber(v, -1)
  if (n >= 0 && n <= 6 && Number.isInteger(n)) return n
  return null
}

function asAppointmentEstado(v: unknown): AppointmentEstado {
  if (
    typeof v === 'string' &&
    APPOINTMENT_ESTADOS.includes(v as AppointmentEstado)
  ) {
    return v as AppointmentEstado
  }
  return 'programado'
}

export function parsePatient(raw: unknown): Patient | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyId(raw.id)
  if (!id) return null
  return {
    id,
    nombre: asString(raw.nombre),
    apellido: asString(raw.apellido),
    dni: asString(raw.dni),
    telefono: asString(raw.telefono),
    email: asString(raw.email),
    domicilio: asString(raw.domicilio),
    localidad: asString(raw.localidad),
    fechaNacimiento: asString(raw.fechaNacimiento),
    obraSocial: asString(raw.obraSocial),
    notas: asString(raw.notas),
  }
}

export function parseDoctor(raw: unknown): Doctor | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyId(raw.id)
  if (!id) return null
  return {
    id,
    nombre: asString(raw.nombre),
    apellido: asString(raw.apellido),
    matricula: asString(raw.matricula),
    especialidad: asString(raw.especialidad),
    telefono: asString(raw.telefono),
    localidad: asString(raw.localidad),
    email: asString(raw.email),
    porcentaje: (() => {
      if (raw.porcentaje === undefined || raw.porcentaje === null || raw.porcentaje === '')
        return undefined
      const n = asNumber(raw.porcentaje, NaN)
      if (!Number.isFinite(n)) return undefined
      const rounded = Math.round(n)
      if (rounded < 0 || rounded > 999) return undefined
      return rounded
    })(),
    duracionTurnoMinutos: (() => {
      const n = asNumber(raw.duracionTurnoMinutos, 30)
      return n > 0 ? Math.round(n) : 30
    })(),
    tipoAgenda: ((): DoctorTipoAgenda => {
      const t = asString(raw.tipoAgenda)
      return t === 'mensual' ? 'mensual' : 'semanal'
    })(),
  }
}

export function parseAtencionMensual(raw: unknown): DoctorAtencionMensual | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyId(raw.id)
  const doctorId = nonEmptyId(raw.doctorId)
  const fecha = asString(raw.fecha)
  if (!id || !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  return {
    id,
    doctorId,
    fecha,
    horaInicio: asString(raw.horaInicio, '09:00'),
    horaFin: asString(raw.horaFin, '13:00'),
  }
}

export function parseHorario(raw: unknown): DoctorHorario | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyId(raw.id)
  const doctorId = nonEmptyId(raw.doctorId)
  const diaSemana = asDiaSemana(raw.diaSemana)
  if (!id || !doctorId || diaSemana === null) return null
  return {
    id,
    doctorId,
    diaSemana,
    horaInicio: asString(raw.horaInicio, '09:00'),
    horaFin: asString(raw.horaFin, '13:00'),
  }
}

export function parseAppointment(raw: unknown): Appointment | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyId(raw.id)
  const patientId = nonEmptyId(raw.patientId)
  const doctorId = nonEmptyId(raw.doctorId)
  const fechaHora = asString(raw.fechaHora)
  if (!id || !patientId || !doctorId || !fechaHora) return null
  const duracion = asNumber(raw.duracionMinutos, 30)
  return {
    id,
    patientId,
    doctorId,
    fechaHora,
    duracionMinutos: duracion > 0 ? Math.round(duracion) : 30,
    notas: asString(raw.notas),
    estado: asAppointmentEstado(raw.estado),
  }
}

export function parsePayment(raw: unknown): Payment | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyId(raw.id)
  const patientId = nonEmptyId(raw.patientId)
  const doctorId = nonEmptyId(raw.doctorId)
  const fecha = asString(raw.fecha)
  if (!id || !patientId || !doctorId || !fecha) return null
  const citaRaw = raw.citaId
  const citaId =
    citaRaw === null || citaRaw === undefined
      ? null
      : nonEmptyId(citaRaw)
  return {
    id,
    patientId,
    doctorId,
    citaId,
    monto: asNumber(raw.monto, 0),
    fecha,
    metodo: asString(raw.metodo, 'Efectivo'),
    notas: asString(raw.notas),
  }
}

function parseEspecialidadesCustom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const s = item.trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function parseSettings(raw: unknown): AppSettings {
  if (!isRecord(raw)) {
    return {
      email: '',
      emailGerente: '',
      telefonoGerente: '',
      clave: '',
      telefono: '',
      cuit: '',
    }
  }
  return {
    email: asString(raw.email),
    emailGerente: asString(raw.emailGerente),
    telefonoGerente: asString(raw.telefonoGerente),
    clave: asString(raw.clave),
    telefono: asString(raw.telefono),
    cuit: asString(raw.cuit),
  }
}

function parseMotivoCancelacion(v: unknown): MotivoCancelacionPago {
  if (
    typeof v === 'string' &&
    MOTIVOS_CANCELACION_VALIDOS.has(v as MotivoCancelacionPago)
  ) {
    return v as MotivoCancelacionPago
  }
  return 'otros'
}

/** Migra y valida registros de pagos cancelados (incl. turnosEliminados). */
export function normalizePagosCancelados(raw: unknown): PagoCancelado[] {
  if (!Array.isArray(raw)) return []
  const out: PagoCancelado[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = nonEmptyId(item.id)
    if (!id) continue
    const payment = parsePayment(item.payment)
    if (!payment) continue
    const canceladoEn = asString(
      item.canceladoEn ?? item.eliminadoEn,
      new Date().toISOString(),
    )
    let appointment: Appointment | null = null
    if (item.appointment != null) {
      appointment = parseAppointment(item.appointment)
    }
    out.push({
      id,
      motivo: parseMotivoCancelacion(item.motivo),
      canceladoEn,
      payment,
      appointment,
      notasOtros: asString(item.notasOtros),
    })
  }
  return out
}

function parseArray<T>(
  raw: unknown,
  parseItem: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  for (const item of raw) {
    const parsed = parseItem(item)
    if (parsed) out.push(parsed)
  }
  return out
}

/** Valida y normaliza el JSON de la base (sin datos demo). */
export function parseAppDataRecord(parsed: unknown): AppData {
  if (!isRecord(parsed)) {
    throw new Error('Formato de base de datos no reconocido.')
  }

  const pagosCanceladosRaw =
    parsed.pagosCancelados ??
    (typeof parsed.turnosEliminados !== 'undefined'
      ? parsed.turnosEliminados
      : [])

  return {
    patients: parseArray(parsed.patients, parsePatient),
    doctors: parseArray(parsed.doctors, parseDoctor),
    horarios: parseArray(parsed.horarios, parseHorario),
    diasLibres: normalizeDiasLibres(
      Array.isArray(parsed.diasLibres) ? parsed.diasLibres : [],
    ),
    atencionesMensuales: parseArray(
      parsed.atencionesMensuales,
      parseAtencionMensual,
    ),
    appointments: parseArray(parsed.appointments, parseAppointment),
    payments: parseArray(parsed.payments, parsePayment),
    pagosCancelados: normalizePagosCancelados(pagosCanceladosRaw),
    especialidadesCustom: parseEspecialidadesCustom(
      parsed.especialidadesCustom,
    ),
    obrasSocialesCustom: parseEspecialidadesCustom(
      parsed.obrasSocialesCustom,
    ),
    localidadesCustom: parseEspecialidadesCustom(
      parsed.localidadesCustom,
    ),
    settings: parseSettings(parsed.settings),
  }
}

export function parseAppDataJson(raw: string): AppData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('El archivo no es JSON válido.')
  }
  return parseAppDataRecord(parsed)
}
