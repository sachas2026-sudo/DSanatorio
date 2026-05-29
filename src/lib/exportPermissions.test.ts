import { describe, expect, it } from 'vitest'
import {
  canExportMedicosListado,
  canExportPacientesListado,
  canExportPagosDetallePacientes,
  canExportPagosGerencia,
  canSendClinicalEmailExport,
  canViewDoctorPorcentaje,
  canViewPagosPendientes,
} from './exportPermissions'

describe('exportPermissions', () => {
  it('admin tiene acceso a exportaciones sensibles', () => {
    expect(canExportPagosGerencia('admin')).toBe(true)
    expect(canExportPagosDetallePacientes('admin')).toBe(true)
    expect(canExportPacientesListado('admin')).toBe(true)
    expect(canExportMedicosListado('admin')).toBe(true)
    expect(canSendClinicalEmailExport('admin')).toBe(true)
    expect(canViewDoctorPorcentaje('admin')).toBe(true)
    expect(canViewPagosPendientes('admin')).toBe(true)
  })

  it('secretaria no puede exportar ni ver liquidación', () => {
    expect(canExportPagosGerencia('secretaria')).toBe(false)
    expect(canExportPagosDetallePacientes('secretaria')).toBe(false)
    expect(canExportPacientesListado('secretaria')).toBe(false)
    expect(canExportMedicosListado('secretaria')).toBe(false)
    expect(canSendClinicalEmailExport('secretaria')).toBe(false)
    expect(canViewDoctorPorcentaje('secretaria')).toBe(false)
    expect(canViewPagosPendientes('secretaria')).toBe(false)
  })
})
