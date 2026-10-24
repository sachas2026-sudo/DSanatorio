import { format, parseISO } from 'date-fns'
import type { Appointment } from '../types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { drawPdfHeader, pdfBodyStartYAfterHeader, PDF_BODY_EXTRA_DOWN_PLAIN } from './pdfHeader'
import { PAGOS_PDF_MARGIN, stampPdfGeneratedFooterOnAllPages } from './pagosPdfLayout'

export type PagosPendienteRow = {
  fecha: string
  paciente: string
  medico: string
  especialidad: string
  obraSocial: string
}

export function buildPagosPendientesPdf(
  desde: string,
  hasta: string,
  filterLabel: string,
  rows: PagosPendienteRow[],
  footerLabel?: string,
  turnoLabel?: string,
): { doc: jsPDF; filename: string; title: string } {
  const doc = new jsPDF({ format: 'a4', orientation: 'portrait', unit: 'mm' })
  const pageW = doc.internal.pageSize.getWidth()
  const periodText =
    desde === hasta
      ? format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')
      : `${format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')} al ${format(parseISO(`${hasta}T12:00:00`), 'dd-MM-yyyy')}`
  const turnoText = turnoLabel ? ` - Turno: ${turnoLabel}` : ''
  const filterText = filterLabel ? ` - Filtro: ${filterLabel}` : ''
  const title = 'Reporte de Pagos Pendientes'
  const headerBottom = drawPdfHeader(doc, pageW, title, {
    secondLine: `Período: ${periodText}${turnoText}${filterText}`,
    fontSize: 18,
  })
  const margin = 10
  let y = pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN)

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Fecha / Hora', 'Paciente', 'Médico', 'Especialidad', 'Obra Social']],
    body: [
      ...rows.map((r) => [r.fecha, r.paciente, r.medico, r.especialidad, r.obraSocial]),
      [['TOTALES', '', '', '', `${rows.length} pendiente${rows.length === 1 ? '' : 's'}`]],
    ],
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 41, 66],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 52 },
      2: { cellWidth: 48 },
      3: { cellWidth: 30 },
      4: { cellWidth: 26 },
    },
  })
  stampPdfGeneratedFooterOnAllPages(doc, { marginX: margin, label: footerLabel ?? undefined })
  const stamp = format(new Date(), 'yyyyMMdd-HHmm')
  return { doc, filename: `pagos-pendientes-${stamp}.pdf`, title }
}
