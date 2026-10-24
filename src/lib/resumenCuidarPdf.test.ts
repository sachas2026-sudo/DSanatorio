import { describe, it, expect } from 'vitest'
import {
  buildObraSocialDashboardPdf,
  buildResumenCuidarPdf,
} from './resumenCuidarPdf'

describe('buildResumenCuidarPdf', () => {
  it('generates a PDF with date range, doctor and turno in header subtitle', () => {
    const result = buildResumenCuidarPdf(
      '2026-10-01',
      '2026-10-31',
      'AGUIRRE, RAFAEL',
      [
        {
          day: '2026-10-01',
          turno: 'Mañana',
          cantidad: 5,
          facturado: 50000,
          transferencias: 10000,
          medico: 40000,
          cuidar: 10000,
        },
      ],
      {
        facturado: 50000,
        transferencias: 10000,
        medico: 40000,
        cuidar: 10000,
      },
      'Generado por: Administrador',
      'Mañana',
    )

    expect(result.doc).toBeDefined()
    expect(result.filename).toContain('resumen-cuidar-')
    expect(result.title).toBe('Resumen Cuidar')
  })

  it('handles single day without duplicating date range in subtitle', () => {
    const result = buildResumenCuidarPdf(
      '2026-10-05',
      '2026-10-05',
      'Todos los médicos',
      [],
      {
        facturado: 0,
        transferencias: 0,
        medico: 0,
        cuidar: 0,
      },
      undefined,
      'Tarde',
    )

    expect(result.doc).toBeDefined()
    expect(result.filename).toContain('resumen-cuidar-')
  })

  it('adds the debt notice when the doctor owes Cuidar', () => {
    const result = buildResumenCuidarPdf(
      '2026-10-07',
      '2026-10-07',
      'ALFONSO, CARMEN',
      [
        {
          day: '2026-10-07',
          turno: 'Mañana',
          cantidad: 1,
          facturado: 70000,
          transferencias: 70000,
          medico: -10850,
          cuidar: 10850,
        },
      ],
      {
        facturado: 70000,
        transferencias: 70000,
        medico: -10850,
        cuidar: 10850,
      },
    )

    expect(result.doc).toBeDefined()
  })

  it('adds a final debt page when the global debt rows are supplied', () => {
    const result = buildResumenCuidarPdf(
      '2026-10-07',
      '2026-10-07',
      'Todos los médicos',
      [],
      { facturado: 0, transferencias: 0, medico: 0, cuidar: 0 },
      undefined,
      undefined,
      {
        doctorDebtRows: [{
          key: 'doc-1__2026-10-07', doctorId: 'doc-1', fecha: '2026-10-07',
          doctor: 'PEREZ, JUAN', concepto: 'Comisión pendiente',
          deuda: 1000, pagado: 200, saldo: 800, estado: 'Parcial',
        }],
        doctorDebtLabel: 'PEREZ, JUAN',
      },
    )

    expect(result.doc.getNumberOfPages()).toBe(2)
  })

  it('genera el tablero horizontal agrupado por obra social', () => {
    const result = buildObraSocialDashboardPdf(
      '2026-10-01',
      '2026-10-07',
      'Todas las obras sociales',
      [
        { obraSocial: 'OSDE', cantidad: 243, facturado: 428760, medico: 300132, cuidar: 128628 },
        { obraSocial: 'IPS', cantidad: 186, facturado: 312450, medico: 218715, cuidar: 93735 },
      ],
      'Generado por: Administrador',
      undefined,
      true,
    )

    expect(result.doc.internal.pageSize.getWidth()).toBeGreaterThan(
      result.doc.internal.pageSize.getHeight(),
    )
    expect(result.filename).toContain('resumen-obra-social-')
    expect(result.title).toBe('Obras Sociales')
  })
})
