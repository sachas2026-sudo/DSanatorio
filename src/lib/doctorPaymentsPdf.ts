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
  buildPagosSummaryMetrics,
  drawPagosDoctorSectionTitle,
  computeDoctorPorcentajeSettlement,
  drawPagosDoctorSubtotalBar,
  drawPagosSummaryStrip,
  PAGOS_DOCTOR_SUBTOTAL_WITH_PCT_H,
  sumPagosNetTotalByDoctor,
  drawPagosTotalGeneralBar,
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
import type { Doctor, Payment } from '../types'

function money(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  })
}

export type DoctorPdfRow = {
  fecha: string
  paciente: string
  obs: string
  monto: number
  metodo: string
  obraSocial: string
}

export type DayPaymentPdfRow = {
  fecha: string
  paciente: string
  obs: string
  medico: string
  monto: number
  metodo: string
  obraSocial: string
}

export type ObraSocialLabelFn = (patientId: string) => string

function formatObraSocialCell(
  obraSocialLabel: ObraSocialLabelFn,
  patientId: string,
): string {
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
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })
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
): DoctorTotalChartItem[] {
  const map = new Map<string, number>()
  for (const p of payments) {
    map.set(p.doctorId, (map.get(p.doctorId) ?? 0) + p.monto)
  }
  return [...map.entries()]
    .map(([doctorId, facturado]) => {
      const monto = doctorPorcentaje
        ? computeDoctorPorcentajeSettlement(
            facturado,
            doctorPorcentaje(doctorId),
          ).totalGeneral
        : facturado
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
    center: `${items.length} médico${items.length === 1 ? '' : 's'}`,
  })
}

