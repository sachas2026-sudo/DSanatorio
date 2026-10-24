import { format } from 'date-fns'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  ESPECIALIDADES_COMUNES,
  isEspecialidadComun,
  normalizeEspecialidad,
} from './especialidades'
import { drawPdfHeader, pdfBodyStartYAfterHeader, PDF_BODY_EXTRA_DOWN_PLAIN } from './pdfHeader'
import {
  drawPdfPeriodMetaBlock,
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
  strokePagosTableRoundFrame,
} from './pagosPdfLayout'

const TABLE_HEAD_STYLES = {
  fillColor: [47, 111, 219] as [number, number, number],
  textColor: [255, 255, 255] as [number, number, number],
  fontStyle: 'bold' as const,
  fontSize: 8,
  cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
  minCellHeight: 7,
  valign: 'middle' as const,
  halign: 'left' as const,
}

const TABLE_BODY_STYLES = {
  fontSize: 7.5,
  cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
  valign: 'middle' as const,
  overflow: 'linebreak' as const,
  textColor: [61, 74, 92] as [number, number, number],
  lineColor: [225, 232, 242] as [number, number, number],
  lineWidth: 0.15,
}

type CatalogRow = { nombre: string; tipo: 'Habitual' | 'Agregada' }

function tableFinalY(doc: jsPDF, fallback: number): number {
  return (
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? fallback
  )
}

function buildCatalogRows(custom: string[]): CatalogRow[] {
  const rows: CatalogRow[] = ESPECIALIDADES_COMUNES.map((nombre) => ({
    nombre,
    tipo: 'Habitual' as const,
  }))
  for (const raw of custom) {
    const nombre = normalizeEspecialidad(raw)
    if (!nombre || isEspecialidadComun(nombre)) continue
    rows.push({ nombre, tipo: 'Agregada' })
  }
  return rows.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

function drawTotalBar(doc: jsPDF, y: number, pageW: number, count: number): number {
  const left = PAGOS_PDF_MARGIN
  const width = pageW - 2 * PAGOS_PDF_MARGIN
  const h = 10
  const r = PAGOS_DOCTOR_BLOCK_RADIUS

  doc.setFillColor(238, 244, 255)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.25)
  doc.roundedRect(left, y, width, h, r, r, 'FD')

  const textY = y + h / 2 + 1.1
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(26, 39, 68)
  doc.text('Total en listado', left + 5, textY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(61, 74, 92)
  doc.text(
    `${count} especialidad${count === 1 ? '' : 'es'}`,
    left + width - 5,
    textY,
    { align: 'right' },
  )

  return y + h + 5
}

export function buildEspecialidadesCatalogPdf(custom: string[]): {
  doc: jsPDF
  filename: string
} {
  const rows = buildCatalogRows(custom)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const headerBottom = drawPdfHeader(doc, pageW, 'Listado de especialidades')

  const cursorY =
    drawPdfPeriodMetaBlock(doc, pageW, pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN), '', [
      `${rows.length} especialidad${rows.length === 1 ? '' : 'es'} · Listado alfabético`,
    ]) + 4

  if (rows.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay especialidades cargadas.', PAGOS_PDF_MARGIN, cursorY + 2)
  } else {
    const tableLeft = PAGOS_PDF_MARGIN
    const tableWidth = pageW - 2 * PAGOS_PDF_MARGIN
    const colWidths = [12, tableWidth - 12 - 38, 38]
    const tableStartY = cursorY

    autoTable(doc, {
      startY: tableStartY,
      head: [['#', 'Especialidad', 'Origen']],
      body: rows.map((row, index) => [
        String(index + 1),
        row.nombre,
        row.tipo,
      ]),
      styles: TABLE_BODY_STYLES,
      headStyles: TABLE_HEAD_STYLES,
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: {
        0: { cellWidth: colWidths[0], halign: 'center', valign: 'middle' },
        1: { cellWidth: colWidths[1], valign: 'middle' },
        2: { cellWidth: colWidths[2], valign: 'middle' },
      },
      tableWidth,
      margin: { left: tableLeft, right: PAGOS_PDF_MARGIN },
      showHead: 'everyPage',
    })

    const finalY = tableFinalY(doc, tableStartY)
    strokePagosTableRoundFrame(
      doc,
      tableLeft,
      cursorY,
      tableWidth,
      finalY - cursorY,
      PAGOS_DOCTOR_BLOCK_RADIUS,
    )
    drawTotalBar(doc, finalY + 6, pageW, rows.length)
  }

  const stamp = format(new Date(), 'yyyy-MM-dd')
  const filename = `especialidades-listado-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
  return { doc, filename }
}

export function especialidadesCatalogPdfPreviewTitle(count: number): string {
  return `Especialidades (${count})`
}
