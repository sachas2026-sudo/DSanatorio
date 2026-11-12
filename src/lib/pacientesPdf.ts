import { format, parseISO, isValid } from 'date-fns'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { DNI_PAC_LABEL } from './dniLabels'
import { drawPdfHeader, pdfBodyStartYAfterHeader, PDF_BODY_EXTRA_DOWN_PLAIN } from './pdfHeader'
import {
  drawPdfPeriodMetaBlock,
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
  strokePagosTableRoundFrame,
} from './pagosPdfLayout'
import type { Patient } from '../types'

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
  cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
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

function sortPatientsAlphabetic(patients: Patient[]): Patient[] {
  return [...patients].sort((a, b) =>
    `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
      sensitivity: 'base',
    }),
  )
}

function drawListMeta(doc: jsPDF, pageW: number, y: number, count: number): number {
  return drawPdfPeriodMetaBlock(doc, pageW, y, '', [
    `${count} paciente${count === 1 ? '' : 's'} · Listado alfabético`,
  ])
}

function formatFechaNac(fechaNac: string): string {
  if (!fechaNac || fechaNac === '-') return '-'
  const date = parseISO(fechaNac)
  if (!isValid(date)) return '-'
  return format(date, 'dd-MM-yy')
}

function drawPacientesTotalBar(
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
    `${count} paciente${count === 1 ? '' : 's'}`,
    left + width - 5,
    textY,
    { align: 'right' },
  )

  return y + h + 5
}

function pacientesTableColWidths(tableW: number): number[] {
  const pct = [6, 26, 14, 18, 16, 20]
  const raw = pct.map((p) => (p / 100) * tableW)
  const sum = raw.reduce((a, b) => a + b, 0)
  const diff = tableW - sum
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) + diff
  return raw.map((w) => Math.round(w * 100) / 100)
}

export function buildPacientesPdf(patients: Patient[]): {
  doc: jsPDF
  filename: string
} {
  const sorted = sortPatientsAlphabetic(patients)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const headerBottom = drawPdfHeader(doc, pageW, 'Listado de pacientes')

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
    doc.text(
      'No hay pacientes cargados.',
      PAGOS_PDF_MARGIN,
      cursorY + 2,
    )
  } else {
    const tableLeft = PAGOS_PDF_MARGIN
    const tableWidth = pageW - 2 * PAGOS_PDF_MARGIN
    const colWidths = pacientesTableColWidths(tableWidth)
    const headers = ['#', 'Apellido y nombre', DNI_PAC_LABEL, 'Obra social', 'Teléfono', 'Email']
    const tableStartY = cursorY

    const columnStyles: Record<
      number,
      { cellWidth: number; halign?: 'left' | 'center' | 'right'; valign?: 'middle' }
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
      body: sorted.map((p, index) => [
        String(index + 1),
        `${p.apellido || '—'}, ${p.nombre || '—'}`,
        p.dni || '—',
        p.obraSocial || '—',
        p.telefono || '—',
        p.email || '—',
      ]),
      styles: TABLE_BODY_STYLES,
      headStyles: TABLE_HEAD_STYLES,
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles,
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
    drawPacientesTotalBar(doc, finalY + 6, pageW, sorted.length)
  }

  const stamp = format(new Date(), 'yyyy-MM-dd')
  const filename = `pacientes-listado-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
  return { doc, filename }
}

export function pacientesPdfPreviewTitle(count: number): string {
  return `Pacientes (${count})`
}

export interface PacientesListadoGrupo {
  obraSocial: string
  patients: Patient[]
}

export function buildPacientesListadoPdf(
  groups: PacientesListadoGrupo[],
): { doc: jsPDF; filename: string; title: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const headerBottom = drawPdfHeader(doc, pageW, 'Listado de pacientes')
  let y = pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN)

  const totalPacientes = groups.reduce((s, g) => s + g.patients.length, 0)

  if (totalPacientes === 0) {
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay pacientes para el filtro seleccionado.', PAGOS_PDF_MARGIN, y + 2)
    const stamp = format(new Date(), 'yyyy-MM-dd')
    stampPdfGeneratedFooterOnAllPages(doc)
    return { doc, filename: `pacientes-listado-${stamp}.pdf`, title: `Listado de pacientes (0)` }
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    const sorted = sortPatientsAlphabetic(group.patients)
    if (sorted.length === 0) continue

    // Titulo de la obra social (encima de la barra de titulos de la tabla)
    if (gi > 0) {
      y += 6
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(26, 39, 68)
    doc.text(group.obraSocial || 'Sin obra social', PAGOS_PDF_MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(61, 74, 92)
    doc.text(
      `${sorted.length} paciente${sorted.length === 1 ? '' : 's'}`,
      pageW - PAGOS_PDF_MARGIN,
      y,
      { align: 'right' },
    )
    y += 3
    // linea divisoria
    doc.setDrawColor(210, 222, 238)
    doc.setLineWidth(0.3)
    doc.line(PAGOS_PDF_MARGIN, y, pageW - PAGOS_PDF_MARGIN, y)
    y += 4

    const tableLeft = PAGOS_PDF_MARGIN
    const tableWidth = pageW - 2 * PAGOS_PDF_MARGIN
    const colWidths = [12, 34, 34, 26, 30, 52, 45]
    const sum = colWidths.reduce((a, b) => a + b, 0)
    const scale = tableWidth / sum
    const widths = colWidths.map((w) => Math.round(w * scale * 100) / 100)
    const headers = ['Nro', 'Apellido', 'Nombre', 'F. nacimiento', 'Teléfono', 'Domicilio', 'Observaciones']
    const tableStartY = y

    const columnStyles: Record<number, { cellWidth: number; halign?: 'left' | 'center' | 'right'; valign?: 'middle' }> = {}
    widths.forEach((w, i) => {
      columnStyles[i] = { cellWidth: w, valign: 'middle', ...(i === 0 ? { halign: 'center' } : {}) }
    })

    autoTable(doc, {
      startY: tableStartY,
      head: [headers],
      body: sorted.map((p, idx) => [
        String(idx + 1),
        p.apellido || '-',
        p.nombre || '-',
        formatFechaNac(p.fechaNacimiento),
        p.telefono || '-',
        p.domicilio || '-',
        p.notas || '-',
      ]),
      styles: TABLE_BODY_STYLES,
      headStyles: TABLE_HEAD_STYLES,
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles,
      tableWidth,
      margin: { left: tableLeft, right: PAGOS_PDF_MARGIN },
      showHead: 'everyPage',
    })

    const finalY = tableFinalY(doc, tableStartY)
    strokePagosTableRoundFrame(doc, tableLeft, y, tableWidth, finalY - y, PAGOS_DOCTOR_BLOCK_RADIUS)
    y = finalY + 18
  }

  const stamp = format(new Date(), 'yyyy-MM-dd')
  stampPdfGeneratedFooterOnAllPages(doc)
  return { doc, filename: `pacientes-listado-${stamp}.pdf`, title: `Listado de pacientes (${totalPacientes})` }
}
