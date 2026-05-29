import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type jsPDF from 'jspdf'
import type { Payment } from '../types'
import { formatMonto } from './formatMonto'

export const PAGOS_PDF_MARGIN = 12

const PDF_META_TITLE_LINE_H = 5.2
const PDF_META_BODY_LINE_H = 4.2

export function pdfGeneratedLabel(): string {
  return `Generado: ${format(new Date(), 'd/MM/yyyy HH:mm', { locale: es })}`
}

/** Pie de página en todas las hojas (fecha/hora de generación). */
export function stampPdfGeneratedFooterOnAllPages(
  doc: jsPDF,
  options?: { bold?: boolean; label?: string },
): void {
  const label = options?.label ?? pdfGeneratedLabel()
  const total = doc.getNumberOfPages()
  for (let page = 1; page <= total; page++) {
    doc.setPage(page)
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const right = pageW - PAGOS_PDF_MARGIN
    doc.setFont('helvetica', options?.bold ? 'bold' : 'normal')
    doc.setFontSize(8)
    doc.setTextColor(107, 124, 147)
    doc.text(label, right, pageH - 7, { align: 'right' })
  }
}

/** Título arriba y líneas opcionales debajo (sin «Generado»; va al pie de cada hoja). */
export function drawPdfPeriodMetaBlock(
  doc: jsPDF,
  pageW: number,
  startY: number,
  title: string,
  extraParts: string[] = [],
): number {
  const left = PAGOS_PDF_MARGIN
  const right = pageW - PAGOS_PDF_MARGIN
  const contentW = right - left
  let y = startY

  const titleTrim = title.trim()
  if (titleTrim) {
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(26, 39, 68)
    const titleLines = doc.splitTextToSize(titleTrim, contentW)
    doc.text(titleLines, left, y)
    y += titleLines.length * PDF_META_TITLE_LINE_H
  }

  const extras = extraParts.map((p) => p.trim()).filter(Boolean)
  if (extras.length > 0) {
    doc.setFontSize(9.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(107, 124, 147)
    const metaLines = doc.splitTextToSize(extras.join('  ·  '), contentW)
    for (const line of metaLines) {
      doc.text(line, left, y)
      y += PDF_META_BODY_LINE_H
    }
  }

  if (titleTrim || extras.length > 0) {
    doc.setDrawColor(225, 232, 242)
    doc.setLineWidth(0.3)
    doc.line(left, y + 1.2, right, y + 1.2)
    return y + 5.5
  }

  return startY + 3
}

export type PagosSummaryMetrics = {
  medicos: number
  totalFacturado: number
  totalPagos: number
  pendiente?: number
}

export type PagosDoctorBlockStats = {
  facturado: number
  pagos: number
  pendiente?: number
}

type MetricIconKind = 'medicos' | 'facturado' | 'pagos' | 'pendiente'

function money(n: number): string {
  return formatMonto(n)
}

export function pagosPdfContentLeft(_pageNumber?: number): number {
  return PAGOS_PDF_MARGIN
}

export function pagosPdfContentWidth(doc: jsPDF, _pageNumber?: number): number {
  const pageW = doc.internal.pageSize.getWidth()
  return pageW - 2 * PAGOS_PDF_MARGIN
}

export function pagosPdfTableOptions(
  doc: jsPDF,
  _pageNumber?: number,
): { margin: { left: number; right: number }; tableWidth: number } {
  const pageW = doc.internal.pageSize.getWidth()
  const left = PAGOS_PDF_MARGIN
  const width = pageW - 2 * PAGOS_PDF_MARGIN
  return {
    margin: { left, right: PAGOS_PDF_MARGIN },
    tableWidth: width,
  }
}

/** Siluetas sólidas — modelo Médicos */
function drawMedicsIcon(
  doc: jsPDF,
  cx: number,
  cy: number,
  rgb: [number, number, number],
): void {
  doc.setFillColor(...rgb)
  doc.circle(cx - 3.2, cy - 2.2, 2.1, 'F')
  doc.roundedRect(cx - 5.4, cy - 0.2, 4.4, 5.8, 0.9, 0.9, 'F')
  doc.circle(cx + 3.2, cy - 2.2, 2.1, 'F')
  doc.roundedRect(cx + 1, cy - 0.2, 4.4, 5.8, 0.9, 0.9, 'F')
}

/** Billete en contorno con $ — modelo Total facturado / Pendiente */
export function drawBillOutlineIcon(
  doc: jsPDF,
  cx: number,
  cy: number,
  rgb: [number, number, number],
): void {
  const w = 13
  const h = 7.5
  const x = cx - w / 2
  const y = cy - h / 2
  doc.setDrawColor(...rgb)
  doc.setLineWidth(0.55)
  doc.roundedRect(x, y, w, h, 0.9, 0.9, 'S')
  doc.circle(x + 2.2, cy, 0.9, 'S')
  doc.circle(x + w - 2.2, cy, 0.9, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...rgb)
  doc.text('$', cx, cy + 1.1, { align: 'center' })
}

/** Documento en contorno — modelo Total pagos */
function drawDocumentOutlineIcon(
  doc: jsPDF,
  cx: number,
  cy: number,
  rgb: [number, number, number],
): void {
  const w = 9
  const h = 11
  const x = cx - w / 2
  const y = cy - h / 2
  doc.setDrawColor(...rgb)
  doc.setLineWidth(0.55)
  doc.roundedRect(x, y, w, h, 0.65, 0.65, 'S')
  doc.line(x + w - 2.2, y, x + w, y)
  doc.line(x + w, y, x + w, y + 2.2)
  for (let i = 0; i < 4; i++) {
    const ly = y + 3.8 + i * 1.65
    doc.line(x + 1.6, ly, x + w - 1.6, ly)
  }
}

function drawMetricIcon(
  doc: jsPDF,
  cx: number,
  cy: number,
  kind: MetricIconKind,
  rgb: [number, number, number],
): void {
  if (kind === 'medicos') {
    drawMedicsIcon(doc, cx, cy, rgb)
    return
  }
  if (kind === 'facturado' || kind === 'pendiente') {
    drawBillOutlineIcon(doc, cx, cy, rgb)
    return
  }
  drawDocumentOutlineIcon(doc, cx, cy, rgb)
}

const PAGOS_PILL_LABEL_RGB: [number, number, number] = [30, 45, 90]
const PAGOS_PILL_VALUE_RGB: [number, number, number] = [20, 32, 58]

/** Mínimos en mm; el resto del ancho va a facturado/pendiente. */
const PILL_MIN_WIDTHS_MM = [24, 46, 22, 40] as const
const PILL_EXTRA_WEIGHTS = [0.06, 0.44, 0.06, 0.44] as const
/** Separación entre icono y texto en pastillas de resumen PDF. */
const PILL_ICON_COL_MM = 14
const PILL_ICON_TEXT_GAP_MM = 5

function measurePillTextWidth(
  doc: jsPDF,
  label: string,
  value: string,
  valueFs: number,
): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  const labelW = doc.getTextWidth(label)
  doc.setFontSize(valueFs)
  const valueW = doc.getTextWidth(value)
  return Math.max(labelW, valueW)
}

