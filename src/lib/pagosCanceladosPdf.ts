import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  drawPdfHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
  pdfBodyStartYAfterHeader,
} from './pdfHeader'
import { labelMotivoCancelacion } from './pagosCancelados'
import {
  drawPagosTotalGeneralBar,
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_PDF_MARGIN,
  pagosPdfContentLeft,
  stampPdfGeneratedFooterOnAllPages,
  strokePagosTableRoundFrame,
  type PagosCanceladosPdfSummary,
} from './pagosPdfLayout'
import type { MotivoCancelacionPago, PagoCancelado } from '../types'

export type PagosCanceladosPdfScope = 'todo' | 'dia' | 'mes' | 'anio'

export type PagosCanceladoPdfRow = {
  cancelado: string
  fechaPago: string
  paciente: string
  medico: string
  monto: number
  motivo: string
  metodo: string
}

function money(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  })
}

const TABLE_HEAD_STYLES = {
  fillColor: [47, 111, 219] as [number, number, number],
  textColor: [255, 255, 255] as [number, number, number],
  fontStyle: 'bold' as const,
  fontSize: 7.5,
  cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
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

/** Anchos en % (suman 100): fecha×2, paciente, médico, monto, motivo, método. */
function canceladosTableColWidths(
  scope: PagosCanceladosPdfScope,
  tableW: number,
): number[] {
  const pct =
    scope === 'dia'
      ? [9, 9, 16, 16, 14, 24, 12]
      : [15, 15, 14, 14, 13, 17, 12]
  const raw = pct.map((p) => (p / 100) * tableW)
  const sum = raw.reduce((a, b) => a + b, 0)
  const diff = tableW - sum
  raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) + diff
  return raw.map((w) => Math.round(w * 100) / 100)
}

function tableFinalY(doc: jsPDF, fallback: number): number {
  return (
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? fallback
  )
}

export function formatPagosCanceladosPdfPeriodLabel(
  scope: PagosCanceladosPdfScope,
  refDia: string,
  refMes: string,
  refAnio: string,
): string {
  if (scope === 'todo') return 'Todos los registros'
  if (scope === 'dia') {
    return format(parseISO(`${refDia}T12:00:00`), "d 'de' MMMM yyyy", {
      locale: es,
    })
  }
  if (scope === 'mes') {
    return format(parseISO(`${refMes}-15T12:00:00`), 'MMMM yyyy', {
      locale: es,
    })
  }
  const y = Number(refAnio) || new Date().getFullYear()
  return String(y)
}

export function formatPagosCanceladosPdfTitle(
  scope: PagosCanceladosPdfScope,
  periodLabel: string,
): string {
  if (scope === 'todo') return `Pagos cancelados - ${periodLabel}`
  if (scope === 'mes') return `Pagos cancelados - Mes ${periodLabel}`
  if (scope === 'anio') return `Pagos cancelados - Año ${periodLabel}`
  return `Pagos cancelados - Día ${periodLabel}`
}

export function formatPagosCanceladosPdfResumenLine(
  scope: PagosCanceladosPdfScope,
  periodLabel: string,
): string {
  if (scope === 'todo') return periodLabel
  if (scope === 'mes') return `Resumen Mes de ${periodLabel}`
  if (scope === 'anio') return `Resumen Año ${periodLabel}`
  return `Resumen Día de ${periodLabel}`
}

export function pagosCanceladosPdfFileStamp(
  scope: PagosCanceladosPdfScope,
  refDia: string,
  refMes: string,
  refAnio: string,
): string {
  if (scope === 'dia') return refDia
  if (scope === 'mes') return refMes
  if (scope === 'anio') return refAnio
  return 'todos'
}

export function buildPagosCanceladosPdfRows(
  records: PagoCancelado[],
  scope: PagosCanceladosPdfScope,
  patientLabel: (id: string) => string,
  doctorLabel: (id: string) => string,
): PagosCanceladoPdfRow[] {
  const dtFmt =
    scope === 'dia' ? 'HH:mm' : 'd MMM yyyy HH:mm'

  return [...records]
    .sort(
      (a, b) =>
        parseISO(b.canceladoEn).getTime() - parseISO(a.canceladoEn).getTime(),
    )
    .map((r) => ({
      cancelado: format(parseISO(r.canceladoEn), dtFmt, { locale: es }),
      fechaPago: format(parseISO(r.payment.fecha), dtFmt, { locale: es }),
      paciente: patientLabel(r.payment.patientId),
      medico: doctorLabel(r.payment.doctorId),
      monto: r.payment.monto,
      motivo: labelMotivoCancelacion(r.motivo),
      metodo: r.payment.metodo,
    }))
}

