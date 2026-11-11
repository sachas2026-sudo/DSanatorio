export interface MedicoResumenItem {
  id?: string
  nombre: string
  especialidad?: string
  pacientes: number
  monto?: number
  totalCobrado?: number
  totalCentro?: number
  totalMedico?: number
}

export interface TurnosClasificacionItem {
  obra_social: number
  individual: number
  familiar: number
  plan_plus: number // legacy
  particular: number
}

export interface TurnosClasificacion {
  atendidos: TurnosClasificacionItem
  pendientes: TurnosClasificacionItem
  cancelados: TurnosClasificacionItem
}

export interface ResumenDiario {
  fecha: string // YYYY-MM-DD
  total_cobrado: number
  total_centro: number
  total_medicos: number
  total_efectivo: number
  total_transferencia: number
  total_otros: number
  turnos_totales: number
  turnos_atendidos: number
  turnos_cancelados: number
  turnos_pendientes: number
  recaudacion_manana: number
  recaudacion_tarde: number
  recaudacion_mary: number
  recaudacion_andrea: number
  medicos_detalle: MedicoResumenItem[]
  turnos_clasificacion?: TurnosClasificacion
  ultima_actualizacion: string // ISO
  origen: string
}

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export interface MedicoDirectorio {
  medico_id: string
  nombre: string
  especialidad: string
  porcentaje_medico: number
  activo: boolean
  ultima_actualizacion?: string
}
