import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  drawPagosTotalsPill,
  drawPdfPeriodMetaBlock,
  PAGOS_PDF_MARGIN,
  PAGOS_TOTAL_GENERAL_BAR_H,
  stampPdfGeneratedFooterOnAllPages,
} from './pagosPdfLayout'
import {
  drawPdfHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
  pdfBodyStartYAfterHeader,
} from './pdfHeader'
import { savePdfFile } from './doctorPaymentsPdf'
import { aggregateResumenSettlementForPayments } from './paymentPorcentaje'
import { formatMonto } from './formatMonto'
import type { Doctor, DoctorDebtPayment, Payment } from '../types'

export type DoctorDebtPdfRow = {
  key: string
  doctorId: string
  fecha: string
  doctor: string
  concepto: string
  deuda: number
  pagado: number
  /** Fecha del último pago aplicado a esta deuda (YYYY-MM-DD). Vacía si no se pagó. */
  fechaPago: string
  saldo: number
  estado: string
  /** Datos de los pagos directos que se aplicaron a esta deuda. */
  metodo: string
  destinatario: string
  nroComprobante: string
  nota: string
}

function dateKey(value: string): string {
  return value.slice(0, 10)
}

function dateLabel(value: string): string {
  if (!value) return 'Sin fecha'
  return format(parseISO(`${value}T12:00:00`), 'dd/MM/yyyy', { locale: es })
}

/**
 * "Fecha Pago" va en dd-mm-aa: la columna es angosta y con el año de 4
 * dígitos el texto se partía en dos líneas.
 */
function shortDateLabel(value: string): string {
  if (!value) return ''
  // Ojo: el año de 2 dígitos en date-fns es `yy`. `aa` es el marcador de AM/PM
  // y salía "20-05-PM".
  return format(parseISO(`${value}T12:00:00`), 'dd-MM-yy', { locale: es })
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
      const deuda = Math.max(
        0,
        -aggregateResumenSettlementForPayments(
          list,
          () => doctor?.porcentaje,
        ).efectivoAEntregar,
      )
      const pagado = Math.min(
        deuda,
        debtPayments
          .filter((payment) => payment.deudaKey === key)
          .reduce((sum, payment) => sum + payment.monto, 0),
      )
      const saldo = Math.max(0, deuda - pagado)
      const pagosDeuda = debtPayments.filter((payment) => payment.deudaKey === key)
      // Una deuda puede haberse pagado con varios pagos: se listan los valores
      // distintos separados por " / ", como en el Excel.
      const distintos = (vals: string[]) => [
        ...new Set(vals.map((v) => (v ?? '').trim()).filter(Boolean)),
      ].join(' / ')
      return {
        key,
        doctorId: source.doctorId,
        fecha: dateKey(source.fecha),
        doctor: doctor ? `${doctor.apellido}, ${doctor.nombre}` : 'Médico no encontrado',
        concepto: 'Comisión pendiente',
        deuda,
        pagado,
        // Último pago aplicado: la fecha más reciente de los que cancelaron
        // (total o parcialmente) esta deuda.
        fechaPago: pagosDeuda.reduce((ultima, payment) => {
          const d = dateKey(payment.fecha ?? '')
          return d > ultima ? d : ultima
        }, ''),
        saldo,
        estado: saldo === 0 ? 'Pagada' : pagado > 0 ? 'Parcial' : 'Pendiente',
        metodo: distintos(pagosDeuda.map((payment) => payment.metodo)),
        // El destinatario sólo existe si la deuda se pagó: una deuda pendiente
        // no tiene a quién se le pagó.
        destinatario: distintos(
          pagosDeuda.map((payment) => payment.destinatario || 'Gerencia'),
        ),
        nroComprobante: distintos(pagosDeuda.map((payment) => payment.nroComprobante)),
        nota: distintos(pagosDeuda.map((payment) => payment.nota)),
      }
    })
    .filter((row) => row.deuda > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.doctor.localeCompare(b.doctor, 'es'))
}

export type DoctorDebtSituacion = 'pendiente' | 'pagada'

/** ¿La fila cae en la situación pedida? "pagada" es saldo 0; "pendiente", saldo > 0. */
export function coincideSituacion(row: DoctorDebtPdfRow, situacion?: DoctorDebtSituacion): boolean {
  if (!situacion) return true
  return situacion === 'pagada' ? row.saldo === 0 : row.saldo > 0
}

/** ¿La fecha de la deuda (YYYY-MM-DD) cae en el rango pedido? */
export function coincideRangoFechas(
  fecha: string,
  desde?: string,
  hasta?: string,
): boolean {
  if (desde && fecha < desde) return false
  if (hasta && fecha > hasta) return false
  return true
}

export function buildDoctorDebtPdf(params: {
  payments: Payment[]
  debtPayments: DoctorDebtPayment[]
  doctors: Doctor[]
  doctorId?: string
  /** Filtro de situación del modal: sólo pendientes o sólo pagadas. */
  situacion?: DoctorDebtSituacion
  /** Rango de fechas de la deuda, en YYYY-MM-DD. */
  desde?: string
  hasta?: string
}): { doc: jsPDF; filename: string } {
  const { payments, debtPayments, doctors, doctorId, situacion, desde, hasta } = params
  // Se respetan los filtros del modal (Médico, Situación y fechas) en todo el PDF.
  const rows = buildDoctorDebtPdfRows(payments, debtPayments, doctors, doctorId)
    .filter((row) => coincideSituacion(row, situacion))
    .filter((row) => coincideRangoFechas(row.fecha, desde, hasta))
  const doctor = doctorId ? doctors.find((item) => item.id === doctorId) : undefined
  const situacionLabel =
    situacion === 'pagada'
      ? 'Pagadas'
      : situacion === 'pendiente'
        ? 'Pendientes'
        : 'Todas'
  const rangoLabel = desde || hasta ? `${desde || '...'} a ${hasta || '...'}` : ''
  const scopeLabel = [
    doctor ? `${doctor.apellido}, ${doctor.nombre}` : 'Todos los médicos',
    situacionLabel,
    rangoLabel,
  ]
    .filter(Boolean)
    .join(' · ')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const headerBottom = drawPdfHeader(
    doc,
    pageW,
    'Gestión de\ndeudas médicas',
    { secondLine: scopeLabel },
  )
  const bodyStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )
  const cursorY = drawPdfPeriodMetaBlock(
    doc,
    pageW,
    bodyStartY,
    'Comisiones pendientes y pagos directos',
    [`Alcance: ${scopeLabel}`, `Registros: ${rows.length}`],
  )
  // El saldo pendiente ya no se imprime: la pastilla lleva los totales que
