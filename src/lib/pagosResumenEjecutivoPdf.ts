import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import type { Payment } from '../types'
import { formatMonto } from './formatMonto'
import {
  drawPdfHeader,
  pdfBodyStartYAfterHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
} from './pdfHeader'
import {
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
  resolvePaymentPorcentaje,
  computeDoctorPorcentajeSettlement,
} from './pagosPdfLayout'

type BuildPagosResumenEjecutivoOptions = {
  payments: Payment[]
  annualPayments: Payment[]
  periodLabel: string
  doctorLabel: (id: string) => string
  doctorPorcentaje?: (id: string) => number | undefined
  footerLabel?: string
}

type TotalRow = { label: string; total: number; count: number }

const RESUMEN_PDF_MARGIN = 22

/** Alto del panel "Recaudación por médico" (mm). Va más alto que el de formas de
 *  pago porque suele traer muchos médicos y las barras quedaban apretadas: con
 *  panelY ≈ 58 y 135 de alto el recuadro cierra en ~193mm, contra el pie de
 *  página que stampPdfGeneratedFooterOnAllPages deja en ~203mm. */
const RESUMEN_PANEL_MEDICOS_H = 135

/** Alto del panel "Formas de pago" (mm): son pocas filas, no necesita más. */
const RESUMEN_PANEL_METODOS_H = 92

function drawMetric(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
): void {
  doc.setFillColor(241, 247, 255)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.25)
  doc.roundedRect(x, y, width, 16, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(107, 124, 147)
  doc.text(label.toUpperCase(), x + 4, y + 5.5)
  doc.setFontSize(11)
  doc.setTextColor(26, 74, 138)
  doc.text(value, x + 4, y + 12.5)
}

