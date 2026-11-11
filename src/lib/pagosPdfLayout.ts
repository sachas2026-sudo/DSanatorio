import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Doctor, Payment } from '../types'
import { formatMonto } from './formatMonto'

export const PAGOS_PDF_MARGIN = 12

/** Misma agrupación que en tablas PDF: turno (cita) o paciente + fecha/hora. */
export function pagoPdfGroupKey(p: Payment): string {
  return (
    p.citaId ??
    `${p.patientId}__${format(parseISO(p.fecha), 'yyyy-MM-dd HH:mm')}`
  )
}

/** Dos registros del mismo turno (pago partido) cuentan como un solo pago. */
export function countDistinctPagos(payments: Payment[]): number {
  if (payments.length === 0) return 0
  const keys = new Set<string>()
  for (const p of payments) {
    keys.add(pagoPdfGroupKey(p))
  }
  return keys.size
}

/** ¿El pago entered por transferencia? (definición única del método) */
export function esPagoTransferencia(metodo: string | undefined): boolean {
  return (metodo ?? '').trim().toLowerCase() === 'transferencia'
}

/** Suma montos cuya forma de pago es Transferencia. */
export function sumPagosTransferencia(payments: Payment[]): number {
  return payments.reduce(
    (s, p) => s + (esPagoTransferencia(p.metodo) ? p.monto : 0),
    0,
  )
}

/** Suma montos cuya forma de pago es Efectivo. */
export function sumPagosEfectivo(payments: Payment[]): number {
  return payments.reduce(
    (s, p) => s + (p.metodo.trim().toLowerCase() === 'efectivo' ? p.monto : 0),
    0,
  )
}

const PDF_META_TITLE_LINE_H = 5.2
const PDF_META_BODY_LINE_H = 4.2

import { getCurrentUserDisplayName, getExportTurnoLabel, getUserDisplayNameForShift, resolveUserRealName } from './auth'

export function pdfGeneratedLabel(userOverride?: string, turnoText?: string): string {
  const rawUser = userOverride || getCurrentUserDisplayName()
  const nowStr = format(new Date(), 'dd-MM-yyyy HH:mm', { locale: es })

  let resolvedTurno = (turnoText || '').trim()
  const isDiaCompleto =
    !resolvedTurno ||
    resolvedTurno.toLowerCase() === 'todos' ||
    resolvedTurno.toLowerCase() === 'día completo' ||
    resolvedTurno.toLowerCase() === 'dia completo' ||
    resolvedTurno.toLowerCase() === 'dia_completo'

  if (isDiaCompleto) {
    const user = rawUser ? resolveUserRealName(rawUser) : 'Admi'
    return `${user} - Generado: ${nowStr}`
  }

  const user = getUserDisplayNameForShift(resolvedTurno, rawUser)

  let shiftLabel = resolvedTurno
  if (
    !shiftLabel.toLowerCase().startsWith('turno ') &&
    !shiftLabel.toLowerCase().startsWith('día completo') &&
    !shiftLabel.toLowerCase().startsWith('dia completo')
  ) {
    shiftLabel = `Turno ${shiftLabel}`
  }

  if (user) {
    return `${user} - ${shiftLabel} - Generado: ${nowStr}`
  }
  return `${shiftLabel} - Generado: ${nowStr}`
}