// corresponde según el filtro de Situación.
  const paidTotal = rows.reduce((sum, row) => sum + row.pagado, 0)
  const debtTotal = rows.reduce((sum, row) => sum + row.deuda, 0)

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay deudas registradas para el alcance seleccionado.', PAGOS_PDF_MARGIN, cursorY + 3)
  } else {
    const debtTableMargin = 8
    // Horizontal: entran las columnas del pago directo (Método, Destinatario,
    // N° Comprobante y Notas) sin que la tabla se haga ilegible.
    const debtTableW = pageW - 2 * debtTableMargin
    const wFecha = 19
    const wFechaPago = 17
    // Médico más ancha: los apellidos largos ("Senestraki, María Fernanda") se
    // cortaban en dos líneas con 36mm.
    const wMedico = 47
    const wEstado = 16
    const wMoney = 18
    // Lo que sobra se reparte entre Concepto, Método, Destinatario,
    // N° Comprobante y Notas.
    const wTexto = (debtTableW - wFecha - wFechaPago - wMedico - wEstado - wMoney * 3) / 5
    autoTable(doc, {
      startY: cursorY + 2,
      head: [
        [
          'Fecha',
          'Médico',
          'Concepto',
          'Deuda',
          'Pagado',
          'Fecha Pago',
          'Saldo',
          'Estado',
          'Método',
          'Destinatario',
          'N° Comprobante',
          'Notas',
        ],
      ],
      body: rows.map((row) => [
        dateLabel(row.fecha),
        row.doctor,
        row.concepto,
        formatMonto(row.deuda),
        formatMonto(row.pagado),
        shortDateLabel(row.fechaPago),
        formatMonto(row.saldo),
        row.estado,
        row.metodo,
        row.destinatario,
        row.nroComprobante,
        row.nota,
      ]),
      margin: { left: debtTableMargin, right: debtTableMargin },
      tableWidth: debtTableW,
      styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.8, textColor: [51, 65, 85] },
      headStyles: {
        fillColor: [122, 163, 176],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
      },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: {
        0: { cellWidth: wFecha },
        1: { cellWidth: wMedico },
        2: { cellWidth: wTexto },
        3: { cellWidth: wMoney, halign: 'right' },
        4: { cellWidth: wMoney, halign: 'right' },
        5: { cellWidth: wFechaPago },
        6: { cellWidth: wMoney, halign: 'right' },
        7: { cellWidth: wEstado, halign: 'center' },
        8: { cellWidth: wTexto },
        9: { cellWidth: wTexto },
        10: { cellWidth: wTexto },
        11: { cellWidth: wTexto },
      },
    })
  }

  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 8

  // Antes el PDF agregaba abajo una segunda tabla con todas las deudas de todos
  // los médicos. Ya no va: el reporte sale con los filtros de Médico y
  // Situación que se eligieron en el modal, y esa tabla los contradecía.

  // La barra de totales va pegada a la tabla, en la misma hoja si entra papel.
  // Sólo baja a la hoja siguiente cuando de verdad no queda.
  //
  // El pie "Generado" se estampa en `pageH - 7`, así que la barra tiene que
  // terminar antes. El umbral era de 45mm, unos 20 de más: con 16 filas la
  // hoja 1 tenía 40mm libres y el total se iba igual a una hoja nueva.
  const resumenMaxY =
    doc.internal.pageSize.getHeight() - 7 - PAGOS_TOTAL_GENERAL_BAR_H - 3
  let barY = finalY + 6
  if (barY > resumenMaxY) {
    doc.addPage()
    barY = 22
  }
  // El filtro de Situación decide qué total tiene sentido. Con "Pendiente" el
  // informe es sobre lo que falta cobrar y el total de pagos no aporta; con
  // "Pagado" pasa al revés. Sin filtro van los dos.
  const textoTotales =
    situacion === 'pendiente'
      ? `Deuda total: ${formatMonto(debtTotal)}`
      : situacion === 'pagada'
        ? `Pagos Realizados: ${formatMonto(paidTotal)}`
        : `Pagos Realizados: ${formatMonto(paidTotal)} - Deuda total: ${formatMonto(debtTotal)}`
  drawPagosTotalsPill(doc, barY, textoTotales, { marginX: 8 })
  stampPdfGeneratedFooterOnAllPages(doc)

  const stamp = format(new Date(), 'yyyyMMdd-HHmm')
  const slug = [
    doctor ? doctor.apellido.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'todos',
    situacion ?? 'todas',
  ].join('-')
  return { doc, filename: `deudas-medicos-${slug}-${stamp}.pdf` }
}

export async function saveDoctorDebtPdf(params: Parameters<typeof buildDoctorDebtPdf>[0]): Promise<void> {
  const built = buildDoctorDebtPdf(params)
  await savePdfFile(built.doc, built.filename)
}