function computeSummaryPillWidths(
  doc: jsPDF,
  availableW: number,
  cards: { label: string; value: string; kind: MetricIconKind }[],
): number[] {
  const mins = cards.map((card, i) => {
    const valueFs =
      card.kind === 'facturado' || card.kind === 'pendiente' ? 12 : 13
    const textW = measurePillTextWidth(doc, card.label, card.value, valueFs)
    const content =
      PILL_ICON_COL_MM + PILL_ICON_TEXT_GAP_MM + textW + 8
    return Math.max(PILL_MIN_WIDTHS_MM[i] ?? 22, content)
  })

  const minSum = mins.reduce((s, m) => s + m, 0)
  if (minSum >= availableW) {
    const scale = availableW / minSum
    return mins.map((m) => m * scale)
  }

  const extra = availableW - minSum
  const weightSum = PILL_EXTRA_WEIGHTS.reduce((s, w) => s + w, 0)
  return mins.map(
    (m, i) => m + extra * ((PILL_EXTRA_WEIGHTS[i] ?? 0.25) / weightSum),
  )
}

function drawSummaryMetricCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  iconKind: MetricIconKind,
  iconRgb: [number, number, number],
  label: string,
  value: string,
): void {
  const pad = 3
  const showIcon = w >= 18
  const iconCol = showIcon ? Math.min(PILL_ICON_COL_MM, w * 0.34) : 0
  const iconGap = showIcon ? PILL_ICON_TEXT_GAP_MM : 0
  const iconCx = x + pad + iconCol / 2
  const textX = x + pad + iconCol + iconGap
  const valueMaxW = Math.max(4, w - pad * 2 - iconCol - iconGap)

  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(218, 226, 238)
  doc.setLineWidth(0.35)
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD')

  if (showIcon) {
    drawMetricIcon(doc, iconCx, y + h / 2, iconKind, iconRgb)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...PAGOS_PILL_LABEL_RGB)
  const labelLines = doc.splitTextToSize(label, valueMaxW) as string[]
  doc.text(labelLines[0] ?? label, textX, y + 8.2)

  doc.setTextColor(...PAGOS_PILL_VALUE_RGB)
  let valueFs =
    iconKind === 'facturado' || iconKind === 'pendiente' ? 12 : 13
  doc.setFontSize(valueFs)
  while (valueFs > 7.5 && doc.getTextWidth(value) > valueMaxW) {
    valueFs -= 0.5
    doc.setFontSize(valueFs)
  }
  doc.text(value, textX, y + 17.2)
}