/** Pie de página en todas las hojas (fecha/hora de generación). */
export function stampPdfGeneratedFooterOnAllPages(
  doc: jsPDF,
  options?: { bold?: boolean; label?: string; marginX?: number },
): void {
  const label = options?.label ?? pdfGeneratedLabel()
  const marginX = options?.marginX ?? PAGOS_PDF_MARGIN
  const total = doc.getNumberOfPages()
  for (let page = 1; page <= total; page++) {
    doc.setPage(page)
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const right = pageW - marginX
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
  esMontoFijo?: boolean
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

/**
 * Resuelve la liquidación de un pago contemplando:
 * 1. Si es particular y el médico tiene configurado un monto para Cuidar (doc.cuidar > 0).
 * 2. Si es una obra social y el médico tiene configurado un porcentaje para esa obra social.
 * 3. Fallback al porcentaje aplicado en el pago o al porcentaje general del médico.
 */
export function resolveDoctorPaymentSettlement(
  payment: Payment,
  doctor?: Doctor | null,
  obraSocial?: string | null,
): DoctorPorcentajeSettlement {
  const os = (payment.obraSocialOverride || obraSocial || 'Particular').trim()
  const isParticular = os.toLowerCase() === 'particular'

  if (doctor?.valor != null && doctor.valor > 0) {
    const totalPorcentaje = Math.min(payment.monto, doctor.valor)
    const totalGeneral = Math.max(0, payment.monto - totalPorcentaje)
    return { porcentaje: 0, totalPorcentaje, totalGeneral, esMontoFijo: true }
  }

  if (isParticular && doctor?.cuidar != null && doctor.cuidar > 0) {
    const totalPorcentaje = doctor.cuidar
    const totalGeneral = Math.max(0, payment.monto - totalPorcentaje)
    return { porcentaje: 0, totalPorcentaje, totalGeneral, esMontoFijo: true }
  }

  if (!isParticular && doctor?.obrasSociales && doctor.obrasSociales.length > 0) {
    const match = doctor.obrasSociales.find(
      (o) => o.nombre.trim().toLowerCase() === os.toLowerCase(),
    )
    if (match && match.porcentaje > 0) {
      return computeDoctorPorcentajeSettlement(payment.monto, match.porcentaje)
    }
  }

  const pct = resolvePaymentPorcentaje(payment, doctor?.porcentaje)
  return computeDoctorPorcentajeSettlement(payment.monto, pct)
}

export type DesglosePagoFila = {
  monto: number
  cuidar: number
  medico: number
  cuidarLabel: string
  medicoLabel: string
  montoLabel: string
}

/**
 * Calcula el desglose por fila de un pago para la tabla del PDF:
 * - Monto: el monto del pago.
 * - Cuidar: retención de Cuidar según regla vigente.
 * - Médico: Monto - Cuidar. Si Cuidar > Monto, Médico es "—" (sin negativos).
 * - Fila sin monto (<= 0): Cuidar y Médico muestran "—".
 */
export function calcularDesglosePagoFila(
  payment: { monto: number; porcentajeAplicado?: number; obraSocialOverride?: string },
  doctor?: Doctor | null,
  obraSocial?: string | null,
  settlementOverride?: DoctorPorcentajeSettlement,
): DesglosePagoFila {
  const monto = payment.monto ?? 0
  const montoLabel = formatMonto(monto)

  if (monto <= 0) {
    return {
      monto: 0,
      cuidar: 0,
      medico: 0,
      cuidarLabel: '—',
      medicoLabel: '—',
      montoLabel,
    }
  }

  const s =
    settlementOverride ??
    resolveDoctorPaymentSettlement(payment as Payment, doctor, obraSocial)

  const cuidar = Math.round((s.totalPorcentaje || 0) * 100) / 100

  if (cuidar > monto) {
    return {
      monto,
      cuidar,
      medico: 0,
      cuidarLabel: formatMonto(cuidar),
      medicoLabel: '—',
      montoLabel,
    }
  }

  const medico = Math.round((monto - cuidar) * 100) / 100

  return {
    monto,
    cuidar,
    medico,
    cuidarLabel: formatMonto(cuidar),
    medicoLabel: formatMonto(medico),
    montoLabel,
  }
}

export type DoctorResumenSettlement = {
  facturado: number
  porcentaje: number
  comision: number
  transferencias: number
  efectivoAEntregar: number
}

/** Importe en efectivo pendiente de entregar tras comisión y transferencias. */
export function computeEfectivoAEntregar(
  totalNeto: number,
  transferencias: number,
): number {
  return Math.round((totalNeto - transferencias) * 100) / 100
}

/** Resumen por médico: facturado − comisión − transferencias. */
export function computeDoctorResumenSettlement(
  facturado: number,
  transferencias: number,
  porcentaje?: number | null,
): DoctorResumenSettlement {
  const s = computeDoctorPorcentajeSettlement(facturado, porcentaje)
  const efectivoAEntregar = computeEfectivoAEntregar(
    s.totalGeneral,
    transferencias,
  )
  return {
    facturado,
    porcentaje: s.porcentaje,
    comision: s.totalPorcentaje,
    transferencias,
    efectivoAEntregar,
  }
}

/** % congelado en el pago; si falta, el del médico al calcular reportes. */
export function resolvePaymentPorcentaje(
  payment: Payment,
  doctorPorcentaje?: number | null,
): number | undefined {
  if (
    payment.porcentajeAplicado != null &&
    Number.isFinite(payment.porcentajeAplicado)
  ) {
    return payment.porcentajeAplicado
  }
  if (doctorPorcentaje != null && Number.isFinite(doctorPorcentaje)) {
    return doctorPorcentaje
  }
  return undefined
}

/**
 * Resuelve la liquidación de una lista de pagos teniendo en cuenta:
 * 1. Médicos con valor diario para Cuidar (doctor.valor > 0): se agrupan por médico y fecha (día),
 *    deduciendo el valor diario de Cuidar de los primeros pagos del día hasta cubrirlo.
 * 2. Médicos con Cuidar fijo por consulta particular (doctor.cuidar > 0).
 * 3. Obras sociales con porcentaje específico configurado en la ficha del médico.
 * 4. Porcentaje aplicado en el pago o porcentaje general del médico.
 */
export function buildPaymentsSettlementMap(
  payments: Payment[],
  doctorResolver?: ((doctorId: string) => Doctor | undefined) | ((doctorId: string) => number | undefined),
  obraSocialResolver?: (payment: Payment) => string | undefined,
): Map<string, DoctorPorcentajeSettlement> {
  const map = new Map<string, DoctorPorcentajeSettlement>()
  if (!payments || payments.length === 0) return map

  // Agrupar pagos por médico y fecha (día: YYYY-MM-DD)
  const byDoctorAndDay = new Map<string, Payment[]>()
  for (const p of payments) {
    const docId = p.doctorId || ''
    const day = (p.fecha || '').slice(0, 10)
    const key = `${docId}__${day}`
    const list = byDoctorAndDay.get(key) ?? []
    list.push(p)
    byDoctorAndDay.set(key, list)
  }

  for (const [, list] of byDoctorAndDay) {
    const first = list[0]!
    const resolved = doctorResolver?.(first.doctorId)
    const doctor = resolved && typeof resolved === 'object' && 'id' in resolved ? (resolved as Doctor) : undefined

    if (doctor?.valor != null && doctor.valor > 0) {
      // Ordenar cronológicamente para que Cuidar absorba el valor diario de los primeros pagos del día
      const sorted = [...list].sort(
        (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
      )
      let dailyCuidarRemaining = doctor.valor
      for (const p of sorted) {
        const montoCuidar = Math.min(p.monto, dailyCuidarRemaining)
        dailyCuidarRemaining = Math.max(0, dailyCuidarRemaining - montoCuidar)
        const montoMedico = Math.max(0, p.monto - montoCuidar)
        map.set(p.id, {
          porcentaje: 0,
          totalPorcentaje: montoCuidar,
          totalGeneral: montoMedico,
          esMontoFijo: true,
        })
      }
    } else {
      for (const p of list) {
        const os = obraSocialResolver?.(p)
        if (doctor) {
          map.set(p.id, resolveDoctorPaymentSettlement(p, doctor, os))
        } else {
          const pct = resolvePaymentPorcentaje(p, resolved as number | undefined)
          map.set(p.id, computeDoctorPorcentajeSettlement(p.monto, pct))
        }
      }
    }
  }

  return map
}

/** Suma «Efectivo a entregar» de cada médico en el período. */
export function sumPagosEfectivoEntregarByDoctor(
  payments: Payment[],
  doctorResolver?: ((doctorId: string) => Doctor | undefined) | ((doctorId: string) => number | undefined),
  obraSocialResolver?: (payment: Payment) => string | undefined,
): number {
  const settlementMap = buildPaymentsSettlementMap(payments, doctorResolver, obraSocialResolver)
  const byDoctor = new Map<string, Payment[]>()
  for (const p of payments) {
    const list = byDoctor.get(p.doctorId) ?? []
    list.push(p)
    byDoctor.set(p.doctorId, list)
  }
  let sum = 0
  for (const [, list] of byDoctor) {
    const facturado = list.reduce((s, p) => s + p.monto, 0)
    let comision = 0
    for (const p of list) {
      const s = settlementMap.get(p.id)
      if (s) {
        comision += s.totalPorcentaje
      } else {
        const resolved = doctorResolver?.(p.doctorId)
        if (resolved && typeof resolved === 'object' && 'id' in resolved) {
          const os = obraSocialResolver?.(p)
          comision += resolveDoctorPaymentSettlement(p, resolved as Doctor, os).totalPorcentaje
        } else {
          comision += computeDoctorPorcentajeSettlement(
            p.monto,
            resolvePaymentPorcentaje(p, resolved as number | undefined),
          ).totalPorcentaje
        }
      }
    }
    comision = Math.round(comision * 100) / 100
    const transferencias = sumPagosTransferencia(list)
    sum += computeEfectivoAEntregar(facturado - comision, transferencias)
  }
  return Math.round(sum * 100) / 100
}

/** Suma del «Total» neto de cada médico (facturado − Total %). */
export function sumPagosNetTotalByDoctor(
  payments: Payment[],
  doctorResolver?: ((doctorId: string) => Doctor | undefined) | ((doctorId: string) => number | undefined),
  obraSocialResolver?: (payment: Payment) => string | undefined,
): number {
  const settlementMap = buildPaymentsSettlementMap(payments, doctorResolver, obraSocialResolver)
  let sum = 0
  for (const p of payments) {
    const s = settlementMap.get(p.id)
    if (s) {
      sum += s.totalGeneral
    } else {
      const resolved = doctorResolver?.(p.doctorId)
      if (resolved && typeof resolved === 'object' && 'id' in resolved) {
        const os = obraSocialResolver?.(p)
        sum += resolveDoctorPaymentSettlement(p, resolved as Doctor, os).totalGeneral
      } else {
        const pct = resolvePaymentPorcentaje(p, resolved as number | undefined)
        sum += computeDoctorPorcentajeSettlement(p.monto, pct).totalGeneral
      }
    }
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
const PAGOS_SUBTOTAL_FACTURADO_FILL: [number, number, number] = [238, 244, 255]

/** Pie con % y Total: hasta 5 filas si hay deuda pendiente con Cuidar. */
export const PAGOS_DOCTOR_SUBTOTAL_WITH_PCT_H = PAGOS_DOCTOR_SUBTOTAL_BAR_H * 5 + 5

/** Bloque resumen bajo cada médico (4 filas). */
export const PAGOS_DOCTOR_RESUMEN_ROW_H = 7
export const PAGOS_DOCTOR_RESUMEN_BLOCK_H = PAGOS_DOCTOR_RESUMEN_ROW_H * 5 + 12

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

const PAGOS_TABLE_HEAD_RGB: [number, number, number] = [122, 163, 176]
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
  options?: { withoutFrame?: boolean },
): number {
  const withoutFrame = options?.withoutFrame ?? false
  const boxH = withoutFrame ? 7 : PAGOS_DOCTOR_TITLE_BAR_H
  const padX = withoutFrame ? 0 : 4
  const textY = y + (withoutFrame ? 4.5 : 6.2)

  if (!withoutFrame) {
    strokePagosFrameTopRound(doc, x, y, width, boxH, PAGOS_DOCTOR_BLOCK_RADIUS)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(withoutFrame ? 12 : 11)
  doc.setTextColor(withoutFrame ? 22 : 47, withoutFrame ? 82 : 111, withoutFrame ? 162 : 219)
  doc.text(doctorName, x + padX, textY)

  const esp = especialidad?.trim()
  if (esp) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(withoutFrame ? 10 : 11)
    doc.setTextColor(withoutFrame ? 100 : 61, withoutFrame ? 116 : 74, withoutFrame ? 139 : 92)
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
  options?: { boldLabelPart?: string },
): void {
  const right = left + width - 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PAGOS_SUBTOTAL_VALUE_FS)
  doc.setTextColor(26, 39, 68)
  doc.text(value, right, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PAGOS_SUBTOTAL_LABEL_FS)
  const boldPart = options?.boldLabelPart
  const boldPartIndex = boldPart ? label.indexOf(boldPart) : -1
  if (boldPartIndex >= 0 && boldPart) {
    const prefix = label.slice(0, boldPartIndex)
    const suffix = label.slice(boldPartIndex + boldPart.length)
    const prefixWidth = doc.getTextWidth(prefix)
    const suffixWidth = doc.getTextWidth(suffix)
    doc.setFont('helvetica', 'bold')
    const boldWidth = doc.getTextWidth(boldPart)
    doc.setFont('helvetica', 'normal')
    const labelStartX = labelRightX - prefixWidth - boldWidth - suffixWidth
    doc.text(prefix, labelStartX, y)
    doc.setFont('helvetica', 'bold')
    doc.text(boldPart, labelStartX + prefixWidth, y)
    doc.setFont('helvetica', 'normal')
    doc.text(suffix, labelStartX + prefixWidth + boldWidth, y)
    return
  }
  doc.text(label, labelRightX, y, { align: 'right' })
}

export type PagosDoctorSubtotalOptions = {
  porcentaje?: number | null
  /** Si hay varios % en el bloque (ej. "Var."). */
  porcentajeLabel?: string
  /** Totales ya sumados por pago (evita un solo % sobre el subtotal). */
  totalPorcentaje?: number
  totalGeneral?: number
  /** Líneas % / Total % / Total bajo Total facturado (mismo tamaño de texto). */
  showPorcentajeLines?: boolean
  totalTransferencias?: number
  /** Todo el bloque por transferencia => "Total % Cuidar" en negativo. */
  todosTransferencia?: boolean
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

  const s =
    options?.totalPorcentaje != null && options?.totalGeneral != null
      ? {
          porcentaje: options.porcentaje ?? 0,
          totalPorcentaje: options.totalPorcentaje,
          totalGeneral: options.totalGeneral,
        }
      : computeDoctorPorcentajeSettlement(amount, options?.porcentaje)
  const transferTotal = options?.totalTransferencias ?? 0
  const signoCuidar = options?.todosTransferencia ? -1 : 1
  const efectivoAEntregar = computeEfectivoAEntregar(
    s.totalGeneral,
    transferTotal,
  )
  const deudaConCuidar = Math.max(0, -efectivoAEntregar)
  const efectivoAEntregarVisible = Math.max(0, efectivoAEntregar)
  const porcentajeCuidarLabel =
    options?.porcentajeLabel ??
    (options?.porcentaje != null ? `${options.porcentaje}%` : `${s.porcentaje}%`)
  const rowH = PAGOS_DOCTOR_SUBTOTAL_BAR_H
  const topY = y
  const row1Y = topY + rowH
  const row2Y = topY + rowH * 2
  const row3Y = topY + rowH * 3
  const totalRowY = deudaConCuidar > 0 ? topY + rowH * 4 : row3Y

  const subtotalTextY = (rowY: number) => rowY + rowH / 2 + PAGOS_SUBTOTAL_TEXT_Y_OFFSET

  // Solo «Total facturado» se destaca; transferencias y porcentajes quedan sin relleno.
  doc.setFillColor(...PAGOS_SUBTOTAL_FACTURADO_FILL)
  doc.rect(left, topY, width, rowH, 'F')

  doc.setDrawColor(...PAGOS_BORDER_RGB)
  doc.setLineWidth(0.25)
  doc.line(left, topY, left, totalRowY)
  doc.line(left + width, topY, left + width, totalRowY)
  doc.line(left, row1Y, left + width, row1Y)
  doc.line(left, row2Y, left + width, row2Y)
  doc.line(left, row3Y, left + width, row3Y)
  if (deudaConCuidar > 0) {
    doc.line(left, totalRowY, left + width, totalRowY)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PAGOS_SUBTOTAL_VALUE_FS)
  const maxValueW = Math.max(
    doc.getTextWidth(money(amount)),
    doc.getTextWidth(money(transferTotal)),
    doc.getTextWidth(money(s.totalPorcentaje)),
    doc.getTextWidth(money(deudaConCuidar)),
    doc.getTextWidth(money(efectivoAEntregarVisible)),
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
    'Ya cobró por transferencia',
    money(transferTotal),
    labelRightX,
  )
  const cleanPctLabel = (porcentajeCuidarLabel || '').trim()
  const displayPct = cleanPctLabel === 'Var.' ? '%' : cleanPctLabel
  const labelCuidar = displayPct ? `Total ${displayPct} Cuidar` : 'Total Cuidar'
  drawPagosSubtotalAmountRight(
    doc,
    left,
    width,
    subtotalTextY(row2Y),
    labelCuidar,
    money(s.totalPorcentaje * signoCuidar),
    labelRightX,
    displayPct ? { boldLabelPart: displayPct } : undefined,
  )

  if (deudaConCuidar > 0) {
    drawPagosSubtotalAmountRight(
      doc,
      left,
      width,
      subtotalTextY(row3Y),
      'Comisión pendiente - Deuda del médico con Cuidar',
      money(deudaConCuidar),
      labelRightX,
    )
  }

  fillPagosBarBottomRound(doc, left, totalRowY, width, rowH, PAGOS_DOCTOR_BLOCK_RADIUS)
  drawPagosSubtotalAmountRight(
    doc,
    left,
    width,
    subtotalTextY(totalRowY),
    'Total',
    money(efectivoAEntregarVisible),
    labelRightX,
  )

  if (deudaConCuidar > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(138, 75, 8)
    doc.text(
      'Se cobrará la comisión en turnos posteriores o con pagos a acordar con Cuidar.',
      left + 3,
      totalRowY + rowH + 4,
      { maxWidth: width - 6 },
    )
    return totalRowY + rowH + 10
  }

  return totalRowY + rowH + 5
}

const PAGOS_RESUMEN_TABLE_LINE: [number, number, number] = [225, 232, 242]
const PAGOS_RESUMEN_EFECTIVO_FILL: [number, number, number] = [238, 244, 255]

/** Filas de totales pegadas a la lista de pagos del médico. */
export function drawPagosDoctorResumenTable(
  doc: jsPDF,
  y: number,
  left: number,
  width: number,
  settlement: DoctorResumenSettlement,
  todosTransferencia = false,
): number {
  const pageW = doc.internal.pageSize.getWidth()
  const rightMargin = pageW - left - width
  const deuda = Math.max(0, -settlement.efectivoAEntregar)
  const efectivoAEntregar = Math.max(0, settlement.efectivoAEntregar)
  // Con todo el bloque por transferencia, la comisión sale del lado del centro
  // y no se le adeuda: va negativa.
  const signoCuidar = todosTransferencia ? -1 : 1
  const bodyRows = [
    ['Total facturado', money(settlement.facturado)],
    [`Comisión para Cuidar (${settlement.porcentaje}%)`, money(settlement.comision * signoCuidar)],
    ['Ya cobró por transferencia', money(settlement.transferencias)],
    ['Efectivo a entregar', money(efectivoAEntregar)],
  ]
  if (deuda > 0) {
    bodyRows.push([
      'Comisión pendiente - Deuda del médico con Cuidar',
      money(deuda),
    ])
  }

  autoTable(doc, {
    startY: y,
    body: bodyRows,
    tableWidth: width,
    margin: { left, right: rightMargin, top: 0, bottom: 0 },
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 1.8, bottom: 1.8, left: 3, right: 3 },
      textColor: [26, 39, 68],
      lineColor: PAGOS_RESUMEN_TABLE_LINE,
      lineWidth: 0.1,
      valign: 'middle',
      minCellHeight: PAGOS_DOCTOR_RESUMEN_ROW_H,
    },
    columnStyles: {
      1: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      const lastRowIndex = deuda > 0 ? 4 : 3
      if (data.section === 'body' && data.row.index === 0) {
        data.cell.styles.fillColor = PAGOS_SUBTOTAL_FACTURADO_FILL
      }
      if (data.section === 'body' && data.row.index === lastRowIndex) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = deuda > 0
          ? [255, 245, 230]
          : PAGOS_RESUMEN_EFECTIVO_FILL
      }
    },
  })

  const finalY =
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? y + PAGOS_DOCTOR_RESUMEN_ROW_H * bodyRows.length
  if (deuda > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(138, 75, 8)
    doc.text(
      'Se cobrará la comisión en turnos posteriores o con pagos a acordar con Cuidar.',
      left + 3,
      finalY + 4,
      { maxWidth: width - 6 },
    )
    return finalY + 10
  }
  return finalY + 5
}

export type PagosTotalBarLabels = {
  left?: string
  /** Texto normal a continuación del título en negrita (misma línea). */
  leftSuffix?: string
  center?: string
  marginX?: number
}

/**
 * Pastilla de totales de una sola línea: todo el texto en negrita, más grande
 * que el cuerpo y alineado a la derecha.
 *
 * A diferencia de `drawPagosTotalGeneralBar`, la caja se ajusta al ancho del
 * texto en vez de ocupar toda la página: con un único texto pegado al borde
 * derecho de una barra de página completa quedaba media hoja en blanco.
 */
export function drawPagosTotalsPill(
  doc: jsPDF,
  y: number,
  text: string,
  options?: { marginX?: number; fontSize?: number },
): number {
  const marginX = options?.marginX ?? PAGOS_PDF_MARGIN
  const fontSize = options?.fontSize ?? 11
  const h = PAGOS_TOTAL_GENERAL_BAR_H
  const r = PAGOS_DOCTOR_BLOCK_RADIUS
  const padX = 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(fontSize)
  const width = doc.getTextWidth(text) + padX * 2
  const left = doc.internal.pageSize.getWidth() - marginX - width

  doc.setFillColor(238, 244, 255)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.25)
  doc.roundedRect(left, y, width, h, r, r, 'FD')

  doc.setTextColor(26, 39, 68)
  doc.text(text, left + width - padX, y + h / 2 + 0.95, { align: 'right' })
  return y + h + 5
}

