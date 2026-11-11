import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { isTauri } from '@tauri-apps/api/core'
import jsPDF from 'jspdf'
import autoTable, { type CellHookData } from 'jspdf-autotable'
import {
  drawPdfHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
  PDF_BODY_START_Y,
  pdfBodyStartYAfterHeader,
} from './pdfHeader'
import {
  aggregatePorcentajeSettlementForPayments,
  aggregateResumenSettlementForPayments,
  buildRendicionDoctorRows,
  sonTodosTransferencia,
  type RendicionDoctorRow,
} from './paymentPorcentaje'
import {
  buildPagosSummaryMetrics,
  calcularDesglosePagoFila,
  countDistinctPagos,
  computeDoctorPorcentajeSettlement,
  computeEfectivoAEntregar,
  drawPagosDoctorSectionTitle,
  pagoPdfGroupKey,
  drawPagosDoctorResumenTable,
  drawPagosDoctorSubtotalBar,
  drawPagosSummaryStrip,
  PAGOS_DOCTOR_RESUMEN_BLOCK_H,
  PAGOS_DOCTOR_SUBTOTAL_WITH_PCT_H,
  buildPaymentsSettlementMap,
  resolveDoctorPaymentSettlement,
  resolvePaymentPorcentaje,
  sumPagosEfectivoEntregarByDoctor,
  sumPagosNetTotalByDoctor,
  sumPagosTransferencia,
  drawPagosTransferenciaBar,
  PAGOS_TRANSFERENCIA_BAR_H,
  drawPagosTotalesBloqueH4,
  PAGOS_TOTALES_H4_BLOCK_H,
  drawPagosTotalGeneralBar,
  drawResumenGeneralCardJ2,
  calculateResumenGeneralJ2,
  RESUMEN_GENERAL_J2_TOTAL_H,
  drawPdfPeriodMetaBlock,
  formatPagosPdfDateTime,
  stampPdfGeneratedFooterOnAllPages,
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_DOCTOR_SUBTOTAL_BAR_H,
  PAGOS_DOCTOR_TITLE_BAR_H,
  PAGOS_PDF_MARGIN,
  PAGOS_TOTAL_GENERAL_BAR_H,
  pagosPdfContentLeft,
  pagosPdfContentWidth,
  pagosPdfTableOptions,
} from './pagosPdfLayout'
import { getTurnoFromFecha } from './dayTurnos'
import { formatMonto } from './formatMonto'
import type { Appointment, Doctor, Payment } from '../types'
import { appendDoctorDebtSummaryPage, type DoctorDebtPdfRow } from './doctorDebtPdfTable'
import { drawValoresConfiguradosBullets } from './resumenCuidarValores'

function money(n: number): string {
  return formatMonto(n)
}

function formatTurnoCell(
  citaId: string | undefined | null,
  paymentFecha: string,
  appointmentById?: (id: string) => Appointment | undefined,
): string {
  const appt = citaId && appointmentById ? appointmentById(citaId) : undefined
  const t = getTurnoFromFecha(appt?.fechaHora || paymentFecha)
  return t === 'Mañana' ? 'Mañ' : t
}

function formatMetodoCell(metodo: string | undefined | null): string {
  if (!metodo) return '—'
  const trimmed = metodo.trim()
  if (/^transferencia$/i.test(trimmed)) {
    return 'Transf.'
  }
  return trimmed
}

export type DoctorPdfRow = {
  fecha: string
  turno?: string
  paciente: string
  obs: string
  monto: number
  metodo: string
  obraSocial: string
}

export type DayPaymentPdfRow = {
  fecha: string
  turno?: string
  paciente: string
  obs: string
  medico: string
  monto: number
  metodo: string
  obraSocial: string
}

export type ObraSocialLabelFn = (patientId: string) => string

export function formatObraSocialCell(
  obraSocialLabel: ObraSocialLabelFn,
  patientId: string,
  payment?: Payment,
  appointmentById?: (id: string) => Appointment | undefined,
): string {
  if (payment?.obraSocialOverride) return payment.obraSocialOverride
  if (payment?.citaId && appointmentById) {
    const appt = appointmentById(payment.citaId)
    if (appt?.obraSocialOverride) return appt.obraSocialOverride
  }
  const v = obraSocialLabel(patientId)?.trim()
  return v || '—'
}

export type DoctorTotalChartItem = {
  label: string
  monto: number
}

const CHART_BAR_GRADIENTS: [string, string][] = [
  ['#2f6fdb', '#7eb3f5'],
  ['#3d9a7a', '#8ed4b8'],
  ['#7c5cbf', '#b39ee8'],
  ['#e07b39', '#f5b07a'],
  ['#d6455d', '#f08a9a'],
  ['#1a8a9b', '#5ec4d4'],
  ['#5b6b8a', '#9aa8c4'],
  ['#c9a227', '#e8cc6a'],
]

function roundRectCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/** Esquinas superiores redondeadas; borde inferior recto. */
function roundTopOnlyCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x + w, y + radius)
  ctx.quadraticCurveTo(x + w, y, x + w - radius, y)
  ctx.lineTo(x + radius, y)
  ctx.quadraticCurveTo(x, y, x, y + radius)
  ctx.lineTo(x, y + h)
  ctx.closePath()
}

function moneyChart(n: number): string {
  return formatMonto(n)
}

function aggregateDoctorTotals(rows: DayPaymentPdfRow[]): DoctorTotalChartItem[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.medico, (map.get(r.medico) ?? 0) + r.monto)
  }
  return [...map.entries()]
    .map(([label, monto]) => ({ label, monto }))
    .sort((a, b) => b.monto - a.monto)
}

export function aggregateDoctorTotalsFromPayments(
  payments: Payment[],
  doctorLabel: (doctorId: string) => string,
  doctorPorcentaje?: (doctorId: string) => number | undefined,
  doctorResolver?: (doctorId: string) => Doctor | undefined,
): DoctorTotalChartItem[] {
  const byDoctor = new Map<string, Payment[]>()
  for (const p of payments) {
    const list = byDoctor.get(p.doctorId) ?? []
    list.push(p)
    byDoctor.set(p.doctorId, list)
  }
  return [...byDoctor.entries()]
    .map(([doctorId, list]) => {
      const monto = doctorResolver || doctorPorcentaje
        ? aggregatePorcentajeSettlementForPayments(
            list,
            doctorPorcentaje,
            doctorResolver,
          ).totalGeneral
        : list.reduce((s, p) => s + p.monto, 0)
      return { label: doctorLabel(doctorId), monto }
    })
    .sort((a, b) => b.monto - a.monto)
}

export function formatCobranzasChartHeaderTitle(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  return `Cobranzas - Gráfico por médico - ${formatCobranzasHeaderPeriodSuffix(scope, periodLabel)}`
}

function buildDoctorChartImage(
  items: DoctorTotalChartItem[],
): { dataUrl: string; width: number; height: number } {
  const pad = 28
  const headerH = 44
  const rowH = 50
  const rankW = 36
  const labelW = 168
  const barAreaW = 420
  const valueW = 118
  const bodyTop = pad + headerH + 12
  const w = pad * 2 + rankW + labelW + barAreaW + valueW
  const h = bodyTop + pad + items.length * rowH
  const dpr = 2
  const total = items.reduce((s, i) => s + i.monto, 0)
  const max = Math.max(...items.map((i) => i.monto), 1)

  const canvas = document.createElement('canvas')
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return { dataUrl: '', width: w, height: h }

  ctx.scale(dpr, dpr)

  roundRectCanvas(ctx, 4, 6, w - 4, h - 2, 11)
  ctx.fillStyle = 'rgba(30, 50, 90, 0.06)'
  ctx.fill()

  roundRectCanvas(ctx, 0, 0, w, h, 16)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = '#d8e2ef'
  ctx.lineWidth = 1
  ctx.stroke()

  roundTopOnlyCanvas(ctx, 0, 0, w, headerH, 10)
  const headGrad = ctx.createLinearGradient(0, 0, w, 0)
  headGrad.addColorStop(0, '#2f6fdb')
  headGrad.addColorStop(1, '#5b9aee')
  ctx.fillStyle = headGrad
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = '700 16px system-ui, "Segoe UI", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('Totales por médico', pad, headerH / 2)

  const barX = pad + rankW + labelW
  const barH = 26

  items.forEach((item, i) => {
    const y = bodyTop + i * rowH + 8
    const [c0, c1] = CHART_BAR_GRADIENTS[i % CHART_BAR_GRADIENTS.length]
    const pct = total > 0 ? Math.round((item.monto / total) * 100) : 0
    const shortLabel =
      item.label.length > 24 ? `${item.label.slice(0, 22)}…` : item.label

    ctx.beginPath()
    ctx.arc(pad + 14, y + barH / 2, 12, 0, Math.PI * 2)
    const rankGrad = ctx.createLinearGradient(pad + 2, y, pad + 26, y + barH)
    rankGrad.addColorStop(0, c0)
    rankGrad.addColorStop(1, c1)
    ctx.fillStyle = rankGrad
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), pad + 14, y + barH / 2)

    ctx.fillStyle = '#1e2a44'
    ctx.font = '600 12px system-ui, "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(shortLabel, pad + rankW, y + barH / 2)

    roundRectCanvas(ctx, barX, y, barAreaW, barH, 8)
    ctx.fillStyle = '#eef3fb'
    ctx.fill()

    const fillW = Math.max(12, (item.monto / max) * barAreaW)
    const barGrad = ctx.createLinearGradient(barX, y, barX + fillW, y)
    barGrad.addColorStop(0, c0)
    barGrad.addColorStop(1, c1)
    roundRectCanvas(ctx, barX, y, fillW, barH, 8)
    ctx.fillStyle = barGrad
    ctx.fill()

    if (fillW > 52) {
      ctx.fillStyle = '#ffffff'
      ctx.font = '600 10px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${pct}%`, barX + fillW - 8, y + barH / 2)
    }

    ctx.fillStyle = '#1a2744'
    ctx.font = '700 11px system-ui, "Segoe UI", sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(moneyChart(item.monto), barX + barAreaW + valueW - 4, y + barH / 2)
  })

  return {
    dataUrl: canvas.toDataURL('image/png', 1),
    width: w,
    height: h,
  }
}

