import { describe, expect, it } from 'vitest'
import {
  canExportMedicosListado,
  canExportPacientesListado,
  canExportPagosDetallePacientes,
  canExportPagosGerencia,
  canExportPagosGerenciaExcel,
  canSendClinicalEmailExport,
  canViewDoctorPorcentaje,
  canViewPagosPendientes,
  canAccessConfiguracion,
  canAccessMantenimiento,
} from './exportPermissions'

describe('exportPermissions', () => {
  it('admin tiene acceso a exportaciones sensibles', () => {
    expect(canExportPagosGerencia('admin')).toBe(true)
    expect(canExportPagosGerenciaExcel('admin')).toBe(true)
    expect(canExportPagosDetallePacientes('admin')).toBe(true)
    expect(canExportPacientesListado('admin')).toBe(true)
    expect(canExportMedicosListado('admin')).toBe(true)
    expect(canSendClinicalEmailExport('admin')).toBe(true)
    expect(canViewDoctorPorcentaje('admin')).toBe(true)
    expect(canViewPagosPendientes('admin')).toBe(true)
    expect(canAccessConfiguracion('admin')).toBe(true)
    expect(canAccessMantenimiento('admin')).toBe(true)
  })

  it('secretaria puede exportar cobranzas operativas y listados clínicos', () => {
    expect(canExportPacientesListado('secretaria')).toBe(true)
    expect(canExportMedicosListado('secretaria')).toBe(true)
    expect(canExportPagosDetallePacientes('secretaria')).toBe(true)
    expect(canExportPagosGerenciaExcel('secretaria')).toBe(true)
    expect(canSendClinicalEmailExport('secretaria')).toBe(true)
    expect(canViewDoctorPorcentaje('secretaria')).toBe(true)
  })

  it('secretaria no puede exportaciones Gerencia ni rutas de administración', () => {
    expect(canExportPagosGerencia('secretaria')).toBe(false)
    expect(canViewPagosPendientes('secretaria')).toBe(false)
    expect(canAccessConfiguracion('secretaria')).toBe(false)
    expect(canAccessMantenimiento('secretaria')).toBe(false)
  })
})
