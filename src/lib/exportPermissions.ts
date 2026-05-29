import type { AppRole } from './auth'

function isAdmin(role: AppRole): boolean {
  return role === 'admin'
}

/** Porcentaje de liquidación del médico (UI y PDFs de cobranzas). */
export function canViewDoctorPorcentaje(role: AppRole): boolean {
  return isAdmin(role)
}

/** PDF/Excel Gerencia, Obra Social y correo de resumen de cobranzas. */
export function canExportPagosGerencia(role: AppRole): boolean {
  return isAdmin(role)
}

/** PDF de cobranzas con nombres de pacientes. */
export function canExportPagosDetallePacientes(role: AppRole): boolean {
  return isAdmin(role)
}

/** Listado completo de pacientes (incluye DNI). */
export function canExportPacientesListado(role: AppRole): boolean {
  return isAdmin(role)
}

/** Listado de médicos en PDF. */
export function canExportMedicosListado(role: AppRole): boolean {
  return isAdmin(role)
}

/** Envío por correo de PDFs con datos clínicos (agenda o pagos). */
export function canSendClinicalEmailExport(role: AppRole): boolean {
  return isAdmin(role)
}

/** Modal de pacientes atendidos sin pago registrado. */
export function canViewPagosPendientes(role: AppRole): boolean {
  return isAdmin(role)
}

export const EXPORT_DENIED_MESSAGE =
  'Esta exportación está reservada para administración.'
