import type { Afiliado, Patient, PlanAfiliado } from '../types'
import { buscarAfiliacionYPlanPaciente } from './consumoAfiliados'

/** Obra social efectiva: el plan activo del Sanatorio funciona como cobertura (titular o adherente). */
export function patientObraSocial(
  patient: Patient | undefined,
  afiliados: readonly Afiliado[] = [],
  planes: readonly PlanAfiliado[] = [],
): string {
  if (!patient) return ''
  const info = buscarAfiliacionYPlanPaciente(patient.id, afiliados, planes)
  if (info) return info.plan.nombre.trim()
  return patient.obraSocial?.trim() || ''
}
