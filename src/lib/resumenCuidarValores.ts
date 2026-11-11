import { formatMonto } from './formatMonto'

export type ObraSocialConfigurada = {
  nombre: string
  porcentaje?: number | null
  monto?: number | null
}

export type ValoresConfiguradosInput = {
  valor?: number | null
  particular?: number | null
  cuidar?: number | null
  porcentaje?: number | null
  obrasSociales?: ObraSocialConfigurada[] | null
}

export type LineaValorConfigurado = {
  etiqueta: string
  texto: string
  esVacio?: boolean
}

/**
 * Formatea montos monetarios según el estándar requerido:
 * "$ 40.000" (símbolo $, espacio, punto de miles, sin decimales).
 */
export function formatMontoCuidar(monto: number): string {
  return formatMonto(Math.round(monto))
}

/**
 * Formatea porcentajes según el estándar requerido:
 * "30 %" (espacio antes del %, coma decimal si hay decimales, ej. "2,5 %").
 */
export function formatPorcentajeCuidar(pct: number): string {
  const rounded = Math.round(pct * 100) / 100
  const formatted = rounded.toString().replace('.', ',')
  return `${formatted} %`
}

/**
 * Genera el título para la sección de valores configurados.
 */
export function buildTituloValoresConfigurados(doctor: {
  apellido: string
  nombre: string
  especialidad?: string | null
}): string {
  const esp = doctor.especialidad?.trim() ? ` (${doctor.especialidad.trim()})` : ''
  return `${doctor.apellido.trim()}, ${doctor.nombre.trim()}${esp}`
}

/**
 * Función pura que construye las líneas con viñetas para el bloque
 * "Valores y Porcentajes Configurados del Médico".
 *
 * Orden:
 * 1. Monto diario
 * 2. Consulta particular
 * 3. Obras sociales
 *
 * Si no hay ningún concepto: devuelve una única línea "Sin valores configurados."
 */
export function buildValoresConfigurados(
  input?: ValoresConfiguradosInput | null,
): LineaValorConfigurado[] {
  if (!input) {
    return [{ etiqueta: '', texto: 'Sin valores configurados.', esVacio: true }]
  }

  const lineas: LineaValorConfigurado[] = []

  // 1. Monto diario de Cuidar (solo si tiene monto cargado > 0)
  const valorDiario = input.valor ?? 0
  if (valorDiario > 0) {
    lineas.push({
      etiqueta: 'Monto diario de Cuidar:',
      texto: ` ${formatMontoCuidar(valorDiario)}.`,
    })
  }

  // 2. Consulta particular (solo si particular > 0)
  const particular = input.particular ?? 0
  const cuidar = input.cuidar ?? 0
  if (particular > 0) {
    if (cuidar <= 0) {
      lineas.push({
        etiqueta: 'Consulta particular:',
        texto: ` ${formatMontoCuidar(particular)}.`,
      })
    } else if (cuidar <= particular) {
      const medicoRecibe = particular - cuidar
      lineas.push({
        etiqueta: 'Consulta particular:',
        texto: ` ${formatMontoCuidar(particular)} - Cuidar ${formatMontoCuidar(cuidar)} fijos y el Médico ${formatMontoCuidar(medicoRecibe)}.`,
      })
    } else {
      // Cuidar mayor que el particular: no calcular lo que recibe el médico (sin negativos)
      lineas.push({
        etiqueta: 'Consulta particular:',
        texto: ` ${formatMontoCuidar(particular)} - Cuidar ${formatMontoCuidar(cuidar)} fijos.`,
      })
    }
  }

  // 3. Retención general / Porcentaje base (solo si porcentaje > 0)
  const pctBase = input.porcentaje ?? 0
  if (pctBase > 0) {
    lineas.push({
      etiqueta: 'Retención de Cuidar:',
      texto: ` ${formatPorcentajeCuidar(pctBase)}.`,
    })
  }

  // 4. Obras sociales configuradas
  const obrasSociales = input.obrasSociales ?? []
  for (const os of obrasSociales) {
    const nombre = os.nombre.trim()
    if (!nombre) continue

    const pct = os.porcentaje ?? 0
    const montoFijo = os.monto ?? 0

    if (pct > 0) {
      lineas.push({
        etiqueta: `Obra social ${nombre}:`,
        texto: ` según arancel. Cuidar retiene el ${formatPorcentajeCuidar(pct)}.`,
      })
    } else if (montoFijo > 0) {
      lineas.push({
        etiqueta: `Obra social ${nombre}:`,
        texto: ` según arancel. Cuidar retiene ${formatMontoCuidar(montoFijo)} fijos.`,
      })
    } else {
      lineas.push({
        etiqueta: `Obra social ${nombre}:`,
        texto: ` según arancel.`,
      })
    }
  }

  if (lineas.length === 0) {
    return [{ etiqueta: '', texto: 'Sin valores configurados.', esVacio: true }]
  }

  return lineas
}

