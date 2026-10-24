import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx/xlsx.mjs'
import { buildDistribucionObrasSocialesWorkbook, distribucionObrasSocialesExcelFilename } from './distribucionObrasSocialesExcel'
import type { DistribucionObrasSocialesPdfRow, DistribucionPdfObra } from './distribucionObrasSocialesPdf'

const OBRAS: DistribucionPdfObra[] = [
  { nombre: 'OSDE', porcentaje: 30 },
  { nombre: 'PAMI', porcentaje: 25 },
]

const RESUMEN: DistribucionObrasSocialesPdfRow[] = [
  {
    fecha: '01-05-26 / 31-05-26',
    medico: 'AGUIRRE, RAFAEL',
    paciente: 'Varios',
    motivo: 'Consulta',
    monto: '$ 100.000',
    porObraSocial: ['$ 30.000', ''],
    total: '$ 70.000',
  },
]

const DETALLE: DistribucionObrasSocialesPdfRow[] = [
  {
    fecha: '11-05-26',
    medico: 'AGUIRRE, RAFAEL',
    paciente: 'PEREZ, ANA',
    motivo: 'Consulta',
    monto: '$ 100.000',
    porObraSocial: ['$ 30.000', ''],
    total: '$ 70.000',
  },
]

function leer(wb: XLSX.WorkBook, hoja: string): (string | number)[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[hoja]!, { header: 1, raw: true }) as (string | number)[][]
}

describe('buildDistribucionObrasSocialesWorkbook', () => {
  it('arma la hoja Resumen con las columnas de obra social y los importes numéricos', () => {
    const wb = buildDistribucionObrasSocialesWorkbook({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: 'Obra Social: OSDE',
      obras: OBRAS,
      rows: RESUMEN,
    })

    expect(wb.SheetNames).toEqual(['Resumen'])
    const aoa = leer(wb, 'Resumen')

    expect(aoa[0]).toEqual(['Distribución por médico · Obras sociales'])
    expect(aoa[1]).toEqual(['Obras sociales · período 01/05/2026 – 31/05/2026'])
    expect(aoa[2]).toEqual(['Filtro: Obra Social: OSDE'])
    expect(aoa[3]).toEqual(['TOTAL FACTURADO', 100000, 'TOTAL MÉDICO', 70000, 'TOTAL CUIDAR', 30000])

    // Encabezado de la tabla: nombre de cada obra social con su porcentaje.
    expect(aoa[6]).toEqual([
      'Fecha',
      'Médico',
      'Paciente',
      'Motivo de la Consulta',
      'Monto',
      'OSDE · 30%',
      'PAMI · 25%',
      'Total Médico',
    ])

    // Fila de datos: importes como número (Excel los puede sumar).
    expect(aoa[7]).toEqual([
      '01-05-26 / 31-05-26',
      'AGUIRRE, RAFAEL',
      'Varios',
      'Consulta',
      100000,
      30000,
      '',
      70000,
    ])

    // Totales.
    expect(aoa[8]).toEqual(['TOTALES', '', '', '', 100000, 30000, '', 70000])
  })

  it('agrega la hoja Completo sólo cuando se manda el detalle', () => {
    const sinDetalle = buildDistribucionObrasSocialesWorkbook({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: '',
      obras: OBRAS,
      rows: RESUMEN,
    })
    expect(sinDetalle.SheetNames).toEqual(['Resumen'])

    const conDetalle = buildDistribucionObrasSocialesWorkbook({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: '',
      obras: OBRAS,
      rows: RESUMEN,
      rowsCompletas: DETALLE,
    })
    expect(conDetalle.SheetNames).toEqual(['Resumen', 'Completo'])
    expect(leer(conDetalle, 'Completo')[7]?.[2]).toBe('PEREZ, ANA')
  })

  it('cuenta los médicos y agrega el pie con el filtro', () => {
    const wb = buildDistribucionObrasSocialesWorkbook({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: 'Motivo: Consulta',
      obras: OBRAS,
      rows: RESUMEN,
      footerLabel: 'Admi · Turno Mañana',
    })
    const aoa = leer(wb, 'Resumen')
    const pie = String(aoa[aoa.length - 1]?.[0] ?? '')
    expect(pie).toContain('Período 01/05/2026 – 31/05/2026')
    expect(pie).toContain('1 médicos')
    expect(pie).toContain('Admi · Turno Mañana')
  })
})

describe('distribucionObrasSocialesExcelFilename', () => {
  it('usa el mismo nombre que el PDF, con extensión xlsx', () => {
    expect(distribucionObrasSocialesExcelFilename()).toMatch(/^Fac Obras Sociales-\d{8}-\d{4}\.xlsx$/)
  })
})