export interface DoctorTotalesBloqueH4 {
  totalFacturado: number
  totalMedico: number
  totalCuidar: number
  totalTransferencias: number
}

export const PAGOS_TOTALES_H4_LINE_H = 5.2
export const PAGOS_TOTALES_H4_BLOCK_H = PAGOS_TOTALES_H4_LINE_H * 4

/**
 * Bloque de 4 líneas (modelo H4), alineado a la derecha (ancho aprox. 45% de la página),
 * una línea por renglón con separador fino gris, etiqueta a la izquierda (gris, negrita)
 * y valor a la derecha (negrita):
 *   Total Facturado:      $ X
 *   Total Médico:         $ Y
 *   Total Cuidar:         $ Z
 *   Total Transferencias: $ T
 */
export function drawPagosTotalesBloqueH4(
  doc: jsPDF,
  y: number,
  pageW: number,
  totales: DoctorTotalesBloqueH4,
  options?: { marginX?: number; widthRatio?: number },
): number {
  const left = options?.marginX ?? PAGOS_PDF_MARGIN
  const contentW = pageW - 2 * left
  const blockW = contentW * (options?.widthRatio ?? 0.45)
  const blockX = left + contentW - blockW

  const lineH = PAGOS_TOTALES_H4_LINE_H
  const lines: Array<{ label: string; value: number }> = [
    { label: 'Total Facturado:', value: totales.totalFacturado },
    { label: 'Total Médico:', value: totales.totalMedico },
    { label: 'Total Cuidar:', value: totales.totalCuidar },
    { label: 'Total Transferencias:', value: totales.totalTransferencias },
  ]

  let curY = y
  for (let i = 0; i < lines.length; i++) {
    const item = lines[i]!
    const rowMidY = curY + lineH / 2 + 0.8

    // Etiqueta a la izquierda (gris, negrita)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(100, 116, 139) // #64748B
    doc.text(item.label, blockX, rowMidY)

    // Valor a la derecha (negrita)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42) // #0F172A
    doc.text(money(item.value), blockX + blockW, rowMidY, { align: 'right' })

    // Separador fino gris
    doc.setDrawColor(226, 232, 240) // #E2E8F0
    doc.setLineWidth(0.15)
    doc.line(blockX, curY + lineH, blockX + blockW, curY + lineH)

    curY += lineH
  }

  return curY
}