function drawDoctorPaymentsChartPage(
  doc: jsPDF,
  scope: AllDoctorsPdfScope,
  periodLabel: string,
  items: DoctorTotalChartItem[],
  totalPagos: number,
): void {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  doc.addPage()
  const headerBottom = drawPdfHeader(
    doc,
    pageW,
    formatCobranzasChartHeaderTitle(scope, periodLabel),
  )

  const chart = buildDoctorChartImage(items)
  if (!chart.dataUrl) return

  const imgY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )
  const margin = PAGOS_PDF_MARGIN
  let imgW = pageW - margin * 2
  let imgH = (imgW * chart.height) / chart.width
  const maxH = pageH - imgY - PAGOS_TOTAL_GENERAL_BAR_H - 16
  if (imgH > maxH) {
    imgH = maxH
    imgW = (imgH * chart.width) / chart.height
  }
  const imgX = margin + (pageW - margin * 2 - imgW) / 2
  doc.addImage(chart.dataUrl, 'PNG', imgX, imgY, imgW, imgH)

  const total = items.reduce((s, i) => s + i.monto, 0)
  const footY = imgY + imgH + 6
  drawPagosTotalGeneralBar(doc, footY, pageW, totalPagos, total, {
    left: 'Total del período',
    leftSuffix: '( Transferencias + Total Efectivo Médico )',
    center: '',
  })
}

function appendDoctorTotalsChartPage(
  doc: jsPDF,
  scope: AllDoctorsPdfScope,
  periodLabel: string,
  payments: Payment[],
  doctorLabel: (doctorId: string) => string,
  doctorPorcentaje?: (doctorId: string) => number | undefined,
  doctorResolver?: (doctorId: string) => Doctor | undefined,
): void {
  const items = aggregateDoctorTotalsFromPayments(
    payments,
    doctorLabel,
    doctorPorcentaje,
    doctorResolver,
  )
  if (items.length <= 1) return
  drawDoctorPaymentsChartPage(doc, scope, periodLabel, items, payments.length)
}

export type AllDoctorsPdfScope = 'dia' | 'mes' | 'anio'

/** Título principal del encabezado del PDF según período. */
export function formatPdfResumenTitle(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  if (scope === 'mes') return `Resumen Mes de ${periodLabel}`
  if (scope === 'anio') return `Resumen Año ${periodLabel}`
  return `Resumen Día de ${periodLabel}`
}

/** Sufijo de período para la barra azul (ej. Día de 27 mayo 2026). */
export function formatCobranzasHeaderPeriodSuffix(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  if (scope === 'mes') return `Mes de ${periodLabel}`
  if (scope === 'anio') return `Año de ${periodLabel}`
  return `Día de ${periodLabel}`
}

const SPANISH_MONTH_NUMS: Record<string, string> = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  setiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
}

/**
 * Formato de subtítulo para el PDF diario del médico:
 * "Período: DD-MM-YYYY — Médico: APELLIDO, NOMBRE" (estilo Resumen Cuidar).
 */
export function formatDoctorPaymentsSubtitle(
  _scope: AllDoctorsPdfScope,
  periodLabel: string,
  doctorLine: string,
): string {
  let periodPart = periodLabel.trim()
  let turnoPart = ''

  const turnoMatch = periodPart.match(/\s*\((Turno\s+[^)]+)\)$/i)
  if (turnoMatch) {
    turnoPart = ` — ${turnoMatch[1]!.replace(/^Turno\s+/i, 'Turno: ')}`
    periodPart = periodPart.replace(/\s*\((Turno\s+[^)]+)\)$/i, '').trim()
  }

  periodPart = periodPart
    .replace(/^Día de\s+/i, '')
    .replace(/^Mes de\s+/i, '')
    .replace(/^Año de\s+/i, '')
    .trim()

  const singleDateMatch = periodPart.match(
    /^(\d{1,2})\s+(?:de\s+)?([a-zA-Záéíóúñ]+)\s+(?:de\s+)?(\d{4})$/i,
  )
  if (singleDateMatch) {
    const d = singleDateMatch[1]!.padStart(2, '0')
    const m = SPANISH_MONTH_NUMS[singleDateMatch[2]!.toLowerCase()]
    const y = singleDateMatch[3]!
    if (m) {
      periodPart = `${d}-${m}-${y}`
    }
  }

  const rangeMatch = periodPart.match(
    /^(\d{1,2})(?:\s+(?:de\s+)?([a-zA-Záéíóúñ]+))?\s+al\s+(\d{1,2})\s+(?:de\s+)?([a-zA-Záéíóúñ]+)\s+(?:de\s+)?(\d{4})$/i,
  )
  if (rangeMatch) {
    const d1 = rangeMatch[1]!.padStart(2, '0')
    const m1Name = rangeMatch[2]?.toLowerCase()
    const d2 = rangeMatch[3]!.padStart(2, '0')
    const m2Name = rangeMatch[4]!.toLowerCase()
    const y = rangeMatch[5]!
    const m2 = SPANISH_MONTH_NUMS[m2Name]
    const m1 = m1Name ? SPANISH_MONTH_NUMS[m1Name] : m2
    if (m1 && m2) {
      periodPart = `${d1}-${m1}-${y} al ${d2}-${m2}-${y}`
    }
  }

  return `Período: ${periodPart} — Médico: ${doctorLine}${turnoPart}`
}

export function formatCobranzasTodosMedicosHeaderTitle(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  return `Cobranzas - Todos los médicos - ${formatCobranzasHeaderPeriodSuffix(scope, periodLabel)}`
}

/** Encabezado PDF de la hoja final de rendición. */
export function formatCobranzasRendicionHeaderTitle(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  return `Cobranzas - RENDICIÓN - ${formatCobranzasHeaderPeriodSuffix(scope, periodLabel)}`
}

export function formatCobranzasDoctorHeaderTitle(
  doctor: Doctor,
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  return `Cobranzas - ${doctor.apellido}, ${doctor.nombre} - ${formatCobranzasHeaderPeriodSuffix(scope, periodLabel)}`
}

export function formatCobranzasObraSocialHeaderTitle(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  return `Cobranzas - Obra Social - ${formatCobranzasHeaderPeriodSuffix(scope, periodLabel)}`
}

/** Título de la hoja «Rendición» al final del PDF todos los médicos. */
export function formatRendicionResumenTitle(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  if (scope === 'dia') return `RENDICIÓN DEL DÍA ${periodLabel}`
  return `RENDICIÓN — ${formatCobranzasHeaderPeriodSuffix(scope, periodLabel)}`
}

/** Azul petróleo suave (título, totales y columna Efectivo). */
const RENDICION_TABLE_HEAD_FILL: [number, number, number] = [196, 218, 228]
const RENDICION_TABLE_TEXT: [number, number, number] = [0, 0, 0]
const RENDICION_PAGOS_COL_WIDTH = 14
const RENDICION_VALUE_COL_WIDTH = 23
const RENDICION_TRANSFERENCIAS_COL_WIDTH = 25
const RENDICION_VERIF_COL = 8
const RENDICION_VERIF_COL_WIDTH = 7

function buildRendicionVerifCheckIcon(): string {
  const size = 36
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.strokeStyle = '#1a2744'
  ctx.lineWidth = 3.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(size * 0.22, size * 0.52)
  ctx.lineTo(size * 0.42, size * 0.72)
  ctx.lineTo(size * 0.78, size * 0.28)
  ctx.stroke()

  return canvas.toDataURL('image/png')
}

