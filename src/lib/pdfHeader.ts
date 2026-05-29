import type jsPDF from 'jspdf'
import { PAGOS_PDF_MARGIN } from './pagosPdfLayout'
import {
  plainHeaderHeightForWidth,
  renderPlainHeaderFromBanner,
} from './pdfHeaderBanner'
import { getPdfLogo } from './pdfLogo'

/** Altura de la barra azul superior en todos los PDF */
export const PDF_HEADER_HEIGHT = 18

import {
  PDF_BRAND_NAME,
  PDF_TITLE_DASH,
} from './pdfBranding'

export { PDF_BRAND_NAME, PDF_TITLE_DASH } from './pdfBranding'

const PDF_HEADER_LOGO_MARGIN = 10
const PDF_HEADER_LOGO_MAX_H = 14

const PDF_HEADER_PLAIN_PAD_TOP = 4

/** Margen lateral del encabezado en PDF de agenda (más ancho que cobranzas). */
export const PDF_HEADER_AGENDA_MARGIN = 7

/** Tamaño del título en la barra azul */
export const PDF_HEADER_FONT_SIZE = 11.5

/** Primera línea de contenido debajo del encabezado (mínimo; usar retorno de drawPdfHeader si es mayor). */
export const PDF_BODY_START_Y = 30

/** Separación entre el encabezado y el cuerpo del PDF (mm). */
export const PDF_BODY_GAP_AFTER_HEADER = 4

/** Baja meta / pastillas bajo el encabezado plain (mm). */
export const PDF_BODY_EXTRA_DOWN_PLAIN = 2

export function pdfBodyStartYAfterHeader(
  headerBottomMm: number,
  extraDownMm = 0,
): number {
  return (
    Math.max(PDF_BODY_START_Y, headerBottomMm + PDF_BODY_GAP_AFTER_HEADER) +
    extraDownMm
  )
}

export function normalizePdfTitle(text: string): string {
  return text
    .replace(/\bSanatorio\b/gi, PDF_BRAND_NAME)
    .replace(/\s*[—–]\s*/g, PDF_TITLE_DASH)
}

export function formatPdfBrandTitle(subtitle?: string): string {
  const sub = subtitle?.trim() ?? ''
  return normalizePdfTitle(
    sub ? `${PDF_BRAND_NAME} - Gestión ${sub}` : `${PDF_BRAND_NAME} - Gestión`,
  )
}

export type PdfHeaderDrawOptions = {
  /** Segunda línea bajo el título (ej. médico en agenda). */
  secondLine?: string
  /** `plain`: banner con logo (default). `blue`: barra azul legacy. */
  variant?: 'blue' | 'plain'
  /** Margen lateral del banner en mm (default: PAGOS_PDF_MARGIN). */
  marginX?: number
}

function drawPlainStyledHeader(
  doc: jsPDF,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  title: string,
  secondLine?: string,
): void {
  const png = renderPlainHeaderFromBanner(
    boxW,
    boxH,
    title,
    PDF_HEADER_FONT_SIZE,
    secondLine,
  )

  if (png) {
    doc.addImage(png, 'PNG', boxX, boxY, boxW, boxH)
    return
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PDF_HEADER_FONT_SIZE)
  doc.setTextColor(26, 39, 68)
  doc.text(title, boxX + boxW / 2, boxY + boxH / 2 + 1, {
    align: 'center',
    maxWidth: boxW - 8,
  })
}

/** Altura usada al dibujar el encabezado (mm). */
export function drawPdfHeader(
  doc: jsPDF,
  pageW: number,
  subtitle: string,
  options?: string | PdfHeaderDrawOptions,
): number {
  const opts: PdfHeaderDrawOptions =
    typeof options === 'string' ? { secondLine: options } : (options ?? {})
  const variant = opts.variant ?? 'plain'
  const second = opts.secondLine?.trim()

  const fullTitle = formatPdfBrandTitle(subtitle)
  const logo = getPdfLogo()
  const plainMarginX = opts.marginX ?? PAGOS_PDF_MARGIN
  const logoMargin = PDF_HEADER_LOGO_MARGIN
  const logoMaxH = PDF_HEADER_LOGO_MAX_H

  const boxW = pageW - 2 * plainMarginX
  const boxX = plainMarginX

  if (variant === 'plain') {
    const headerHeight = plainHeaderHeightForWidth(boxW)
    const contentTop = PDF_HEADER_PLAIN_PAD_TOP

    drawPlainStyledHeader(
      doc,
      boxX,
      contentTop,
      boxW,
      headerHeight,
      fullTitle,
      second,
    )

    return headerHeight + contentTop
  }

  const textLeft = logo
    ? logoMargin + logoMaxH * (logo?.aspect ?? 1) + 5
    : plainMarginX + 2
  const maxW = pageW - textLeft - 14
  const titleLineH = 4.7
  const secondLineH = 4.5
  const secondSize = 11

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PDF_HEADER_FONT_SIZE)
  const titleLines = doc.splitTextToSize(fullTitle, maxW) as string[]

  let secondLines: string[] = []
  if (second) {
    doc.setFontSize(secondSize)
    secondLines = doc.splitTextToSize(second, maxW) as string[]
  }

  const titleBlockH = titleLines.length * titleLineH
  const gap = secondLines.length > 0 ? 1.1 : 0
  const secondBlockH = secondLines.length * secondLineH
  const innerH = titleBlockH + gap + secondBlockH + 5
  const headerHeight = Math.max(
    PDF_HEADER_HEIGHT,
    innerH,
    logo ? logoMaxH + 5 : 0,
  )

  doc.setFillColor(47, 111, 219)
  doc.rect(0, 0, pageW, headerHeight, 'F')

  if (logo) {
    const logoH = Math.min(headerHeight - 2, logoMaxH)
    const logoW = logoH * logo.aspect
    const logoY = (headerHeight - logoH) / 2
    doc.addImage(logo.dataUrl, logo.format, logoMargin, logoY, logoW, logoH)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PDF_HEADER_FONT_SIZE)
  doc.setTextColor(255, 255, 255)
  let y = (headerHeight - titleBlockH - gap - secondBlockH) / 2 + 3
  doc.text(titleLines, textLeft, y)

  if (secondLines.length > 0) {
    y += titleBlockH + gap
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(secondSize)
    doc.setTextColor(255, 255, 255)
    doc.text(secondLines, textLeft, y)
  }

  return headerHeight
}