export type MetricSummaryCard = {
  kind: MetricIconKind
  rgb: [number, number, number]
  label: string
  value: string
}

export type MetricSummaryStripOptions = {
  cardH?: number
  bottomGap?: number
}

/** Fila horizontal de pastillas de métricas (reutilizable en otros PDF). */
export function drawMetricSummaryStrip(
  doc: jsPDF,
  y: number,
  pageW: number,
  cards: MetricSummaryCard[],
  options?: MetricSummaryStripOptions,
): number {
  const x0 = PAGOS_PDF_MARGIN
  const totalW = pageW - 2 * PAGOS_PDF_MARGIN
  const gap = 4
  const cardH = options?.cardH ?? 28
  const bottomGap = options?.bottomGap ?? 6
  const gapCount = Math.max(0, cards.length - 1)
  const availableW = totalW - gap * gapCount
  const cardWidths = computeSummaryPillWidths(doc, availableW, cards)

  let x = x0
  cards.forEach((card, index) => {
    const w = cardWidths[index] ?? availableW / Math.max(1, cards.length)
    drawSummaryMetricCard(
      doc,
      x,
      y,
      w,
      cardH,
      card.kind,
      card.rgb,
      card.label,
      card.value,
    )
    x += w + (index < cards.length - 1 ? gap : 0)
  })

  return y + cardH + bottomGap
}

export type DoctorPorcentajeSettlement = {
  porcentaje: number
  totalPorcentaje: number
  totalGeneral: number
}

export function computeDoctorPorcentajeSettlement(
  facturado: number,
  porcentaje?: number | null,
): DoctorPorcentajeSettlement {
  const pct = porcentaje ?? 0
  const totalPorcentaje = Math.round(((facturado * pct) / 100) * 100) / 100
  const totalGeneral = Math.round((facturado - totalPorcentaje) * 100) / 100
  return { porcentaje: pct, totalPorcentaje, totalGeneral }
}

/** Suma del «Total» neto de cada médico (facturado − Total %). */
export function sumPagosNetTotalByDoctor(
  payments: Payment[],
  doctorPorcentaje?: (doctorId: string) => number | undefined,
): number {
  const facturadoPorMedico = new Map<string, number>()
  for (const p of payments) {
    facturadoPorMedico.set(
      p.doctorId,
      (facturadoPorMedico.get(p.doctorId) ?? 0) + p.monto,
    )
  }
  let sum = 0
  for (const [doctorId, facturado] of facturadoPorMedico) {
    sum += computeDoctorPorcentajeSettlement(
      facturado,
      doctorPorcentaje?.(doctorId),
    ).totalGeneral
  }
  return Math.round(sum * 100) / 100
}

/** Fila horizontal de resumen arriba del primer médico. */
export function drawPagosSummaryStrip(
  doc: jsPDF,
  y: number,
  pageW: number,
  metrics: PagosSummaryMetrics,
): number {
  const pendiente = metrics.pendiente ?? 0
  return drawMetricSummaryStrip(doc, y, pageW, [
    {
      kind: 'medicos',
      rgb: [47, 111, 219],
      label: 'Médicos',
      value: String(metrics.medicos),
    },
    {
      kind: 'facturado',
      rgb: [61, 154, 122],
      label: 'Total facturado',
      value: money(metrics.totalFacturado),
    },
    {
      kind: 'pagos',
      rgb: [124, 92, 191],
      label: 'Total pagos',
      value: String(metrics.totalPagos),
    },
    {
      kind: 'pendiente',
      rgb: [224, 122, 58],
      label: 'Pendiente',
      value: money(pendiente),
    },
  ])
}