function appendRendicionResumenPage(
  doc: jsPDF,
  scope: AllDoctorsPdfScope,
  periodLabel: string,
  rows: RendicionDoctorRow[],
  todosTransferencia = false,
): void {
  if (rows.length === 0) return
  // Con todo el export por transferencia, "C.Cuidar" sale en negativo: la
  // plata nunca pasó por caja, así que lo del médico sale del lado del centro.
  const signoCuidar = todosTransferencia ? -1 : 1

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const left = PAGOS_PDF_MARGIN
  const width = pageW - 2 * PAGOS_PDF_MARGIN

  doc.addPage()
  const headerBottom = drawPdfHeader(
    doc,
    pageW,
    formatCobranzasRendicionHeaderTitle(scope, periodLabel),
  )
  let y = pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN) + 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(26, 39, 68)
  doc.text(formatRendicionResumenTitle(scope, periodLabel), left, y)
  y += 8

  const totals = rows.reduce(
    (acc, row) => ({
      cantidadPagos: acc.cantidadPagos + (row.cantidadPagos ?? 0),
      transferencias: acc.transferencias + row.transferencias,
      efectivo: acc.efectivo + row.efectivo,
      totalCobrado: acc.totalCobrado + row.totalCobrado,
      totalMedico: acc.totalMedico + row.totalMedico,
      totalCentroCuidar: acc.totalCentroCuidar + row.totalCentroCuidar,
    }),
    {
      cantidadPagos: 0,
      transferencias: 0,
      efectivo: 0,
      totalCobrado: 0,
      totalMedico: 0,
      totalCentroCuidar: 0,
    },
  )
  const round2 = (n: number) => Math.round(n * 100) / 100

  const body = rows.map((row) => [
    row.medico,
    row.porcentajeLabel,
    (row.cantidadPagos ?? 0).toString(),
    money(row.totalCobrado),
    money(row.transferencias),
    money(row.efectivo),
    money(row.totalMedico),
    money(row.totalCentroCuidar * signoCuidar),
    '',
  ])

  const verifCheckIcon = buildRendicionVerifCheckIcon()

  autoTable(doc, {
    startY: y,
    head: [
      [
        'Médico',
        '%',
        'Pagos',
        'Total Cobrado',
        'Transferencias',
        'Efectivo',
        'Total Efectivo\nMédico',
        'Total Efectivo\nC.Cuidar',
        '',
      ],
    ],
    body: [
      ...body,
      [
        'TOTALES',
        '',
        totals.cantidadPagos.toString(),
        money(round2(totals.totalCobrado)),
        money(round2(totals.transferencias)),
        money(round2(totals.efectivo)),
        money(round2(totals.totalMedico)),
        money(round2(totals.totalCentroCuidar * signoCuidar)),
        '',
      ],
    ],
    tableWidth: width,
    margin: { left, right: PAGOS_PDF_MARGIN, top: 0, bottom: 0 },
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 },
      textColor: RENDICION_TABLE_TEXT,
      lineColor: [210, 220, 230],
      lineWidth: 0.15,
      valign: 'middle',
      minCellHeight: 6.2,
    },
    headStyles: {
      fillColor: RENDICION_TABLE_HEAD_FILL,
      textColor: RENDICION_TABLE_TEXT,
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'center', cellWidth: 12 },
      2: { halign: 'center', cellWidth: RENDICION_PAGOS_COL_WIDTH },
      3: { halign: 'right', cellWidth: RENDICION_VALUE_COL_WIDTH },
      4: { halign: 'right', cellWidth: RENDICION_TRANSFERENCIAS_COL_WIDTH },
      5: { halign: 'right', cellWidth: RENDICION_VALUE_COL_WIDTH },
      6: { halign: 'right', cellWidth: RENDICION_VALUE_COL_WIDTH },
      7: { halign: 'right', cellWidth: RENDICION_VALUE_COL_WIDTH },
      8: { halign: 'center', cellWidth: RENDICION_VERIF_COL_WIDTH },
    },
    didParseCell: (data) => {
      const totalRowIndex = rows.length
      const isTotalRow = data.section === 'body' && data.row.index === totalRowIndex
      if (data.section === 'head' && data.column.index === RENDICION_VERIF_COL) {
        data.cell.text = ['']
      }
      if (isTotalRow) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fontSize = 8.5
        data.cell.styles.fillColor = RENDICION_TABLE_HEAD_FILL
        data.cell.styles.textColor = RENDICION_TABLE_TEXT
        if (data.column.index === 0) {
          data.cell.styles.halign = 'left'
        } else if (data.column.index === 1 || data.column.index === 2) {
          data.cell.styles.halign = 'center'
        } else if (
          data.column.index > 2 &&
          data.column.index !== RENDICION_VERIF_COL
        ) {
          data.cell.styles.halign = 'right'
        }
      }
    },
    didDrawCell: (data) => {
      if (
        data.section !== 'head' ||
        data.column.index !== RENDICION_VERIF_COL ||
        !verifCheckIcon
      ) {
        return
      }
      const pad = 1.2
      const imgMm = Math.min(
        data.cell.height - pad * 2,
        data.cell.width - pad * 2,
        4.2,
      )
      doc.addImage(
        verifCheckIcon,
        'PNG',
        data.cell.x + (data.cell.width - imgMm) / 2,
        data.cell.y + (data.cell.height - imgMm) / 2,
        imgMm,
        imgMm,
      )
    },
  })

  y =
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? y + 20
  y = Math.max(y + 52, pageH - 58)

  if (y > pageH - 24) {
    doc.addPage()
    y = pageH - 58
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(26, 39, 68)
  doc.text('Fecha Rendición: ....................', left, y)
  doc.text(
    'Firma Gerente: ............................................................',
    left + width,
    y,
    { align: 'right' },
  )
}

/** Misma altura que la fila «Total facturado» del pie. */
const PAYMENTS_TABLE_ROW_MIN_H = PAGOS_DOCTOR_SUBTOTAL_BAR_H

const PAYMENTS_TABLE_CELL_PADDING = {
  top: 1.45,
  bottom: 1.45,
  left: 2.5,
  right: 2.5,
} as const

/** Hora angosta; Turno tras Fecha; Obra social tras Paciente; % tras Obra social; Monto tras Método. */
const PAYMENTS_TABLE_COLUMN_STYLES_WITH_OBS: Record<
  number,
  {
    halign?: 'right' | 'left' | 'center'
    valign?: 'top' | 'middle' | 'bottom'
    cellWidth?: number
    cellPadding?: { top?: number; bottom?: number; left?: number; right?: number } | number
  }
> = {
  0: { cellWidth: 13, valign: 'middle' }, // Hora
  1: {
    cellWidth: 16,
    valign: 'middle',
    cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 },
  }, // Turno
  3: { cellWidth: 26, valign: 'middle' }, // Obra social
  4: {
    halign: 'center',
    cellWidth: 11,
    valign: 'middle',
    cellPadding: { top: 2, bottom: 2, left: 1, right: 1 },
  }, // %
  5: { cellWidth: 18, valign: 'middle' }, // Motivo
  6: {
    cellWidth: 17,
    valign: 'middle',
    cellPadding: { top: 2, bottom: 2, left: 1.2, right: 1.2 },
  }, // Método
  7: { halign: 'right', cellWidth: 18, valign: 'middle' }, // Monto
  8: { halign: 'right', cellWidth: 18, valign: 'middle' }, // Cuidar
  9: { halign: 'right', cellWidth: 18, valign: 'middle' }, // Médico
}

/** Sin Obra social: Turno tras Fecha; Monto tras Método. */
const PAYMENTS_TABLE_COLUMN_STYLES_NO_OBRA_WITH_OBS: Record<
  number,
  {
    halign?: 'right' | 'left' | 'center'
    valign?: 'top' | 'middle' | 'bottom'
    cellWidth?: number
  }
> = {
  0: { cellWidth: 20, valign: 'middle' }, // Hora / Fecha
  1: { cellWidth: 22, valign: 'middle' }, // Turno
  3: { cellWidth: 28, valign: 'middle' }, // Motivo / Obs
  4: { cellWidth: 27, valign: 'middle' }, // Método
  5: { halign: 'right', cellWidth: 24, valign: 'middle' }, // Monto
}

/** Cabecera azul oscura (Hora, Turno, Paciente, Obra social, %, Motivo, Método, Monto, Cuidar, Médico). */
const PAYMENTS_TABLE_HEAD_STYLES = {
  fillColor: [10, 37, 64] as [number, number, number], // #0A2540 dark navy
  textColor: [255, 255, 255] as [number, number, number],
  fontStyle: 'bold' as const,
  fontSize: 8.5,
  cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 },
  minCellHeight: 8,
  valign: 'middle' as const,
}

const PAYMENTS_TABLE_BODY_STYLES = {
  fontSize: 8,
  cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
  textColor: [26, 39, 68] as [number, number, number],
  lineColor: [225, 232, 242] as [number, number, number],
  lineWidth: 0.1,
  valign: 'middle' as const,
  minCellHeight: 6.5,
}

const PAYMENTS_TABLE_ALTERNATE_ROW_STYLES = {
  fillColor: [248, 251, 255] as [number, number, number],
  valign: 'middle' as const,
  minCellHeight: PAYMENTS_TABLE_ROW_MIN_H,
}

function applyPagosTableLastBodyRowPadding(
  data: CellHookData,
  bodyRowCount: number,
): void {
  if (data.section !== 'body' || data.row.index !== bodyRowCount - 1) return
  data.cell.styles.minCellHeight = PAYMENTS_TABLE_ROW_MIN_H
  const raw = data.cell.styles.cellPadding
  const pad =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? raw
      : undefined
  data.cell.styles.cellPadding = {
    top: pad?.top ?? PAYMENTS_TABLE_CELL_PADDING.top,
    bottom: 0,
    left: pad?.left ?? PAYMENTS_TABLE_CELL_PADDING.left,
    right: pad?.right ?? PAYMENTS_TABLE_CELL_PADDING.right,
  }
}