export const PAGOS_TRANSFERENCIA_BAR_H = 8.5
export const PAGOS_TRANSFERENCIA_BG_COLOR = [243, 245, 248] as const // #F3F5F8
export const PAGOS_TRANSFERENCIA_BORDER_COLOR = [225, 230, 236] as const // #E1E6EC
export const PAGOS_TRANSFERENCIA_LABEL_COLOR = [71, 85, 105] as const // #475569
export const PAGOS_TRANSFERENCIA_VALUE_COLOR = [15, 23, 42] as const // #0F172A

/**
 * Franja gris: Ya cobró por transferencia  $ X
 * Fondo gris claro #F3F5F8, borde #E1E6EC, bordes redondeados ~10px / 2.5mm,
 * etiqueta a la izquierda en gris negrita, valor a la derecha en negrita.
 */
export function drawPagosTransferenciaBar(
  doc: jsPDF,
  y: number,
  pageW: number,
  transferTotal: number,
  options?: { marginX?: number; height?: number; label?: string },
): number {
  const left = options?.marginX ?? PAGOS_PDF_MARGIN
  const width = pageW - 2 * left
  const h = options?.height ?? PAGOS_TRANSFERENCIA_BAR_H
  const r = PAGOS_DOCTOR_BLOCK_RADIUS

  doc.setFillColor(...PAGOS_TRANSFERENCIA_BG_COLOR)
  doc.setDrawColor(...PAGOS_TRANSFERENCIA_BORDER_COLOR)
  doc.setLineWidth(0.25)
  doc.roundedRect(left, y, width, h, r, r, 'FD')

  const textY = y + h / 2 + 1
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...PAGOS_TRANSFERENCIA_LABEL_COLOR)
  doc.text(options?.label ?? 'Ya cobró por transferencia', left + 5, textY)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...PAGOS_TRANSFERENCIA_VALUE_COLOR)
  doc.text(money(transferTotal), left + width - 5, textY, { align: 'right' })

  return y + h
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
  const left = labels?.marginX ?? PAGOS_PDF_MARGIN
  const width = pageW - 2 * left
  const h = PAGOS_TOTAL_GENERAL_BAR_H

  const r = PAGOS_DOCTOR_BLOCK_RADIUS
  doc.setFillColor(238, 244, 255)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.25)
  doc.roundedRect(left, y, width, h, r, r, 'FD')

  const textY = y + h / 2 + 0.95
  const leftMain = labels?.left ?? 'Total general'
  const xStart = left + 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(26, 39, 68)
  doc.text(leftMain, xStart, textY)
  if (labels?.leftSuffix) {
    const suffixGapMm = 8
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(
      labels.leftSuffix,
      xStart + doc.getTextWidth(leftMain) + suffixGapMm,
      textY,
    )
  }

  const pagosLabel =
    labels?.center !== undefined
      ? labels.center
      : `${totalPagos} pago${totalPagos === 1 ? '' : 's'}`
  if (pagosLabel) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(61, 74, 92)
    doc.text(pagosLabel, left + width / 2, textY, { align: 'center' })
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(15, 35, 75)
  doc.text(money(totalMonto), left + width - 5, textY, { align: 'right' })

  return y + h + 5
}