export type PagosCanceladosPdfSummary = {
  count: number
  total: number
  paciente: number
  doctor: number
  otros: number
}

export function drawPagosCanceladosSummaryStrip(
  doc: jsPDF,
  y: number,
  pageW: number,
  stats: PagosCanceladosPdfSummary,
): number {
  return drawMetricSummaryStrip(doc, y, pageW, [
    {
      kind: 'pagos',
      rgb: [47, 111, 219],
      label: 'Cancelados',
      value: String(stats.count),
    },
    {
      kind: 'facturado',
      rgb: [61, 154, 122],
      label: 'Monto total',
      value: money(stats.total),
    },
    {
      kind: 'medicos',
      rgb: [124, 92, 191],
      label: 'Paciente',
      value: String(stats.paciente),
    },
    {
      kind: 'pendiente',
      rgb: [224, 122, 58],
      label: 'Médico',
      value: String(stats.doctor),
    },
    {
      kind: 'pagos',
      rgb: [107, 124, 147],
      label: 'Otros',
      value: String(stats.otros),
    },
  ])
}

function drawStatCell(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  iconKind: MetricIconKind,
  iconRgb: [number, number, number],
  label: string,
  value: string,
): void {
  drawMetricIcon(doc, x + 9, y + h / 2 + 0.5, iconKind, iconRgb)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  doc.setTextColor(107, 124, 147)
  doc.text(label, x + 17, y + 5.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(26, 39, 68)
  const valueMaxW = w - 19
  let valueFs = iconKind === 'facturado' || iconKind === 'pendiente' ? 8 : 8.5
  doc.setFontSize(valueFs)
  while (valueFs > 6.5 && doc.getTextWidth(value) > valueMaxW) {
    valueFs -= 0.4
    doc.setFontSize(valueFs)
  }
  doc.text(value, x + 17, y + 11)
}

export const PAGOS_DOCTOR_SUBTOTAL_BAR_H = 6.5
const PAGOS_SUBTOTAL_LABEL_FS = 8
const PAGOS_SUBTOTAL_VALUE_FS = 8.5
const PAGOS_SUBTOTAL_TEXT_Y_OFFSET = 0.95

/** Pie con % y Total: 4 filas iguales (misma altura que Total facturado). */
export const PAGOS_DOCTOR_SUBTOTAL_WITH_PCT_H = PAGOS_DOCTOR_SUBTOTAL_BAR_H * 4

export const PAGOS_DOCTOR_TITLE_BAR_H = 9
export const PAGOS_DOCTOR_BLOCK_RADIUS = 1.5
export const PAGOS_TOTAL_GENERAL_BAR_H = 10.5

const PAGOS_BORDER_RGB: [number, number, number] = [210, 222, 238]
/** Factor de curva bezier (mismo que jsPDF roundedRect). */
const PDF_CORNER_ARC = 4 / 3 * (Math.SQRT2 - 1)

function clampCornerRadius(r: number, w: number, h: number): number {
  return Math.min(r, w / 2, h / 2)
}

/** Borde sin relleno: solo esquinas superiores redondeadas. */
function strokePagosFrameTopRound(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  r = clampCornerRadius(r, w, h)
  doc.setDrawColor(...PAGOS_BORDER_RGB)
  doc.setLineWidth(0.35)
  // Mismos segmentos bezier que jsPDF.roundedRect (solo marco: arriba redondeado).
  doc.lines(
    [
      [w - 2 * r, 0],
      [r * PDF_CORNER_ARC, 0, r, r - r * PDF_CORNER_ARC, r, r],
      [0, h - r],
      [-w, 0],
      [0, -(h - r)],
      [0, -(r * PDF_CORNER_ARC), r * PDF_CORNER_ARC, -r, r, -r],
    ],
    x + r,
    y,
    [1, 1],
    'S',
    false,
  )
}

/** Relleno + borde: solo esquinas inferiores redondeadas. */
function fillPagosBarBottomRound(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillRgb: [number, number, number] = [238, 244, 255],
): void {
  r = clampCornerRadius(r, w, h)
  doc.setFillColor(...fillRgb)
  doc.setDrawColor(...PAGOS_BORDER_RGB)
  doc.setLineWidth(0.25)
  doc.lines(
    [
      [w, 0],
      [0, h - r],
      [0, r * PDF_CORNER_ARC, -(r * PDF_CORNER_ARC), r, -r, r],
      [-w + 2 * r, 0],
      [-(r * PDF_CORNER_ARC), 0, -r, -(r * PDF_CORNER_ARC), -r, -r],
      [0, -(h - r)],
    ],
    x,
    y,
    [1, 1],
    'FD',
    true,
  )
}

/** Relleno + borde: solo esquinas superiores redondeadas (cabecera de tabla). */
export function fillPagosFrameTopRound(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillRgb: [number, number, number],
): void {
  r = clampCornerRadius(r, w, h)
  doc.setFillColor(...fillRgb)
  doc.setDrawColor(...PAGOS_BORDER_RGB)
  doc.setLineWidth(0.25)
  doc.lines(
    [
      [w - 2 * r, 0],
      [r * PDF_CORNER_ARC, 0, r, r - r * PDF_CORNER_ARC, r, r],
      [0, h - r],
      [-r * PDF_CORNER_ARC, 0, -r, -r * PDF_CORNER_ARC, -r, -r],
      [-w + 2 * r, 0],
      [0, -(h - r)],
    ],
    x + r,
    y,
    [1, 1],
    'FD',
    true,
  )
}

/** Última fila: esquinas inferiores redondeadas (mismo estilo que subtotales). */
export function fillPagosTableBottomRound(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  fillRgb: [number, number, number],
  r: number = PAGOS_DOCTOR_BLOCK_RADIUS,
): void {
  fillPagosBarBottomRound(doc, x, y, w, h, r, fillRgb)
}

/** Marco exterior de tabla con esquinas superiores e inferiores redondeadas. */
export function strokePagosTableRoundFrame(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number = PAGOS_DOCTOR_BLOCK_RADIUS,
): void {
  r = clampCornerRadius(r, w, h)
  doc.setDrawColor(...PAGOS_BORDER_RGB)
  doc.setLineWidth(0.35)
  doc.roundedRect(x, y, w, h, r, r, 'S')
}

const PAGOS_TABLE_HEAD_RGB: [number, number, number] = [47, 111, 219]
const PAGOS_TABLE_HEAD_TEXT_RGB: [number, number, number] = [255, 255, 255]

/** Cabecera azul con esquinas superiores redondeadas (ancho = tabla). */
export function drawPagosTableHeaderBand(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  labels: string[],
  colWidths: number[],
): number {
  const h = 7
  fillPagosFrameTopRound(doc, x, y, width, h, PAGOS_DOCTOR_BLOCK_RADIUS, PAGOS_TABLE_HEAD_RGB)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...PAGOS_TABLE_HEAD_TEXT_RGB)

  let colX = x
  labels.forEach((label, i) => {
    const cw = colWidths[i] ?? width / labels.length
    doc.text(label, colX + 2.5, y + 4.6, { maxWidth: Math.max(4, cw - 4) })
    colX += cw
  })

  return y + h
}

