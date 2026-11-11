import { format } from 'date-fns'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { DNI_MED_LABEL } from './dniLabels'
import { drawPdfHeader, pdfBodyStartYAfterHeader, PDF_BODY_EXTRA_DOWN_PLAIN } from './pdfHeader'
import {
  drawPdfPeriodMetaBlock,
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
  strokePagosTableRoundFrame,
} from './pagosPdfLayout'
import type { Doctor } from '../types'

const TABLE_HEAD_STYLES = {
  fillColor: [122, 163, 176] as [number, number, number],
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
  cellPadding: { top: 2.5, bottom: 0, left: 3, right: 3 },
  valign: 'middle' as const,
  overflow: 'linebreak' as const,
  textColor: [61, 74, 92] as [number, number, number],
  lineColor: [225, 232, 242] as [number, number, number],
  lineWidth: 0.15,
}

function tableFinalY(doc: jsPDF, fallback: number): number {
  return (
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? fallback
  )
}

function sortMedicosAlphabetic(doctors: Doctor[]): Doctor[] {
  return [...doctors].sort((a, b) =>
    `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
      sensitivity: 'base',
    }),
  )
}

function drawListMeta(
  doc: jsPDF,
  pageW: number,
  y: number,
  count: number,
): number {
  return drawPdfPeriodMetaBlock(doc, pageW, y, '', [
    `${count} médico${count === 1 ? '' : 's'} · Listado alfabético`,
  ])
}

function drawMedicosTotalBar(
  doc: jsPDF,
  y: number,
  pageW: number,
  count: number,
): number {
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
    `${count} médico${count === 1 ? '' : 's'}`,
    left + width - 5,
    textY,
    { align: 'right' },
  )

  return y + h + 5
}

function medicosTableColWidths(
  tableW: number,
  includePorcentaje: boolean,
): number[] {
  const pct = includePorcentaje
    // Mantiene más espacio para el nombre y DNI; % queda angosta.
    ? [6, 19, 11, 10, 19, 13, 14, 8]
    : [7, 24, 12, 12, 12, 16, 17]
  const raw = pct.map((p) => (p / 100) * tableW)
  const sum = raw.reduce((a, b) => a + b, 0)
  const diff = tableW - sum
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) + diff
  return raw.map((w) => Math.round(w * 100) / 100)
}

export type BuildMedicosPdfOptions = {
  includePorcentaje?: boolean
}

export function buildMedicosPdf(
  doctors: Doctor[],
  options: BuildMedicosPdfOptions = {},
): {
  doc: jsPDF
  filename: string
} {
  const includePorcentaje = options.includePorcentaje !== false
  const sorted = sortMedicosAlphabetic(doctors)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const headerBottom = drawPdfHeader(doc, pageW, 'Listado de médicos')

  const cursorY =
    drawListMeta(
      doc,
      pageW,
      pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN),
      sorted.length,
    ) + 4

  if (sorted.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay médicos cargados.', PAGOS_PDF_MARGIN, cursorY + 2)
  } else {
    const tableLeft = PAGOS_PDF_MARGIN
    const tableWidth = pageW - 2 * PAGOS_PDF_MARGIN
    const colWidths = medicosTableColWidths(tableWidth, includePorcentaje)
    const headers = includePorcentaje
      ? [
          '#',
          'Apellido y nombre',
          DNI_MED_LABEL,
          'Matrícula',
          'Especialidad',
          'Teléfono',
          'Email',
          '%',
        ]
      : [
          '#',
          'Apellido y nombre',
          DNI_MED_LABEL,
          'Matrícula',
          'Especialidad',
          'Teléfono',
          'Email',
        ]
    const tableStartY = cursorY

    const columnStyles: Record<
      number,
      {
        cellWidth: number
        halign?: 'left' | 'center' | 'right'
        valign?: 'middle'
      }
    > = {}
    colWidths.forEach((w, i) => {
      columnStyles[i] = {
        cellWidth: w,
        valign: 'middle',
        ...(i === 0 ? { halign: 'center' } : {}),
      }
    })

    autoTable(doc, {
      startY: tableStartY,
      head: [headers],
      body: sorted.map((d, index) => {
        const os = (d.obrasSociales?.length
          ? d.obrasSociales.map((x) => (typeof x === 'string' ? x : x.nombre))
          : d.obraSocial
            ? [d.obraSocial]
            : []
        )
          .map((x) => x.trim())
          .filter(Boolean)
        const osLabel = os.length > 0 ? `OS: ${os.slice(0, 3).join(', ')}${os.length > 3 ? '…' : ''}` : ''
        const row = [
          String(index + 1),
          `${d.apellido || '—'}, ${d.nombre || '—'}`,
          d.dni?.trim() || '—',
          d.matricula || '—',
          `${d.especialidad || '—'}${osLabel ? `\n${osLabel}` : ''}`,
          d.telefono || '—',
          d.email || '—',
        ]
        if (includePorcentaje) {
          row.push(d.porcentaje != null ? String(d.porcentaje) : '—')
        }
        return row
      }),
      styles: TABLE_BODY_STYLES,
      headStyles: TABLE_HEAD_STYLES,
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles,
      tableWidth,
      margin: { left: tableLeft, right: PAGOS_PDF_MARGIN, bottom: 0 },
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
    drawMedicosTotalBar(doc, finalY, pageW, sorted.length)
  }

  const stamp = format(new Date(), 'yyyy-MM-dd')
  const filename = `medicos-listado-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
  return { doc, filename }
}

export function medicosPdfPreviewTitle(count: number): string {
  return `Médicos (${count})`
}