function doctorBlockMinHeight(
  rowCount: number,
  footer: 'simple' | 'porcentaje' | 'resumen' = 'simple',
): number {
  const footerH =
    footer === 'resumen'
      ? PAGOS_DOCTOR_RESUMEN_BLOCK_H
      : footer === 'porcentaje'
        ? PAGOS_DOCTOR_SUBTOTAL_WITH_PCT_H
        : PAGOS_DOCTOR_SUBTOTAL_BAR_H
  return (
    PAGOS_DOCTOR_TITLE_BAR_H +
    8 +
    rowCount * PAYMENTS_TABLE_ROW_MIN_H +
    footerH +
    10
  )
}

/** Tabla gerencia: sin columna Paciente. */
const GERENCIA_TABLE_COLUMN_STYLES: Record<
  number,
  {
    halign?: 'right' | 'left' | 'center'
    valign?: 'top' | 'middle' | 'bottom'
    cellWidth?: number
  }
> = {
  0: { cellWidth: 40, valign: 'middle' },
  1: { halign: 'right', cellWidth: 30, valign: 'middle' },
  2: { cellWidth: 27, valign: 'middle' },
  3: { cellWidth: 26, valign: 'middle' },
}

function gerenciaPdfHeaderSubtitle(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  const period = formatCobranzasHeaderPeriodSuffix(scope, periodLabel)
  return `Resumen Gerencia - Pagos por médico - ${period}`
}

function gerenciaFilenamePrefix(scope: AllDoctorsPdfScope): string {
  if (scope === 'dia') return 'gerencia-pagos-dia'
  if (scope === 'mes') return 'gerencia-pagos-mes'
  return 'gerencia-pagos-anio'
}

type GerenciaTableRow = {
  fechaLabel: string
  monto: number
  metodo: string
  obraSocial: string
}

function joinUniqueLabels(values: Iterable<string>): string {
  const unique = [...new Set([...values].map((v) => v.trim()).filter(Boolean))]
  if (unique.length === 0) return '—'
  if (unique.length === 1) return unique[0]!
  return unique.sort((a, b) => a.localeCompare(b, 'es')).join(' · ')
}

/** Agrupa cobranzas del mismo día (mes/año); en vista día mantiene una fila por pago. */
function buildGerenciaTableRows(
  payments: Payment[],
  scope: AllDoctorsPdfScope,
  obraSocialLabel: ObraSocialLabelFn,
  appointmentById?: (id: string) => Appointment | undefined,
): GerenciaTableRow[] {
  const sorted = [...payments].sort(
    (a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime(),
  )
  if (scope === 'dia') {
    return sorted.map((p) => ({
      fechaLabel: formatPagosPdfDateTime(p.fecha, scope),
      monto: p.monto,
      metodo: p.metodo,
      obraSocial: formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById),
    }))
  }

  const byDay = new Map<
    string,
    {
      sortKey: number
      monto: number
      metodos: Set<string>
      obras: Set<string>
    }
  >()
  for (const p of sorted) {
    const t = parseISO(p.fecha)
    const key = format(t, 'yyyy-MM-dd')
    const appt = p.citaId && appointmentById ? appointmentById(p.citaId) : undefined
    const obra = p.obraSocialOverride || appt?.obraSocialOverride || obraSocialLabel(p.patientId)?.trim()
    const prev = byDay.get(key)
    if (prev) {
      prev.monto += p.monto
      prev.metodos.add(p.metodo)
      if (obra) prev.obras.add(obra)
    } else {
      byDay.set(key, {
        sortKey: t.getTime(),
        monto: p.monto,
        metodos: new Set([p.metodo]),
        obras: obra ? new Set([obra]) : new Set(),
      })
    }
  }

  return [...byDay.entries()]
    .sort((a, b) => a[1].sortKey - b[1].sortKey)
    .map(([dayKey, agg]) => ({
      fechaLabel: format(parseISO(`${dayKey}T12:00:00`), 'd MMM yyyy', {
        locale: es,
      }),
      monto: agg.monto,
      metodo:
        agg.metodos.size === 1
          ? [...agg.metodos][0]!
          : [...agg.metodos].sort((a, b) => a.localeCompare(b, 'es')).join(' · '),
      obraSocial: joinUniqueLabels(agg.obras),
    }))
}

function renderPagosDoctorBlockGerencia(
  doc: jsPDF,
  cursorY: number,
  pageW: number,
  pageNum: number,
  doctorName: string,
  payments: Payment[],
  scope: AllDoctorsPdfScope,
  dateColumnHeader: string,
  obraSocialLabel: ObraSocialLabelFn,
  doctorEspecialidad?: string,
  appointmentById?: (id: string) => Appointment | undefined,
): number {
  const left = pagosPdfContentLeft(pageNum)
  const width = pagosPdfContentWidth(doc, pageNum)
  const tableOpts = pagosPdfTableOptions(doc, pageNum)
  const rows = buildGerenciaTableRows(payments, scope, obraSocialLabel, appointmentById)
  const pagoCount = countDistinctPagos(payments)
  const subtotal = payments.reduce((s, p) => s + p.monto, 0)

  let y = drawPagosDoctorSectionTitle(
    doc,
    left,
    cursorY,
    width,
    doctorName,
    doctorEspecialidad,
  )

  const bodyRowCount = rows.length
  autoTable(doc, {
    startY: y,
    head: [[dateColumnHeader, 'Monto', 'Método', 'Obra social']],
    body: rows.map((r) => [
      r.fechaLabel,
      money(r.monto),
      r.metodo,
      r.obraSocial,
    ]),
    ...tableOpts,
    tableWidth: width,
    margin: { ...tableOpts.margin, top: 0, bottom: 0 },
    styles: PAYMENTS_TABLE_BODY_STYLES,
    headStyles: PAYMENTS_TABLE_HEAD_STYLES,
    alternateRowStyles: PAYMENTS_TABLE_ALTERNATE_ROW_STYLES,
    columnStyles: GERENCIA_TABLE_COLUMN_STYLES,
    didParseCell: (data) => applyPagosTableLastBodyRowPadding(data, bodyRowCount),
  })

  y = tableFinalY(doc, y)
  return drawPagosDoctorSubtotalBar(doc, y, pageW, pagoCount, subtotal)
}