/** Nombre del médico (izq.) y especialidad (der.) sobre la cabecera de la tabla. */
export function drawPagosDoctorSectionTitle(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  doctorName: string,
  especialidad?: string,
): number {
  const boxH = PAGOS_DOCTOR_TITLE_BAR_H
  const padX = 4
  const textY = y + 6.2

  strokePagosFrameTopRound(doc, x, y, width, boxH, PAGOS_DOCTOR_BLOCK_RADIUS)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(47, 111, 219)
  doc.text(doctorName, x + padX, textY)

  const esp = especialidad?.trim()
  if (esp) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(61, 74, 92)
    doc.text(esp, x + width - padX, textY, { align: 'right' })
  }

  return y + boxH
}

function drawPagosSubtotalPagosLabel(
  doc: jsPDF,
  left: number,
  y: number,
  count: number,
): void {
  const pagosLabel = `${count} pago${count === 1 ? '' : 's'}`
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PAGOS_SUBTOTAL_LABEL_FS)
  doc.setTextColor(61, 74, 92)
  doc.text(pagosLabel, left + 5, y)
}

function drawPagosSubtotalAmountRight(
  doc: jsPDF,
  left: number,
  width: number,
  y: number,
  label: string,
  value: string,
  labelRightX: number,
): void {
  const right = left + width - 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PAGOS_SUBTOTAL_VALUE_FS)
  doc.setTextColor(26, 39, 68)
  doc.text(value, right, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PAGOS_SUBTOTAL_LABEL_FS)
  doc.text(label, labelRightX, y, { align: 'right' })
}

