export interface MedicoResumenItem {
  id: string
  nombre: string
  especialidad?: string
  pacientes: number
  totalCobrado: number
  totalCentro: number
  totalMedico: number
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
  ultima_actualizacion: string // ISO
  origen: string
}

export interface SupabaseConfig {
  url: string
  anonKey: string
}