export function buildPagosCanceladosPdfSummary(
  records: PagoCancelado[],
): PagosCanceladosPdfSummary {
  const porMotivo: Record<MotivoCancelacionPago, number> = {
    cancelacion_paciente: 0,
    cancelacion_doctor: 0,
    otros: 0,
  }
  let total = 0
  for (const r of records) {
    total += r.payment.monto
    porMotivo[r.motivo] += 1
  }
  return {
    count: records.length,
    total,
    paciente: porMotivo.cancelacion_paciente,
    doctor: porMotivo.cancelacion_doctor,
    otros: porMotivo.otros,
  }
}

export function buildPagosCanceladosPdf(params: {
  scope: PagosCanceladosPdfScope
  periodLabel: string
  records: PagoCancelado[]
  patientLabel: (id: string) => string
  doctorLabel: (id: string) => string
  fileStamp?: string
}): { doc: jsPDF; filename: string } {
  const {
    scope,
    periodLabel,
    records,
    patientLabel,
    doctorLabel,
    fileStamp,
  } = params

  const rows = buildPagosCanceladosPdfRows(
    records,
    scope,
    patientLabel,
    doctorLabel,
  )
  const stats = buildPagosCanceladosPdfSummary(records)
  const headerTitle = formatPagosCanceladosPdfTitle(scope, periodLabel)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const headerBottom = drawPdfHeader(doc, pageW, headerTitle)
  const bodyStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  const cursorY = bodyStartY + 3

  if (rows.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text(
      'No hay pagos cancelados en el período seleccionado.',
      pagosPdfContentLeft(1),
      cursorY + 2,
    )
  } else {
    const tableStartY = bodyStartY + 3

    const canceladoHeader = scope === 'dia' ? 'Hora cancel.' : 'Cancelado'
    const fechaPagoHeader = scope === 'dia' ? 'Hora pago' : 'Fecha pago'
    const tableLeft = PAGOS_PDF_MARGIN
    const tableWidth = pageW - 2 * PAGOS_PDF_MARGIN
    const colWidths = canceladosTableColWidths(scope, tableWidth)
    const headers = [
      canceladoHeader,
      fechaPagoHeader,
      'Paciente',
      'Médico',
      'Monto',
      'Motivo',
      'Método',
    ]

    const columnStyles: Record<
      number,
      {
        cellWidth: number
        halign?: 'right' | 'left' | 'center'
        valign?: 'middle'
        overflow?: 'linebreak' | 'ellipsize'
      }
    > = {}
    colWidths.forEach((w, i) => {
      columnStyles[i] = {
        cellWidth: w,
        valign: 'middle',
        ...(i === 4 ? { halign: 'right' } : {}),
        ...(i === 5 ? { overflow: 'linebreak' } : {}),
        ...(i === 6 ? { halign: 'center' } : {}),
      }
    })

    autoTable(doc, {
      startY: tableStartY,
      head: [headers],
      body: rows.map((r) => [
        r.cancelado,
        r.fechaPago,
        r.paciente,
        r.medico,
        money(r.monto),
        r.motivo,
        r.metodo,
      ]),
      styles: TABLE_BODY_STYLES,
      headStyles: TABLE_HEAD_STYLES,
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles,
      tableWidth,
      margin: { left: tableLeft, right: PAGOS_PDF_MARGIN },
    })

    const finalY = tableFinalY(doc, tableStartY)
    strokePagosTableRoundFrame(
      doc,
      tableLeft,
      tableStartY,
      tableWidth,
      finalY - tableStartY,
      PAGOS_DOCTOR_BLOCK_RADIUS,
    )
    drawPagosTotalGeneralBar(doc, finalY + 6, pageW, rows.length, stats.total, {
      left: 'Total cancelado',
      center: `${rows.length} cancelación${rows.length === 1 ? '' : 'es'}`,
    })
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const prefix =
    scope === 'dia'
      ? 'pagos-cancelados-dia'
      : scope === 'mes'
        ? 'pagos-cancelados-mes'
        : scope === 'anio'
          ? 'pagos-cancelados-anio'
          : 'pagos-cancelados-todos'
  const filename = `${prefix}-${stamp || format(new Date(), 'yyyy-MM-dd')}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
  return { doc, filename }
}