export type DoctorValoresItem = {
  apellido: string
  nombre: string
  especialidad?: string | null
  valor?: number | null
  particular?: number | null
  cuidar?: number | null
  porcentaje?: number | null
  obrasSociales?: ObraSocialConfigurada[] | null
}

function drawSingleDoctorBlock(
  doc: any,
  block: { title: string; lineas: LineaValorConfigurado[]; height: number },
  colX: number,
  y: number,
  colW: number,
  lineHeightMm: number,
  titleFontSize: number,
  lineFontSize: number,
  bulletGap: number,
  isSmallFont: boolean,
): number {
  let curY = y
  const textX = colX + bulletGap
  const availableTextW = colW - bulletGap

  // Título del médico
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(titleFontSize)
  doc.setTextColor(15, 41, 66)
  doc.text(block.title, colX, curY)
  curY += isSmallFont ? 4.0 : 5.5

  for (const line of block.lineas) {
    if (line.esVacio) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(lineFontSize)
      doc.setTextColor(100, 116, 139)
      doc.text(line.texto, colX, curY)
      curY += lineHeightMm
      continue
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(lineFontSize)
    const labelW = doc.getTextWidth(line.etiqueta)

    doc.setFont('helvetica', 'normal')
    const textW = doc.getTextWidth(line.texto)

    // Viñeta
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(lineFontSize)
    doc.setTextColor(30, 41, 59)
    doc.text('•', colX, curY)

    // Etiqueta en negrita
    doc.setFont('helvetica', 'bold')
    doc.text(line.etiqueta, textX, curY)

    // Texto en normal
    doc.setFont('helvetica', 'normal')
    if (labelW + textW <= availableTextW) {
      doc.text(line.texto, textX + labelW, curY)
      curY += lineHeightMm
    } else {
      const words = line.texto.trimStart().split(' ')
      let firstLineText = ''
      let wordIdx = 0
      while (wordIdx < words.length) {
        const testWord = (firstLineText ? firstLineText + ' ' : '') + words[wordIdx]
        if (labelW + doc.getTextWidth(' ' + testWord) <= availableTextW) {
          firstLineText = testWord
          wordIdx++
        } else {
          break
        }
      }
      doc.text(' ' + firstLineText, textX + labelW, curY)
      curY += lineHeightMm

      const remainingWords = words.slice(wordIdx).join(' ')
      if (remainingWords) {
        const wrappedRest = doc.splitTextToSize(remainingWords, availableTextW)
        for (const rLine of wrappedRest) {
          doc.text(rLine, textX, curY)
          curY += lineHeightMm
        }
      }
    }
  }

  return curY
}

/**
 * Dibuja la lista con viñetas de valores y porcentajes configurados del médico (o de varios médicos).
 *
 * - Título por médico: "APELLIDO, NOMBRE (Especialidad)"
 * - Viñetas: una por concepto con la etiqueta en negrita y el resto en texto normal.
 * - Si no hay valores: una sola línea gris "Sin valores configurados."
 * - Soporta modo de 2 columnas con tipografía reducida para Resumen Cuidar.
 * - Anclado al pie de la primera hoja si entra en el espacio disponible.
 */