export type PagosDoctorSubtotalOptions = {
  porcentaje?: number | null
  /** Líneas % / Total % / Total bajo Total facturado (mismo tamaño de texto). */
  showPorcentajeLines?: boolean
}

/** Pie por médico: N pagos · Total facturado (+ % y neto si showPorcentajeLines). */
export function drawPagosDoctorSubtotalBar(
  doc: jsPDF,
  y: number,
  pageW: number,
  count: number,
  amount: number,
  options?: PagosDoctorSubtotalOptions,
): number {
  const left = PAGOS_PDF_MARGIN
  const width = pageW - 2 * PAGOS_PDF_MARGIN
  const right = left + width - 5
  const showLines = options?.showPorcentajeLines ?? false

  if (!showLines) {
    const h = PAGOS_DOCTOR_SUBTOTAL_BAR_H
    fillPagosBarBottomRound(doc, left, y, width, h, PAGOS_DOCTOR_BLOCK_RADIUS)
    const textY = y + h / 2 + PAGOS_SUBTOTAL_TEXT_Y_OFFSET
    drawPagosSubtotalPagosLabel(doc, left, textY, count)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(PAGOS_SUBTOTAL_VALUE_FS)
    const maxValueW = doc.getTextWidth(money(amount))
    const labelRightX = right - maxValueW - 4
    drawPagosSubtotalAmountRight(
      doc,
      left,
      width,
      textY,
      'Total facturado',
      money(amount),
      labelRightX,
    )
    return y + h + 5
  }

  const s = computeDoctorPorcentajeSettlement(amount, options?.porcentaje)
  const rowH = PAGOS_DOCTOR_SUBTOTAL_BAR_H
  const topY = y
  const row1Y = topY + rowH
  const row2Y = topY + rowH * 2
  const row3Y = topY + rowH * 3

  const subtotalTextY = (rowY: number) => rowY + rowH / 2 + PAGOS_SUBTOTAL_TEXT_Y_OFFSET

  for (let i = 0; i < 3; i++) {
    doc.setFillColor(255, 255, 255)
    doc.rect(left, topY + i * rowH, width, rowH, 'F')
  }

  doc.setDrawColor(...PAGOS_BORDER_RGB)
  doc.setLineWidth(0.25)
  doc.line(left, topY, left, row3Y)
  doc.line(left + width, topY, left + width, row3Y)
  doc.line(left, row1Y, left + width, row1Y)
  doc.line(left, row2Y, left + width, row2Y)
  doc.line(left, row3Y, left + width, row3Y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PAGOS_SUBTOTAL_VALUE_FS)
  const maxValueW = Math.max(
    doc.getTextWidth(money(amount)),
    doc.getTextWidth(`${s.porcentaje}%`),
    doc.getTextWidth(money(s.totalPorcentaje)),
    doc.getTextWidth(money(s.totalGeneral)),
  )
  const labelRightX = right - maxValueW - 4

  drawPagosSubtotalPagosLabel(doc, left, subtotalTextY(topY), count)
  drawPagosSubtotalAmountRight(
    doc,
    left,
    width,
    subtotalTextY(topY),
    'Total facturado',
    money(amount),
    labelRightX,
  )
  drawPagosSubtotalAmountRight(
    doc,
    left,
    width,
    subtotalTextY(row1Y),
    '% Médico',
    `${s.porcentaje}%`,
    labelRightX,
  )
  drawPagosSubtotalAmountRight(
    doc,
    left,
    width,
    subtotalTextY(row2Y),
    'Total %',
    money(s.totalPorcentaje),
    labelRightX,
  )

  fillPagosBarBottomRound(doc, left, row3Y, width, rowH, PAGOS_DOCTOR_BLOCK_RADIUS)
  drawPagosSubtotalAmountRight(
    doc,
    left,
    width,
    subtotalTextY(row3Y),
    'Total',
    money(s.totalGeneral),
    labelRightX,
  )

  return row3Y + rowH + 5
}

