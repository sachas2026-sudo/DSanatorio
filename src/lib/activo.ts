import type { Doctor, Patient } from '../types'

/** Activo salvo `activo === false` (registros viejos sin campo = activos). */
export function isPacienteActivo(p: Patient): boolean {
  return p.activo !== false
}

export function isMedicoActivo(d: Doctor): boolean {
  return d.activo !== false
}

export function pacientesActivos(patients: Patient[]): Patient[] {
  return patients.filter(isPacienteActivo)
}

export function medicosActivos(doctors: Doctor[]): Doctor[] {
  return doctors.filter(isMedicoActivo)
}

export function pacientesSuspendidos(patients: Patient[]): Patient[] {
  return patients.filter((p) => !isPacienteActivo(p))
}

export function medicosSuspendidos(doctors: Doctor[]): Doctor[] {
  return doctors.filter((d) => !isMedicoActivo(d))
}
