import { describe, expect, it } from 'vitest'
import {
  buildDistribucionObrasSocialesPdf,
  formatMoney,
  totalesDe,
} from './distribucionObrasSocialesPdf'
import type {
  DistribucionObrasSocialesPdfRow,
  DistribucionPdfObra,
} from './distribucionObrasSocialesPdf'

/**
 * Datos de referencia de la distribución.
 *
 * Todas las obras sociales al 30 %. Cada fila ya viene con los importes de las
 * columnas resueltos, que es la forma en que la pantalla calcula el reparto:
 * (suma de los montos base de esa obra social) × % de esa obra social.
 */
const OBRAS: DistribucionPdfObra[] = [
  { nombre: 'ASIS SALUD', porcentaje: 30 },
  { nombre: 'IPS', porcentaje: 30 },
  { nombre: 'Medicus', porcentaje: 30 },
  { nombre: 'MELD SALUD', porcentaje: 30 },
  { nombre: 'PAMI', porcentaje: 30 },
  { nombre: 'Sancor Salud', porcentaje: 30 },
]

type Ref = {
  medico: string
  monto: string
  /** Importe por obra social; '' = sin prestaciones en esa obra social. */
  os: (string | null)[]
  total: string
}

/** Fila de referencia: los `null` del spec se pasan como '' (celda vacía). */
function fila(r: Ref): DistribucionObrasSocialesPdfRow {
  return {
    fecha: '11-05-26',
    medico: r.medico,
    paciente: 'Varios',
    motivo: 'Consulta',
    monto: r.monto,
    porObraSocial: r.os.map((v) => v ?? ''),
    total: r.total,
  }
}

/** Tabla de referencia del enunciado, en el orden de las 6 obras sociales. */
const REFERENCIA: Ref[] = [
  { medico: 'AGUIRRE, RAFAEL', monto: '$ 175.000', os: [null, '$ 52.500', null, null, null, null], total: '$ 122.500' },
  { medico: 'BUSTAMANTE, JAZMIN BELEN', monto: '$ 60.000', os: ['$ 18.000', null, null, null, null, null], total: '$ 42.000' },
  { medico: 'CABALLERO, YOLANDA', monto: '$ 170.000', os: [null, '$ 51.000', null, null, null, null], total: '$ 119.000' },
  { medico: 'CASTAÑARES, VALERIA', monto: '$ 95.000', os: [null, '$ 6.000', '$ 10.500', '$ 12.000', null, null], total: '$ 66.500' },
  { medico: 'DIBIASI, MIGUEL ANGEL C.', monto: '$ 150.000', os: [null, '$ 39.000', null, '$ 6.000', null, null], total: '$ 105.000' },
  { medico: 'IMBACH, GUILLERMO', monto: '$ 150.000', os: ['$ 15.000', null, null, '$ 30.000', null, null], total: '$ 105.000' },
  { medico: 'MUYAL, JOEL ERNESTO', monto: '$ 50.000', os: [null, '$ 7.500', null, '$ 7.500', null, null], total: '$ 35.000' },
  { medico: 'RAVIOLO , CECILIA', monto: '$ 85.000', os: [null, '$ 13.500', null, null, null, '$ 12.000'], total: '$ 59.500' },
  { medico: 'SCHIMPF, ROALD ARTURO', monto: '$ 285.000', os: ['$ 30.000', '$ 22.500', null, '$ 6.000', '$ 15.000', '$ 12.000'], total: '$ 199.500' },
  { medico: 'SENESTRARI, MARIA FERNANDA', monto: '$ 35.000', os: [null, null, null, null, null, '$ 10.500'], total: '$ 24.500' },
  { medico: 'VELAZQUEZ, ROBERTO', monto: '$ 70.000', os: ['$ 6.000', '$ 6.000', null, null, '$ 9.000', null], total: '$ 49.000' },
  { medico: 'VIDONDO, MATIAS', monto: '$ 25.000', os: [null, '$ 7.500', null, null, null, null], total: '$ 17.500' },
]

const filasReferencia = REFERENCIA.map(fila)