export type PagosTotalBarLabels = {
  left?: string
  center?: string
}

/** Barra final: etiqueta izq · centro · monto a la derecha. */
export function drawPagosTotalGeneralBar(
  doc: jsPDF,
  y: number,
  pageW: number,
  totalPagos: number,
  totalMonto: number,
  labels?: PagosTotalBarLabels,
): number {
  const left = PAGOS_PDF_MARGIN
  const width = pageW - 2 * PAGOS_PDF_MARGIN
  const h = PAGOS_TOTAL_GENERAL_BAR_H

  const r = PAGOS_DOCTOR_BLOCK_RADIUS
  doc.setFillColor(238, 244, 255)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.25)
  doc.roundedRect(left, y, width, h, r, r, 'FD')

  const textY = y + h / 2 + 0.95
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(26, 39, 68)
  doc.text(labels?.left ?? 'Total general', left + 5, textY)

  const pagosLabel =
    labels?.center ??
    `${totalPagos} pago${totalPagos === 1 ? '' : 's'}`
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(61, 74, 92)
  doc.text(pagosLabel, left + width / 2, textY, { align: 'center' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(26, 39, 68)
  doc.text(money(totalMonto), left + width - 5, textY, { align: 'right' })

  return y + h + 5
}

/** Cabecera de tarjeta médico (nombre + Facturado / Pagos / Pendiente). */
export function drawPagosDoctorCardHeader(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  doctorName: string,
  stats: PagosDoctorBlockStats,
): number {
  const headerH = 11
  const statsH = 16
  const totalH = headerH + statsH

  doc.setFillColor(241, 247, 255)
  doc.rect(x, y, width, headerH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(47, 111, 219)
  doc.text(doctorName, x + 4, y + 7.5)

  const statsY = y + headerH
  doc.setFillColor(252, 253, 255)
  doc.rect(x, statsY, width, statsH, 'F')

  const colW = width / 3
  const pendiente = stats.pendiente ?? 0
  drawStatCell(
    doc,
    x,
    statsY,
    colW,
    statsH,
    'facturado',
    [61, 154, 122],
    'Facturado',
    money(stats.facturado),
  )
  doc.setDrawColor(225, 232, 242)
  doc.setLineWidth(0.2)
  doc.line(x + colW, statsY + 2, x + colW, statsY + statsH - 2)
  drawStatCell(
    doc,
    x + colW,
    statsY,
    colW,
    statsH,
    'pagos',
    [124, 92, 191],
    'Pagos',
    String(stats.pagos),
  )
  doc.line(x + 2 * colW, statsY + 2, x + 2 * colW, statsY + statsH - 2)
  drawStatCell(
    doc,
    x + 2 * colW,
    statsY,
    colW,
    statsH,
    'pendiente',
    [224, 122, 58],
    'Pendiente',
    money(pendiente),
  )

  return y + totalH
}

export function fillPagosDoctorCardBackground(
  doc: jsPDF,
  x: number,
  yTop: number,
  width: number,
  height: number,
): void {
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, yTop, width, Math.max(height, 8), 1.5, 1.5, 'F')
}

export function strokePagosDoctorCardBorder(
  doc: jsPDF,
  x: number,
  yTop: number,
  width: number,
  yBottom: number,
): void {
  const h = Math.max(yBottom - yTop, 8)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.35)
  doc.roundedRect(x, yTop, width, h, 1.5, 1.5, 'S')
}

export function buildPagosSummaryMetrics(
  payments: Payment[],
  doctorCount: number,
): PagosSummaryMetrics {
  return {
    medicos: doctorCount,
    totalFacturado: payments.reduce((s, p) => s + p.monto, 0),
    totalPagos: payments.length,
    pendiente: 0,
  }
}

/** @deprecated usar buildPagosSummaryMetrics */
export const buildPagosSidebarMetrics = buildPagosSummaryMetrics

export function formatPagosPdfDateTime(
  iso: string,
  scope: 'dia' | 'mes' | 'anio',
): string {
  if (scope === 'dia') {
    return format(parseISO(iso), 'HH:mm', { locale: es })
  }
  return format(parseISO(iso), 'd MMM yyyy HH:mm', { locale: es })
}
