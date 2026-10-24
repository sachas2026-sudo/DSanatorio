/**
 * Con qué se factura un turno: la obra social del paciente, su plan de
 * afiliado, o como particular.
 *
 * El plan no es una segunda obra social: es una suscripción mensual
 * (CuotaMensual). La cobertura del turno sólo decide a quién se le atribuye
 * el importe y cómo aparece en los informes.
 */
export type CoberturaTipo = 'obraSocial' | 'plan' | 'particular'

export interface Patient {
  id: string
  nombre: string
  apellido: string
  dni: string
  telefono: string
  email: string
  domicilio: string
  localidad: string
  fechaNacimiento: string
  obraSocial: string
  notas: string
  /** false = suspendido (no aparece en listas operativas; historial intacto). */
  activo?: boolean
  /**
   * Cobertura con la que se agendan sus turnos por defecto.
   * Si no está, se usa la obra social del paciente.
   */
  coberturaPreferida?: CoberturaTipo
}

export type DoctorTipoAgenda = 'semanal' | 'mensual'

export interface Doctor {
  id: string
  nombre: string
  apellido: string
  dni: string
  matricula: string
  especialidad: string
  /** @deprecated Usar `obrasSociales` (se mantiene por compatibilidad con bases viejas). */
  obraSocial?: string
  /** Obras sociales que atiende el médico (opcional). */
  obrasSociales?: string[]
  telefono: string
  localidad: string
  email: string
  /** Nombre corto o código interno (opcional). */
  alias?: string
  /** Porcentaje (0–999, hasta 2 decimales), uso interno. */
  porcentaje?: number
  /** Minutos entre turnos (ej. 15 → 8:00, 8:15, 8:30…). Por defecto 30. */
  duracionTurnoMinutos?: number
  /** Semanal: horarios por día; mensual: solo fechas en atencionesMensuales. */
  tipoAgenda?: DoctorTipoAgenda
  /** false = suspendido (no aparece en listas operativas; historial intacto). */
  activo?: boolean
}

/** Día puntual de atención (médicos que vienen una vez al mes o fechas especiales). */
export interface DoctorAtencionMensual {
  id: string
  doctorId: string
  /** YYYY-MM-DD */
  fecha: string
  horaInicio: string
  horaFin: string
}

export interface DoctorHorario {
  id: string
  doctorId: string
  diaSemana: number
  horaInicio: string
  horaFin: string
}

/** Día de la semana en que el médico no atiende (0 = domingo … 6 = sábado) */
export interface DoctorDiaLibre {
  id: string
  doctorId: string
  diaSemana: number
}

export type AppointmentEstado = 'programado' | 'cancelado' | 'atendido'

export interface Appointment {
  id: string
  patientId: string
  doctorId: string
  fechaHora: string
  duracionMinutos: number
  notas: string
  estado: AppointmentEstado
  /** Segundo motivo de la consulta (opcional). `notas` sigue siendo el motivo 1. */
  motivoConsulta2?: string
  /** Sobrescribe la obra social del paciente solo para este turno (ej: 'Particular'). */
  obraSocialOverride?: string
  /** ISO: WhatsApp recordatorio abierto desde la app (aprox. enviado). */
  whatsappRecordatorioEnviadoEn?: string
  /** Usuario que reservó el turno por primera vez */
  creadoPor?: string
  /** Usuario que modificó el turno por última vez */
  modificadoPor?: string
  /** Fecha/hora ISO de la última modificación del turno */
  modificadoEn?: string
}

export interface Payment {
  id: string
  patientId: string
  doctorId: string
  citaId: string | null
  monto: number
  fecha: string
  metodo: string
  notas: string
  /** Sobrescribe la obra social del paciente solo para este cobro (ej: 'Particular'). */
  obraSocialOverride?: string
  /** % del médico al registrar el cobro (no cambia si luego editan al médico). */
  porcentajeAplicado?: number
  /** Usuario que registró el cobro por primera vez */
  registradoPor?: string
  /** Usuario que modificó el cobro por última vez (si fue editado) */
  modificadoPor?: string
  /** Fecha/hora ISO de la última modificación (si fue editado) */
  modificadoEn?: string
}

export interface DoctorDebtPayment {
  id: string
  doctorId: string
  deudaKey: string
  fecha: string
  monto: number
  metodo: string
  /** A quién se le paga la deuda. Por defecto "Gerencia". */
  destinatario: string
  /** Nº de comprobante del pago (opcional). */
  nroComprobante: string
  nota: string
}

/** Fila guardada en un listado de atención sin turno (base propia, no Pagos). */
export interface AtencionSinTurnoFila {
  patientId: string
  monto: number
}

/** Listado de atención sin turno por médico y fecha (YYYY-MM-DD). */
export interface AtencionSinTurnoListado {
  id: string
  doctorId: string
  /** YYYY-MM-DD */
  fecha: string
  filas: AtencionSinTurnoFila[]
  guardadoEn: string
}