function drawBarPanel(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  rows: TotalRow[],
): void {
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, width, height, PAGOS_DOCTOR_BLOCK_RADIUS, PAGOS_DOCTOR_BLOCK_RADIUS, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(26, 39, 68)
  doc.text(title, x + 5, y + 8)

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(107, 124, 147)
    doc.text('Sin datos para el período.', x + 5, y + 20)
    return
  }

  const max = rows[0]?.total ?? 1
  const labelW = Math.min(48, width * 0.35)
  const valueW = 28
  const trackX = x + 5 + labelW
  const trackW = width - labelW - valueW - 10
  const rowH = Math.min(11.5, (height - 16) / rows.length)

  rows.forEach((row, index) => {
    const rowY = y + 15 + index * rowH
    if (index % 2 === 0) {
      doc.setFillColor(248, 251, 255)
      doc.roundedRect(x + 3, rowY - 2.5, width - 6, rowH, 1.5, 1.5, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(61, 74, 92)
    doc.text(doc.splitTextToSize(row.label, labelW - 3) as string[], x + 5, rowY + 2, {
      maxWidth: labelW - 3,
    })
    doc.setFillColor(229, 238, 249)
    doc.roundedRect(trackX, rowY, trackW, 4.5, 2.25, 2.25, 'F')
    doc.setFillColor(91, 159, 212)
    doc.roundedRect(trackX, rowY, Math.max(3, (row.total / max) * trackW), 4.5, 2.25, 2.25, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.8)
    doc.setTextColor(26, 74, 138)
    doc.text(formatMonto(row.total), x + width - 5, rowY + 3.5, { align: 'right' })
  })
}

export function buildPagosResumenEjecutivoPdf({
  payments,
  annualPayments,
  periodLabel,
  doctorLabel,
  doctorPorcentaje,
  footerLabel,
}: BuildPagosResumenEjecutivoOptions): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const left = RESUMEN_PDF_MARGIN
  const contentW = pageW - left * 2
  const total = payments.reduce((sum, payment) => sum + payment.monto, 0)
  const average = payments.length > 0 ? total / payments.length : 0

  const byDoctor = new Map<string, TotalRow>()
  const byMethod = new Map<string, TotalRow>()
  payments.forEach((payment) => {
    const doctor = doctorLabel(payment.doctorId)
    const method = payment.metodo?.trim() || 'Sin especificar'
    const pct = resolvePaymentPorcentaje(payment, doctorPorcentaje?.(payment.doctorId))
    const doctorCut = computeDoctorPorcentajeSettlement(payment.monto, pct).totalGeneral

    const doctorRow = byDoctor.get(doctor) ?? { label: doctor, total: 0, count: 0 }
    doctorRow.total += doctorCut
    doctorRow.count += 1
    byDoctor.set(doctor, doctorRow)
    const methodRow = byMethod.get(method) ?? { label: method, total: 0, count: 0 }
    methodRow.total += doctorCut
    methodRow.count += 1
    byMethod.set(method, methodRow)
  })

  const sortRows = (rows: TotalRow[]) =>
    rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'es'))
  const doctors = sortRows([...byDoctor.values()])
  const methods = sortRows([...byMethod.values()])

  const headerBottom = drawPdfHeader(doc, pageW, 'Resumen ejecutivo de cobranzas', {
    secondLine: periodLabel,
    marginX: left,
  })
  const y = pdfBodyStartYAfterHeader(headerBottom, 3)
  const metricGap = 6
  const metricW = (contentW - metricGap * 3) / 4
  drawMetric(doc, left, y, metricW, 'Total cobrado', formatMonto(total))
  drawMetric(doc, left + metricW + metricGap, y, metricW, 'Pagos registrados', String(payments.length))
  drawMetric(doc, left + (metricW + metricGap) * 2, y, metricW, 'Promedio por pago', formatMonto(average))
  drawMetric(doc, left + (metricW + metricGap) * 3, y, metricW, 'Médicos', String(doctors.length))

  const panelY = y + 21
  const panelGap = 8
  const panelW = (contentW - panelGap) / 2
  drawBarPanel(doc, left, panelY, panelW, RESUMEN_PANEL_MEDICOS_H, 'Recaudación por médico', doctors)
  drawBarPanel(doc, left + panelW + panelGap, panelY, panelW, RESUMEN_PANEL_METODOS_H, 'Formas de pago', methods)

  const activeYear = new Date().getFullYear()
  const monthlyTotals = Array.from({ length: 12 }, (_, month) => {
    const rows = annualPayments.filter((payment) =>
      new Date(payment.fecha).getFullYear() === activeYear &&
      new Date(payment.fecha).getMonth() === month,
    )
    
    let totalMedico = 0
    rows.forEach((payment) => {
      const pct = resolvePaymentPorcentaje(payment, doctorPorcentaje?.(payment.doctorId))
      totalMedico += computeDoctorPorcentajeSettlement(payment.monto, pct).totalGeneral
    })
    
    const total = rows.reduce((sum, payment) => sum + payment.monto, 0)

    return {
      label: format(new Date(activeYear, month, 1), 'MMMM', { locale: es }),
      total,
      totalMedico,
      totalCuidar: total - totalMedico,
      count: rows.length,
    }
  })
  const annualTotal = monthlyTotals.reduce((sum, row) => sum + row.total, 0)
  const annualMax = Math.max(...monthlyTotals.map((row) => row.total), 1)

  doc.addPage()
  const annualHeaderBottom = drawPdfHeader(doc, pageW, 'Historial anual de cobranzas', {
    secondLine: String(activeYear),
    marginX: left,
  })
  const annualTop = pdfBodyStartYAfterHeader(annualHeaderBottom, 3)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(26, 39, 68)
  doc.text('Recaudación por mes', left, annualTop)
  
  // Leyenda de colores
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setFillColor(46, 204, 113)
  doc.rect(left + 54, annualTop - 2.8, 3.8, 3.8, 'F')
  doc.text('Total Médico', left + 60, annualTop)
  doc.setFillColor(45, 122, 186)
  doc.rect(left + 84, annualTop - 2.8, 3.8, 3.8, 'F')
  doc.text('Total Cuidar', left + 90, annualTop)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(107, 124, 147)
  doc.text(`Total anual: ${formatMonto(annualTotal)}`, pageW - left, annualTop, { align: 'right' })

  const annualChartTop = annualTop + 8
  const annualLabelW = 24
  const annualValueW = 34
  const annualTrackX = left + annualLabelW
  const annualTrackW = contentW - annualLabelW - annualValueW
  monthlyTotals.forEach((row, index) => {
    const rowY = annualChartTop + index * 9.2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(61, 74, 92)
    const monthLabel = row.label.charAt(0).toUpperCase() + row.label.slice(1)
    doc.text(monthLabel, left, rowY + 3.5)
    doc.setFillColor(229, 238, 249)
    doc.roundedRect(annualTrackX, rowY, annualTrackW, 4.5, 2.25, 2.25, 'F')
    
    if (row.total > 0) {
      const fullWidth = Math.max(3, (row.total / annualMax) * annualTrackW)
      const medicoWidth = (row.totalMedico / annualMax) * annualTrackW
      
      // Dibujar barra completa (Cuidar quedará a la derecha) con azul más oscuro
      doc.setFillColor(45, 122, 186)
      doc.roundedRect(annualTrackX, rowY, fullWidth, 4.5, 2.25, 2.25, 'F')
      
      // Dibujar parte Médico sobre la izquierda
      if (medicoWidth > 1) {
        doc.setFillColor(46, 204, 113)
        doc.roundedRect(annualTrackX, rowY, Math.max(3, medicoWidth), 4.5, 2.25, 2.25, 'F')
      }
    }
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.8)
    doc.setTextColor(26, 74, 138)
    doc.text(`${formatMonto(row.total)} · ${row.count}`, pageW - left, rowY + 3.5, { align: 'right' })
  })

  stampPdfGeneratedFooterOnAllPages(doc, { label: footerLabel, marginX: left })
  return {
    doc,
    filename: `resumen-cobranzas-${activeYear}.pdf`,
  }
}
