import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
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

  it('includes Total Efectivo column and page 2 doctor breakdown table when Todos los médicos is selected', () => {
    const doctorRows = [
      {
        day: '2026-11-05',
        turno: 'Mañana',
        doctorId: 'd1',
        doctorNombre: 'ALFONSO, CARMEN',
        cantidad: 4,
        facturado: 200000,
        transferencias: 0,
        efectivo: 200000,
        medico: 140000,
        cuidar: 60000,
      },
      {
        day: '2026-11-05',
        turno: 'Mañana',
        doctorId: 'd2',
        doctorNombre: 'VERA, JUANA',
        cantidad: 2,
        facturado: 95000,
        transferencias: 0,
        efectivo: 95000,
        medico: 69000,
        cuidar: 26000,
      },
      {
        day: '2026-11-05',
        turno: 'Tarde',
        doctorId: 'd2',
        doctorNombre: 'VERA, JUANA',
        cantidad: 3,
        facturado: 117000,
        transferencias: 0,
        efectivo: 117000,
        medico: 95700,
        cuidar: 21300,
      },
    ]

    const result = buildResumenCuidarPdf(
      '2026-11-05',
      '2026-11-05',
      'Todos los médicos',
      [
        {
          day: '2026-11-05',
          turno: 'Mañana',
          cantidad: 6,
          facturado: 295000,
          transferencias: 0,
          efectivo: 295000,
          medico: 209000,
          cuidar: 86000,
        },
        {
          day: '2026-11-05',
          turno: 'Tarde',
          cantidad: 3,
          facturado: 117000,
          transferencias: 0,
          efectivo: 117000,
          medico: 95700,
          cuidar: 21300,
        },
      ],
      {
        facturado: 412000,
        transferencias: 0,
        efectivo: 412000,
        medico: 304700,
        cuidar: 107300,
      },
      undefined,
      undefined,
      { doctorRows },
    )

    const text = result.doc.output()
    expect(text).toContain('Fac.')
    expect(text).toContain('Trans.')
    expect(text).toContain('Efectivo')
    expect(text).toContain('Total M')
    expect(text).toContain('Monto Cuidar')
    expect(text).toContain('412.000')
    expect(text).toContain('295.000')
    expect(text).toContain('117.000')
    // Verifica que en la hoja 2 está el resumen por día y médico
    expect(text).toContain('ALFONSO, CARMEN')
    expect(text).toContain('VERA, JUANA')
    expect(result.doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)

    const brainDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231'
    if (fs.existsSync(brainDir)) {
      fs.writeFileSync(
        path.join(brainDir, 'resumen-cuidar-todos-muestra.pdf'),
        Buffer.from(result.doc.output('arraybuffer')),
      )
    }
  })

  it('includes Total Efectivo column when a single doctor is selected as well', () => {
    const doctorMock = { id: 'd1', nombre: 'CARMEN', apellido: 'ALFONSO', especialidad: 'Endo', activo: true }
    const result = buildResumenCuidarPdf(
      '2026-11-05',
      '2026-11-05',
      'ALFONSO, CARMEN',
      [
        {
          day: '2026-11-05',
          turno: 'Mañana',
          cantidad: 1,
          facturado: 40000,
          transferencias: 0,
          efectivo: 40000,
          medico: 30000,
          cuidar: 10000,
        },
      ],
      {
        facturado: 40000,
        transferencias: 0,
        efectivo: 40000,
        medico: 30000,
        cuidar: 10000,
      },
      undefined,
      undefined,
      { doctor: doctorMock as any },
    )

    const text = result.doc.output()
    expect(text).toContain('Fac.')
    expect(text).toContain('Trans.')
    expect(text).toContain('Efectivo')
    expect(text).toContain('40.000')

    const brainDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231'
    if (fs.existsSync(brainDir)) {
      fs.writeFileSync(
        path.join(brainDir, 'resumen-cuidar-medico-muestra.pdf'),
        Buffer.from(result.doc.output('arraybuffer')),
      )
    }
  })

  it('preserves standard 8-column layout when includeTotalEfectivo is false', () => {
    const doctorMock = { id: 'd1', nombre: 'CARMEN', apellido: 'ALFONSO', especialidad: 'Endo', activo: true }
    const result = buildResumenCuidarPdf(
      '2026-11-05',
      '2026-11-05',
      'ALFONSO, CARMEN',
      [
        {
          day: '2026-11-05',
          turno: 'Mañana',
          cantidad: 1,
          facturado: 40000,
          transferencias: 0,
          medico: 30000,
          cuidar: 10000,
        },
      ],
      {
        facturado: 40000,
        transferencias: 0,
        medico: 30000,
        cuidar: 10000,
      },
      undefined,
      undefined,
      { doctor: doctorMock as any, includeTotalEfectivo: false },
    )

    const text = result.doc.output()
    expect(text).toContain('Fac.')
    expect(text).toContain('Trans.')
    expect(text).not.toContain('Total\nEfectivo')
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

  it('incluye la tabla de valores y porcentajes configurados del médico', () => {
    const docAlfonso = {
      id: 'doc-alfonso',
      apellido: 'ALFONSO',
      nombre: 'CARMEN',
      especialidad: 'Endocrinología',
      porcentaje: 0,
      valor: 0,
      particular: 40000,
      cuidar: 10000,
      obrasSociales: [{ nombre: 'PREVENCION SALUD', porcentaje: 30, monto: 0 }],
    }

    const result = buildResumenCuidarPdf(
      '2026-11-06',
      '2026-11-06',
      'ALFONSO, CARMEN',
      [
        {
          day: '2026-11-06',
          turno: 'Mañana',
          cantidad: 3,
          facturado: 100000,
          transferencias: 0,
          medico: 71000,
          cuidar: 29000,
        },
      ],
      {
        facturado: 100000,
        transferencias: 0,
        medico: 71000,
        cuidar: 29000,
      },
      undefined,
      'Mañana',
      {
        doctor: docAlfonso as any,
      },
    )

    expect(result.doc).toBeDefined()
    const text = result.doc.output()
    expect(text).toContain('PREVENCION SALUD')
    expect(text).toContain('40.000')

    const outDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231/scratch'
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true })
    }
    const outPath = path.join(outDir, 'ejemplo-resumen-cuidar-prueba.pdf')
    fs.writeFileSync(outPath, Buffer.from(result.doc.output('arraybuffer')))
  })

  it('incluye el diseño de viñetas para todos los médicos cuando no se filtra por uno solo', () => {
    const docAlfonso = {
      id: 'doc-alfonso',
      apellido: 'ALFONSO',
      nombre: 'CARMEN',
      especialidad: 'Endocrinología',
      porcentaje: 0,
      valor: 0,
      particular: 40000,
      cuidar: 10000,
      obrasSociales: [{ nombre: 'PREVENCION SALUD', porcentaje: 30, monto: 0 }],
    }
    const docAyala = {
      id: 'doc-ayala',
      apellido: 'AYALA',
      nombre: 'MARCELA ALEJANDRA',
      especialidad: 'Psiquiatría',
      porcentaje: 0,
      valor: 70000,
      particular: 70000,
      cuidar: 0,
      obrasSociales: [],
    }

    const result = buildResumenCuidarPdf(
      '2026-11-01',
      '2026-11-30',
      'Todos los médicos',
      [
        {
          day: '2026-11-05',
          turno: 'Mañana',
          cantidad: 6,
          facturado: 295000,
          transferencias: 0,
          medico: 209000,
          cuidar: 86000,
        },
      ],
      {
        facturado: 295000,
        transferencias: 0,
        medico: 209000,
        cuidar: 86000,
      },
      undefined,
      undefined,
      {
        doctors: [docAlfonso, docAyala] as any,
      },
    )

    expect(result.doc).toBeDefined()
    const text = result.doc.output()
    expect(text).toContain('ALFONSO, CARMEN')
    expect(text).toContain('AYALA, MARCELA ALEJANDRA')
    expect(text).toContain('Monto diario de Cuidar:')
    expect(text).toContain('70.000')
    expect(text).toContain('PREVENCION SALUD')
    // Verifica que ya no dibuja la tabla con el viejo encabezado
    expect(text).not.toContain('Valores y Porcentajes Configurados por Médico')
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
