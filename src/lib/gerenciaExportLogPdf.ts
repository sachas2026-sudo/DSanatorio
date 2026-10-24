import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  drawPdfHeader,
  pdfBodyStartYAfterHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
} from './pdfHeader'
import {
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
} from './pagosPdfLayout'
import { formatMonto } from './formatMonto'
import { resolveExportLogTurno, type PagosGerenciaExcelLogRecord } from './pagosGerenciaExcelLog'

export function buildGerenciaExportLogPdf(
  logs: PagosGerenciaExcelLogRecord[],
): { doc: jsPDF; filename: string; title: string } {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' })
  const headerTitle = 'Registro de Exportaciones a Gerencia'
  const pageW = doc.internal.pageSize.getWidth()
  
  drawPdfHeader(doc, pageW, headerTitle)
  let y = pdfBodyStartYAfterHeader(18, PDF_BODY_EXTRA_DOWN_PLAIN)

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Usuario', 'Turno', 'Cuidar', 'Total Médico', 'Efectivo Exportado']],
    body: logs.map((l) => [
      format(parseISO(l.fechaExportacion), 'dd/MM/yyyy HH:mm', { locale: es }),
      l.usuario,
      resolveExportLogTurno(l),
      formatMonto(l.montoCuidar ?? 0),
      formatMonto(l.montoEfectivo - (l.montoCuidar ?? 0)),
      formatMonto(l.montoEfectivo),
    ]),
    theme: 'striped',
    headStyles: {
      fillColor: [26, 74, 138],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 28 },
      3: { cellWidth: 25, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
    },
    styles: {
      fontSize: 9,
      cellPadding: 1.5,
    },
    margin: { left: PAGOS_PDF_MARGIN, right: PAGOS_PDF_MARGIN },
  })

  stampPdfGeneratedFooterOnAllPages(doc)

  const filename = `historial-exportaciones-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`
  return { doc, filename, title: headerTitle }
}
