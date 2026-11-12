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
  /** Obra social previa a afiliarse a un plan de salud (para restaurar al dar de baja) */
  obraSocialAnterior?: string
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

export interface DoctorObraSocial {
  nombre: string
  porcentaje: number
  monto: number
}

export interface ObraSocialCatalog {
  nombre: string
  plus: number
  arancel: number
  cuidar: number
  impBanco: number
  impFactura: number
  gastosAdm: number
  suspendida: boolean
  version: number
}

export interface Doctor {
  id: string
  nombre: string
  apellido: string
  dni: string
  matricula: string
  especialidad: string
  /** @deprecated Usar `obrasSociales` (se mantiene por compatibilidad con bases viejas). */
  obraSocial?: string
  /** Obras sociales que atiende el médico con % y monto (opcional). */
  obrasSociales?: DoctorObraSocial[]
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
  /** Monto en pesos (entero no negativo). */
  valor?: number | null
  /** Monto en pesos (entero no negativo). */
  particular?: number | null
  /** Monto en pesos que se queda el centro dentro de "particular" (entero no negativo). */
  cuidar?: number | null
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

export type TipoPlanAfiliado = 'individual' | 'familiar'

export interface PlanAfiliado {
  id: string
  nombre: string
  precio: number
  descripcion: string
  activo: boolean
  /** Individual (1 persona) o Familiar (titular + adherentes) */
  tipo?: TipoPlanAfiliado
  /**
   * Consultas gratuitas por mes incluidas en el plan. 0 = sin cupo.
   * Todavía no bloquea el agendamiento: sólo se guarda y se muestra.
   */
  cupoConsultas: number
  /**
   * Prestaciones gratuitas por mes incluidas en el plan. 0 = sin límite.
   */
  prestacionesPorMes?: number
  /**
   * Máximo de adherentes además del titular (solo si tipo === 'familiar'). 0 = sin límite.
   */
  maxAdherentes?: number
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
  /** Usuario que registró el cobro (pantalla Pagos de afiliados). */
  cobradoPor?: string
  /** Fecha y hora ISO del cobro (pantalla Pagos de afiliados). */
  registradoEn?: string
}

export type RelacionTitular = 'Cónyuge' | 'Hijo/a' | 'Otro'

export interface AdherenteAfiliado {
  patientId: string
  relacion: RelacionTitular | string
  obraSocialAnterior?: string
}

export type TipoMovimientoContratante =
  | 'alta'
  | 'cambio_cobertura'
  | 'suspension'
  | 'reactivacion'
  | 'baja'

export interface MovimientoContratante {
  id: string
  afiliadoId: string
  /** YYYY-MM-DD (fecha de vigencia del movimiento) */
  fecha: string
  tipo: TipoMovimientoContratante
  detalle: string
  motivo?: string
  usuario: string
  /** ISO datetime */
  creadoEn: string
}

export interface SuspensionContratante {
  activa: boolean
  /** YYYY-MM-DD */
  desde: string
  /** YYYY-MM-DD (opcional; si se define, se reactiva automáticamente ese día) */
  hasta?: string
  motivo: string
  observaciones?: string
  usuario?: string
}

export interface BajaContratante {
  activa: boolean
  /** YYYY-MM-DD */
  fecha: string
  motivo: string
  /** true cuando la fecha de baja es futura y aún no se ejecutó el corte */
  programada?: boolean
  usuario?: string
}

export type OpcionAdherentesFamiliarAIndividual = 'sin_cobertura' | 'pasan_individual'

export interface AdherenteCambioProgramado {
  pacienteExistenteId?: string
  dni: string
  apellido: string
  nombre: string
  fechaNacimiento: string
  relacion: RelacionTitular | string
}

export interface CambioCoberturaProgramado {
  planNuevoId: string
  planNuevoNombre: string
  /** YYYY-MM-DD */
  fechaVigencia: string
  opcionAdherentes?: OpcionAdherentesFamiliarAIndividual
  nuevosAdherentes?: AdherenteCambioProgramado[]
  usuario: string
  creadoEn: string
}

export interface HistorialCoberturaItem {
  planId: string
  planNombre: string
  /** YYYY-MM-DD */
  desde: string
  /** YYYY-MM-DD */
  hasta?: string
}

export interface Afiliado {
  id: string
  patientId: string
  planId: string
  /** YYYY-MM-DD */
  fechaInicio: string
  activo: boolean
  /** Obra social que tenía el titular antes de la afiliación (para restaurar en la baja). */
  obraSocialAnterior?: string
  /** Adherentes a la afiliación del titular (en planes familiares). */
  adherentes?: AdherenteAfiliado[]
  /** Estado de suspensión activa o programada del contratante y sus adherentes */
  suspension?: SuspensionContratante
  /** Datos de baja de afiliación (ejecutada o con fecha futura) */
  baja?: BajaContratante
  /** Cambio de cobertura programado para fecha futura (ej. 1.º del mes siguiente) */
  cambioCoberturaProgramado?: CambioCoberturaProgramado
  /** Historial de coberturas por las que pasó el contratante */
  historialCoberturas?: HistorialCoberturaItem[]
  /** Historial de movimientos (alta, cambio de cobertura, suspensión, reactivación, baja) */
  movimientos?: MovimientoContratante[]
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
  supabaseUrl?: string
  supabaseAnonKey?: string
  supabaseServiceRoleKey?: string
  supabaseAutoSync?: boolean
  supabaseUltimaSync?: string
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
  /** Catálogo unificado de obras sociales con montos y porcentajes */
  obrasSociales?: ObraSocialCatalog[]
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
  /** Catálogo de prestaciones configurables para órdenes médicas de Afiliados */
  prestacionesAfiliados?: PrestacionCatalogo[]
  /** Órdenes médicas emitidas para Afiliados */
  ordenesMedicas?: OrdenMedica[]
}

export interface PrestacionCatalogo {
  id: string
  nombre: string
  grupo: string
  activa: boolean
}

export type TipoOrdenMedica = 'consulta' | 'prestacion'

export interface OrdenMedica {
  id: string
  numero: string // Correlativo OM-0001
  patientId: string // ID del paciente (titular o adherente)
  afiliadoId: string // ID del registro Afiliado
  planNombre: string // Plan al momento de emitir
  tipo: TipoOrdenMedica
  prestacionNombre?: string // Prestación si tipo === 'prestacion'
  medicoId?: string // ID del médico solicitante (Pedido del Médico)
  medicoNombre?: string // Nombre del médico solicitante
  fecha: string // YYYY-MM-DD
  observaciones?: string
  usuario?: string // Usuario que emitió
  creadaEn: string // ISO string
}
