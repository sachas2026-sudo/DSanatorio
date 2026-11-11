import jsPDF from 'jspdf'
import logoAssetUrl from '../assets/logo-transparente.png?url'

export interface ReciboPdfDatos {
  paciente: string
  dni: string
  cobertura: string
  periodo: string
  fechaPago: string
  formaPago: string
  importe: number | string
  nroRecibo?: string
  logoDataUrl?: string
}

let cachedTransparentLogo: string | null = null

export async function preloadReciboLogo(): Promise<string | null> {
  if (cachedTransparentLogo) return cachedTransparentLogo
  try {
    const res = await fetch(logoAssetUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        cachedTransparentLogo = String(reader.result)
        resolve(cachedTransparentLogo)
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export function getReciboLogo(): string | null {
  return cachedTransparentLogo
}

export function formatNroRecibo(id?: string): string {
  if (!id) return '0001-00000001'
  if (/^\d{4}-\d{8}$/.test(id)) return id
  const numOnly = id.replace(/\D/g, '')
  if (numOnly.length > 0 && numOnly.length <= 8) {
    return `0001-${numOnly.padStart(8, '0')}`
  }
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  const nro = (hash % 100000000).toString().padStart(8, '0')
  return `0001-${nro}`
}

function renderValue(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxW: number,
  initialPt = 11,
  minPt = 9
) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(initialPt)
  if (doc.getTextWidth(text) <= maxW) {
    doc.text(text, x, y)
    return
  }
  doc.setFontSize(minPt)
  if (doc.getTextWidth(text) <= maxW) {
    doc.text(text, x, y)
    return
  }
  let trimmed = text
  while (trimmed.length > 0 && doc.getTextWidth(trimmed + '…') > maxW) {
    trimmed = trimmed.slice(0, -1)
  }
  doc.text(trimmed + '…', x, y)
}

/**
 * Genera el comprobante de pago con el modelo "franja".
 *
 * Hoja A4 vertical, medidas en mm con origen arriba a la izquierda.
 * Tarjeta: 180 x 88 mm en (15, 15), radio 3 mm, borde #CFD6E4.
 * Franja izquierda: 5 mm de ancho, color #6BB5C4.
 * Cabecera celeste: x=20 a x=195, y=15 a y=37, color #EEF3FC.
 * Sello PAGADO: 40 x 14 mm en (168, 90.5), rotado -10° hacia arriba a la derecha.
 */
/**
 * Dibuja un recibo sobre la página actual de `doc`.
 * Separado de `generarReciboPdf` para poder emitir varios comprobantes en un
 * mismo archivo (uno por página) sin duplicar el diseño.
 */
export function dibujarReciboPdf(doc: jsPDF, datos: ReciboPdfDatos): void {
  // 1. Tarjeta base: rectángulo con esquinas redondeadas r=3 mm
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(207, 214, 228) // #CFD6E4
  doc.setLineWidth(0.3)
  doc.roundedRect(15, 15, 180, 88, 3, 3, 'FD')

  // 2. Franja izquierda de 5 mm de ancho, color #6BB5C4 (con esquinas izquierdas redondeadas r=3)
  doc.setFillColor(107, 181, 196) // #6BB5C4
  doc.roundedRect(15, 15, 5, 88, 3, 3, 'F')
  doc.rect(17.5, 15, 2.5, 88, 'F') // rectifica esquinas derechas de la franja

  // 3. Cabecera desde x=20 hasta x=195 (ancho 175 mm), y=15, alto 22 mm, fondo #EEF3FC
  doc.setFillColor(238, 243, 252) // #EEF3FC
  doc.roundedRect(20, 15, 175, 22, 3, 3, 'F')
  doc.rect(20, 15, 3, 22, 'F') // rectifica esquinas izquierdas
  doc.rect(192, 17, 3, 20, 'F') // rectifica esquina inferior derecha

  // Re-dibujar el borde de la tarjeta para unión perfecta
  doc.setDrawColor(207, 214, 228)
  doc.setLineWidth(0.3)
  doc.roundedRect(15, 15, 180, 88, 3, 3, 'S')

  // 4. Logo transparente (18 x 18 mm en x=25, y=17)
  const logo = datos.logoDataUrl || getReciboLogo()
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', 25, 17, 18, 18)
    } catch {
      // Si falla la inserción de imagen, continuar con los textos
    }
  }

  // 5. Cabecera: Título, Subtítulo e Importe
  // Título: bold 13 pt, color #1B2A4A, x=47, línea base y=25
  doc.setTextColor(27, 42, 74) // #1B2A4A
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('CENTRO MEDICO - COBERTURA DE SALUD', 47, 25)

  // Subtítulo: normal 9 pt, color #5C6780, x=47, línea base y=31
  const nroRecibo = formatNroRecibo(datos.nroRecibo)
  doc.setTextColor(92, 103, 128) // #5C6780
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Comprobante de pago · N° ${nroRecibo}`, 47, 31)

  // Importe: bold 20 pt, #1B2A4A, alineado a la derecha en x=187, línea base y=28
  const importeStr =
    typeof datos.importe === 'number'
      ? `$${Math.round(datos.importe).toLocaleString('es-AR')}`
      : datos.importe.startsWith('$')
        ? datos.importe
        : `$${datos.importe}`

  doc.setTextColor(27, 42, 74)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(importeStr, 187, 28, { align: 'right' })

  // 6. Datos en 3 columnas (x = 27, 87, 147) y 2 filas
  // Fila 1 (etiqueta y=51, valor y=56.5): CONTRATANTE | DNI | COBERTURA
  doc.setTextColor(92, 103, 128)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('CONTRATANTE', 27, 51)
  doc.text('DNI', 87, 51)
  doc.text('COBERTURA', 147, 51)

  doc.setTextColor(27, 42, 74)
  renderValue(doc, datos.paciente, 27, 56.5, 56)
  renderValue(doc, String(datos.dni || '—'), 87, 56.5, 56)
  renderValue(doc, datos.cobertura, 147, 56.5, 45)

  // Fila 2 (etiqueta y=71, valor y=76.5): PERÍODO | FECHA DE PAGO | FORMA DE PAGO
  doc.setTextColor(92, 103, 128)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('PERÍODO', 27, 71)
  doc.text('FECHA DE PAGO', 87, 71)
  doc.text('FORMA DE PAGO', 147, 71)

  doc.setTextColor(27, 42, 74)
  renderValue(doc, datos.periodo, 27, 76.5, 56)
  renderValue(doc, datos.fechaPago, 87, 76.5, 56)
  renderValue(doc, datos.formaPago, 147, 76.5, 45)

  // 7. Pie: normal 8 pt, #5C6780, x=27, línea base y=96
  doc.setTextColor(92, 103, 128)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Este comprobante acredita el pago de la cuota indicada.', 27, 96)

  // 8. Sello "PAGADO": rectángulo redondeado 40 x 14 mm, borde #E08A00 0.8 mm,
  // texto bold 18 pt, centro x=168, y=90.5, rotado 10° subiendo hacia la derecha.
  const cx = 168
  const cy = 90.5
  const k = doc.internal.scaleFactor
  const pageHeightPt = doc.internal.pageSize.getHeight() * k
  const xPt = cx * k
  const yPt = pageHeightPt - cy * k
  const angle = -10 // en coordenadas de página (Y descendente), ángulo negativo inclina hacia arriba a la derecha
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const tx = xPt - (xPt * cos - yPt * sin)
  const ty = yPt - (xPt * sin + yPt * cos)

  doc.saveGraphicsState()
  type MatrixInstance = Parameters<typeof doc.setCurrentTransformationMatrix>[0]
  const MatrixConstructor = (doc as unknown as { Matrix: new (...args: number[]) => MatrixInstance }).Matrix
  const m = new MatrixConstructor(cos, sin, -sin, cos, tx, ty)
  doc.setCurrentTransformationMatrix(m)

  doc.setDrawColor(224, 138, 0) // #E08A00
  doc.setLineWidth(0.8)
  doc.roundedRect(cx - 20, cy - 7, 40, 14, 2, 2, 'S')

  doc.setTextColor(224, 138, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('PAGADO', cx, cy + 0.5, { align: 'center', baseline: 'middle' })

  doc.restoreGraphicsState()
}

/** Genera un comprobante de una sola cuota. */
export function generarReciboPdf(datos: ReciboPdfDatos): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  dibujarReciboPdf(doc, datos)
  return doc
}

/**
 * Genera un archivo con un comprobante por página. Se usa para el cobro de
 * varias cuotas: el número de comprobante de cada página sale de su cuota.
 */
export function generarRecibosPdf(datos: readonly ReciboPdfDatos[]): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  datos.forEach((recibo, index) => {
    if (index > 0) doc.addPage()
    dibujarReciboPdf(doc, recibo)
  })
  return doc
}