export function drawValoresConfiguradosBullets(
  doc: any,
  doctorOrDoctors: DoctorValoresItem | DoctorValoresItem[],
  startY: number,
  left: number,
  maxW: number,
  options?: {
    twoColumns?: boolean
    smallFont?: boolean
    skipSetPage?: boolean
    targetPage?: number
    anchorToBottom?: boolean
  },
): number {
  if (options?.targetPage !== undefined) {
    doc.setPage(options.targetPage)
  }
  const pageH = doc.internal.pageSize.getHeight()
  const isTwoColumns = Boolean(options?.twoColumns)
  const isSmallFont = Boolean(options?.smallFont ?? options?.twoColumns)

  const titleFontSize = isSmallFont ? 6.8 : 8.5
  const lineFontSize = isSmallFont ? 6.0 : 7.5
  const lineHeightMm = isSmallFont ? 3.1 : 4.25
  const titleHeightMm = isSmallFont ? 3.8 : 5.5
  const bulletGap = isSmallFont ? 2.8 : 4.0
  const blockGap = isSmallFont ? 2.2 : 2.5

  const doctors = Array.isArray(doctorOrDoctors) ? doctorOrDoctors : [doctorOrDoctors]
  if (doctors.length === 0) return startY

  const blocks: {
    title: string
    lineas: LineaValorConfigurado[]
    height: number
  }[] = []

  let totalBlockHeight = 0
  for (const docItem of doctors) {
    const title = buildTituloValoresConfigurados(docItem)
    const lineas = buildValoresConfigurados(docItem)
    const height = titleHeightMm + lineas.length * lineHeightMm
    blocks.push({ title, lineas, height })
    totalBlockHeight += height
  }
  if (blocks.length > 1) {
    totalBlockHeight += (blocks.length - 1) * blockGap
  }

  const shouldAnchorBottom = Boolean(options?.anchorToBottom)
  const bottomMarginMm = 16

  // Si se solicita dos columnas y hay al menos 2 bloques, dividimos en 2 columnas
  if (isTwoColumns && blocks.length >= 2) {
    const colGap = 8
    const colW = (maxW - colGap) / 2
    const col1X = left
    const col2X = left + colW + colGap

    // Balanceamos los bloques manteniendo el orden alfabético
    let bestSplit = Math.ceil(blocks.length / 2)
    let minDiff = Infinity
    let sumTotal = blocks.reduce((acc, b) => acc + b.height, 0)
    let runSum = 0
    for (let i = 0; i < blocks.length - 1; i++) {
      runSum += blocks[i].height
      const diff = Math.abs(runSum - (sumTotal - runSum))
      if (diff < minDiff) {
        minDiff = diff
        bestSplit = i + 1
      }
    }

    const col1Blocks = blocks.slice(0, bestSplit)
    const col2Blocks = blocks.slice(bestSplit)

    const col1H = col1Blocks.reduce((s, b, i) => s + b.height + (i > 0 ? blockGap : 0), 0)
    const col2H = col2Blocks.reduce((s, b, i) => s + b.height + (i > 0 ? blockGap : 0), 0)
    const maxColH = Math.max(col1H, col2H)

    // Solo pasamos a nueva página si el contenido no entra en la página actual desde startY
    let curY: number
    if (startY + maxColH > pageH - bottomMarginMm) {
      doc.addPage()
      curY = shouldAnchorBottom
        ? Math.max(20, pageH - bottomMarginMm - maxColH)
        : 20
    } else {
      curY = shouldAnchorBottom
        ? Math.max(startY, pageH - bottomMarginMm - maxColH)
        : startY
    }

    let col1Y = curY
    for (let i = 0; i < col1Blocks.length; i++) {
      const b = col1Blocks[i]!
      col1Y = drawSingleDoctorBlock(
        doc,
        b,
        col1X,
        col1Y,
        colW,
        lineHeightMm,
        titleFontSize,
        lineFontSize,
        bulletGap,
        isSmallFont,
      )
      if (i < col1Blocks.length - 1) col1Y += blockGap
    }

    let col2Y = curY
    for (let i = 0; i < col2Blocks.length; i++) {
      const b = col2Blocks[i]!
      col2Y = drawSingleDoctorBlock(
        doc,
        b,
        col2X,
        col2Y,
        colW,
        lineHeightMm,
        titleFontSize,
        lineFontSize,
        bulletGap,
        isSmallFont,
      )
      if (i < col2Blocks.length - 1) col2Y += blockGap
    }

    return Math.max(col1Y, col2Y)
  }

  // Columna única (1 médico o modo estándar)
  const drawW = isTwoColumns ? (maxW - 8) / 2 : maxW
  const totalH = blocks.reduce((s, b, i) => s + b.height + (i > 0 ? blockGap : 0), 0)

  let curY: number
  if (startY + totalH > pageH - bottomMarginMm) {
    doc.addPage()
    curY = shouldAnchorBottom
      ? Math.max(20, pageH - bottomMarginMm - totalH)
      : 20
  } else {
    curY = shouldAnchorBottom
      ? Math.max(startY, pageH - bottomMarginMm - totalH)
      : startY
  }

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const block = blocks[bIdx]!
    curY = drawSingleDoctorBlock(
      doc,
      block,
      left,
      curY,
      drawW,
      lineHeightMm,
      titleFontSize,
      lineFontSize,
      bulletGap,
      isSmallFont,
    )
    if (bIdx < blocks.length - 1) {
      curY += blockGap
    }
  }

  return curY
}