function renderPagosDoctorBlock(
  doc: jsPDF,
  cursorY: number,
  pageW: number,
  pageNum: number,
  doctorName: string,
  payments: Payment[],
  patientLabel: (patientId: string) => string,
  obraSocialLabel: ObraSocialLabelFn,
  scope: AllDoctorsPdfScope,
  dateColumnHeader: string,
  doctorPorcentaje?: number,
  doctorEspecialidad?: string,
  resumenMedicoLayout?: boolean,
  appointmentById?: (id: string) => Appointment | undefined,
  doctor?: Doctor,
  blockOptions?: {
    suppressTotalesH4?: boolean
    suppressTransferenciaBar?: boolean
    suppressDoctorSectionTitle?: boolean
  },
): number {
  const left = pagosPdfContentLeft(pageNum)
  const width = pagosPdfContentWidth(doc, pageNum)
  const tableOpts = pagosPdfTableOptions(doc, pageNum)
  const sorted = [...payments].sort(
    (a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime(),
  )
  const subtotal = sorted.reduce((s, p) => s + p.monto, 0)

  let y = blockOptions?.suppressDoctorSectionTitle
    ? cursorY
    : drawPagosDoctorSectionTitle(
        doc,
        left,
        cursorY,
        width,
        doctorName,
        doctorEspecialidad,
        { withoutFrame: true },
      )

  const pctFallback = () => doctorPorcentaje
  const docGetter = doctor ? () => doctor : undefined
  const osResolver = (p: Payment) =>
    obraSocialLabel
      ? formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById)
      : (p.obraSocialOverride || undefined)
  const pctAgg = aggregatePorcentajeSettlementForPayments(
    sorted,
    pctFallback,
    docGetter,
    osResolver,
  )

  const bodyRowCount = sorted.length
  autoTable(doc, {
    startY: y,
    pageBreak: 'auto',
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    head: [
      [
        dateColumnHeader,
        'Turno',
        'Paciente',
        'Obra social',
        '%',
        'Motivo',
        'Método',
        'Monto',
        'Médico',
        'Cuidar',
      ],
    ],
    body: (() => {
      // Si un turno tiene 2 pagos (split), repetimos método/monto pero mostramos
      // Hora/Paciente/Obra social/%/Motivo una sola vez.
      let lastKey: string | null = null
      const settlementMap = buildPaymentsSettlementMap(
        sorted,
        doctor ? () => doctor : undefined,
        (p) => formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById),
      )
      const todosTransf = sonTodosTransferencia(sorted)
      return sorted.map((p) => {
        const groupKey = pagoPdfGroupKey(p)
        const repeat = groupKey === lastKey
        lastKey = groupKey
        const osCell = formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById)
        const s =
          settlementMap.get(p.id) ??
          (doctor
            ? resolveDoctorPaymentSettlement(p, doctor, osCell)
            : computeDoctorPorcentajeSettlement(
                p.monto,
                resolvePaymentPorcentaje(p, doctorPorcentaje),
              ))
        const pctCell = s.esMontoFijo ? '—' : `${s.porcentaje}%`
        const desglose = calcularDesglosePagoFila(p, doctor, osCell, s)
        const motivo = p.notas?.trim() || 'Consulta'
        const cuidarLabel =
          todosTransf && desglose.cuidar > 0
            ? formatMonto(-desglose.cuidar)
            : desglose.cuidarLabel
        return [
          repeat ? '' : formatPagosPdfDateTime(p.fecha, scope),
          repeat ? '' : formatTurnoCell(p.citaId, p.fecha, appointmentById),
          repeat ? '' : patientLabel(p.patientId),
          repeat ? '' : osCell,
          repeat ? '' : pctCell,
          repeat ? '' : motivo,
          formatMetodoCell(p.metodo),
          money(p.monto),
          desglose.medicoLabel,
          cuidarLabel,
        ]
      })
    })(),
    foot: [
      [
        `Totales · ${countDistinctPagos(sorted)} pago${countDistinctPagos(sorted) === 1 ? '' : 's'}`,
        '',
        '',
        '',
        '',
        '',
        '',
        money(subtotal),
        money(pctAgg.totalGeneral),
        formatMonto(
          sonTodosTransferencia(sorted)
            ? -pctAgg.totalPorcentaje
            : pctAgg.totalPorcentaje,
        ),
      ],
    ],
    footStyles: {
      fillColor: [240, 245, 252],
      textColor: [26, 39, 68],
      fontStyle: 'bold',
      fontSize: 8.5,
      minCellHeight: 7.5,
      valign: 'middle',
    },
    ...tableOpts,
    tableWidth: width,
    margin: { ...tableOpts.margin, top: 0, bottom: 0 },
    styles: PAYMENTS_TABLE_BODY_STYLES,
    headStyles: PAYMENTS_TABLE_HEAD_STYLES,
    alternateRowStyles: PAYMENTS_TABLE_ALTERNATE_ROW_STYLES,
    columnStyles: PAYMENTS_TABLE_COLUMN_STYLES_WITH_OBS,
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 4) {
          data.cell.styles.halign = 'center'
          data.cell.styles.cellPadding = { top: 2, bottom: 2, left: 1, right: 1 }
        } else if (data.column.index >= 7) {
          data.cell.styles.halign = 'right'
        }
      } else if (data.section === 'foot') {
        if (data.column.index === 0) {
          data.cell.colSpan = 7
          data.cell.styles.halign = 'left'
        } else if (data.column.index >= 7) {
          data.cell.styles.halign = 'right'
        }
      }
      applyPagosTableLastBodyRowPadding(data, bodyRowCount)
    },
  })

  y = tableFinalY(doc, y)
  const transferTotal = sumPagosTransferencia(sorted)
  if (!blockOptions?.suppressTotalesH4) {
    y = drawPagosTotalesBloqueH4(
      doc,
      y + 1.5,
      pageW,
      {
        totalFacturado: subtotal,
        totalMedico: pctAgg.totalGeneral,
        totalCuidar: pctAgg.totalPorcentaje,
        totalTransferencias: transferTotal,
      },
      { marginX: left },
    ) + 3
  }
  if (!blockOptions?.suppressTransferenciaBar) {
    y = drawPagosTransferenciaBar(doc, y, pageW, transferTotal, { marginX: left }) + 2.5
  }

  const deudaConCuidar = Math.max(0, transferTotal - pctAgg.totalGeneral)
  if (deudaConCuidar > 0) {
    y += 5
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(138, 75, 8)
    doc.text('Comisión pendiente - Deuda del médico con Cuidar', left, y)
    doc.text(money(deudaConCuidar), left + width, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(
      'Se cobrará la comisión en turnos posteriores o con pagos a acordar con Cuidar.',
      left,
      y + 3.8,
      { maxWidth: width },
    )
    y += 5.5
  }

  if (blockOptions?.suppressTotalesH4 && blockOptions?.suppressTransferenciaBar) {
    return y
  }
  return y + 3
}

function renderPagosDoctorBlockNoObraSocial(
  doc: jsPDF,
  cursorY: number,
  pageW: number,
  pageNum: number,
  doctorName: string,
  payments: Payment[],
  patientLabel: (patientId: string) => string,
  scope: AllDoctorsPdfScope,
  dateColumnHeader: string,
  doctorPorcentaje?: number,
  doctorEspecialidad?: string,
  resumenMedicoLayout?: boolean,
  appointmentById?: (id: string) => Appointment | undefined,
  doctor?: Doctor,
  obraSocialLabel?: ObraSocialLabelFn,
): number {
  const left = pagosPdfContentLeft(pageNum)
  const width = pagosPdfContentWidth(doc, pageNum)
  const tableOpts = pagosPdfTableOptions(doc, pageNum)
  const sorted = [...payments].sort(
    (a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime(),
  )
  const subtotal = sorted.reduce((s, p) => s + p.monto, 0)

  let y = drawPagosDoctorSectionTitle(
    doc,
    left,
    cursorY,
    width,
    doctorName,
    doctorEspecialidad,
  )

  const bodyRowCount = sorted.length
  autoTable(doc, {
    startY: y,
    head: [[dateColumnHeader, 'Turno', 'Paciente', 'Historia Clínica', 'Método', 'Monto']],
    body: (() => {
      let lastKey: string | null = null
      return sorted.map((p) => {
        const groupKey = pagoPdfGroupKey(p)
        const repeat = groupKey === lastKey
        lastKey = groupKey
        return [
          repeat ? '' : formatPagosPdfDateTime(p.fecha, scope),
          repeat ? '' : formatTurnoCell(p.citaId, p.fecha, appointmentById),
          repeat ? '' : patientLabel(p.patientId),
          repeat ? '' : p.notas?.trim() || '—',
          formatMetodoCell(p.metodo),
          money(p.monto),
        ]
      })
    })(),
    ...tableOpts,
    tableWidth: width,
    margin: { ...tableOpts.margin, top: 0, bottom: 0 },
    styles: PAYMENTS_TABLE_BODY_STYLES,
    headStyles: PAYMENTS_TABLE_HEAD_STYLES,
    alternateRowStyles: PAYMENTS_TABLE_ALTERNATE_ROW_STYLES,
    columnStyles: PAYMENTS_TABLE_COLUMN_STYLES_NO_OBRA_WITH_OBS,
    didParseCell: (data) => applyPagosTableLastBodyRowPadding(data, bodyRowCount),
  })

  y = tableFinalY(doc, y)
  const pctFallback = () => doctorPorcentaje
  const docGetter = doctor ? () => doctor : undefined
  const osResolver = (p: Payment) =>
    obraSocialLabel
      ? formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById)
      : (p.obraSocialOverride || undefined)
  if (resumenMedicoLayout) {
    return drawPagosDoctorResumenTable(
      doc,
      y,
      left,
      width,
      aggregateResumenSettlementForPayments(sorted, pctFallback, docGetter, osResolver),
      sonTodosTransferencia(sorted),
    )
  }
  const pctAgg = aggregatePorcentajeSettlementForPayments(
    sorted,
    pctFallback,
    docGetter,
    osResolver,
  )
  return drawPagosDoctorSubtotalBar(doc, y, pageW, countDistinctPagos(sorted), subtotal, {
    showPorcentajeLines: true,
    porcentaje: pctAgg.porcentaje,
    porcentajeLabel: pctAgg.porcentajeLabel,
    totalPorcentaje: pctAgg.totalPorcentaje,
    totalGeneral: pctAgg.totalGeneral,
    totalTransferencias: sumPagosTransferencia(sorted),
    todosTransferencia: sonTodosTransferencia(sorted),
  })
}

function drawObraSocialSectionTitle(
  doc: jsPDF,
  pageW: number,
  y: number,
  label: string,
): number {
  const left = PAGOS_PDF_MARGIN
  const width = pageW - 2 * PAGOS_PDF_MARGIN
  const h = 8
  const r = PAGOS_DOCTOR_BLOCK_RADIUS
  doc.setFillColor(241, 247, 255)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.25)
  doc.roundedRect(left, y, width, h, r, r, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(26, 39, 68)
  doc.text(label, left + 5, y + 5.4, { maxWidth: width - 10 })
  return y + h + 3
}

function ensurePagosPdfSpace(
  doc: jsPDF,
  cursorY: number,
  neededH: number,
  pageH: number,
  bodyStartY: number = PDF_BODY_START_Y,
): { y: number; pageNum: number } {
  const bottom = pageH - PAGOS_PDF_MARGIN
  if (cursorY + neededH <= bottom) {
    return { y: cursorY, pageNum: doc.getNumberOfPages() }
  }
  doc.addPage()
  return { y: bodyStartY, pageNum: doc.getNumberOfPages() }
}