export type ResumenGeneralJ2Input = {
  totalFacturado: number
  totalMedico: number
  totalCuidar: number
  totalTransferencias: number
  totalPagos: number
  totalGeneral: number
}

export type ResumenGeneralJ2Options = {
  marginX?: number
  labelTotalGeneral?: string
}

export const RESUMEN_GENERAL_J2_ROW_H = 7.2
export const RESUMEN_GENERAL_J2_FINAL_ROW_H = 9.0
export const RESUMEN_GENERAL_J2_TOTAL_H =
  RESUMEN_GENERAL_J2_ROW_H * 4 + RESUMEN_GENERAL_J2_FINAL_ROW_H // 37.8 mm
export const RESUMEN_GENERAL_J2_RADIUS = 0

/**
 * Función pura que calcula los totales agregados para la tarjeta Resumen General J2.
 */
export function calculateResumenGeneralJ2(
  payments: Payment[],
  doctorResolverOrPorcentaje?:
    | ((id: string) => Doctor | undefined)
    | ((id: string) => number | undefined),
  osResolver?: (p: Payment) => string,
  resumenMedicoLayout = false,
): ResumenGeneralJ2Input {
  const totalFacturado = payments.reduce((s, p) => s + p.monto, 0)
  const totalTransferencias = sumPagosTransferencia(payments)
  const totalMedico = sumPagosNetTotalByDoctor(
    payments,
    doctorResolverOrPorcentaje,
    osResolver,
  )
  const totalCuidar = totalFacturado - totalMedico
  const totalPagos = countDistinctPagos(payments)
  const totalGeneral = resumenMedicoLayout
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
        computeEfectivoAEntregar(totalMedico, totalTransferencias),
      )

  return {
    totalFacturado,
    totalMedico,
    totalCuidar,
    totalTransferencias,
    totalPagos,
    totalGeneral,
  }
}

