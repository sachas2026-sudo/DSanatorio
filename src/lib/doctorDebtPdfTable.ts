import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { drawPdfHeader, PDF_BODY_EXTRA_DOWN_PLAIN, pdfBodyStartYAfterHeader } from './pdfHeader'
import { drawPagosTotalGeneralBar } from './pagosPdfLayout'
import { formatMonto } from './formatMonto'
import { aggregateResumenSettlementForPayments } from './paymentPorcentaje'
import type { Doctor, DoctorDebtPayment, Payment } from '../types'

export type DoctorDebtPdfRow = {
  key: string
  doctorId: string
  fecha: string
  doctor: string
  concepto: string
  deuda: number
  pagado: number
  saldo: number
  estado: string
}

function dateKey(value: string): string {
  return value.slice(0, 10)
}

function dateLabel(value: string): string {
  return format(parseISO(`${value}T12:00:00`), 'dd/MM/yyyy', { locale: es })
}

export function buildDoctorDebtPdfRows(
  payments: Payment[],
  debtPayments: DoctorDebtPayment[],
  doctors: Doctor[],
  doctorId?: string,
): DoctorDebtPdfRow[] {
  const doctorById = new Map(doctors.map((doctor) => [doctor.id, doctor]))
  const grouped = new Map<string, Payment[]>()
  for (const payment of payments) {
    if (payment.monto <= 0 || (doctorId && payment.doctorId !== doctorId)) continue
    const key = `${payment.doctorId}__${dateKey(payment.fecha)}`
    const list = grouped.get(key) ?? []
    list.push(payment)
    grouped.set(key, list)
  }

  return [...grouped.entries()]
    .map(([key, list]) => {
      const source = list[0]!
      const doctor = doctorById.get(source.doctorId)
      const deuda = Math.max(0, -aggregateResumenSettlementForPayments(list, () => doctor?.porcentaje).efectivoAEntregar)
      const pagado = Math.min(deuda, debtPayments.filter((payment) => payment.deudaKey === key).reduce((sum, payment) => sum + payment.monto, 0))
      const saldo = Math.max(0, deuda - pagado)
      return {
        key, doctorId: source.doctorId, fecha: dateKey(source.fecha),
        doctor: doctor ? `${doctor.apellido}, ${doctor.nombre}` : 'Médico no encontrado',
        concepto: 'Comisión pendiente', deuda, pagado, saldo,
        estado: saldo === 0 ? 'Pagada' : pagado > 0 ? 'Parcial' : 'Pendiente',
      }
    })
    .filter((row) => row.deuda > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.doctor.localeCompare(b.doctor, 'es'))
}

/** Agrega una última hoja con las deudas originadas en los pagos del período. */
export function appendDoctorDebtSummaryPage(
  doc: jsPDF,
  rows: DoctorDebtPdfRow[],
  periodLabel: string,
  subjectLabel: string = 'Todos los médicos',
): void {
  const pageW = doc.internal.pageSize.getWidth()
  const tableMargin = 20
  doc.addPage()
  const headerBottom = drawPdfHeader(doc, pageW, 'Deudas de médicos', {
    secondLine: `Período: ${periodLabel} — ${subjectLabel}`,
  })
  const startY = pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN)
  const pendingTotal = rows.reduce((sum, row) => sum + row.saldo, 0)
  const debtTotal = rows.reduce((sum, row) => sum + row.deuda, 0)
  const paidTotal = rows.reduce((sum, row) => sum + row.pagado, 0)

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay deudas de médicos en el período seleccionado.', tableMargin, startY + 5)
  } else {
    autoTable(doc, {
      startY,
      head: [['Fecha', 'Médico', 'Concepto', 'Deuda', 'Pagado', 'Saldo', 'Estado']],
      body: rows.map((row) => [dateLabel(row.fecha), row.doctor, row.concepto, formatMonto(row.deuda), formatMonto(row.pagado), formatMonto(row.saldo), row.estado]),
      theme: 'plain',
      margin: { left: tableMargin, right: tableMargin }, tableWidth: pageW - tableMargin * 2,
      styles: {
        font: 'helvetica', fontSize: 7.5,
        cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 },
        textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.15,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [15, 41, 66], textColor: [255, 255, 255],
        fontStyle: 'bold', fontSize: 7.5, halign: 'center',
        cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 47 },
        2: { cellWidth: 27, overflow: 'linebreak' },
        3: { cellWidth: 19, halign: 'right' },
        4: { cellWidth: 19, halign: 'right' },
        5: { cellWidth: 19, halign: 'right', fontStyle: 'bold' },
        6: { cellWidth: 18, halign: 'center' },
      },
    })
  }

  let summaryY = rows.length > 0
    ? ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY) + 8
    : startY + 12
  if (summaryY > doc.internal.pageSize.getHeight() - 24) {
    doc.addPage()
    summaryY = 22
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105)
  doc.text(`Deuda total: ${formatMonto(debtTotal)}    Pagos aplicados: ${formatMonto(paidTotal)}`, tableMargin, summaryY)
  drawPagosTotalGeneralBar(doc, summaryY + 5, pageW, rows.length, pendingTotal, { left: 'Saldo pendiente', center: subjectLabel, marginX: tableMargin })
}
