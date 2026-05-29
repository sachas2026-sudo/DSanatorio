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
}

export type DoctorTipoAgenda = 'semanal' | 'mensual'

export interface Doctor {
  id: string
  nombre: string
  apellido: string
  matricula: string
  especialidad: string
  telefono: string
  localidad: string
  email: string
  /** Porcentaje (0–999), uso interno. */
  porcentaje?: number
  /** Minutos entre turnos (ej. 15 → 8:00, 8:15, 8:30…). Por defecto 30. */
  duracionTurnoMinutos?: number
  /** Semanal: horarios por día; mensual: solo fechas en atencionesMensuales. */
  tipoAgenda?: DoctorTipoAgenda
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
}

/** Datos institucionales del centro médico (configuración) */
export interface AppSettings {
  email: string
  emailGerente: string
  telefonoGerente: string
  clave: string
  telefono: string
  cuit: string
}

export interface AppData {
  patients: Patient[]
  doctors: Doctor[]
  horarios: DoctorHorario[]
  diasLibres: DoctorDiaLibre[]
  atencionesMensuales: DoctorAtencionMensual[]
  appointments: Appointment[]
  payments: Payment[]
  /** Historial de pagos cancelados desde Pagos de consultas */
  pagosCancelados: PagoCancelado[]
  /** Especialidades agregadas por el usuario (además de las comunes) */
  especialidadesCustom: string[]
  /** Obras sociales agregadas por el usuario (además de las habituales) */
  obrasSocialesCustom: string[]
  /** Localidades agregadas por el usuario (además de Misiones) */
  localidadesCustom: string[]
  settings: AppSettings
}
