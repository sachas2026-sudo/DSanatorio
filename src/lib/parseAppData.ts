import { normalizeDiasLibres } from './diasLibres'
import { buildObrasSocialesCatalog } from './obrasSocialesCatalog'
import { buildPrestacionesCatalog } from './prestacionesCatalog'
import { parsePorcentajeStored } from './porcentajeInput'
import { parsePorcentajeAplicado } from './paymentPorcentajeParse'
import { mergeAtencionSinTurnoStorage } from './atencionSinTurno'
import type {
  AppData,
  AppSettings,
  Appointment,
  AppointmentEstado,
  AtencionSinTurnoFila,
  AtencionSinTurnoListado,
  CoberturaTipo,
  CuotaMensual,
  FormaPago,
  PlanAfiliado,
  Afiliado,
  Doctor,
  DoctorObraSocial,
  DoctorAtencionMensual,
  DoctorDebtPayment,
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

export function asBoolean(v: unknown, fallback = true): boolean {
  if (v === false || v === 0 || v === 'false' || v === '0') return false
  if (v === true || v === 1 || v === 'true' || v === '1') return true
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
  const fechaNacimiento = asString(raw.fechaNacimiento)
  const obraSocial = asString(raw.obraSocial)
  const notas = asString(raw.notas)
  const activo = asBoolean(raw.activo, true)
  // Se acepta cualquier valor y se descarta el que no sea una cobertura
  // conocida: una base vieja o editada a mano no debe romper la carga.
  const coberturaRaw = asString(raw.coberturaPreferida)
  const coberturaPreferida: CoberturaTipo | undefined =
    coberturaRaw === 'obraSocial' || coberturaRaw === 'plan' || coberturaRaw === 'particular'
      ? coberturaRaw
      : undefined
  return {
    id,
    nombre: asString(raw.nombre),
    apellido: asString(raw.apellido),
    dni: asString(raw.dni),
    telefono: asString(raw.telefono),
    email: asString(raw.email),
    domicilio: asString(raw.domicilio),
    localidad: asString(raw.localidad),
    fechaNacimiento,
    obraSocial: asString(raw.obraSocial),
    ...(typeof raw.obraSocialAnterior === 'string' ? { obraSocialAnterior: raw.obraSocialAnterior } : {}),
    notas: asString(raw.notas),
    activo: asBoolean(raw.activo, true),
    ...(coberturaPreferida ? { coberturaPreferida } : {}),
  }
}

function clampMoney(val: unknown): number {
  const n = asNumber(val, 0)
  return n > 0 ? Math.min(Math.round(n), 100_000_000) : 0
}

function parseUnboundedMoney(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? Math.round(val) : 0
  }
  if (typeof val !== 'string' || val.trim().startsWith('-')) return 0
  const digits = val.replace(/\D/g, '')
  const parsed = Number.parseInt(digits, 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function parseNullableMoney(val: unknown): number | null {
  return val === null ? null : clampMoney(val)
}

export function parseDoctor(raw: unknown): Doctor | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyId(raw.id)
  if (!id) return null
  const obrasSociales = (() => {
    const v = (raw as Record<string, unknown>).obrasSociales
    if (Array.isArray(v)) {
      const result: DoctorObraSocial[] = []
      const seen = new Set<string>()
      for (const item of v) {
        if (typeof item === 'string') {
          const nombre = item.trim()
          if (!nombre) continue
          const key = nombre.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          result.push({ nombre, porcentaje: 0, monto: 0 })
        } else if (isRecord(item)) {
          const nombre = asString(item.nombre).trim()
          if (!nombre) continue
          const key = nombre.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          const rawPct = typeof item.porcentaje === 'number'
            ? item.porcentaje
            : typeof item.porcentaje === 'string'
              ? parseFloat(item.porcentaje.replace(',', '.'))
              : 0
          const porcentaje = !Number.isFinite(rawPct)
            ? 0
            : Math.max(0, Math.round(rawPct))
          const monto = parseUnboundedMoney(item.monto)
          result.push({ nombre, porcentaje, monto })
        }
      }
      return result.length > 0 ? result : undefined
    }
    const single = asString((raw as Record<string, unknown>).obraSocial).trim()
    return single ? [{ nombre: single, porcentaje: 0, monto: 0 }] : undefined
  })()
  return {
    id,
    nombre: asString(raw.nombre),
    apellido: asString(raw.apellido),
    dni: asString(raw.dni),
    matricula: asString(raw.matricula),
    especialidad: asString(raw.especialidad),
    obraSocial: asString(raw.obraSocial),
    obrasSociales,
    telefono: asString(raw.telefono),
    localidad: asString(raw.localidad),
    email: asString(raw.email),
    alias: (() => {
      const a = asString(raw.alias).trim()
      return a
    })(),
    porcentaje: parsePorcentajeStored(raw.porcentaje),
    duracionTurnoMinutos: (() => {
      const n = asNumber(raw.duracionTurnoMinutos, 30)
      return n > 0 ? Math.round(n) : 30
    })(),
    tipoAgenda: ((): DoctorTipoAgenda => {
      const t = asString(raw.tipoAgenda)
      return t === 'mensual' ? 'mensual' : 'semanal'
    })(),
    activo: asBoolean(raw.activo, true),
    valor: parseNullableMoney((raw as Record<string, unknown>).valor),
    particular: parseNullableMoney((raw as Record<string, unknown>).particular),
    cuidar: parseNullableMoney((raw as Record<string, unknown>).cuidar),
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
  const whatsappRecordatorioEnviadoEn = asString(
    raw.whatsappRecordatorioEnviadoEn,
  ).trim()
  const creadoPor = asString(raw.creadoPor).trim()
  const modificadoPor = asString(raw.modificadoPor).trim()
  const modificadoEn = asString(raw.modificadoEn).trim()
  const obraSocialOverride = asString(raw.obraSocialOverride).trim()
  const motivoConsulta2 = asString(raw.motivoConsulta2).trim()
  return {
    id,
    patientId,
    doctorId,
    fechaHora,
    duracionMinutos: duracion > 0 ? Math.round(duracion) : 30,
    notas: asString(raw.notas),
    estado: asAppointmentEstado(raw.estado),
    ...(motivoConsulta2 ? { motivoConsulta2 } : {}),
    ...(obraSocialOverride ? { obraSocialOverride } : {}),
    ...(whatsappRecordatorioEnviadoEn
      ? { whatsappRecordatorioEnviadoEn }
      : {}),
    ...(creadoPor ? { creadoPor } : {}),
    ...(modificadoPor ? { modificadoPor } : {}),
    ...(modificadoEn ? { modificadoEn } : {}),
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
  const registradoPor = asString(raw.registradoPor).trim()
  const modificadoPor = asString(raw.modificadoPor).trim()
  const modificadoEn = asString(raw.modificadoEn).trim()
  const obraSocialOverride = asString(raw.obraSocialOverride).trim()
  return {
    id,
    patientId,
    doctorId,
    citaId,
    monto: asNumber(raw.monto, 0),
    fecha,
    metodo: asString(raw.metodo, 'Efectivo'),
    notas: asString(raw.notas),
    porcentajeAplicado: parsePorcentajeAplicado(raw.porcentajeAplicado),
    ...(obraSocialOverride ? { obraSocialOverride } : {}),
    ...(registradoPor ? { registradoPor } : {}),
    ...(modificadoPor ? { modificadoPor } : {}),
    ...(modificadoEn ? { modificadoEn } : {}),
  }
}

function parseAtencionSinTurnoFila(raw: unknown): AtencionSinTurnoFila | null {
  if (!isRecord(raw)) return null
  const patientId = nonEmptyId(raw.patientId)
  if (!patientId) return null
  const monto = asNumber(raw.monto, -1)
  if (monto < 0) return null
  return { patientId, monto }
}

export function parseAtencionSinTurnoListado(
  raw: unknown,
): AtencionSinTurnoListado | null {
  if (!isRecord(raw)) return null
  const id = nonEmptyId(raw.id)
  const doctorId = nonEmptyId(raw.doctorId)
  const fecha = asString(raw.fecha)
  if (!id || !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const filas = parseArray(raw.filas, parseAtencionSinTurnoFila)
  if (filas.length === 0) return null
  return {
    id,
    doctorId,
    fecha,
    filas,
    guardadoEn: asString(raw.guardadoEn, new Date().toISOString()),
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

function optionalStringField(raw: Record<string, unknown>, key: string): string | undefined {
  const v = asString(raw[key]).trim()
  return v || undefined
}

function optionalBoolField(raw: Record<string, unknown>, key: string): boolean | undefined {
  const v = raw[key]
  return typeof v === 'boolean' ? v : undefined
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
      supabaseUrl: 'https://mzfyzabgdlzqkvufqrxh.supabase.co',
      supabaseAnonKey: 'sb_publishable_5E4thTDbweeAZOd4wcypsw_I5O7F4fM',
      supabaseServiceRoleKey: '',
      supabaseAutoSync: true,
      supabaseUltimaSync: '',
    }
  }
  const carpetaBackupGoogleDrive = optionalStringField(raw, 'carpetaBackupGoogleDrive')
  const carpetaExportarGoogleDrive = optionalStringField(raw, 'carpetaExportarGoogleDrive')
  const carpetaPdfsGoogleDrive = optionalStringField(raw, 'carpetaPdfsGoogleDrive')
  const rutaGoogleDriveCustom = optionalStringField(raw, 'rutaGoogleDriveCustom')
  const googleDriveDeshabilitado = optionalBoolField(raw, 'googleDriveDeshabilitado')
  const googleDriveSetupCompletado =
    optionalBoolField(raw, 'googleDriveSetupCompletado') ??
    Boolean(
      carpetaBackupGoogleDrive ||
        carpetaExportarGoogleDrive ||
        carpetaPdfsGoogleDrive ||
        rutaGoogleDriveCustom ||
        googleDriveDeshabilitado,
    )

  return {
    email: asString(raw.email),
    emailGerente: asString(raw.emailGerente),
    telefonoGerente: asString(raw.telefonoGerente),
    clave: asString(raw.clave),
    telefono: asString(raw.telefono),
    cuit: asString(raw.cuit),
    carpetaBackupGoogleDrive,
    carpetaExportarGoogleDrive,
    carpetaPdfsGoogleDrive,
    rutaGoogleDriveCustom,
    googleDriveDeshabilitado,
    googleDriveSetupCompletado,
    secretariaPuedeModificarMesActual: asBoolean(
      raw.secretariaPuedeModificarMesActual,
      false,
    ),
    secretariaPuedeModificarTurnosOtrosUsuarios: asBoolean(
      raw.secretariaPuedeModificarTurnosOtrosUsuarios,
      false,
    ),
    mostrarAccionesEnListaPagos: asBoolean(
      raw.mostrarAccionesEnListaPagos,
      false,
    ),
    supabaseUrl: optionalStringField(raw, 'supabaseUrl') || 'https://mzfyzabgdlzqkvufqrxh.supabase.co',
    supabaseAnonKey: optionalStringField(raw, 'supabaseAnonKey') || 'sb_publishable_5E4thTDbweeAZOd4wcypsw_I5O7F4fM',
    supabaseServiceRoleKey: optionalStringField(raw, 'supabaseServiceRoleKey') || '',
    supabaseAutoSync: optionalBoolField(raw, 'supabaseAutoSync') ?? true,
    supabaseUltimaSync: optionalStringField(raw, 'supabaseUltimaSync') || '',
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
    const canceladoPor = asString(item.canceladoPor).trim()
    out.push({
      id,
      motivo: parseMotivoCancelacion(item.motivo),
      canceladoEn,
      payment,
      appointment,
      notasOtros: asString(item.notasOtros),
      ...(canceladoPor ? { canceladoPor } : {}),
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

function sanitizeAppDataReferences(data: AppData): AppData {
  const appointmentIds = new Set(data.appointments.map((a) => a.id))
  const patientIds = new Set(data.patients.map((p) => p.id))
  const doctorIds = new Set(data.doctors.map((d) => d.id))

  const payments = data.payments.map((p) => ({
    ...p,
    citaId: p.citaId && !appointmentIds.has(p.citaId) ? null : p.citaId,
  }))

  const atencionesSinTurno = data.atencionesSinTurno
    .filter((l) => doctorIds.has(l.doctorId))
    .map((l) => ({
      ...l,
      filas: l.filas.filter((f) => patientIds.has(f.patientId)),
    }))
    .filter((l) => l.filas.length > 0)

  return {
    ...data,
    payments,
    atencionesSinTurno,
  }
}

export type AppDataIntegrityReport = {
  invalidRows: {
    patients: number
    doctors: number
    appointments: number
    payments: number
    pagosCancelados: number
    horarios: number
    atencionesMensuales: number
    atencionesSinTurno: number
    diasLibres: number
  }
  orphanedRefs: {
    appointments: number
    payments: number
    pagosCancelados: number
    horarios: number
    atencionesMensuales: number
    atencionesSinTurno: number
    diasLibres: number
  }
}

function arrayRawLen(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0
}

export function hasIntegrityIssues(report: AppDataIntegrityReport): boolean {
  const { invalidRows, orphanedRefs } = report
  return (
    Object.values(invalidRows).some((n) => n > 0) ||
    Object.values(orphanedRefs).some((n) => n > 0)
  )
}

export function formatIntegrityAlert(report: AppDataIntegrityReport): string {
  const parts: string[] = []
  const { invalidRows: i, orphanedRefs: o } = report
  if (i.patients) parts.push(`${i.patients} paciente(s) inválido(s)`)
  if (i.doctors) parts.push(`${i.doctors} médico(s) inválido(s)`)
  if (i.appointments) parts.push(`${i.appointments} turno(s) inválido(s)`)
  if (i.payments) parts.push(`${i.payments} pago(s) inválido(s)`)
  if (i.pagosCancelados) parts.push(`${i.pagosCancelados} cancelado(s) inválido(s)`)
  if (i.horarios) parts.push(`${i.horarios} horario(s) inválido(s)`)
  if (i.atencionesMensuales) parts.push(`${i.atencionesMensuales} atención(es) mensual(es) inválida(s)`)
  if (i.atencionesSinTurno) parts.push(`${i.atencionesSinTurno} listado(s) sin turno inválido(s)`)
  if (i.diasLibres) parts.push(`${i.diasLibres} día(s) libre(s) inválido(s)`)
  if (o.appointments) parts.push(`${o.appointments} turno(s) huérfano(s)`)
  if (o.payments) parts.push(`${o.payments} pago(s) huérfano(s)`)
  if (o.pagosCancelados) parts.push(`${o.pagosCancelados} cancelado(s) huérfano(s)`)
  if (o.horarios) parts.push(`${o.horarios} horario(s) huérfano(s)`)
  if (o.atencionesMensuales) parts.push(`${o.atencionesMensuales} atención(es) huérfana(s)`)
  if (o.atencionesSinTurno) parts.push(`${o.atencionesSinTurno} listado(s) sin turno huérfano(s)`)
  if (o.diasLibres) parts.push(`${o.diasLibres} día(s) libre(s) huérfano(s)`)
  if (parts.length === 0) return ''
  return `Integridad: se omitieron o limpiaron registros al cargar — ${parts.join('; ')}.`
}

/** Valida y normaliza el JSON de la base (sin datos demo), con informe de integridad. */
export function parseAppDataRecordWithReport(parsed: unknown): {
  data: AppData
  report: AppDataIntegrityReport
} {
  if (!isRecord(parsed)) {
    throw new Error('Formato de base de datos no reconocido.')
  }

  const pagosCanceladosRaw =
    parsed.pagosCancelados ??
    (typeof parsed.turnosEliminados !== 'undefined'
      ? parsed.turnosEliminados
      : [])

  const patients = parseArray(parsed.patients, parsePatient)
  const doctors = parseArray(parsed.doctors, parseDoctor)
  const horarios = parseArray(parsed.horarios, parseHorario)
  const atencionesMensuales = parseArray(
    parsed.atencionesMensuales,
    parseAtencionMensual,
  )
  const appointments = parseArray(parsed.appointments, parseAppointment)
  const paymentsRaw = parseArray(parsed.payments, parsePayment)
  const atencionesSinTurnoRaw = parseArray(
    parsed.atencionesSinTurno,
    parseAtencionSinTurnoListado,
  )
  const { listados: atencionesSinTurno, payments } = mergeAtencionSinTurnoStorage(
    atencionesSinTurnoRaw,
    paymentsRaw,
  )
  const pagosCancelados = normalizePagosCancelados(pagosCanceladosRaw)
  const diasLibres = normalizeDiasLibres(
    Array.isArray(parsed.diasLibres) ? parsed.diasLibres : [],
  )
  const pagosDeudasMedicos: DoctorDebtPayment[] = Array.isArray(
    parsed.pagosDeudasMedicos,
  )
    ? parsed.pagosDeudasMedicos.flatMap((raw) => {
        if (!isRecord(raw)) return []
        const id = nonEmptyId(raw.id)
        const doctorId = nonEmptyId(raw.doctorId)
        const deudaKey = nonEmptyId(raw.deudaKey)
        const monto = asNumber(raw.monto, 0)
        if (!id || !doctorId || !deudaKey || monto <= 0) return []
        return [{
          id,
          doctorId,
          deudaKey,
          fecha: asString(raw.fecha),
          monto,
          metodo: asString(raw.metodo, 'Efectivo'),
          destinatario: asString(raw.destinatario, 'Gerencia'),
          nroComprobante: asString(raw.nroComprobante),
          nota: asString(raw.nota),
        }]
      })
    : []

  const beforeSanitize: AppData = {
    patients,
    doctors,
    horarios,
    diasLibres,
    atencionesMensuales,
    appointments,
    payments,
    atencionesSinTurno,
    pagosCancelados,
    pagosDeudasMedicos,
  planesAfiliados: Array.isArray(parsed.planesAfiliados) ? parsed.planesAfiliados.flatMap((raw: unknown) => {
    if (!isRecord(raw)) return []
    const id = nonEmptyId(raw.id)
    if (!id) return []
    return [{
      id,
      nombre: asString(raw.nombre),
      precio: asNumber(raw.precio, 0),
      descripcion: asString(raw.descripcion),
      activo: asBoolean(raw.activo, true),
      tipo: (raw.tipo === 'familiar' ? 'familiar' : 'individual') as 'individual' | 'familiar',
      // Los planes guardados antes de existir el cupo se leen como "sin cupo".
      cupoConsultas: Math.max(0, Math.trunc(asNumber(raw.cupoConsultas, 0))),
      prestacionesPorMes: Math.max(0, Math.trunc(asNumber(raw.prestacionesPorMes, 0))),
      maxAdherentes: Math.max(0, Math.trunc(asNumber(raw.maxAdherentes, 0))),
    }]
  }) : [],
  afiliados: Array.isArray(parsed.afiliados) ? parsed.afiliados.flatMap((raw: unknown) => {
    if (!isRecord(raw)) return []
    const id = nonEmptyId(raw.id)
    if (!id) return []
    const suspension = isRecord(raw.suspension)
      ? {
          activa: asBoolean(raw.suspension.activa, false),
          desde: asString(raw.suspension.desde),
          ...(typeof raw.suspension.hasta === 'string' && raw.suspension.hasta.trim()
            ? { hasta: raw.suspension.hasta.trim() }
            : {}),
          motivo: asString(raw.suspension.motivo),
          ...(typeof raw.suspension.observaciones === 'string' && raw.suspension.observaciones.trim()
            ? { observaciones: raw.suspension.observaciones.trim() }
            : {}),
          ...(typeof raw.suspension.usuario === 'string' && raw.suspension.usuario.trim()
            ? { usuario: raw.suspension.usuario.trim() }
            : {}),
        }
      : undefined
    const baja = isRecord(raw.baja)
      ? {
          activa: asBoolean(raw.baja.activa, false),
          fecha: asString(raw.baja.fecha),
          motivo: asString(raw.baja.motivo),
          ...(typeof raw.baja.programada === 'boolean' ? { programada: raw.baja.programada } : {}),
          ...(typeof raw.baja.usuario === 'string' && raw.baja.usuario.trim()
            ? { usuario: raw.baja.usuario.trim() }
            : {}),
        }
      : undefined
    const cambioCoberturaProgramado = isRecord(raw.cambioCoberturaProgramado)
      ? {
          planNuevoId: asString(raw.cambioCoberturaProgramado.planNuevoId),
          planNuevoNombre: asString(raw.cambioCoberturaProgramado.planNuevoNombre),
          fechaVigencia: asString(raw.cambioCoberturaProgramado.fechaVigencia),
          ...(raw.cambioCoberturaProgramado.opcionAdherentes === 'sin_cobertura' ||
          raw.cambioCoberturaProgramado.opcionAdherentes === 'pasan_individual'
            ? {
                opcionAdherentes: raw.cambioCoberturaProgramado.opcionAdherentes as
                  | 'sin_cobertura'
                  | 'pasan_individual',
              }
            : {}),
          ...(Array.isArray(raw.cambioCoberturaProgramado.nuevosAdherentes)
            ? {
                nuevosAdherentes: raw.cambioCoberturaProgramado.nuevosAdherentes.flatMap(
                  (na: unknown) => {
                    if (!isRecord(na)) return []
                    return [
                      {
                        ...(typeof na.pacienteExistenteId === 'string' && na.pacienteExistenteId
                          ? { pacienteExistenteId: na.pacienteExistenteId }
                          : {}),
                        dni: asString(na.dni),
                        apellido: asString(na.apellido),
                        nombre: asString(na.nombre),
                        fechaNacimiento: asString(na.fechaNacimiento),
                        relacion: asString(na.relacion) || 'Otro',
                      },
                    ]
                  },
                ),
              }
            : {}),
          usuario: asString(raw.cambioCoberturaProgramado.usuario),
          creadoEn: asString(raw.cambioCoberturaProgramado.creadoEn),
        }
      : undefined
    const historialCoberturas = Array.isArray(raw.historialCoberturas)
      ? raw.historialCoberturas.flatMap((hc: unknown) => {
          if (!isRecord(hc)) return []
          return [
            {
              planId: asString(hc.planId),
              planNombre: asString(hc.planNombre),
              desde: asString(hc.desde),
              ...(typeof hc.hasta === 'string' && hc.hasta.trim() ? { hasta: hc.hasta.trim() } : {}),
            },
          ]
        })
      : undefined
    const movimientos = Array.isArray(raw.movimientos)
      ? raw.movimientos.flatMap((m: unknown) => {
          if (!isRecord(m)) return []
          const mid = nonEmptyId(m.id)
          if (!mid) return []
          const tipoRaw = asString(m.tipo)
          const tipo: 'alta' | 'cambio_cobertura' | 'suspension' | 'reactivacion' | 'baja' =
            tipoRaw === 'cambio_cobertura' ||
            tipoRaw === 'suspension' ||
            tipoRaw === 'reactivacion' ||
            tipoRaw === 'baja'
              ? tipoRaw
              : 'alta'
          return [
            {
              id: mid,
              afiliadoId: asString(m.afiliadoId, id),
              fecha: asString(m.fecha),
              tipo,
              detalle: asString(m.detalle),
              ...(typeof m.motivo === 'string' && m.motivo.trim() ? { motivo: m.motivo.trim() } : {}),
              usuario: asString(m.usuario, 'Sistema'),
              creadoEn: asString(m.creadoEn, asString(m.fecha)),
            },
          ]
        })
      : undefined
    return [{
      id,
      patientId: asString(raw.patientId),
      planId: asString(raw.planId),
      fechaInicio: asString(raw.fechaInicio),
      activo: asBoolean(raw.activo, true),
      ...(typeof raw.obraSocialAnterior === 'string' ? { obraSocialAnterior: raw.obraSocialAnterior } : {}),
      adherentes: Array.isArray(raw.adherentes) ? raw.adherentes.flatMap((adh: unknown) => {
        if (!isRecord(adh)) return []
        const pid = asString(adh.patientId)
        if (!pid) return []
        return [{
          patientId: pid,
          relacion: asString(adh.relacion) || 'Otro',
          ...(typeof adh.obraSocialAnterior === 'string' ? { obraSocialAnterior: adh.obraSocialAnterior } : {}),
        }]
      }) : [],
      ...(suspension ? { suspension } : {}),
      ...(baja ? { baja } : {}),
      ...(cambioCoberturaProgramado ? { cambioCoberturaProgramado } : {}),
      ...(historialCoberturas && historialCoberturas.length > 0 ? { historialCoberturas } : {}),
      ...(movimientos && movimientos.length > 0 ? { movimientos } : {}),
    }]
  }) : [],
  cuotasAfiliados: Array.isArray(parsed.cuotasAfiliados) ? parsed.cuotasAfiliados.flatMap((raw: unknown) => {
    if (!isRecord(raw)) return []
    const id = nonEmptyId(raw.id)
    if (!id) return []
    const estadoRaw = raw.estado
    const estado: CuotaMensual['estado'] = (estadoRaw === 'pagado' || estadoRaw === 'pendiente' || estadoRaw === 'vencido') ? estadoRaw : 'pendiente'
    const formaRaw = raw.formaPago
    const formaPago: FormaPago | null = (formaRaw === 'efectivo' || formaRaw === 'transferencia' || formaRaw === 'deposito' || formaRaw === 'mercadopago' || formaRaw === 'debito') ? formaRaw : null
    return [{
      id,
      afiliadoId: asString(raw.afiliadoId),
      mes: asNumber(raw.mes, 1),
      anio: asNumber(raw.anio, new Date().getFullYear()),
      monto: asNumber(raw.monto, 0),
      estado,
      fechaPago: raw.fechaPago === null ? null : asString(raw.fechaPago, '') || null,
      formaPago,
      comprobante: asBoolean(raw.comprobante, false),
      notas: asString(raw.notas),
      usos: Math.max(0, Math.trunc(asNumber(raw.usos, 0))),
    }]
  }) : [],
  distribucionOSPercentajes: Array.isArray(parsed.distribucionOSPercentajes)
    ? parsed.distribucionOSPercentajes.flatMap((raw: unknown) => {
      if (!isRecord(raw)) return []
      const obraSocial = asString(raw.obraSocial).trim()
      if (!obraSocial) return []
      return [{
        obraSocial,
        porcentaje: Math.min(100, Math.max(0, asNumber(raw.porcentaje, 0))),
      }]
    })
    : [],
  prestacionesAfiliados: buildPrestacionesCatalog(parsed.prestacionesAfiliados),
  ordenesMedicas: Array.isArray(parsed.ordenesMedicas)
    ? parsed.ordenesMedicas.flatMap((raw: unknown) => {
        if (!isRecord(raw)) return []
        const id = nonEmptyId(raw.id)
        const numero = asString(raw.numero).trim()
        const patientId = asString(raw.patientId).trim()
        if (!id || !numero || !patientId) return []
        return [{
          id,
          numero,
          patientId,
          afiliadoId: asString(raw.afiliadoId).trim(),
          planNombre: asString(raw.planNombre).trim(),
          tipo: raw.tipo === 'prestacion' ? ('prestacion' as const) : ('consulta' as const),
          ...(typeof raw.prestacionNombre === 'string' && raw.prestacionNombre.trim()
            ? { prestacionNombre: raw.prestacionNombre.trim() }
            : {}),
          ...(typeof raw.medicoId === 'string' && raw.medicoId.trim()
            ? { medicoId: raw.medicoId.trim() }
            : {}),
          ...(typeof raw.medicoNombre === 'string' && raw.medicoNombre.trim()
            ? { medicoNombre: raw.medicoNombre.trim() }
            : {}),
          fecha: asString(raw.fecha).trim(),
          ...(typeof raw.observaciones === 'string' && raw.observaciones.trim()
            ? { observaciones: raw.observaciones.trim() }
            : {}),
          ...(typeof raw.usuario === 'string' && raw.usuario.trim()
            ? { usuario: raw.usuario.trim() }
            : {}),
          creadaEn: asString(raw.creadaEn) || new Date().toISOString(),
        }]
      })
    : [],
    especialidadesCustom: parseEspecialidadesCustom(
      parsed.especialidadesCustom,
    ),
    obrasSociales: buildObrasSocialesCatalog(
      parsed.obrasSociales,
      parsed.obrasSocialesCustom,
      parsed.planesAfiliados,
    ),
    obrasSocialesCustom: parseEspecialidadesCustom(
      parsed.obrasSocialesCustom,
    ),
    localidadesCustom: parseEspecialidadesCustom(
      parsed.localidadesCustom,
    ),
    motivosConsultaCustom: parseEspecialidadesCustom(
      parsed.motivosConsultaCustom,
    ),
    settings: parseSettings(parsed.settings),
  }

  const data = sanitizeAppDataReferences(beforeSanitize)

  const report: AppDataIntegrityReport = {
    invalidRows: {
      patients: arrayRawLen(parsed.patients) - patients.length,
      doctors: arrayRawLen(parsed.doctors) - doctors.length,
      appointments: arrayRawLen(parsed.appointments) - appointments.length,
      payments: arrayRawLen(parsed.payments) - paymentsRaw.length,
      atencionesSinTurno:
        arrayRawLen(parsed.atencionesSinTurno) - atencionesSinTurnoRaw.length,
      pagosCancelados:
        arrayRawLen(pagosCanceladosRaw) - pagosCancelados.length,
      horarios: arrayRawLen(parsed.horarios) - horarios.length,
      atencionesMensuales:
        arrayRawLen(parsed.atencionesMensuales) - atencionesMensuales.length,
      diasLibres:
        arrayRawLen(parsed.diasLibres) - beforeSanitize.diasLibres.length,
    },
    orphanedRefs: {
      appointments:
        beforeSanitize.appointments.length - data.appointments.length,
      payments: beforeSanitize.payments.length - data.payments.length,
      pagosCancelados:
        beforeSanitize.pagosCancelados.length - data.pagosCancelados.length,
      horarios: beforeSanitize.horarios.length - data.horarios.length,
      atencionesMensuales:
        beforeSanitize.atencionesMensuales.length -
        data.atencionesMensuales.length,
      atencionesSinTurno:
        beforeSanitize.atencionesSinTurno.length -
        data.atencionesSinTurno.length,
      diasLibres: beforeSanitize.diasLibres.length - data.diasLibres.length,
    },
  }

  return { data, report }
}

/** Valida y normaliza el JSON de la base (sin datos demo). */
export function parseAppDataRecord(parsed: unknown): AppData {
  return parseAppDataRecordWithReport(parsed).data
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
