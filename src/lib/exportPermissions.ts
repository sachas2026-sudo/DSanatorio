import type { AppRole } from './auth'

function isAdmin(role: AppRole): boolean {
  return role === 'admin'
}

/** Porcentaje de liquidación del médico (UI y PDFs de cobranzas). Admin y secretaría. */
export function canViewDoctorPorcentaje(role: AppRole): boolean {
  return isAdmin(role) || role === 'secretaria'
}

/** PDF Gerencia, Obra Social y correo con PDF Gerencia. Solo administración. */
export function canExportPagosGerencia(role: AppRole): boolean {
  return isAdmin(role)
}

/** Excel crudo Gerencia en pantalla Pagos. Admin y secretaría. */
export function canExportPagosGerenciaExcel(role: AppRole): boolean {
  return isAdmin(role) || role === 'secretaria'
}

/** PDF de cobranzas con nombres de pacientes (Resumen por Médico). Admin y secretaría. */
export function canExportPagosDetallePacientes(role: AppRole): boolean {
  return isAdmin(role) || role === 'secretaria'
}

/** Listado completo de pacientes (incluye DNI Pac). Admin y secretaría. */
export function canExportPacientesListado(role: AppRole): boolean {
  return isAdmin(role) || role === 'secretaria'
}

/** Listado de médicos en PDF. Admin y secretaría. */
export function canExportMedicosListado(role: AppRole): boolean {
  return isAdmin(role) || role === 'secretaria'
}

/** Envío por correo de PDFs con datos clínicos (agenda o pagos). Admin y secretaría. */
export function canSendClinicalEmailExport(role: AppRole): boolean {
  return isAdmin(role) || role === 'secretaria'
}

/** Modal de pacientes atendidos sin pago registrado. */
export function canViewPagosPendientes(role: AppRole): boolean {
  return isAdmin(role)
}

/** Pantalla Configuración (usuarios, respaldos, correo). */
export function canAccessConfiguracion(role: AppRole): boolean {
  return isAdmin(role)
}

/** Pantalla de copias de seguridad. Solo administración. */
export function canAccessBackup(role: AppRole): boolean {
  return isAdmin(role)
}

/** Pantalla Mantenimiento (recuperación, acceso técnico). */
export function canAccessMantenimiento(role: AppRole): boolean {
  return isAdmin(role)
}

export const EXPORT_DENIED_MESSAGE =
  'Esta exportación está reservada para administración.'