export function buildDoctorPaymentsPdf(params: {
  doctor: Doctor
  periodLabel: string
  payments: Payment[]
  patientLabel: (patientId: string) => string
  obraSocialLabel: ObraSocialLabelFn
  scope: AllDoctorsPdfScope
  fileStamp?: string
  resumenMedicoLayout?: boolean
  appointmentById?: (id: string) => Appointment | undefined
  footerLabel?: string
  doctorDebtRows?: DoctorDebtPdfRow[]
}): { doc: jsPDF; filename: string } {
  const {
    doctor,
    periodLabel,
    payments,
    patientLabel,
    obraSocialLabel,
    scope,
    fileStamp,
    resumenMedicoLayout = false,
    appointmentById,
  } = params
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const timeCol = scope === 'dia' ? 'Hora' : 'Fecha'
  const doctorLine = `${doctor.apellido}, ${doctor.nombre}`

   const headerBottom = drawPdfHeader(
     doc,
     pageW,
     'Cobranzas',
     {
       secondLine: formatDoctorPaymentsSubtitle(scope, periodLabel, doctorLine),
       fontSize: 18,
     },
   )
  const bodyStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  const metaExtra: string[] = []

  let cursorY =
    drawPdfPeriodMetaBlock(doc, pageW, bodyStartY, '', metaExtra) + 4

  const pageNum = 1

  if (payments.length === 0) {
    doc.setTextColor(107, 124, 147)
    doc.text(
      'No hay cobranzas registradas en este período.',
      pagosPdfContentLeft(pageNum),
      cursorY + 2,
    )

    const pageH = doc.internal.pageSize.getHeight()
    const neededH = RESUMEN_GENERAL_J2_TOTAL_H + 4
    const space = ensurePagosPdfSpace(doc, cursorY + 8, neededH, pageH)
    let blockY = space.y
    blockY = drawResumenGeneralCardJ2(
      doc,
      blockY,
      pageW,
      {
        totalFacturado: 0,
        totalMedico: 0,
        totalCuidar: 0,
        totalTransferencias: 0,
        totalPagos: 0,
        totalGeneral: 0,
      },
      {
        marginX: pagosPdfContentLeft(pageNum),
        labelTotalGeneral: 'Total efectivo a entregar al médico',
      },
    )
    const afterBarsY = blockY + 5
    const left = pagosPdfContentLeft(pageNum)
    const maxW = pagosPdfContentWidth(doc, pageNum)
    drawValoresConfiguradosBullets(doc, doctor, afterBarsY, left, maxW, {
      skipSetPage: true,
      anchorToBottom: true,
    })
  } else {
    const pageH = doc.internal.pageSize.getHeight()
    const pctFallback = () => doctor.porcentaje
    const docGetter = () => doctor
    const osResolver = (p: Payment) =>
      formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById)

    const totalFacturado = payments.reduce((s, p) => s + p.monto, 0)
    const settlement = aggregatePorcentajeSettlementForPayments(
      payments,
      pctFallback,
      docGetter,
      osResolver,
    )
    const totalMedico = settlement.totalGeneral
    const totalCuidar = settlement.totalPorcentaje
    const totalTransferencias = sumPagosTransferencia(payments)

    const totalGeneral = resumenMedicoLayout
      ? Math.max(
          0,
          aggregateResumenSettlementForPayments(
            payments,
            pctFallback,
            docGetter,
            osResolver,
          ).efectivoAEntregar,
        )
      : Math.max(
          0,
          computeEfectivoAEntregar(
            totalMedico,
            totalTransferencias,
          ),
        )

    cursorY = renderPagosDoctorBlock(
      doc,
      cursorY,
      pageW,
      pageNum,
      doctorLine,
      payments,
      patientLabel,
      obraSocialLabel,
      scope,
      timeCol,
      doctor.porcentaje,
      doctor.especialidad,
      resumenMedicoLayout,
      appointmentById,
      doctor,
      {
        suppressTotalesH4: true,
        suppressTransferenciaBar: true,
        suppressDoctorSectionTitle: true,
      },
    )

    const neededH = RESUMEN_GENERAL_J2_TOTAL_H + 4
    const space = ensurePagosPdfSpace(
      doc,
      cursorY,
      neededH,
      pageH,
    )
    let blockY = space.y + 1.5
    blockY = drawResumenGeneralCardJ2(
      doc,
      blockY,
      pageW,
      {
        totalFacturado,
        totalMedico,
        totalCuidar,
        totalTransferencias,
        totalPagos: countDistinctPagos(payments),
        totalGeneral,
      },
      {
        marginX: pagosPdfContentLeft(pageNum),
        labelTotalGeneral: 'Total efectivo a entregar al médico',
      },
    )
    const afterBarsY = blockY + 5
    const left = pagosPdfContentLeft(pageNum)
    const maxW = pagosPdfContentWidth(doc, pageNum)
    drawValoresConfiguradosBullets(doc, doctor, afterBarsY, left, maxW, {
      skipSetPage: true,
      anchorToBottom: true,
    })
  }

  const slug = `${doctor.apellido}-${doctor.nombre}`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const filename = `cobranzas-${slug}-${stamp}.pdf`

  if (params.doctorDebtRows) {
    appendDoctorDebtSummaryPage(doc, params.doctorDebtRows, periodLabel, doctorLine)
  }

  stampPdfGeneratedFooterOnAllPages(doc, params.footerLabel ? { label: params.footerLabel } : undefined)
  return { doc, filename }
}

export function pdfBlobUrl(doc: jsPDF): string {
  const blob = doc.output('blob') as Blob
  return URL.createObjectURL(blob)
}

/** Bytes del PDF en base64 para adjuntar al correo (SMTP). */
export function pdfToBase64(doc: jsPDF): string {
  const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

export async function savePdfFile(doc: jsPDF, filename: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    
    let googleDriveFolder = 'PDFs'
    let customRoot: string | null = null
    let disabled = false
    try {
      const { loadStorageRaw } = await import('./appStorage')
      const raw = await loadStorageRaw()
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed?.settings?.carpetaPdfsGoogleDrive) {
          googleDriveFolder = parsed.settings.carpetaPdfsGoogleDrive.trim()
        }
        const root = parsed?.settings?.rutaGoogleDriveCustom?.trim()
        if (root) customRoot = root
        disabled = parsed?.settings?.googleDriveDeshabilitado === true
      }
    } catch (e) {
      console.warn('No se pudo leer la config para PDF', e)
    }

    await invoke<boolean>('save_pdf_dialog', {
      defaultFilename: filename,
      pdfBase64: pdfToBase64(doc),
      googleDriveFolder,
      customRoot,
      disabled,
    })
    return
  }

  const url = pdfBlobUrl(doc)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function buildDoctorPdfRows(
  payments: Payment[],
  patientLabel: (patientId: string) => string,
  obraSocialLabel: ObraSocialLabelFn,
  appointmentById?: (id: string) => Appointment | undefined,
): DoctorPdfRow[] {
  let lastKey: string | null = null
  return [...payments]
    .sort((a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime())
    .map((p) => {
      const groupKey = pagoPdfGroupKey(p)
      const repeat = groupKey === lastKey
      lastKey = groupKey
      return {
        fecha: repeat
          ? ''
          : format(parseISO(p.fecha), 'd MMM yyyy', { locale: es }),
        paciente: repeat ? '' : patientLabel(p.patientId),
        obs: repeat ? '' : p.notas?.trim() || '—',
        monto: p.monto,
        metodo: formatMetodoCell(p.metodo),
        obraSocial: formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById),
      }
    })
}

export function buildDayPaymentPdfRows(
  payments: Payment[],
  patientLabel: (patientId: string) => string,
  doctorLabel: (doctorId: string) => string,
  obraSocialLabel: ObraSocialLabelFn,
  dateFormat: string = 'HH:mm',
  appointmentById?: (id: string) => Appointment | undefined,
): DayPaymentPdfRow[] {
  let lastKey: string | null = null
  return [...payments]
    .sort((a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime())
    .map((p) => {
      const groupKey = pagoPdfGroupKey(p)
      const repeat = groupKey === lastKey
      lastKey = groupKey
      return {
        fecha: repeat ? '' : format(parseISO(p.fecha), dateFormat, { locale: es }),
        turno: repeat ? '' : formatTurnoCell(p.citaId, p.fecha, appointmentById),
        paciente: repeat ? '' : patientLabel(p.patientId),
        obs: repeat ? '' : p.notas?.trim() || '—',
        medico: repeat ? '' : doctorLabel(p.doctorId),
        monto: p.monto,
        metodo: formatMetodoCell(p.metodo),
        obraSocial: formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById),
      }
    })
}