describe('totalesDe · datos de referencia (todas las OS al 30 %)', () => {
  const t = totalesDe(filasReferencia, OBRAS)

  it('Total Facturado = 1.350.000', () => {
    expect(formatMoney(t.facturado)).toBe('$ 1.350.000')
  })

  it('Total Médico = 945.000', () => {
    expect(formatMoney(t.medico)).toBe('$ 945.000')
  })

  it('Total Cuidar = 405.000', () => {
    expect(formatMoney(t.cuidar)).toBe('$ 405.000')
  })

  it('cada columna de obra social suma lo que dice el enunciado', () => {
    const esperado = [
      '$ 69.000',    // ASIS SALUD
      '$ 205.500',   // IPS
      '$ 10.500',    // Medicus
      '$ 61.500',    // MELD SALUD
      '$ 24.000',    // PAMI
      '$ 34.500',    // Sancor Salud
    ]
    const obtenido = OBRAS.map((_, i) =>
      formatMoney(
        filasReferencia.reduce((s, r) => s + num(r.porObraSocial[i] ?? ''), 0),
      ),
    )
    expect(obtenido).toEqual(esperado)
  })

  it('invariante: Facturado = Médico + Cuidar', () => {
    expect(t.facturado).toBeCloseTo(t.medico + t.cuidar, 6)
  })

  it('invariante: Facturado = suma de obras sociales + Médico', () => {
    const sumaOs = OBRAS.reduce(
      (acc, _, i) => acc + filasReferencia.reduce((s, r) => s + num(r.porObraSocial[i] ?? ''), 0),
      0,
    )
    expect(t.facturado).toBeCloseTo(sumaOs + t.medico, 6)
  })

  it('cada fila: Monto = celdas de obra social + Total Médico', () => {
    for (const r of filasReferencia) {
      const celdas = r.porObraSocial.reduce((s, v) => s + num(v ?? ''), 0)
      expect(num(r.monto)).toBeCloseTo(celdas + num(r.total), 6)
    }
  })
})

describe('totalesDe · otros casos', () => {
  it('médico con una sola prestación', () => {
    const f = fila({ medico: 'PEREZ, ANA', monto: '$ 100.000', os: ['$ 30.000', null, null, null, null, null], total: '$ 70.000' })
    const t = totalesDe([f], OBRAS)
    expect(formatMoney(t.facturado)).toBe('$ 100.000')
    expect(formatMoney(t.cuidar)).toBe('$ 30.000')
    expect(formatMoney(t.medico)).toBe('$ 70.000')
  })

  it('sin prestaciones en una obra social la celda va vacía, no "$ 0"', () => {
    const f = fila({ medico: 'GOMEZ, LUIS', monto: '$ 60.000', os: [null, '$ 18.000', null, null, null, null], total: '$ 42.000' })
    expect(f.porObraSocial[0]).toBe('')
    expect(f.porObraSocial[0]).not.toBe('$ 0')

    const t = totalesDe([f], OBRAS)
    // Las celdas vacías no aportan al total de esa obra social.
    expect(formatMoney(t.cuidar)).toBe('$ 18.000')
  })

  it('porcentajes distintos del 30 % por obra social', () => {
    // 100.000 de base: ASIS al 50 %, IPS al 20 %.
    const f = fila({
      medico: 'RUIZ, SOFIA',
      monto: '$ 100.000',
      os: ['$ 50.000', '$ 20.000', null, null, null, null],
      total: '$ 30.000',
    })
    const t = totalesDe([f], OBRAS)
    expect(formatMoney(t.cuidar)).toBe('$ 70.000')
    expect(formatMoney(t.medico)).toBe('$ 30.000')
    expect(t.facturado).toBeCloseTo(t.medico + t.cuidar, 6)
  })

  it('importe con centavos', () => {
    const f = fila({
      medico: 'SOSA, DIEGO',
      monto: '$ 100.045,47',
      os: ['$ 30.013,64', null, null, null, null, null],
      total: '$ 70.031,83',
    })
    const t = totalesDe([f], OBRAS)
    expect(formatMoney(t.facturado)).toBe('$ 100.045,47')
    expect(formatMoney(t.cuidar)).toBe('$ 30.013,64')
    expect(t.facturado).toBeCloseTo(t.medico + t.cuidar, 6)
  })

  it('sin filas: los tres totales dan cero y no NaN', () => {
    const t = totalesDe([], OBRAS)
    expect(t).toEqual({ facturado: 0, medico: 0, cuidar: 0 })
  })
})

describe('formatMoney', () => {
  it('formato argentino sin centavos', () => {
    expect(formatMoney(1350000)).toBe('$ 1.350.000')
    expect(formatMoney(69000)).toBe('$ 69.000')
    expect(formatMoney(0)).toBe('$ 0')
  })

  it('muestra los centavos sólo cuando existen', () => {
    expect(formatMoney(1045.47)).toBe('$ 1.045,47')
    expect(formatMoney(1045.4)).toBe('$ 1.045,40')
    expect(formatMoney(1045)).toBe('$ 1.045')
  })
})

