import { format } from 'date-fns'
import jsPDF from 'jspdf'
import autoTable, { type CellHookData } from 'jspdf-autotable'
import { drawPdfHeader, pdfBodyStartYAfterHeader, PDF_BODY_EXTRA_DOWN_PLAIN } from './pdfHeader'
import {
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
  strokePagosTableRoundFrame,
} from './pagosPdfLayout'

/** A4 vertical: 210 × 297 mm */
const A4_PORTRAIT_MM: [number, number] = [210, 297]

function createA4PortraitPdf(): jsPDF {
  return new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: A4_PORTRAIT_MM,
  })
}
export function isAtencionSinTurnoPdfPortraitA4(doc: jsPDF): boolean {
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  return w < h && Math.abs(w - A4_PORTRAIT_MM[0]) < 2 && Math.abs(h - A4_PORTRAIT_MM[1]) < 2
}

export type AtencionSinTurnoTurnosPdfRow = {
  paciente: string
  obraSocial: string
  observaciones: string
}

export type AtencionSinTurnoPdfRow = {
  paciente: string
  obraSocial: string
  porcentaje: string
  monto: string
  pctCuidar: string
}

const TABLE_HEAD_STYLES = {
  fillColor: [47, 111, 219] as [number, number, number],
  textColor: [255, 255, 255] as [number, number, number],
  fontStyle: 'normal' as const,
  fontSize: 10.5,
  cellPadding: { top: 1.5, bottom: 1.5, left: 3.5, right: 3.5 },
  minCellHeight: 5.5,
  valign: 'middle' as const,
  halign: 'left' as const,
}

const TABLE_BODY_STYLES = {
  fontSize: 11,
  fontStyle: 'normal' as const,
  cellPadding: { top: 0.9, bottom: 0.9, left: 3.5, right: 3.5 },
  minCellHeight: 4.2,
  valign: 'middle' as const,
  overflow: 'linebreak' as const,
  textColor: [61, 74, 92] as [number, number, number],
  lineColor: [225, 232, 242] as [number, number, number],
  lineWidth: 0.15,
}

const TABLE_NUMERIC_STYLES = {
  fontSize: 11,
  fontStyle: 'normal' as const,
}

function tableFinalY(doc: jsPDF, fallback: number): number {
  return (
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? fallback
  )
}

function alignAtencionSinTurnoResumenCell(
  data: CellHookData,
  includePorcentaje: boolean,
) {
  if (!includePorcentaje) {
    if (data.column.index === 2) {
      data.cell.styles.halign = 'right'
    }
    return
  }

  if (data.column.index === 2) {
    data.cell.styles.halign = 'center'
  }
  if (data.column.index === 3 || data.column.index === 4) {
    data.cell.styles.halign = 'right'
  }
}

export type AtencionSinTurnoPdfMeta = {
  subtitle?: string
  totalMonto?: string
  totalCuidar?: string
}

const TABLE_FOOT_STYLES = {
  fillColor: [232, 244, 253] as [number, number, number],
  textColor: [26, 77, 138] as [number, number, number],
  fontStyle: 'bold' as const,
  fontSize: 11.5,
  cellPadding: { top: 1.5, bottom: 1.5, left: 3.5, right: 3.5 },
  minCellHeight: 5.5,
  valign: 'middle' as const,
}

