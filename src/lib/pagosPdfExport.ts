import { brandGestiónLine } from './pdfBranding'
import {
  buildAllDoctorsPaymentsPdf,
  buildDayPaymentPdfRows,
  buildDayPaymentsPdf,
  formatPdfResumenTitle,
  type AllDoctorsPdfScope,
} from './doctorPaymentsPdf'
import type { Payment } from '../types'
import type jsPDF from 'jspdf'

export type PagosPeriodoPdfExport = {
  doc: jsPDF
  filename: string
  title: string
}

export function buildPagosPeriodoPdfExport(params: {
  periodo: AllDoctorsPdfScope
  payments: Payment[]
  periodLabel: string
  fileStamp: string
  patientLabel: (patientId: string) => string
  obraSocialLabel: (patientId: string) => string
  doctorLabel: (doctorId: string) => string
}): PagosPeriodoPdfExport {
  const {
    periodo,
    payments,
    periodLabel,
    fileStamp,
    patientLabel,
    obraSocialLabel,
    doctorLabel,
  } = params

  if (periodo === 'dia') {
    const rows = buildDayPaymentPdfRows(
      payments,
      patientLabel,
      doctorLabel,
      obraSocialLabel,
      'HH:mm',
    )
    const built = buildDayPaymentsPdf({
      dayLabel: periodLabel,
      rows,
      fileStamp,
      headerTitle: `Pagos del día - ${periodLabel}`,
      dateColumnHeader: 'Hora',
      emptyMessage: 'No hay pagos registrados en este día.',
      totalLabel: 'Total del día',
      filenamePrefix: 'pagos-del-dia',
    })
    return {
      doc: built.doc,
      filename: built.filename,
      title: `Pagos del día - ${periodLabel}`,
    }
  }

  const scopeOpts =
    periodo === 'mes'
      ? {
          headerTitle: `Pagos del mes - ${periodLabel}`,
          dateFormat: 'd MMM yyyy HH:mm',
          dateColumnHeader: 'Fecha',
          emptyMessage: 'No hay pagos registrados en este mes.',
          totalLabel: 'Total del mes',
          filenamePrefix: 'pagos-del-mes',
          withDoctorChart: true,
          previewTitle: `Pagos del mes - ${periodLabel}`,
        }
      : {
          headerTitle: `Pagos del año - ${periodLabel}`,
          dateFormat: 'd MMM yyyy HH:mm',
          dateColumnHeader: 'Fecha',
          emptyMessage: 'No hay pagos registrados en este año.',
          totalLabel: 'Total del año',
          filenamePrefix: 'pagos-del-anio',
          withDoctorChart: true,
          previewTitle: `Pagos del año - ${periodLabel}`,
        }

  const built = buildAllDoctorsPaymentsPdf({
    periodLabel,
    payments,
    patientLabel,
    obraSocialLabel,
    doctorLabel,
    scope: periodo,
    fileStamp,
    ...scopeOpts,
  })

  return {
    doc: built.doc,
    filename: built.filename,
    title: scopeOpts.previewTitle,
  }
}

export function buildPagosEmailBodyWithPdf(params: {
  periodo: AllDoctorsPdfScope
  periodLabel: string
  pdfFilename: string
  totalCobrado: string
  cantidadPagos: number
  filtroMedicoLabel?: string
  gerencia?: boolean
}): string {
  const lines = [
    brandGestiónLine(),
    formatPdfResumenTitle(params.periodo, params.periodLabel),
    '',
    params.gerencia
      ? 'Se adjunta el resumen para Gerencia (pagos por médico, sin nombres de pacientes).'
      : 'Se adjunta el mismo informe PDF que en «Vista previa».',
    `Archivo: ${params.pdfFilename}`,
  ]
  if (params.filtroMedicoLabel) {
    lines.push(`Filtro médico en pantalla: ${params.filtroMedicoLabel}`)
  }
  lines.push(
    '',
    `Total cobrado: ${params.totalCobrado}`,
    `Cantidad de pagos: ${params.cantidadPagos}`,
  )
  return lines.join('\n')
}