export function buildDayPaymentsPdf(params: {
  dayLabel: string
  rows: DayPaymentPdfRow[]
  fileStamp?: string
  headerTitle?: string
  dateColumnHeader?: string
  emptyMessage?: string
  totalLabel?: string
  filenamePrefix?: string
  /** Última hoja: gráfico de barras por médico (Pagos del mes). */
  withDoctorChart?: boolean
  /** Cobros distintos (pago partido en dos métodos = 1). */
  totalPagos?: number
  footerLabel?: string
}): { doc: jsPDF; filename: string } {
  const {
    dayLabel,
    rows,
    fileStamp,
    totalPagos: totalPagosParam,
    headerTitle = 'Pagos del día',
    dateColumnHeader = 'Hora',
    emptyMessage = 'No hay pagos registrados hoy.',
    filenamePrefix = 'pagos-del-dia',
    withDoctorChart = false,
  } = params
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const headerBottom = drawPdfHeader(
    doc,
    pageW,
    headerTitle.includes(dayLabel)
      ? headerTitle
      : `${headerTitle} - ${formatCobranzasHeaderPeriodSuffix('dia', dayLabel)}`,
  )
  const bodyStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  const tableStartY = bodyStartY + 3
  const total = rows.reduce((s, r) => s + r.monto, 0)
  const totalPagos =
    totalPagosParam ?? rows.filter((r) => r.fecha.trim() !== '').length

  if (rows.length === 0) {
    doc.setTextColor(107, 124, 147)
    doc.text(emptyMessage, 14, tableStartY + 2)
  } else {
    autoTable(doc, {
      startY: tableStartY,
      head: [
        [
          dateColumnHeader,
          'Turno',
          'Paciente',
          'Obra social',
          'Historia Clínica',
          'Médico',
          'Método',
          'Monto',
        ],
      ],
      body: rows.map((r) => [
        r.fecha,
        r.turno || '—',
        r.paciente,
        r.obraSocial,
        r.obs,
        r.medico,
        r.metodo,
        money(r.monto),
      ]),
      styles: PAYMENTS_TABLE_BODY_STYLES,
      headStyles: PAYMENTS_TABLE_HEAD_STYLES,
      alternateRowStyles: PAYMENTS_TABLE_ALTERNATE_ROW_STYLES,
      columnStyles: {
        0: { cellWidth: 20, valign: 'middle' },
        1: { cellWidth: 20, valign: 'middle' },
        3: { cellWidth: 30, valign: 'middle' },
        4: { cellWidth: 24, valign: 'middle' },
        6: { cellWidth: 19, valign: 'middle' },
        7: { halign: 'right', cellWidth: 24, valign: 'middle' },
      },
      margin: { left: 14, right: 14 },
    })

    const finalY = tableFinalY(doc, tableStartY)
    drawPagosTotalGeneralBar(doc, finalY + 6, pageW, totalPagos, total)
  }

  if (withDoctorChart && rows.length > 0) {
    const byDoctor = aggregateDoctorTotals(rows)
    if (byDoctor.length > 0) {
      drawDoctorPaymentsChartPage(doc, 'dia', dayLabel, byDoctor, totalPagos)
    }
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const filename = `${filenamePrefix}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc, params.footerLabel ? { label: params.footerLabel } : undefined)
  return { doc, filename }
}

function tableFinalY(doc: jsPDF, fallback: number): number {
  return (
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? fallback
  )
}

export function buildAllDoctorsPaymentsPdf(params: {
  periodLabel: string
  payments: Payment[]
  patientLabel: (patientId: string) => string
  obraSocialLabel: ObraSocialLabelFn
  doctorLabel: (doctorId: string) => string
  doctorPorcentaje?: (doctorId: string) => number | undefined
  doctorResolver?: (doctorId: string) => Doctor | undefined
  doctorEspecialidad?: (doctorId: string) => string | undefined
  dateFormat: string
  dateColumnHeader: string
  scope: AllDoctorsPdfScope
  fileStamp?: string
  headerTitle?: string
  emptyMessage?: string
  totalLabel?: string
  filenamePrefix?: string
  withDoctorChart?: boolean
  resumenMedicoLayout?: boolean
  appointmentById?: (id: string) => Appointment | undefined
  footerLabel?: string
  /** Última hoja de deudas, sólo para el alcance global solicitado. */
  doctorDebtRows?: DoctorDebtPdfRow[]
}): { doc: jsPDF; filename: string } {
  const {
    periodLabel,
    payments,
    patientLabel,
    obraSocialLabel,
    doctorLabel,
    doctorPorcentaje,
    doctorResolver,
    doctorEspecialidad,
    dateColumnHeader,
    scope,
    fileStamp,
    headerTitle,
    emptyMessage = 'No hay pagos registrados en este período.',
    filenamePrefix = 'cobranzas-todos',
    withDoctorChart = false,
    resumenMedicoLayout = false,
    appointmentById,
  } = params

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const osResolver = (p: Payment) =>
    formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById)

  const pdfHeaderSubtitle = (
    headerTitle ?? formatCobranzasTodosMedicosHeaderTitle(scope, periodLabel)
  ).replace(/^Cobranzas\s*-\s*/i, '')

  const headerBottom = drawPdfHeader(doc, pageW, 'Cobranzas', {
    secondLine: pdfHeaderSubtitle,
    fontSize: 18,
  })
  const bodyStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  let cursorY = bodyStartY + 3

  if (payments.length === 0) {
    doc.setTextColor(107, 124, 147)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(emptyMessage, pagosPdfContentLeft(1), cursorY + 2)
    cursorY += 8

    drawResumenGeneralCardJ2(
      doc,
      cursorY,
      pageW,
      {
        totalFacturado: 0,
        totalMedico: 0,
        totalCuidar: 0,
        totalTransferencias: 0,
        totalPagos: 0,
        totalGeneral: 0,
      },
      {
        labelTotalGeneral: resumenMedicoLayout
          ? 'Total efectivo a entregar al médico'
          : 'Total general',
      },
    )
  } else {
    const byDoctor = new Map<string, Payment[]>()
    for (const p of payments) {
      const list = byDoctor.get(p.doctorId) ?? []
      list.push(p)
      byDoctor.set(p.doctorId, list)
    }

    const doctorIds = [...byDoctor.keys()].sort((a, b) =>
      doctorLabel(a).localeCompare(doctorLabel(b), 'es'),
    )

    let pageNum = 1

    for (const doctorId of doctorIds) {
      const doctorPayments = [...(byDoctor.get(doctorId) ?? [])].sort(
        (a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime(),
      )
      const doctorName = doctorLabel(doctorId)
      const blockMinH = doctorBlockMinHeight(
        doctorPayments.length,
        resumenMedicoLayout ? 'resumen' : 'porcentaje',
      )

      if (cursorY + blockMinH > pageH - PAGOS_PDF_MARGIN - 4) {
        doc.addPage()
        pageNum = doc.getNumberOfPages()
        cursorY = bodyStartY
      }

      cursorY = renderPagosDoctorBlock(
        doc,
        cursorY,
        pageW,
        pageNum,
        doctorName,
        doctorPayments,
        patientLabel,
        obraSocialLabel,
        scope,
        dateColumnHeader,
        doctorPorcentaje?.(doctorId),
        doctorEspecialidad?.(doctorId),
        resumenMedicoLayout,
        appointmentById,
        doctorResolver?.(doctorId),
      )
    }

    const doctorResolverOrPorcentaje = doctorResolver ?? doctorPorcentaje
    const grandTotalNeto = resumenMedicoLayout
      ? Math.max(
          0,
          sumPagosEfectivoEntregarByDoctor(
            payments,
            doctorResolverOrPorcentaje,
            osResolver,
          ),
        )
      : Math.max(
          0,
          computeEfectivoAEntregar(
            sumPagosNetTotalByDoctor(
              payments,
              doctorResolverOrPorcentaje,
              osResolver,
            ),
            sumPagosTransferencia(payments),
          ),
        )
    const totalFacturadoAll = payments.reduce((s, p) => s + p.monto, 0)
    const totalTransfAll = sumPagosTransferencia(payments)
    const totalMedicoAll = sumPagosNetTotalByDoctor(payments, doctorResolverOrPorcentaje, osResolver)
    const totalCuidarAll = totalFacturadoAll - totalMedicoAll

    const neededH = RESUMEN_GENERAL_J2_TOTAL_H + 4
    if (cursorY + neededH > pageH - 16) {
      doc.addPage()
      cursorY = bodyStartY
    } else {
      cursorY += 4
    }

    drawResumenGeneralCardJ2(
      doc,
      cursorY,
      pageW,
      {
        totalFacturado: totalFacturadoAll,
        totalMedico: totalMedicoAll,
        totalCuidar: totalCuidarAll,
        totalTransferencias: totalTransfAll,
        totalPagos: countDistinctPagos(payments),
        totalGeneral: grandTotalNeto,
      },
      {
        labelTotalGeneral: resumenMedicoLayout
          ? 'Total efectivo a entregar al médico'
          : 'Total general',
      },
    )
  }

  if (withDoctorChart && payments.length > 0) {
    appendDoctorTotalsChartPage(
      doc,
      scope,
      periodLabel,
      payments,
      doctorLabel,
      doctorPorcentaje,
      doctorResolver,
    )
  }

  if (resumenMedicoLayout && payments.length > 0) {
    appendRendicionResumenPage(
      doc,
      scope,
      periodLabel,
      buildRendicionDoctorRows(
        payments,
        doctorLabel,
        doctorPorcentaje,
        doctorResolver,
        osResolver,
      ),
      sonTodosTransferencia(payments),
    )
  }

  if (params.doctorDebtRows) {
    appendDoctorDebtSummaryPage(doc, params.doctorDebtRows, periodLabel)
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const filename = `${filenamePrefix}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc, params.footerLabel ? { label: params.footerLabel } : undefined)
  return { doc, filename }
}

