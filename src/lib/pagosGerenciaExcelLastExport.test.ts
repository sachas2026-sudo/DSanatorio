import { describe, expect, it, beforeEach } from 'vitest'
import {
  PAGOS_GERENCIA_EXCEL_LAST_EXPORT_KEY,
  pagosGerenciaExcelExportRangeKey,
  readLastPagosGerenciaExcelExportForRange,
  readLastPagosGerenciaExcelExportRecord,
  saveLastPagosGerenciaExcelExportForRange,
  formatPagosGerenciaExcelExportRangeLabel,
  formatLastPagosGerenciaExcelExportRangeLabel,
} from './pagosGerenciaExcelLastExport'

describe('pagosGerenciaExcelLastExport', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('normaliza la clave del rango', () => {
    expect(pagosGerenciaExcelExportRangeKey('2026-06-03', '2026-06-01')).toBe(
      '2026-06-01__2026-06-03',
    )
  })

  it('guarda y lee por rango desde/hasta', () => {
    saveLastPagosGerenciaExcelExportForRange(
      '2026-06-01',
      '2026-06-03',
      '2026-06-03T18:00:00.000Z',
    )
    expect(readLastPagosGerenciaExcelExportForRange('2026-06-01', '2026-06-03')).toBe(
      '2026-06-03T18:00:00.000Z',
    )
    expect(readLastPagosGerenciaExcelExportForRange('2026-06-04', '2026-06-05')).toBeNull()
  })

  it('rangos distintos no pisan el historial', () => {
    saveLastPagosGerenciaExcelExportForRange(
      '2026-06-01',
      '2026-06-03',
      '2026-06-03T10:00:00.000Z',
    )
    saveLastPagosGerenciaExcelExportForRange(
      '2026-06-04',
      '2026-06-05',
      '2026-06-05T12:00:00.000Z',
    )
    expect(readLastPagosGerenciaExcelExportForRange('2026-06-01', '2026-06-03')).toBe(
      '2026-06-03T10:00:00.000Z',
    )
    expect(readLastPagosGerenciaExcelExportForRange('2026-06-04', '2026-06-05')).toBe(
      '2026-06-05T12:00:00.000Z',
    )
    const raw = JSON.parse(localStorage.getItem(PAGOS_GERENCIA_EXCEL_LAST_EXPORT_KEY)!)
    expect(Object.keys(raw.byRange)).toHaveLength(2)
  })

  it('formatea etiqueta de rango', () => {
    expect(formatPagosGerenciaExcelExportRangeLabel('2026-06-01', '2026-06-03')).toBe(
      '1-6 al 3-6 2026',
    )
  })

  it('persiste la última exportación con su rango', () => {
    saveLastPagosGerenciaExcelExportForRange(
      '2026-06-01',
      '2026-06-04',
      '2026-06-05T14:17:00.000Z',
    )
    expect(readLastPagosGerenciaExcelExportRecord()).toEqual({
      desde: '2026-06-01',
      hasta: '2026-06-04',
      exportedAt: '2026-06-05T14:17:00.000Z',
    })
    expect(formatLastPagosGerenciaExcelExportRangeLabel(
      readLastPagosGerenciaExcelExportRecord()!,
    )).toBe('1-6 al 4-6 2026')
  })

  it('actualiza la última exportación al generar una nueva', () => {
    saveLastPagosGerenciaExcelExportForRange(
      '2026-06-01',
      '2026-06-04',
      '2026-06-05T14:17:00.000Z',
    )
    saveLastPagosGerenciaExcelExportForRange(
      '2026-06-10',
      '2026-06-12',
      '2026-06-12T09:00:00.000Z',
    )
    expect(readLastPagosGerenciaExcelExportRecord()?.desde).toBe('2026-06-10')
    expect(readLastPagosGerenciaExcelExportRecord()?.hasta).toBe('2026-06-12')
  })
})