function appendDoctorTotalsChartPage(
  doc: jsPDF,
  scope: AllDoctorsPdfScope,
  periodLabel: string,
  payments: Payment[],
  doctorLabel: (doctorId: string) => string,
  doctorPorcentaje?: (doctorId: string) => number | undefined,
): void {
  const items = aggregateDoctorTotalsFromPayments(
    payments,
    doctorLabel,
    doctorPorcentaje,
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

export function formatCobranzasTodosMedicosHeaderTitle(
  scope: AllDoctorsPdfScope,
  periodLabel: string,
): string {
  return `Cobranzas - Todos los médicos - ${formatCobranzasHeaderPeriodSuffix(scope, periodLabel)}`
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

/** Misma altura que la fila «Total facturado» del pie. */
const PAYMENTS_TABLE_ROW_MIN_H = PAGOS_DOCTOR_SUBTOTAL_BAR_H

const PAYMENTS_TABLE_CELL_PADDING = {
  top: 1.45,
  bottom: 1.45,
  left: 2.5,
  right: 2.5,
} as const

/** Columna Monto alineada a la derecha (índice 3), con Obs luego de Paciente. */
const PAYMENTS_TABLE_COLUMN_STYLES_WITH_OBS: Record<
  number,
  {
    halign?: 'right' | 'left' | 'center'
    valign?: 'top' | 'middle' | 'bottom'
    cellWidth?: number
  }
> = {
  0: { cellWidth: 34, valign: 'middle' },
  2: { cellWidth: 30, valign: 'middle' }, // Obs
  3: { halign: 'right', cellWidth: 26, valign: 'middle' }, // Monto
  4: { cellWidth: 22, valign: 'middle' }, // Método
  5: { cellWidth: 26, valign: 'middle' }, // Obra social
}

/** Columna Monto a la derecha (índice 3), con Obs y sin Obra social. */
const PAYMENTS_TABLE_COLUMN_STYLES_NO_OBRA_WITH_OBS: Record<
  number,
  {
    halign?: 'right' | 'left' | 'center'
    valign?: 'top' | 'middle' | 'bottom'
    cellWidth?: number
  }
> = {
  0: { cellWidth: 34, valign: 'middle' },
  2: { cellWidth: 30, valign: 'middle' }, // Obs
  3: { halign: 'right', cellWidth: 26, valign: 'middle' }, // Monto
  4: { cellWidth: 22, valign: 'middle' }, // Método
}

/** Cabecera azul compacta (Fecha, Paciente, Monto, Método, Obra social). */
const PAYMENTS_TABLE_HEAD_STYLES = {
  fillColor: [47, 111, 219] as [number, number, number],
  textColor: [255, 255, 255] as [number, number, number],
  fontStyle: 'bold' as const,
  fontSize: 8,
  cellPadding: PAYMENTS_TABLE_CELL_PADDING,
  minCellHeight: PAYMENTS_TABLE_ROW_MIN_H,
  valign: 'middle' as const,
}

const PAYMENTS_TABLE_BODY_STYLES = {
  fontSize: 8,
  cellPadding: PAYMENTS_TABLE_CELL_PADDING,
  textColor: [61, 74, 92] as [number, number, number],
  lineColor: [225, 232, 242] as [number, number, number],
  lineWidth: 0.1,
  valign: 'middle' as const,
  minCellHeight: PAYMENTS_TABLE_ROW_MIN_H,
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

function doctorBlockMinHeight(rowCount: number, withPorcentajeLines = false): number {
  const footerH = withPorcentajeLines
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
  2: { cellWidth: 22, valign: 'middle' },
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
): GerenciaTableRow[] {
  const sorted = [...payments].sort(
    (a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime(),
  )
  if (scope === 'dia') {
    return sorted.map((p) => ({
      fechaLabel: formatPagosPdfDateTime(p.fecha, scope),
      monto: p.monto,
      metodo: p.metodo,
      obraSocial: formatObraSocialCell(obraSocialLabel, p.patientId),
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
    const obra = obraSocialLabel(p.patientId)?.trim()
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
): number {
  const left = pagosPdfContentLeft(pageNum)
  const width = pagosPdfContentWidth(doc, pageNum)
  const tableOpts = pagosPdfTableOptions(doc, pageNum)
  const rows = buildGerenciaTableRows(payments, scope, obraSocialLabel)
  const pagoCount = payments.length
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
    head: [
      [dateColumnHeader, 'Paciente', 'Historia Clínica', 'Monto', 'Método', 'Obra social'],
    ],
    body: (() => {
      // Si un turno tiene 2 pagos (split), repetimos monto/método pero mostramos
      // Hora/Paciente/Historia Clínica una sola vez.
      let lastKey: string | null = null
      return sorted.map((p) => {
        const groupKey =
          p.citaId ??
          `${p.patientId}__${format(parseISO(p.fecha), 'yyyy-MM-dd HH:mm')}`
        const repeat = groupKey === lastKey
        lastKey = groupKey
        return [
          repeat ? '' : formatPagosPdfDateTime(p.fecha, scope),
          repeat ? '' : patientLabel(p.patientId),
          repeat ? '' : p.notas?.trim() || '—',
          money(p.monto),
          p.metodo,
          formatObraSocialCell(obraSocialLabel, p.patientId),
        ]
      })
    })(),
    ...tableOpts,
    tableWidth: width,
    margin: { ...tableOpts.margin, top: 0, bottom: 0 },
    styles: PAYMENTS_TABLE_BODY_STYLES,
    headStyles: PAYMENTS_TABLE_HEAD_STYLES,
    alternateRowStyles: PAYMENTS_TABLE_ALTERNATE_ROW_STYLES,
    columnStyles: PAYMENTS_TABLE_COLUMN_STYLES_WITH_OBS,
    didParseCell: (data) => applyPagosTableLastBodyRowPadding(data, bodyRowCount),
  })

  y = tableFinalY(doc, y)
  return drawPagosDoctorSubtotalBar(doc, y, pageW, sorted.length, subtotal, {
    showPorcentajeLines: true,
    porcentaje: doctorPorcentaje,
  })
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
    head: [[dateColumnHeader, 'Paciente', 'Historia Clínica', 'Monto', 'Método']],
    body: (() => {
      let lastKey: string | null = null
      return sorted.map((p) => {
        const groupKey =
          p.citaId ??
          `${p.patientId}__${format(parseISO(p.fecha), 'yyyy-MM-dd HH:mm')}`
        const repeat = groupKey === lastKey
        lastKey = groupKey
        return [
          repeat ? '' : formatPagosPdfDateTime(p.fecha, scope),
          repeat ? '' : patientLabel(p.patientId),
          repeat ? '' : p.notas?.trim() || '—',
          money(p.monto),
          p.metodo,
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
  return drawPagosDoctorSubtotalBar(doc, y, pageW, sorted.length, subtotal, {
    showPorcentajeLines: true,
    porcentaje: doctorPorcentaje,
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
}): { doc: jsPDF; filename: string } {
  const { doctor, periodLabel, payments, patientLabel, obraSocialLabel, scope, fileStamp } =
    params
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const timeCol = scope === 'dia' ? 'Hora' : 'Fecha'
  const doctorLine = `${doctor.apellido}, ${doctor.nombre}`

  const headerBottom = drawPdfHeader(
    doc,
    pageW,
    formatCobranzasDoctorHeaderTitle(doctor, scope, periodLabel),
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
  } else {
    const pageH = doc.internal.pageSize.getHeight()
    const facturado = payments.reduce((s, p) => s + p.monto, 0)
    const totalNeto = computeDoctorPorcentajeSettlement(
      facturado,
      doctor.porcentaje,
    ).totalGeneral

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
    )

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
      payments.length,
      totalNeto,
    )
  }

  const slug = `${doctor.apellido}-${doctor.nombre}`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const filename = `cobranzas-${slug}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
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
    await invoke<boolean>('save_pdf_dialog', {
      defaultFilename: filename,
      pdfBase64: pdfToBase64(doc),
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
): DoctorPdfRow[] {
  let lastKey: string | null = null
  return [...payments]
    .sort((a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime())
    .map((p) => {
      const groupKey =
        p.citaId ?? `${p.patientId}__${format(parseISO(p.fecha), 'yyyy-MM-dd HH:mm')}`
      const repeat = groupKey === lastKey
      lastKey = groupKey
      return {
        fecha: repeat
          ? ''
          : format(parseISO(p.fecha), 'd MMM yyyy HH:mm', { locale: es }),
        paciente: repeat ? '' : patientLabel(p.patientId),
        obs: repeat ? '' : p.notas?.trim() || '—',
        monto: p.monto,
        metodo: p.metodo,
        obraSocial: formatObraSocialCell(obraSocialLabel, p.patientId),
      }
    })
}

export function buildDayPaymentPdfRows(
  payments: Payment[],
  patientLabel: (patientId: string) => string,
  doctorLabel: (doctorId: string) => string,
  obraSocialLabel: ObraSocialLabelFn,
  dateFormat: string = 'HH:mm',
): DayPaymentPdfRow[] {
  let lastKey: string | null = null
  return [...payments]
    .sort((a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime())
    .map((p) => {
      const groupKey =
        p.citaId ?? `${p.patientId}__${format(parseISO(p.fecha), 'yyyy-MM-dd HH:mm')}`
      const repeat = groupKey === lastKey
      lastKey = groupKey
      return {
        fecha: repeat ? '' : format(parseISO(p.fecha), dateFormat, { locale: es }),
        paciente: repeat ? '' : patientLabel(p.patientId),
        obs: repeat ? '' : p.notas?.trim() || '—',
        medico: repeat ? '' : doctorLabel(p.doctorId),
        monto: p.monto,
        metodo: p.metodo,
        obraSocial: formatObraSocialCell(obraSocialLabel, p.patientId),
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
}): { doc: jsPDF; filename: string } {
  const {
    dayLabel,
    rows,
    fileStamp,
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

  if (rows.length === 0) {
    doc.setTextColor(107, 124, 147)
    doc.text(emptyMessage, 14, tableStartY + 2)
  } else {
    autoTable(doc, {
      startY: tableStartY,
      head: [
        [
          dateColumnHeader,
          'Paciente',
          'Historia Clínica',
          'Médico',
          'Monto',
          'Método',
          'Obra social',
        ],
      ],
      body: rows.map((r) => [
        r.fecha,
        r.paciente,
        r.obs,
        r.medico,
        money(r.monto),
        r.metodo,
        r.obraSocial,
      ]),
      styles: PAYMENTS_TABLE_BODY_STYLES,
      headStyles: PAYMENTS_TABLE_HEAD_STYLES,
      alternateRowStyles: PAYMENTS_TABLE_ALTERNATE_ROW_STYLES,
      columnStyles: {
        2: { cellWidth: 28, valign: 'middle' }, // Obs
        4: { halign: 'right', cellWidth: 26, valign: 'middle' }, // Monto
        5: { cellWidth: 22, valign: 'middle' }, // Método
        6: { cellWidth: 26, valign: 'middle' }, // Obra social
      },
      margin: { left: 14, right: 14 },
    })

    const finalY = tableFinalY(doc, tableStartY)
    drawPagosTotalGeneralBar(doc, finalY + 6, pageW, rows.length, total)
  }

  if (withDoctorChart && rows.length > 0) {
    const byDoctor = aggregateDoctorTotals(rows)
    if (byDoctor.length > 0) {
      drawDoctorPaymentsChartPage(doc, 'dia', dayLabel, byDoctor, rows.length)
    }
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const filename = `${filenamePrefix}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
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
}): { doc: jsPDF; filename: string } {
  const {
    periodLabel,
    payments,
    patientLabel,
    obraSocialLabel,
    doctorLabel,
    doctorPorcentaje,
    doctorEspecialidad,
    dateColumnHeader,
    scope,
    fileStamp,
    headerTitle,
    emptyMessage = 'No hay pagos registrados en este período.',
    filenamePrefix = 'cobranzas-todos',
    withDoctorChart = false,
  } = params

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  const pdfHeaderTitle =
    headerTitle ?? formatCobranzasTodosMedicosHeaderTitle(scope, periodLabel)

  const headerBottom = drawPdfHeader(doc, pageW, pdfHeaderTitle)
  const bodyStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  let cursorY = bodyStartY + 3

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

    for (const doctorId of doctorIds) {
      const doctorPayments = [...(byDoctor.get(doctorId) ?? [])].sort(
        (a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime(),
      )
      const doctorName = doctorLabel(doctorId)
      const blockMinH = doctorBlockMinHeight(doctorPayments.length, true)

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
      payments.length,
      grandTotalNeto,
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
    )
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const filename = `${filenamePrefix}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
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
  doctorEspecialidad?: (doctorId: string) => string | undefined
  dateColumnHeader: string
  scope: AllDoctorsPdfScope
  fileStamp?: string
  headerTitle?: string
  emptyMessage?: string
  filenamePrefix?: string
}): { doc: jsPDF; filename: string } {
  const {
    periodLabel,
    payments,
    patientLabel,
    obraSocialLabel,
    doctorLabel,
    doctorPorcentaje,
    doctorEspecialidad,
    dateColumnHeader,
    scope,
    fileStamp,
    headerTitle,
    emptyMessage = 'No hay pagos registrados en este período.',
    filenamePrefix = 'cobranzas-obra-social',
  } = params

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

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
        const blockMinH = doctorBlockMinHeight(doctorPayments.length, true)

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
        )
      }

      const obraTotalNeto = sumPagosNetTotalByDoctor(obraPayments, doctorPorcentaje)
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
    drawPagosTotalGeneralBar(doc, space.y, pageW, payments.length, grandTotalNeto)
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const filename = `${filenamePrefix}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
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
  /** Sufijo en el nombre del archivo (p. ej. apellido-nombre de un médico). */
  filenameSuffix?: string
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
  } = params

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

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
      payments.length,
      grandTotal,
    )
  }

  if (withDoctorChart && payments.length > 0) {
    appendDoctorTotalsChartPage(doc, scope, periodLabel, payments, doctorLabel)
  }

  const stamp = fileStamp ?? format(new Date(), 'yyyy-MM-dd')
  const suffix = filenameSuffix ? `-${filenameSuffix}` : ''
  const filename = `${gerenciaFilenamePrefix(scope)}${suffix}-${stamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc)
  return { doc, filename }
}