export function buildAtencionSinTurnoPdf(
  rows: AtencionSinTurnoPdfRow[],
  includePorcentaje: boolean,
  meta?: AtencionSinTurnoPdfMeta,
): { doc: jsPDF; filename: string; title: string } {
  const doc = createA4PortraitPdf()
  const pageW = doc.internal.pageSize.getWidth()
  const title = 'Atención sin turno'
  const headerBottom = drawPdfHeader(doc, pageW, title, {
    secondLine: meta?.subtitle?.trim() || undefined,
  })
  const cursorY = pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN)

  const tableLeft = PAGOS_PDF_MARGIN
  const tableWidth = pageW - 2 * PAGOS_PDF_MARGIN
  const headers = includePorcentaje
    ? ['Paciente', 'Obra social', '%', 'Monto', '% Cuidar']
    : ['Paciente', 'Obra social', 'Monto']
  const pct = includePorcentaje ? [32, 15, 8, 20, 25] : [42, 22, 36]
  const raw = pct.map((p) => (p / 100) * tableWidth)
  const diff = tableWidth - raw.reduce((a, b) => a + b, 0)
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) + diff
  const colWidths = raw.map((w) => Math.round(w * 100) / 100)

  const columnStyles: Record<
    number,
    {
      cellWidth: number
      halign?: 'left' | 'center' | 'right'
      fontSize?: number
      fontStyle?: 'bold' | 'normal'
    }
  > = {}
  colWidths.forEach((w, i) => {
    columnStyles[i] = {
      cellWidth: w,
      ...(includePorcentaje && i === 2
        ? { halign: 'center', ...TABLE_NUMERIC_STYLES }
        : {}),
      ...(includePorcentaje && i === 4
        ? { halign: 'right', ...TABLE_NUMERIC_STYLES }
        : {}),
      ...(!includePorcentaje && i === colWidths.length - 1
        ? { halign: 'right', ...TABLE_NUMERIC_STYLES }
        : {}),
      ...(includePorcentaje && i === 3
        ? { halign: 'right', ...TABLE_NUMERIC_STYLES }
        : {}),
    }
  })

  const body = rows.map((r) =>
    includePorcentaje
      ? [r.paciente, r.obraSocial, r.porcentaje, r.monto, r.pctCuidar]
      : [r.paciente, r.obraSocial, r.monto],
  )

  const foot =
    meta?.totalMonto != null
      ? includePorcentaje
        ? [['TOTALES', '', '', meta.totalMonto, meta.totalCuidar ?? '']]
        : [['TOTALES', '', meta.totalMonto]]
      : undefined

  autoTable(doc, {
    startY: cursorY,
    head: [headers],
    body,
    foot,
    styles: TABLE_BODY_STYLES,
    headStyles: TABLE_HEAD_STYLES,
    footStyles: TABLE_FOOT_STYLES,
    alternateRowStyles: { fillColor: [248, 251, 255] },
    columnStyles,
    tableWidth,
    margin: { left: tableLeft, right: PAGOS_PDF_MARGIN, bottom: 12 },
    horizontalPageBreak: false,
    showHead: 'everyPage',
    didParseCell: (data) => alignAtencionSinTurnoResumenCell(data, includePorcentaje),
  })

  const finalY = tableFinalY(doc, cursorY)
  strokePagosTableRoundFrame(
    doc,
    tableLeft,
    cursorY,
    tableWidth,
    finalY - cursorY,
    PAGOS_DOCTOR_BLOCK_RADIUS,
  )

  const stamp = format(new Date(), 'yyyy-MM-dd')
  const filename = `atencion-sin-turno-${stamp}.pdf`
  stampPdfGeneratedFooterOnAllPages(doc)

  return { doc, filename, title: `${title} (${rows.length})` }
}

export function buildAtencionSinTurnoTurnosPdf(
  rows: AtencionSinTurnoTurnosPdfRow[],
  meta?: Pick<AtencionSinTurnoPdfMeta, 'subtitle'>,
): { doc: jsPDF; filename: string; title: string } {
  const doc = createA4PortraitPdf()
  const pageW = doc.internal.pageSize.getWidth()
  const title = 'Atención sin turno'
  const headerBottom = drawPdfHeader(doc, pageW, title, {
    secondLine: meta?.subtitle?.trim() || undefined,
  })
  const cursorY = pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN)

  const tableLeft = PAGOS_PDF_MARGIN
  const tableWidth = pageW - 2 * PAGOS_PDF_MARGIN
  const headers = ['Paciente', 'Obra social', 'Observaciones']
  const pct = [38, 20, 42]
  const raw = pct.map((p) => (p / 100) * tableWidth)
  const diff = tableWidth - raw.reduce((a, b) => a + b, 0)
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) + diff
  const colWidths = raw.map((w) => Math.round(w * 100) / 100)

  const columnStyles: Record<
    number,
    {
      cellWidth: number
      halign?: 'left' | 'center' | 'right'
      fontSize?: number
      fontStyle?: 'bold' | 'normal'
    }
  > = {}
  colWidths.forEach((w, i) => {
    columnStyles[i] = { cellWidth: w }
  })

  const body = rows.map((r) => [r.paciente, r.obraSocial, r.observaciones])

  autoTable(doc, {
    startY: cursorY,
    head: [headers],
    body,
    styles: TABLE_BODY_STYLES,
    headStyles: TABLE_HEAD_STYLES,
    alternateRowStyles: { fillColor: [248, 251, 255] },
    columnStyles,
    tableWidth,
    margin: { left: tableLeft, right: PAGOS_PDF_MARGIN, bottom: 12 },
    horizontalPageBreak: false,
    showHead: 'everyPage',
  })

  const finalY = tableFinalY(doc, cursorY)
  strokePagosTableRoundFrame(
    doc,
    tableLeft,
    cursorY,
    tableWidth,
    finalY - cursorY,
    PAGOS_DOCTOR_BLOCK_RADIUS,
  )

  const stamp = format(new Date(), 'yyyy-MM-dd')
  const filename = `atencion-sin-turno-turnos-${stamp}.pdf`
  stampPdfGeneratedFooterOnAllPages(doc)

  return { doc, filename, title: `${title} - Turnos (${rows.length})` }
}
