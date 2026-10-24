import { format } from 'date-fns'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { MedicoEspecialidadListRow } from './doctorAgenda'
import {
  buildDoctorAgendaIndex,
  doctorDiasAtencionLabelForPdf,
  doctorHorarioAtencionLabelForPdf,
} from './doctorAgenda'
import { drawPdfHeader, pdfBodyStartYAfterHeader, PDF_BODY_EXTRA_DOWN_PLAIN } from './pdfHeader'
import type { AppData } from '../types'
import {
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
  strokePagosTableRoundFrame,
} from './pagosPdfLayout'

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

const TABLE_BODY_FONT_MAIN_COLS = 8.5

function tableFinalY(doc: jsPDF, fallback: number): number {
  return (
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? fallback
  )
}

function especialidadesTableColWidths(tableW: number): number[] {
  // 6 columnas: Médico, Especialidad, OS, Día, Horario, Duración
  const pct = [18, 16, 14, 12, 32, 8]
  const raw = pct.map((p) => (p / 100) * tableW)
  const sum = raw.reduce((a, b) => a + b, 0)
  const diff = tableW - sum
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) + diff
  return raw.map((w) => Math.round(w * 100) / 100)
}

function drawTotalBar(
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

type EspecialidadesPdfData = Pick<
  AppData,
  'doctors' | 'horarios' | 'diasLibres' | 'atencionesMensuales'
>

function rowsForEspecialidadesPdf(
  rows: MedicoEspecialidadListRow[],
  data?: EspecialidadesPdfData,
): MedicoEspecialidadListRow[] {
  if (!data) return rows
  const index = buildDoctorAgendaIndex(data)
  return rows.map((r) => {
    const doctor = data.doctors.find((d) => d.id === r.id)
    if (!doctor) return r
    return {
      ...r,
      dias: doctorDiasAtencionLabelForPdf(doctor, data, index),
      horario: doctorHorarioAtencionLabelForPdf(doctor, data, index),
    }
  })
}

export function buildMedicosEspecialidadesPdf(
  rows: MedicoEspecialidadListRow[],
  data?: EspecialidadesPdfData,
): {
  doc: jsPDF
  filename: string
} {
  const exportRows = rowsForEspecialidadesPdf(rows, data)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const headerBottom = drawPdfHeader(doc, pageW, 'Especialidades — médicos y horarios')

  const cursorY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  if (exportRows.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay médicos en el listado.', PAGOS_PDF_MARGIN, cursorY + 2)
  } else {
    const tableLeft = PAGOS_PDF_MARGIN
    const tableWidth = pageW - 2 * PAGOS_PDF_MARGIN
    const colWidths = especialidadesTableColWidths(tableWidth)
    const headers = [
      'Médico',
      'Especialidad',
      'Obras sociales',
      'Día que atiende',
      'Horario',
      'Duración',
    ]
    const tableStartY = cursorY

    const columnStyles: Record<
      number,
      {
        cellWidth: number
        halign?: 'left' | 'center' | 'right'
        valign?: 'middle'
        fontStyle?: 'bold'
        fontSize?: number
        textColor?: [number, number, number]
      }
    > = {}
    colWidths.forEach((w, i) => {
      columnStyles[i] = {
        cellWidth: w,
        valign: 'middle',
        ...(i === 0
          ? { fontStyle: 'bold', textColor: [26, 74, 138] }
          : {}),
        ...(i === 5 ? { halign: 'center' } : {}),
        fontSize: i === 4 ? 8 : TABLE_BODY_FONT_MAIN_COLS,
      }
    })

    autoTable(doc, {
      startY: tableStartY,
      head: [headers],
      body: exportRows.map((r) => [
        r.medico || '—',
        r.especialidad || '—',
        r.obrasSociales || '—',
        r.dias || '—',
        r.horario || '—',
        r.duracion || '—',
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
    drawTotalBar(doc, finalY + 6, pageW, exportRows.length)
  }

  const stamp = format(new Date(), 'yyyy-MM-dd')
  const filename = `especialidades-medicos-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
  return { doc, filename }
}

export function medicosEspecialidadesPdfPreviewTitle(count: number): string {
  return `Especialidades (${count})`
}