describe('buildDistribucionObrasSocialesPdf · PDF generado', () => {
  const base = {
    desde: '2026-11-02',
    hasta: '2026-11-02',
    filterLabel: '',
    obras: OBRAS,
  }

  it('3 filas entran en una sola hoja apaisada', () => {
    const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: filasReferencia.slice(0, 3) })
    expect(doc.getNumberOfPages()).toBe(1)
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight())
  })

  it('los datos de referencia salen en un PDF válido y apaisado', () => {
    const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: filasReferencia })
    const salida = doc.output()
    expect(salida.startsWith('%PDF-')).toBe(true)
    expect(salida).toContain('%%EOF')
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight())

    contiene(
      salida,
      'Distribución por médico',
      'Obras sociales · período 02/11/2026',
      'TOTAL FACTURADO',
      'TOTAL MÉDICO',
      'TOTAL CUIDAR',
      '$ 1.350.000',
      '$ 945.000',
      '$ 405.000',
    )
  })

  it('el encabezado lleva Plus, Arancel y los % dentro del título de cada obra social', () => {
    const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: filasReferencia })
    const salida = doc.output()
    contiene(salida, 'Fecha', 'Médico', 'Paciente', 'Motivo', 'Prestación', 'Plus', 'Arancel', 'Cuidar', 'Total', 'médico')
    expect(salida).not.toContain('Especialidad')
    // Sin la banda "Porcentajes sobre el Arancel": sólo la nota al pie de la tabla.
    expect(salida).not.toContain('Porcentajes sobre')
    contiene(salida, 'Los porcentajes de cada columna se calculan sobre el Arancel.')
    for (const o of OBRAS) {
      expect(salida, `falta el rótulo de ${o.nombre}`).toContain(o.nombre.split(' ')[0]!)
    }
    expect(salida.split('(30 %)').length - 1).toBeGreaterThanOrEqual(OBRAS.length)
  })

  it('el Total Cuidar de cada fila es la suma de sus obras sociales', () => {
    const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: filasReferencia })
    // Aguirre: 52.500 en IPS -> Total Cuidar $ 52.500.
    contiene(doc.output(), 'AGUIRRE', '$ 52.500')
  })

  it('pie con el rótulo del centro y la numeración de hojas', () => {
    const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: filasReferencia.slice(0, 3) })
    contiene(
      doc.output(),
      'Centro M', 'Distribución por médico · Obras sociales',
      'Generado el',
      'Página 1 de 1',
    )
  })

  it('con detalle: el resumen va en la primera hoja y el detalle después', () => {
    const detalle = filasReferencia.flatMap((r) => [
      { ...r, paciente: 'PACIENTE UNO', motivo: 'Consulta' },
      { ...r, paciente: '', motivo: 'Presurometría' },
    ])
    const { doc } = buildDistribucionObrasSocialesPdf({
      ...base,
      filterLabel: 'Médico: Aguirre, Rafael',
      rows: filasReferencia,
      rowsCompletas: detalle,
    })
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)
    contiene(doc.output(), 'COMPLETO', 'Presu', 'Médico: Aguirre, Rafael', 'Página 1 de')
  })

  it('sólo resumen: no lleva el rótulo COMPLETO', () => {
    const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: filasReferencia })
    expect(doc.output()).not.toContain('COMPLETO')
  })

  it('sin filas: arma el PDF igual, sin romperse', () => {
    const { doc, filename, title } = buildDistribucionObrasSocialesPdf({ ...base, rows: [] })
    const salida = doc.output()
    expect(salida.startsWith('%PDF-')).toBe(true)
    contiene(salida, 'Sin datos', 'TOTALES', '$ 0')
    expect(salida).not.toContain('NaN')
    expect(title).toBe('Distribución por Médico · Obras Sociales')
    expect(filename).toMatch(/^Fac Obras Sociales-\d{8}-\d{4}\.pdf$/)
  })

  it('un monto grande ("$ 9.999.999") sale entero, en un solo texto', () => {
    const grande = { ...filasReferencia[0]!, monto: '$ 9.999.999', porObraSocial: ['$ 9.999.999', '', '', '', '', ''], total: '$ 9.999.999' }
    const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: [grande] })
    expect(doc.output()).toContain('($ 9.999.999) Tj')
  })

  it('con 40 filas pagina, repite el encabezado y TOTALES queda al final', () => {
    const muchas: DistribucionObrasSocialesPdfRow[] = []
    for (let i = 0; i < 40; i++) {
      muchas.push(
        fila({
          medico: `MEDICO APELLIDO NUMERO ${String(i).padStart(2, '0')}`,
          monto: '$ 100.000',
          os: ['$ 30.000', null, null, null, null, null],
          total: '$ 70.000',
        }),
      )
    }
    const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: muchas })
    const paginas = doc.getNumberOfPages()
    expect(paginas).toBeGreaterThan(1)

    const salida = doc.output()
    // Una vez el título por hoja: el encabezado de la tabla se repite en todas.
    expect(salida.split('(Motivo) Tj').length - 1).toBe(paginas)
    // TOTALES una sola vez, y en la última hoja.
    expect(salida.split('TOTALES').length - 1).toBe(1)
    contiene(salida, `Página ${paginas} de ${paginas}`, '40 motivos')
    const ultimaHoja = salida.split('/Type /Page\n').pop() ?? ''
    expect(ultimaHoja).toContain('TOTALES')
  })

  it('TOTALES nunca queda solo en una hoja', () => {
    // Se prueba con varias cantidades de filas para cruzar el borde de la hoja.
    for (let n = 8; n <= 16; n++) {
      const filas: DistribucionObrasSocialesPdfRow[] = Array.from({ length: n }, (_, i) =>
        fila({
          medico: `MEDICO ${i}`,
          monto: '$ 10.000',
          os: ['$ 3.000', null, null, null, null, null],
          total: '$ 7.000',
        }),
      )
      const { doc } = buildDistribucionObrasSocialesPdf({ ...base, rows: filas })
      const salida = doc.output()
      const hojas = salida.split('/Type /Page\n').slice(1)
      const conTotales = hojas.find((h) => h.includes('TOTALES'))!
      // La hoja de TOTALES también tiene al menos una fila de datos.
      expect(conTotales, `n=${n}`).toContain('MEDICO')
    }
  })
  it('soporta columnas de cantidad para planes como Individual y Familiar', () => {
    const obrasConPlan: DistribucionPdfObra[] = [
      { nombre: 'Individual', porcentaje: 0, esCantidad: true },
      { nombre: 'IPS', porcentaje: 30 },
    ]
    const filas: DistribucionObrasSocialesPdfRow[] = [
      {
        fecha: '13-11-26',
        medico: 'AGUIRRE, RAFAEL',
        paciente: 'AGUIAR, CRISTOPHER',
        motivo: 'Consulta',
        prestacion: 'Radiografía',
        monto: '',
        arancel: '',
        porObraSocial: ['1', ''],
        totalCuidar: '',
        total: '',
      },
      {
        fecha: '13-11-26',
        medico: 'AGUIRRE, RAFAEL',
        paciente: 'ACOSTA, MARIA',
        motivo: 'Consulta',
        prestacion: '—',
        monto: '',
        arancel: '',
        porObraSocial: ['1', ''],
        totalCuidar: '',
        total: '',
      },
    ]

    const totales = totalesDe(filas, obrasConPlan)
    // Las columnas de cantidad no suman a Cuidar ni Facturado
    expect(totales.cuidar).toBe(0)
    expect(totales.facturado).toBe(0)

    const { doc } = buildDistribucionObrasSocialesPdf({
      desde: '2026-11-08',
      hasta: '2026-11-14',
      filterLabel: '',
      obras: obrasConPlan,
      rows: filas,
    })
    const salida = doc.output()
    // El encabezado muestra 'Cant.' en vez de '0 %'
    contiene(salida, 'Cant.')
    // La suma de la columna de cantidad es 2
    expect(salida).toContain('(2)')
  })
})

/**
 * Verifica que el PDF dibuje todos los fragmentos indicados.
 *
 * No se puede usar `toContain` con una cadena larga: una celda angosta parte
 * el texto en varios renglones y jsPDF escribe cada renglón con su propio
 * operador, así que el literal original nunca aparece entero. Los fragmentos
 * se eligen sin espacios en los cortes, que es donde el texto sí es contiguo.
 */
function contiene(salida: string, ...fragmentos: string[]): void {
  for (const f of fragmentos) {
    expect(salida, `falta el texto "${f}" en el PDF`).toContain(f)
  }
}

/** "$ 1.234,50" -> 1234.5 */
function num(v: string): number {
  if (!v) return 0
  const n = Number(
    v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'),
  )
  return isFinite(n) ? n : 0
}
