import jsPDF from 'jspdf'
import type { CuotaMensual, Patient, PlanAfiliado } from '../types'
import { drawPdfHeader, pdfBodyStartYAfterHeader } from './pdfHeader'

function formatFechaPago(fecha: string | null): string {
  if (!fecha) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : fecha
}
function formaPagoLabel(formaPago: CuotaMensual['formaPago']): string {
  switch (formaPago) {
    case 'efectivo': return 'Efectivo'
    case 'transferencia': return 'Transferencia'
    case 'deposito': return 'Depósito'
    case 'mercadopago': return 'Mercado Pago'
    case 'debito': return 'Débito'
    default: return '—'
  }
}

export function buildAfiliadoComprobantePdf(params: {
  patient: Patient
  plan?: PlanAfiliado
  cuota: CuotaMensual
  nombreMes: string
}): { doc: jsPDF; filename: string } {
  const { patient, plan, cuota, nombreMes } = params
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const headerBottom = drawPdfHeader(doc, pageW, '', {
    titleOverride: 'CENTRO MEDICO - PLAN DE SALUD',
  })
  const y = pdfBodyStartYAfterHeader(headerBottom, 5)
  const margin = 18
  const contentW = pageW - margin * 2

  doc.setDrawColor(210, 220, 230)
  doc.roundedRect(margin, y, contentW, 94, 3, 3, 'S')

  doc.setTextColor(26, 39, 68)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('COMPROBANTE DE PAGO', pageW / 2, y + 13, { align: 'center' })

  doc.setDrawColor(99, 173, 188)
  doc.setLineWidth(0.6)
  doc.line(margin + 10, y + 18, pageW - margin - 10, y + 18)

  const left = margin + 10
  const right = pageW / 2 + 22
  doc.setFontSize(11)

  const field = (x: number, fieldLabel: string, value: string, strong = false) => {
    doc.setFont('helvetica', 'bold')
    doc.text(fieldLabel, x, rowY)
    doc.setFont('helvetica', strong ? 'bold' : 'normal')
    doc.text(value, x + 32, rowY)
  }

  let rowY = y + 31
  field(left, 'Paciente:', `${patient.apellido}, ${patient.nombre}`)
  field(right, 'DNI:', patient.dni || '—')
  rowY += 15
  field(left, 'Plan:', plan?.nombre || '—')
  field(right, 'Período:', `${nombreMes} ${cuota.anio}`)
  rowY += 15
  field(left, 'Fecha de pago:', formatFechaPago(cuota.fechaPago))
  field(right, 'Forma de pago:', formaPagoLabel(cuota.formaPago))
  rowY += 15

  doc.setFont('helvetica', 'bold')
  doc.text('Importe:', left, rowY)
  doc.setFontSize(14)
  doc.text(`$${cuota.monto.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`, left + 32, rowY)

  const leyenda = 'Este comprobante acredita el pago de la cuota indicada.'
  const separacion = '  '
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const leyendaAncho = doc.getTextWidth(leyenda)
  const separacionAncho = doc.getTextWidth(separacion)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const pagadoAncho = doc.getTextWidth('PAGADO')
  const inicio = (pageW - leyendaAncho - separacionAncho - pagadoAncho) / 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text(leyenda, inicio, y + 88, { align: 'left' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(217, 119, 6)
  doc.text('PAGADO', inicio + leyendaAncho + separacionAncho, y + 88, { align: 'left' })
  const safeName = `${patient.apellido}-${patient.nombre}`.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return { doc, filename: `comprobante-pago-${safeName}-${cuota.anio}-${String(cuota.mes).padStart(2, '0')}.pdf` }
}