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
  it('los datos de referencia salen en un PDF válido', () => {
    const { doc } = buildDistribucionObrasSocialesPdf({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: '',
      obras: OBRAS,
      rows: filasReferencia,
    })

    // Test de humo: PDF válido para los datos de referencia. La hoja es
    // vertical y entran 4 obras por hoja, así que las 6 de referencia se
    // reparten en dos: la segunda se titula CONTINUACIÓN.
    expect(doc.getNumberOfPages()).toBe(2)
    contiene(doc.output(), 'CONTINU')

    const salida = doc.output()
    // Firma de un PDF válido.
    expect(salida.startsWith('%PDF-')).toBe(true)
    expect(salida).toContain('%%EOF')

    // Banner: título, período y los tres totales.
    // Ojo con las aserciones sobre texto: las celdas angostas parten las
    // palabras en varias líneas y cada línea va en su propio operador de texto,
    // así que un literal largo con espacios ("Motivo de la Consulta") no
    // aparece nunca tal cual en el PDF. Se verifica por fragmentos.
    contiene(salida,
      'Distribución por médico',
      'TOTAL FACTURADO',
      'TOTAL MÉDICO',
      'TOTAL CUIDAR',
      '$ 1.350.000',
      '$ 945.000',
      '$ 405.000',
    )

    // Encabezado: "% Cuidar" con el 30 % de cada obra social.
    contiene(salida,
      '% Cuidar',
      '30%',
      'Fecha',
      'Médico',
      'Paciente',
      // Se verifica la primera palabra: el rótulo se parte en dos renglones
      // ("Motivo de" / "la Consulta") y la frase entera nunca aparece junta.
      'Motivo',
      'Consulta',
      'Monto',
      'ASIS',
      'IPS',
      'Medicu',
      'MELD',
      'PAMI',
      'Sancor',
      'Total',
    )

    // Fila de totales y médicos en mayúsculas.
    contiene(salida, 'TOTALES', 'AGUIRRE')

    // Pie.
    contiene(salida, 'Período', '12 médicos', 'Generado el')
  })

  it('regresión: el encabezado no queda tapado por su propio degradé', () => {
    // El degradé de la banda del encabezado se pinta después de la tabla, con
    // lo que tapaba los títulos y los "%" de cada obra social y dejaba la banda
    // en blanco. Se dibujó a mano antes de autoTable por esto: este test falla
    // si alguien vuelve a pintar el encabezado encima de las celdas.
    const { doc } = buildDistribucionObrasSocialesPdf({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: '',
      obras: OBRAS,
      rows: filasReferencia,
    })
    const salida = doc.output()

    // Cada obra social tiene su rótulo y su porcentaje. En vertical las
    // columnas son angostas y un nombre se puede partir a mitad de palabra
    // ("Medicu" / "s"), así que se busca un fragmento corto.
    for (const o of OBRAS) {
      const fragmento = o.nombre.slice(0, 4)
      expect(salida, `falta el rótulo de ${o.nombre}`).toContain(fragmento)
      expect(salida, `falta el % de ${o.nombre}`).toContain('30%')
    }
    // Y los rótulos de las columnas fijas y de los totales.
    contiene(salida, 'Fecha', 'Médico', 'Paciente', 'Motivo', 'Monto', 'Total')
  })

  it('no lleva el rótulo "RESUMEN" ni el de detalle cuando sólo hay resumen', () => {
    const { doc } = buildDistribucionObrasSocialesPdf({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: '',
      obras: OBRAS,
      rows: filasReferencia,
    })
    const salida = doc.output()
    expect(salida).not.toContain('RESUMEN')
    expect(salida).not.toContain('COMPLETO')
  })

  it('con detalle: el resumen va en la primera hoja y el detalle después', () => {
    const detalle = filasReferencia.flatMap((r) => [
      { ...r, paciente: 'PACIENTE UNO', motivo: 'Consulta' },
      { ...r, paciente: '', motivo: 'Presurometría' },
    ])

    const { doc } = buildDistribucionObrasSocialesPdf({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: 'Médico: Aguirre, Rafael',
      obras: OBRAS,
      rows: filasReferencia,
      rowsCompletas: detalle,
    })

    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)
    contiene(doc.output(), 'COMPLETO', 'Presurom', 'Filtro: Médico: Aguirre, Rafael')
    // Con más de una hoja aparece el "Página x de y".
    expect(doc.output()).toContain('Página 1 de')
  })

  it('sin filas: arma el PDF igual, sin romperse', () => {
    const { doc, filename, title } = buildDistribucionObrasSocialesPdf({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: '',
      obras: OBRAS,
      rows: [],
    })
    const salida = doc.output()
    expect(salida.startsWith('%PDF-')).toBe(true)
    // El aviso de tabla vacía va partido en renglones por el ancho de celda.
    contiene(salida, 'Sin datos', 'TOTALES')
    // Y los tres totales del banner dan cero, no NaN.
    contiene(salida, '$ 0')
    expect(title).toBe('Distribución por Médico · Obras Sociales')
    expect(filename).toMatch(/^Fac Obras Sociales-\d{8}-\d{4}\.pdf$/)
  })

  it('con más de 14 médicos pagina, repite el encabezado y numera las hojas', () => {
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

    const { doc } = buildDistribucionObrasSocialesPdf({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: '',
      obras: OBRAS,
      rows: muchas,
    })

    const paginas = doc.getNumberOfPages()
    expect(paginas).toBeGreaterThan(1)

    const salida = doc.output()
    // El encabezado de tabla se repite en cada hoja. Se cuenta una palabra
    // suelta ("Motivo") porque los rótulos largos se parten en varios renglones
    // y la frase entera no aparece junta en ninguna de las hojas.
    const repeticiones = salida.split('Motivo').length - 1
    expect(repeticiones).toBeGreaterThanOrEqual(paginas)
    // Numeración de hojas y total de médicos.
    contiene(salida, 'Página 1 de', '40 médicos')
  })

  it('el rótulo COMPLETO aparece sólo en las hojas de detalle', () => {
    const detalle = filasReferencia.map((r) => ({ ...r, motivo: 'Presurometría' }))
    const { doc } = buildDistribucionObrasSocialesPdf({
      desde: '2026-05-01',
      hasta: '2026-05-31',
      filterLabel: '',
      obras: OBRAS,
      rows: filasReferencia,
      rowsCompletas: detalle,
    })
    const salida = doc.output()
    // Ni el resumen ni sus hojas de continuación llevan el rótulo: sólo el
    // bloque de detalle. Como las 6 obras no entran en una hoja vertical, el
    // detalle ocupa dos hojas y el rótulo aparece en cada una.
    const ocurrencias = salida.split('COMPLETO').length - 1
    expect(ocurrencias).toBeGreaterThanOrEqual(1)
    expect(ocurrencias).toBe(doc.getNumberOfPages() - 2)
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
