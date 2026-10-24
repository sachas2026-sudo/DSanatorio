import type { Afiliado, Patient, PlanAfiliado } from '../types'

/** Obra social efectiva: el plan activo del Sanatorio funciona como cobertura. */
export function patientObraSocial(
  patient: Patient | undefined,
  afiliados: Afiliado[] = [],
  planes: PlanAfiliado[] = [],
): string {
  if (!patient) return ''
  const afiliado = afiliados.find(a => a.patientId === patient.id && a.activo)
  const plan = afiliado ? planes.find(p => p.id === afiliado.planId) : undefined
  return plan?.nombre?.trim() || patient.obraSocial?.trim() || ''
}