/**
 * Modelo J2: Tarjeta única de Resumen General al final del PDF de Cobranzas.
 *
 * Contenedor:
 * - Borde 1px #CFE0FC
 * - Esquinas redondeadas ~14px (3.5 mm)
 * - Ancho completo del contenido (igual que la tabla)
 *
 * Filas 1 a 4 (separador fino #E4E9EC, izq negrita #52606D, der negrita #1B2A4A):
 * 1) Total Facturado
 * 2) Total Médico
 * 3) Total Cuidar
 * 4) Ya cobró por transferencia (fondo gris claro #F3F5F8)
 *
 * Fila final (dentro de la misma tarjeta, fondo azul claro #EAF1FD, altura compacta ~10mm):
 * - Izquierda: "Total general" (negrita 11pt, #1B2A4A)
 * - Centro: "N pagos" (8.5pt gris)
 * - Derecha: Monto (negrita 15pt, #1B2A4A)
 */
export function drawResumenGeneralCardJ2(
  doc: jsPDF,
  y: number,
  pageW: number,
  input: ResumenGeneralJ2Input,
  options?: ResumenGeneralJ2Options,
): number {
  const left = options?.marginX ?? PAGOS_PDF_MARGIN
  const width = pageW - 2 * left
  const rowH = RESUMEN_GENERAL_J2_ROW_H
  const finalRowH = RESUMEN_GENERAL_J2_FINAL_ROW_H
  const totalH = RESUMEN_GENERAL_J2_TOTAL_H
  const r = RESUMEN_GENERAL_J2_RADIUS

  // 1. Contenedor base blanco con borde #CFE0FC (bordes rectos si r === 0)
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(207, 224, 252) // #CFE0FC
  doc.setLineWidth(0.35)
  if (r > 0) {
    doc.roundedRect(left, y, width, totalH, r, r, 'FD')
  } else {
    doc.rect(left, y, width, totalH, 'FD')
  }

  // 2. Fila 4: fondo gris claro #F3F5F8
  const yRow4 = y + 3 * rowH
  doc.setFillColor(243, 245, 248) // #F3F5F8
  doc.rect(left + 0.2, yRow4, width - 0.4, rowH, 'F')

  // 3. Fila 5: fondo azul claro #EAF1FD (bordes rectos si r === 0)
  const yRow5 = y + 4 * rowH
  doc.setFillColor(234, 241, 253) // #EAF1FD
  if (r > 0) {
    doc.roundedRect(left + 0.2, yRow5, width - 0.4, finalRowH - 0.2, r, r, 'F')
    // Tapamos el radio superior de la fila 5 para que quede cuadrada arriba
    doc.rect(left + 0.2, yRow5, width - 0.4, r, 'F')
  } else {
    doc.rect(left + 0.2, yRow5, width - 0.4, finalRowH - 0.2, 'F')
  }

  // 4. Separadores inferiores finos #E4E9EC entre filas
  doc.setDrawColor(228, 233, 236) // #E4E9EC
  doc.setLineWidth(0.2)
  for (let i = 1; i <= 4; i++) {
    const sepY = y + i * rowH
    doc.line(left, sepY, left + width, sepY)
  }

  // 5. Re-trazar el borde exterior de 1px #CFE0FC
  doc.setDrawColor(207, 224, 252) // #CFE0FC
  doc.setLineWidth(0.35)
  if (r > 0) {
    doc.roundedRect(left, y, width, totalH, r, r, 'S')
  } else {
    doc.rect(left, y, width, totalH, 'S')
  }

  // 6. Textos de filas 1 a 4
  const paddingX = 5.5 // ~20px
  const textXLeft = left + paddingX
  const textXRight = left + width - paddingX

  const rows: Array<{ label: string; value: number }> = [
    { label: 'Total Facturado', value: input.totalFacturado },
    { label: 'Total Médico', value: input.totalMedico },
    { label: 'Total Cuidar', value: input.totalCuidar },
    { label: 'Ya cobró por transferencia', value: input.totalTransferencias },
  ]

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i]!
    const rowMidY = y + i * rowH + rowH / 2 + 1.0

    // Etiqueta a la izquierda (gris #52606D, negrita, 9.2pt)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.2)
    doc.setTextColor(82, 96, 109) // #52606D
    doc.text(item.label, textXLeft, rowMidY)

    // Valor a la derecha (negrita, 10pt, color oscuro #1B2A4A)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.0)
    doc.setTextColor(27, 42, 74) // #1B2A4A
    doc.text(formatMonto(item.value), textXRight, rowMidY, { align: 'right' })
  }

  // 7. Fila final (Total general compacta)
  const finalMidY = yRow5 + finalRowH / 2 + 1.2

  // Izquierda: "Total general" (negrita 10.8pt, color #1B2A4A)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.8)
  doc.setTextColor(27, 42, 74) // #1B2A4A
  const mainLabel = options?.labelTotalGeneral ?? 'Total general'
  doc.text(mainLabel, textXLeft, finalMidY)

  // Centro: "N pagos" / "1 pago" (8.5pt, gris #64748B)
  const countLabel =
    input.totalPagos === 1 ? '1 pago' : `${input.totalPagos} pagos`
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139) // #64748B
  doc.text(countLabel, left + width / 2, finalMidY, { align: 'center' })

  // Derecha: monto (negrita 15pt, color #1B2A4A)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15.0)
  doc.setTextColor(27, 42, 74) // #1B2A4A
  doc.text(formatMonto(input.totalGeneral), textXRight, finalMidY + 0.2, {
    align: 'right',
  })

  return y + totalH
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
    totalPagos: countDistinctPagos(payments),
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
  return format(parseISO(iso), 'd MMM yyyy', { locale: es })
}
