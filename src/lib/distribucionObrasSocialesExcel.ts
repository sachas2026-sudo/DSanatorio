import { format, parseISO } from 'date-fns'
import * as XLSX from 'xlsx/xlsx.mjs'
import {
  parseMoney,
  totalesDe,
  type DistribucionObrasSocialesPdfRow,
  type DistribucionPdfObra,
} from './distribucionObrasSocialesPdf'

/**
 * Excel de la distribución por médico · obras sociales.
 *
 * Es la misma información que el PDF "Fac Obras Sociales": el resumen (una fila
 * por médico) y, si se pide, el detalle por consulta. Los datos llegan ya
 * armados por la pantalla, así que los dos archivos no pueden mostrar números
 * distintos.
 *
 * A diferencia del PDF, los importes van como números y no como texto
 * ("$ 1.350.000"): así Excel puede sumarlos y ordenarlos sin que el usuario
 * tenga que limpiar la columna.
 */

/** Formato de celda para las columnas de importe. */
const FORMATO_MONEDA = '$ #,##0.00'

type FilaExcel = (string | number)[]

/** dd/MM/yyyy a partir de una fecha YYYY-MM-DD. */
function fmtDia(fecha: string): string {
  return format(parseISO(`${fecha}T12:00:00`), 'dd/MM/yyyy')
}

/** "01/05/2026" para un solo día, "01/05/2026 – 31/05/2026" para un rango. */
function periodoTexto(desde: string, hasta: string): string {
  const inicio = fmtDia(desde)
  const fin = fmtDia(hasta)
  return inicio === fin ? inicio : `${inicio} – ${fin}`
}

/** Importe de una celda: número, o '' cuando no hay monto (igual que el PDF). */
function celdaImporte(valor: string | number): number | '' {
  const n = typeof valor === 'number' ? valor : parseMoney(valor)
  return n === 0 ? '' : n
}

/** Cuenta los médicos distintos, para el pie. */
function contarMedicos(filas: DistribucionObrasSocialesPdfRow[]): number {
  return new Set(filas.map((f) => f.medico)).size
}

/**
 * Arma una hoja (resumen o detalle) con el mismo encabezado que el PDF:
 * título, período, filtro, los tres totales y la tabla con una columna por obra
 * social y el porcentaje en el nombre.
 */
function hojaDistribucion(params: {
  titulo: string
  periodText: string
  filterLabel: string
  obras: DistribucionPdfObra[]
  filas: DistribucionObrasSocialesPdfRow[]
  footerLabel?: string
}): XLSX.WorkSheet {
  const { titulo, periodText, filterLabel, obras, filas, footerLabel } = params
  const totales = totalesDe(filas, obras)
  const nMedicos = contarMedicos(filas)

  const aoa: FilaExcel[] = [
    ['Distribución por médico · Obras sociales'],
    [`Obras sociales · período ${periodText}`],
    [filterLabel ? `Filtro: ${filterLabel}` : ''],
    ['TOTAL FACTURADO', totales.facturado, 'TOTAL MÉDICO', totales.medico, 'TOTAL CUIDAR', totales.cuidar],
    [],
    [titulo],
    [
      'Fecha',
      'Médico',
      'Paciente',
      'Motivo de la Consulta',
      'Monto',
      ...obras.map((o) => `${o.nombre} · ${o.porcentaje}%`),
      'Total Médico',
    ],
  ]
  const filaEncabezado = aoa.length - 1

  for (const f of filas) {
    aoa.push([
      f.fecha,
      f.medico.toUpperCase(),
      f.paciente,
      f.motivo,
      celdaImporte(f.monto),
      ...obras.map((_, i) => celdaImporte(f.porObraSocial[i] ?? '')),
      celdaImporte(f.total),
    ])
  }

  aoa.push([
    'TOTALES',
    '',
    '',
    '',
    celdaImporte(totales.facturado),
    ...obras.map((_, i) =>
      celdaImporte(
        filas.reduce((s, f) => s + parseMoney(f.porObraSocial[i] ?? ''), 0),
      ),
    ),
    celdaImporte(totales.medico),
  ])

  aoa.push([])
  const pie: string[] = [`Período ${periodText}`, `${nMedicos} médicos`]
  if (footerLabel) pie.push(footerLabel)
  pie.push(`Generado el ${format(new Date(), 'dd/MM/yyyy')}`)
  aoa.push([pie.join(' · ')])

  const sheet = XLSX.utils.aoa_to_sheet(aoa)

  // Importes como número en formato de moneda. Se recorre sólo la zona de la
  // tabla (incluida la fila de TOTALES) más la línea de totales del encabezado.
  const primeraColImporte = 4
  const ultimaColImporte = 4 + obras.length + 1
  const primeraFilaDatos = filaEncabezado + 1
  for (let r = 0; r < aoa.length; r++) {
    const esFilaTotalesHeader = r === 3
    const esFilaTabla = r >= primeraFilaDatos && r < primeraFilaDatos + filas.length + 1
    if (!esFilaTotalesHeader && !esFilaTabla) continue

    const columnas = esFilaTotalesHeader
      ? [1, 3, 5]
      : Array.from({ length: ultimaColImporte - primeraColImporte + 1 }, (_, i) => primeraColImporte + i)
    for (const c of columnas) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      if (cell && typeof cell.v === 'number') cell.z = FORMATO_MONEDA
    }
  }

  sheet['!cols'] = [
    { wch: 12 },
    { wch: 28 },
    { wch: 26 },
    { wch: 26 },
    { wch: 14 },
    ...obras.map(() => ({ wch: 16 })),
    { wch: 14 },
  ]
  // Título y líneas de encabezado ocupando el ancho de la tabla.
  const ultimaCol = 4 + obras.length + 1
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ultimaCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ultimaCol } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: ultimaCol } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: ultimaCol } },
    { s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: ultimaCol } },
  ]

  return sheet
}

export function buildDistribucionObrasSocialesWorkbook(params: {
  desde: string
  hasta: string
  filterLabel: string
  obras: DistribucionPdfObra[]
  /** Resumen: una fila por médico. */
  rows: DistribucionObrasSocialesPdfRow[]
  /** Detalle por consulta. Si no viene, el archivo es sólo el resumen. */
  rowsCompletas?: DistribucionObrasSocialesPdfRow[]
  footerLabel?: string
}): XLSX.WorkBook {
  const { desde, hasta, filterLabel, obras, rows, rowsCompletas, footerLabel } = params
  const periodText = periodoTexto(desde, hasta)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    hojaDistribucion({
      titulo: 'RESUMEN · una fila por médico',
      periodText,
      filterLabel,
      obras,
      filas: rows,
      footerLabel,
    }),
    'Resumen',
  )

  if (rowsCompletas && rowsCompletas.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      hojaDistribucion({
        titulo: 'COMPLETO · detalle por consulta',
        periodText,
        filterLabel,
        obras,
        filas: rowsCompletas,
        footerLabel,
      }),
      'Completo',
    )
  }

  return wb
}

/** Nombre del archivo, con el mismo criterio que el PDF "Fac Obras Sociales". */
export function distribucionObrasSocialesExcelFilename(): string {
  return `Fac Obras Sociales-${format(new Date(), 'yyyyMMdd-HHmm')}.xlsx`
}