/** Motivo al cancelar un pago desde Pagos de consultas */
export type MotivoCancelacionPago =
  | 'cancelacion_paciente'
  | 'cancelacion_doctor'
  | 'otros'

/** Registro en base Pagos Cancelados (archivo JSON con el resto de la app) */
export interface PagoCancelado {
  id: string
  motivo: MotivoCancelacionPago
  canceladoEn: string
  /** Copia del pago al momento de cancelar */
  payment: Payment
  /** Turno vinculado (cita), si existía */
  appointment: Appointment | null
  /** Detalle cuando motivo es "otros" */
  notasOtros: string
  /** Usuario que realizó la cancelación/eliminación */
  canceladoPor?: string
}

// ── Módulo Afiliados ──────────────────────────────────────────────────────────

export interface PlanAfiliado {
  id: string
  nombre: string
  precio: number
  descripcion: string
  activo: boolean
  /**
   * Consultas gratuitas por mes incluidas en el plan. 0 = sin cupo.
   * Todavía no bloquea el agendamiento: sólo se guarda y se muestra.
   */
  cupoConsultas: number
}

export type CuotaEstado = 'pagado' | 'pendiente' | 'vencido'

export type FormaPago = 'efectivo' | 'transferencia' | 'deposito' | 'mercadopago' | 'debito'

export interface CuotaMensual {
  id: string
  afiliadoId: string
  /** 1–12 */
  mes: number
  anio: number
  monto: number
  estado: CuotaEstado
  /** YYYY-MM-DD o null */
  fechaPago: string | null
  formaPago: FormaPago | null
  comprobante: boolean
  notas: string
  /**
   * Atenciones ya registradas contra esta cuota. Se suman al agendar un
   * turno cubierto por el plan. El cupo por mes todavía no se aplica: por
   * ahora es sólo el contador.
   */
  usos: number
}

export interface Afiliado {
  id: string
  patientId: string
  planId: string
  /** YYYY-MM-DD */
  fechaInicio: string
  activo: boolean
}

/** Datos institucionales del centro médico (configuración) */
export interface AppSettings {
  email: string
  emailGerente: string
  telefonoGerente: string
  clave: string
  telefono: string
  cuit: string
  carpetaBackupGoogleDrive?: string
  carpetaExportarGoogleDrive?: string
  carpetaPdfsGoogleDrive?: string
  /** Ruta completa elegida manualmente (override por PC). */
  rutaGoogleDriveCustom?: string
  /** No copiar respaldos/exportaciones a Google Drive en esta PC. */
  googleDriveDeshabilitado?: boolean
  /** El asistente inicial de Google Drive ya se completó. */
  googleDriveSetupCompletado?: boolean
  /** Habilitar que secretaría pueda modificar turnos de todo el mes actual (en lugar de solo la semana) */
  secretariaPuedeModificarMesActual?: boolean
  /** Habilitar que usuarios de distintos turnos puedan modificar turnos no suyos */
  secretariaPuedeModificarTurnosOtrosUsuarios?: boolean
  /** Mostrar columna de acciones (editar/eliminar) en el listado de pagos */
  mostrarAccionesEnListaPagos?: boolean
}

// ── Módulo Distribución por médico · Obras Sociales ─────────────────────────

/** Porcentaje que le corresponde a cada obra social en el reparto. */
export interface DistribucionOSPercentaje {
  /** Nombre de la obra social (se referencia por texto, como las obras ya usadas). */
  obraSocial: string
  /** 0–100 */
  porcentaje: number
}

export interface AppData {
  patients: Patient[]
  doctors: Doctor[]
  horarios: DoctorHorario[]
  diasLibres: DoctorDiaLibre[]
  atencionesMensuales: DoctorAtencionMensual[]
  appointments: Appointment[]
  payments: Payment[]
  /** Listados de atención sin turno (independientes de turnos y Pagos). */
  atencionesSinTurno: AtencionSinTurnoListado[]
  /** Historial de pagos cancelados desde Pagos de consultas */
  pagosCancelados: PagoCancelado[]
  /** Pagos directos aplicados a deudas de médicos. */
  pagosDeudasMedicos?: DoctorDebtPayment[]
  /** Especialidades agregadas por el usuario (además de las comunes) */
  especialidadesCustom: string[]
  /** Obras sociales agregadas por el usuario (además de las habituales) */
  obrasSocialesCustom: string[]
  /** Localidades agregadas por el usuario (además de Misiones) */
  localidadesCustom: string[]
  /** Motivos de consulta agregados por el usuario (además de los habituales) */
  motivosConsultaCustom: string[]
  settings: AppSettings
  /** Módulo Afiliados */
  planesAfiliados: PlanAfiliado[]
  afiliados: Afiliado[]
  cuotasAfiliados: CuotaMensual[]
  /** Módulo Distribución por médico · Obras Sociales.
      Sólo se guardan los porcentajes: médicos y montos salen del filtro de Pagos. */
  distribucionOSPercentajes: DistribucionOSPercentaje[]
}