/** Cobranzas agrupadas por Obra Social y luego por Médico (con pacientes). */
export function buildObraSocialDoctorsPaymentsPdf(params: {
  periodLabel: string
  payments: Payment[]
  patientLabel: (patientId: string) => string
  obraSocialLabel: ObraSocialLabelFn
  doctorLabel: (doctorId: string) => string
  doctorPorcentaje?: (doctorId: string) => number | undefined
  doctorResolver?: (doctorId: string) => Doctor | undefined
  doctorEspecialidad?: (doctorId: string) => string | undefined
  dateColumnHeader: string
  scope: AllDoctorsPdfScope
  fileStamp?: string
  headerTitle?: string
  emptyMessage?: string
  filenamePrefix?: string
  appointmentById?: (id: string) => Appointment | undefined
  footerLabel?: string
}): { doc: jsPDF; filename: string } {
  const {
    periodLabel,
    payments,
    patientLabel,
    obraSocialLabel,
    doctorLabel,
    doctorPorcentaje,
    doctorResolver,
    doctorEspecialidad,
    dateColumnHeader,
    scope,
    fileStamp,
    headerTitle,
    emptyMessage = 'No hay pagos registrados en este período.',
    filenamePrefix = 'cobranzas-obra-social',
    appointmentById,
  } = params

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const osResolver = (p: Payment) =>
    formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById)

  const headerBottom = drawPdfHeader(
    doc,
    pageW,
    headerTitle ?? formatCobranzasObraSocialHeaderTitle(scope, periodLabel),
  )
  const bodyStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  let cursorY = bodyStartY + 3

  if (payments.length === 0) {
    doc.setTextColor(107, 124, 147)
    doc.text(emptyMessage, pagosPdfContentLeft(1), cursorY + 2)
  } else {
    const byObra = new Map<string, Payment[]>()
    for (const p of payments) {
      const obra = obraSocialLabel(p.patientId)?.trim() || '—'
      const list = byObra.get(obra) ?? []
      list.push(p)
      byObra.set(obra, list)
    }

    const obras = [...byObra.keys()].sort((a, b) => a.localeCompare(b, 'es'))
    let pageNum = 1

    for (const obra of obras) {
      const obraPayments = byObra.get(obra) ?? []

      if (cursorY + 16 > pageH - PAGOS_PDF_MARGIN - 4) {
        doc.addPage()
        pageNum = doc.getNumberOfPages()
        cursorY = bodyStartY
      }

      cursorY = drawObraSocialSectionTitle(doc, pageW, cursorY, obra)

      const byDoctor = new Map<string, Payment[]>()
      for (const p of obraPayments) {
        const list = byDoctor.get(p.doctorId) ?? []
        list.push(p)
        byDoctor.set(p.doctorId, list)
      }

      const doctorIds = [...byDoctor.keys()].sort((a, b) =>
        doctorLabel(a).localeCompare(doctorLabel(b), 'es'),
      )

      for (const doctorId of doctorIds) {
        const doctorPayments = byDoctor.get(doctorId) ?? []
        const blockMinH = doctorBlockMinHeight(doctorPayments.length, 'porcentaje')

        if (cursorY + blockMinH > pageH - PAGOS_PDF_MARGIN - 4) {
          doc.addPage()
          pageNum = doc.getNumberOfPages()
          cursorY = bodyStartY
        }

        cursorY = renderPagosDoctorBlockNoObraSocial(
          doc,
          cursorY,
          pageW,
          pageNum,
          doctorLabel(doctorId),
          doctorPayments,
          patientLabel,
          scope,
          dateColumnHeader,
          doctorPorcentaje?.(doctorId),
          doctorEspecialidad?.(doctorId),
          undefined,
          appointmentById,
          doctorResolver?.(doctorId),
          obraSocialLabel,
        )
      }

      const doctorResolverOrPorcentaje = doctorResolver ?? doctorPorcentaje
      const obraTotalNeto = sumPagosNetTotalByDoctor(
        obraPayments,
        doctorResolverOrPorcentaje,
      )
      const space = ensurePagosPdfSpace(
        doc,
        cursorY,
        PAGOS_TOTAL_GENERAL_BAR_H + 6,
        pageH,
      )
      cursorY = drawPagosTotalGeneralBar(
        doc,
        space.y,
        pageW,
        obraPayments.length,
        obraTotalNeto,
        {
          left: 'Total obra social',
          center: `${doctorIds.length} médico${doctorIds.length === 1 ? '' : 's'}`,
        },
      )
    }

    const grandTotalNeto = sumPagosNetTotalByDoctor(payments, doctorPorcentaje)
    const space = ensurePagosPdfSpace(
      doc,
      cursorY,
      PAGOS_TOTAL_GENERAL_BAR_H + 8,
      pageH,
    )
    drawPagosTotalGeneralBar(
      doc,
      space.y,
      pageW,
      countDistinctPagos(payments),
      grandTotalNeto,
    )
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const filename = `${filenamePrefix}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc, params.footerLabel ? { label: params.footerLabel } : undefined)
  return { doc, filename }
}

/** Resumen para Gerencia: cobranzas por médico sin nombres de pacientes. */
export function buildGerenciaDoctorsPaymentsPdf(params: {
  periodLabel: string
  payments: Payment[]
  doctorLabel: (doctorId: string) => string
  obraSocialLabel: ObraSocialLabelFn
  dateColumnHeader: string
  scope: AllDoctorsPdfScope
  fileStamp?: string
  emptyMessage?: string
  withDoctorChart?: boolean
  /** Líneas extra bajo el título del período (p. ej. médico filtrado). */
  periodMetaExtra?: string[]
  filenameSuffix?: string
  footerLabel?: string
  appointmentById?: (id: string) => Appointment | undefined
}): { doc: jsPDF; filename: string } {
  const {
    periodLabel,
    payments,
    doctorLabel,
    obraSocialLabel,
    dateColumnHeader,
    scope,
    fileStamp,
    emptyMessage = 'No hay pagos registrados en este período.',
    withDoctorChart = true,
    periodMetaExtra = [],
    filenameSuffix,
    appointmentById,
  } = params

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const osResolver = (p: Payment) =>
    formatObraSocialCell(obraSocialLabel, p.patientId, p, appointmentById)

  const headerBottom = drawPdfHeader(
    doc,
    pageW,
    gerenciaPdfHeaderSubtitle(scope, periodLabel),
  )
  const bodyStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  let cursorY =
    drawPdfPeriodMetaBlock(doc, pageW, bodyStartY, '', periodMetaExtra) + 5

  if (payments.length === 0) {
    doc.setTextColor(107, 124, 147)
    doc.text(emptyMessage, pagosPdfContentLeft(1), cursorY + 2)
  } else {
    const byDoctor = new Map<string, Payment[]>()
    for (const p of payments) {
      const list = byDoctor.get(p.doctorId) ?? []
      list.push(p)
      byDoctor.set(p.doctorId, list)
    }

    const doctorIds = [...byDoctor.keys()].sort((a, b) =>
      doctorLabel(a).localeCompare(doctorLabel(b), 'es'),
    )

    let pageNum = 1
    cursorY = drawPagosSummaryStrip(
      doc,
      cursorY,
      pageW,
      buildPagosSummaryMetrics(payments, doctorIds.length),
    )

    for (const doctorId of doctorIds) {
      const doctorPayments = [...(byDoctor.get(doctorId) ?? [])].sort(
        (a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime(),
      )
      const doctorName = doctorLabel(doctorId)
      const gerenciaRows = buildGerenciaTableRows(
        doctorPayments,
        scope,
        obraSocialLabel,
        appointmentById,
      )
      const blockMinH = doctorBlockMinHeight(gerenciaRows.length)

      if (cursorY + blockMinH > pageH - PAGOS_PDF_MARGIN - 4) {
        doc.addPage()
        pageNum = doc.getNumberOfPages()
        cursorY = bodyStartY
      }

      cursorY = renderPagosDoctorBlockGerencia(
        doc,
        cursorY,
        pageW,
        pageNum,
        doctorName,
        doctorPayments,
        scope,
        dateColumnHeader,
        obraSocialLabel,
        undefined,
        appointmentById,
      )
    }

    const grandTotal = payments.reduce((s, p) => s + p.monto, 0)
    const space = ensurePagosPdfSpace(
      doc,
      cursorY,
      PAGOS_TOTAL_GENERAL_BAR_H + 8,
      pageH,
    )
    drawPagosTotalGeneralBar(
      doc,
      space.y,
      pageW,
      countDistinctPagos(payments),
      grandTotal,
    )
  }

  if (withDoctorChart && payments.length > 0) {
    appendDoctorTotalsChartPage(doc, scope, periodLabel, payments, doctorLabel)
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const suffix = filenameSuffix ? `-${filenameSuffix}` : ''
  const filename = `${gerenciaFilenamePrefix(scope)}${suffix}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc, params.footerLabel ? { label: params.footerLabel } : undefined)
  return { doc, filename }
}
