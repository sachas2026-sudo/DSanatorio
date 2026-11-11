import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import type { ResumenMensualCalculado } from './pdfMensualCalculo'
import { formatMonto } from './formatMonto'
import { getPdfLogo } from './pdfLogo'

// ── Paleta de colores ────────────────────────────────────────────────────────
const COLOR_NAVY: [number, number, number] = [19, 41, 75] // #13294b
const COLOR_BLUE: [number, number, number] = [47, 111, 228] // #2f6fe4
const COLOR_TEAL: [number, number, number] = [31, 138, 138] // #1f8a8a
const COLOR_AMBER: [number, number, number] = [217, 119, 6] // #d97706
const COLOR_RED: [number, number, number] = [220, 38, 38] // #dc2626
const COLOR_TEXT_DARK: [number, number, number] = [30, 41, 59] // #1e293b
const COLOR_TEXT_MUTED: [number, number, number] = [100, 116, 139] // #64748b
const COLOR_BORDER: [number, number, number] = [226, 232, 240] // #e2e8f0
const COLOR_CARD_BG: [number, number, number] = [248, 250, 252] // #f8fafc

const PIE_COLORS: [number, number, number][] = [
  [47, 111, 228], // Azul
  [31, 138, 138], // Verde azulado / Teal
  [19, 41, 75], // Marino
  [217, 119, 6], // Ámbar
  [124, 58, 237], // Violeta
  [16, 185, 129], // Verde
  [148, 163, 184], // Gris ("Otras")
]

const PAGE_W = 297
const PAGE_H = 210
const MARGIN_X = 10
const CONTENT_W = PAGE_W - 2 * MARGIN_X // 277 mm

/**
 * Dibuja un sector de torta (pie slice) mediante triangulación desde el centro.
 */
function drawPieSlice(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  startAngleRad: number,
  endAngleRad: number,
  color: [number, number, number],
): void {
  doc.setFillColor(...color)
  const angleDiff = endAngleRad - startAngleRad
  if (angleDiff <= 0) return

  // Dividir el arco en pequeños segmentos angulares (aprox 2.5 grados)
  const step = 0.045
  let cur = startAngleRad

  while (cur < endAngleRad) {
    const next = Math.min(cur + step, endAngleRad)
    const x1 = cx + r * Math.cos(cur)
    const y1 = cy + r * Math.sin(cur)
    const x2 = cx + r * Math.cos(next)
    const y2 = cy + r * Math.sin(next)

    doc.triangle(cx, cy, x1, y1, x2, y2, 'F')
    cur = next
  }
}

/**
 * Dibuja el encabezado superior apaisado (A4 landscape) con logo Cuidar.
 */
function drawLandscapeHeader(
  doc: jsPDF,
  title: string,
  periodoTexto: string,
  badgeText?: string,
): number {
  const y = 8
  const h = 18

  // Tarjeta contenedora de cabecera
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN_X, y, CONTENT_W, h, 2.5, 2.5, 'FD')

  // Franja decorativa lateral izquierda
  doc.setFillColor(...COLOR_NAVY)
  doc.roundedRect(MARGIN_X, y, 3, h, 1.5, 1.5, 'F')

  // Logo Cuidar
  const logo = getPdfLogo()
  let textStartX = MARGIN_X + 6
  if (logo && logo.dataUrl) {
    try {
      const logoW = 12
      const logoH = 12 / (logo.aspect || 1)
      doc.addImage(logo.dataUrl, logo.format || 'JPEG', MARGIN_X + 6, y + (h - logoH) / 2, logoW, logoH)
      textStartX = MARGIN_X + 6 + logoW + 4
    } catch {
      textStartX = MARGIN_X + 6
    }
  }

  // Título
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...COLOR_NAVY)
  doc.text(title, textStartX, y + 7.5)

  // Subtítulo con período y médico
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...COLOR_TEXT_MUTED)
  doc.text(periodoTexto, textStartX, y + 13.5)

  // Badge derecho si existe
  if (badgeText) {
    const badgeW = 44
    const badgeH = 8
    const badgeX = MARGIN_X + CONTENT_W - badgeW - 5
    const badgeY = y + (h - badgeH) / 2
    doc.setFillColor(239, 246, 255)
    doc.setDrawColor(191, 219, 254)
    doc.setLineWidth(0.2)
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...COLOR_BLUE)
    doc.text(badgeText, badgeX + badgeW / 2, badgeY + 5.2, { align: 'center' })
  }

  return y + h + 4
}

/**
 * HOJA 1: DASHBOARD
 */
function renderDashboardPage(doc: jsPDF, data: ResumenMensualCalculado): void {
  const subtitle = `Período: ${data.periodo.desdeFormateada} al ${data.periodo.hastaFormateada} — Médico: ${data.periodo.medicoLabel}`
  let cursorY = drawLandscapeHeader(
    doc,
    'Centro Medico — Dashboard Cuidar',
    subtitle,
    `Mes: ${data.periodo.anioMes}`,
  )

  // ── 1. Seis pastillas superiores (KPIs) ──────────────────────────────────
  const kpiCount = 6
  const kpiGap = 3.5
  const kpiW = (CONTENT_W - (kpiCount - 1) * kpiGap) / kpiCount
  const kpiH = 19.5
  const kpisY = cursorY

  const kpis = [
    {
      titulo: 'Turnos del mes',
      valor: `${data.pastillas.cantidadTurnosMes}`,
      sub: `${data.pastillas.turnosManana} Mañ · ${data.pastillas.turnosTarde} Tarde`,
      colorVal: COLOR_NAVY,
      bg: [255, 255, 255] as [number, number, number],
    },
    {
      titulo: 'Total facturado',
      valor: formatMonto(data.pastillas.totalFacturado),
      sub: `${data.pastillas.cantidadPagosCobrados} cobros`,
      colorVal: COLOR_BLUE,
      bg: [239, 246, 255] as [number, number, number], // celeste muy suave
    },
    {
      titulo: 'Para el médico',
      valor: formatMonto(data.pastillas.paraElMedico),
      sub: `${data.pastillas.porcentajeMedico}% del facturado`,
      colorVal: COLOR_NAVY,
      bg: [255, 255, 255] as [number, number, number],
    },
    {
      titulo: 'Para Cuidar',
      valor: formatMonto(data.pastillas.paraCuidar),
      sub: `${data.pastillas.porcentajeCuidar}% del facturado`,
      colorVal: COLOR_TEAL,
      bg: [240, 253, 250] as [number, number, number], // verde suave
    },
    {
      titulo: 'Pendiente de cobro',
      valor: formatMonto(data.pastillas.pendienteCobroMonto),
      sub: `${data.pastillas.pendienteCobroCantidad} turnos sin pagar`,
      colorVal: COLOR_AMBER,
      bg: [254, 252, 232] as [number, number, number], // ámbar suave
    },
    {
      titulo: 'Ticket promedio',
      valor: formatMonto(data.pastillas.ticketPromedio),
      sub: 'Por pago cobrado',
      colorVal: COLOR_NAVY,
      bg: [255, 255, 255] as [number, number, number],
    },
  ]

  kpis.forEach((k, i) => {
    const kx = MARGIN_X + i * (kpiW + kpiGap)
    doc.setFillColor(...k.bg)
    doc.setDrawColor(...COLOR_BORDER)
    doc.setLineWidth(0.25)
    doc.roundedRect(kx, kpisY, kpiW, kpiH, 2, 2, 'FD')

    // Título de pastilla
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text(k.titulo, kx + 3.5, kpisY + 4.8)

    // Valor principal
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...k.colorVal)
    doc.text(k.valor, kx + 3.5, kpisY + 11.2)

    // Subtexto descriptivo
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text(k.sub, kx + 3.5, kpisY + 16.5)
  })

  cursorY = kpisY + kpiH + 4

  // ── 2. Fila de tres gráficos intermedios ──────────────────────────────────
  const chartsY = cursorY
  const chartsH = 82
  const colGap = 4
  const col1W = 86
  const col2W = 95
  const col3W = CONTENT_W - col1W - col2W - 2 * colGap // 88 mm

  // Contenedor Columna 1: Turnos por obra social
  const c1X = MARGIN_X
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.25)
  doc.roundedRect(c1X, chartsY, col1W, chartsH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Turnos por obra social', c1X + 4, chartsY + 6.5)

  // Dibujar Gráfico de Torta
  const pieCx = c1X + 24
  const pieCy = chartsY + 44
  const pieR = 19
  const totalTurnosOs = data.graficoObrasSociales.reduce((acc, g) => acc + g.cantidad, 0)

  if (totalTurnosOs > 0) {
    let curAngle = -Math.PI / 2 // Comienza arriba (12 en punto)
    data.graficoObrasSociales.forEach((g, idx) => {
      const sliceAngle = (g.cantidad / totalTurnosOs) * 2 * Math.PI
      const endAngle = curAngle + sliceAngle
      const color = PIE_COLORS[idx % PIE_COLORS.length]!
      drawPieSlice(doc, pieCx, pieCy, pieR, curAngle, endAngle, color)
      curAngle = endAngle
    })

    // Centro blanco tipo Donut para modernidad
    doc.setFillColor(255, 255, 255)
    doc.circle(pieCx, pieCy, pieR * 0.45, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...COLOR_NAVY)
    doc.text(`${totalTurnosOs}`, pieCx, pieCy + 1.5, { align: 'center' })
    doc.setFontSize(5)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text('turnos', pieCx, pieCy + 4.5, { align: 'center' })

    // Leyenda a la derecha de la torta
    const legX = c1X + 47
    let legY = chartsY + 16
    data.graficoObrasSociales.forEach((g, idx) => {
      const color = PIE_COLORS[idx % PIE_COLORS.length]!
      doc.setFillColor(...color)
      doc.circle(legX + 1.5, legY - 1, 1.3, 'F')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.8)
      doc.setTextColor(...COLOR_TEXT_DARK)
      const nombreTrunc = g.nombre.length > 10 ? g.nombre.slice(0, 9) + '…' : g.nombre
      doc.text(nombreTrunc, legX + 4.5, legY)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.2)
      doc.setTextColor(...COLOR_TEXT_MUTED)
      doc.text(`${g.cantidad} · ${g.porcentaje}%`, legX + 4.5, legY + 3.5)

      legY += 8.2
    })
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text('Sin turnos en el período', c1X + col1W / 2, chartsY + chartsH / 2, { align: 'center' })
  }

  // Contenedor Columna 2: Facturado por médico (barras horizontales apiladas)
  const c2X = c1X + col1W + colGap
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.25)
  doc.roundedRect(c2X, chartsY, col2W, chartsH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Facturado por médico', c2X + 4, chartsY + 6.5)

  // Mini leyenda Médico vs Cuidar
  const legMedX = c2X + col2W - 38
  doc.setFillColor(...COLOR_BLUE)
  doc.circle(legMedX, chartsY + 5.5, 1.2, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5.8)
  doc.setTextColor(...COLOR_TEXT_MUTED)
  doc.text('Médico', legMedX + 2.5, chartsY + 6.3)

  doc.setFillColor(...COLOR_TEAL)
  doc.circle(legMedX + 18, chartsY + 5.5, 1.2, 'F')
  doc.text('Cuidar', legMedX + 20.5, chartsY + 6.3)

  if (data.graficoMedicos.length > 0) {
    const maxFact = Math.max(...data.graficoMedicos.map((m) => m.facturadoTotal), 1)
    const barMaxW = 42
    let docRowY = chartsY + 16

    data.graficoMedicos.forEach((m) => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.8)
      doc.setTextColor(...COLOR_TEXT_DARK)
      const docLabel = m.medicoNombre.length > 18 ? m.medicoNombre.slice(0, 17) + '…' : m.medicoNombre
      doc.text(docLabel, c2X + 4, docRowY + 3.2)

      const barX = c2X + 32
      const barH = 4.2
      const totalBarW = (m.facturadoTotal / maxFact) * barMaxW
      const medBarW = (m.montoMedico / m.facturadoTotal) * totalBarW
      const cuidBarW = totalBarW - medBarW

      // Barra Médico (Azul)
      if (medBarW > 0) {
        doc.setFillColor(...COLOR_BLUE)
        doc.rect(barX, docRowY, medBarW, barH, 'F')
      }
      // Barra Cuidar (Teal)
      if (cuidBarW > 0) {
        doc.setFillColor(...COLOR_TEAL)
        doc.rect(barX + medBarW, docRowY, cuidBarW, barH, 'F')
      }

      // Monto total a la derecha
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...COLOR_NAVY)
      doc.text(formatMonto(m.facturadoTotal), c2X + col2W - 3, docRowY + 3.2, { align: 'right' })

      docRowY += 10.5
    })
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text('Sin facturación en el período', c2X + col2W / 2, chartsY + chartsH / 2, { align: 'center' })
  }

  // Contenedor Columna 3: Facturado por día (columnas por día)
  const c3X = c2X + col2W + colGap
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.25)
  doc.roundedRect(c3X, chartsY, col3W, chartsH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Facturado por día', c3X + 4, chartsY + 6.5)

  const dias = data.graficoDias
  const maxFactDia = Math.max(...dias.map((d) => d.facturado), 1)
  const chartAreaX = c3X + 6
  const chartAreaW = col3W - 12
  const chartBaseY = chartsY + 68
  const chartMaxH = 46
  const colW = chartAreaW / dias.length

  // Línea base del eje X
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.3)
  doc.line(chartAreaX, chartBaseY, chartAreaX + chartAreaW, chartBaseY)

  dias.forEach((d, idx) => {
    const barHeight = d.facturado > 0 ? Math.max((d.facturado / maxFactDia) * chartMaxH, 1.2) : 0
    const bx = chartAreaX + idx * colW + 0.3
    const actualW = Math.max(colW - 0.6, 0.8)

    if (barHeight > 0) {
      doc.setFillColor(...COLOR_BLUE)
      doc.rect(bx, chartBaseY - barHeight, actualW, barHeight, 'F')

      // Valor encima de los picos más altos (> 65% del máximo)
      if (d.facturado >= maxFactDia * 0.65 && actualW >= 1.5) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(4.8)
        doc.setTextColor(...COLOR_NAVY)
        const valorK = Math.round(d.facturado / 1000)
        doc.text(`${valorK}k`, bx + actualW / 2, chartBaseY - barHeight - 1, { align: 'center' })
      }
    }

    // Etiquetas del eje X: días 1, 5, 10, 15, 20, 25, 30
    if (d.dia === 1 || d.dia % 5 === 0 || d.dia === dias.length) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(...COLOR_TEXT_MUTED)
      doc.text(`${d.dia}`, bx + actualW / 2, chartBaseY + 3.8, { align: 'center' })
    }
  })

  cursorY = chartsY + chartsH + 4

  // ── 3. Fila de 4 pastillas inferiores ────────────────────────────────────
  const btmY = cursorY
  const btmH = 50
  const btmGap = 3.5
  const btmW = (CONTENT_W - 3 * btmGap) / 4

  // Pastilla B1: Estado de pagos
  const b1X = MARGIN_X
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.25)
  doc.roundedRect(b1X, btmY, btmW, btmH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Estado de pagos', b1X + 4, btmY + 5.5)

  const itemsEstado = [
    { label: 'Cobrados', cant: data.estadoPagos.cobradosCantidad, monto: data.estadoPagos.cobradosMonto, color: COLOR_BLUE },
    { label: 'Pendientes', cant: data.estadoPagos.pendientesCantidad, monto: data.estadoPagos.pendientesMonto, color: COLOR_AMBER },
    { label: 'Sin cargo ($0)', cant: data.estadoPagos.sinCargoCantidad, monto: 0, color: COLOR_TEXT_MUTED },
    { label: 'Ausentes / Cancelados', cant: data.estadoPagos.ausentesCantidad, monto: 0, color: COLOR_RED },
  ]

  let eY = btmY + 12
  itemsEstado.forEach((item) => {
    doc.setFillColor(...item.color)
    doc.circle(b1X + 4.5, eY - 1, 1.2, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    doc.setTextColor(...COLOR_TEXT_DARK)
    doc.text(item.label, b1X + 7.5, eY)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.8)
    doc.setTextColor(...item.color)
    const cantText = `${item.cant}`
    doc.text(cantText, b1X + btmW - 25, eY, { align: 'right' })

    if (item.monto > 0) {
      doc.text(formatMonto(item.monto), b1X + btmW - 3, eY, { align: 'right' })
    } else {
      doc.setTextColor(...COLOR_TEXT_MUTED)
      doc.text('—', b1X + btmW - 3, eY, { align: 'right' })
    }

    eY += 9
  })

  // Pastilla B2: Método de cobro
  const b2X = b1X + btmW + btmGap
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.25)
  doc.roundedRect(b2X, btmY, btmW, btmH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Método de cobro', b2X + 4, btmY + 5.5)

  if (data.metodosDesglose.length > 0) {
    let mY = btmY + 12
    const top4Metodos = data.metodosDesglose.slice(0, 4)
    top4Metodos.forEach((m) => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.8)
      doc.setTextColor(...COLOR_TEXT_DARK)
      doc.text(m.metodo, b2X + 4, mY)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.2)
      doc.setTextColor(...COLOR_TEXT_MUTED)
      doc.text(`${m.porcentaje}%`, b2X + btmW - 24, mY, { align: 'right' })

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.8)
      doc.setTextColor(...COLOR_NAVY)
      doc.text(formatMonto(m.monto), b2X + btmW - 3, mY, { align: 'right' })

      // Mini barra
      const barY = mY + 1.8
      const maxMetW = btmW - 8
      doc.setFillColor(241, 245, 249)
      doc.rect(b2X + 4, barY, maxMetW, 2.2, 'F')
      const filledW = (m.porcentaje / 100) * maxMetW
      doc.setFillColor(...COLOR_BLUE)
      doc.rect(b2X + 4, barY, Math.max(filledW, 0.5), 2.2, 'F')

      mY += 9
    })
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text('Sin cobros en el período', b2X + btmW / 2, btmY + btmH / 2, { align: 'center' })
  }

  // Pastilla B3: Mañana vs. Tarde
  const b3X = b2X + btmW + btmGap
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.25)
  doc.roundedRect(b3X, btmY, btmW, btmH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Mañana vs. Tarde', b3X + 4, btmY + 5.5)

  const totTurnosVal = data.pastillas.cantidadTurnosMes || 1
  const pctMan = Math.round((data.mananaVsTarde.turnosManana / totTurnosVal) * 100)
  const pctTar = Math.round((data.mananaVsTarde.turnosTarde / totTurnosVal) * 100)

  // Bloque Turno Mañana
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Turno Mañana', b3X + 4, btmY + 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...COLOR_TEXT_MUTED)
  doc.text(`${data.mananaVsTarde.turnosManana} turnos (${pctMan}%)`, b3X + 4, btmY + 17.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLOR_BLUE)
  doc.text(formatMonto(data.mananaVsTarde.facturadoManana), b3X + btmW - 3, btmY + 17.5, { align: 'right' })

  // Barra comparativa mañana
  doc.setFillColor(241, 245, 249)
  doc.rect(b3X + 4, btmY + 19.5, btmW - 8, 2.5, 'F')
  doc.setFillColor(...COLOR_BLUE)
  doc.rect(b3X + 4, btmY + 19.5, Math.max(((pctMan / 100) * (btmW - 8)), 0.5), 2.5, 'F')

  // Bloque Turno Tarde
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Turno Tarde', b3X + 4, btmY + 29)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...COLOR_TEXT_MUTED)
  doc.text(`${data.mananaVsTarde.turnosTarde} turnos (${pctTar}%)`, b3X + 4, btmY + 33.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLOR_TEAL)
  doc.text(formatMonto(data.mananaVsTarde.facturadoTarde), b3X + btmW - 3, btmY + 33.5, { align: 'right' })

  // Barra comparativa tarde
  doc.setFillColor(241, 245, 249)
  doc.rect(b3X + 4, btmY + 35.5, btmW - 8, 2.5, 'F')
  doc.setFillColor(...COLOR_TEAL)
  doc.rect(b3X + 4, btmY + 35.5, Math.max(((pctTar / 100) * (btmW - 8)), 0.5), 2.5, 'F')

  // Pastilla B4: Otros indicadores
  const b4X = b3X + btmW + btmGap
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.25)
  doc.roundedRect(b4X, btmY, btmW, btmH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Otros indicadores', b4X + 4, btmY + 5.5)

  const otros = [
    { label: 'Tasa de cobro', val: `${data.otrosIndicadores.tasaCobroPorcentaje}%`, color: COLOR_BLUE },
    { label: 'Turnos fuera de grilla', val: `${data.otrosIndicadores.turnosFueraGrilla}`, color: COLOR_TEXT_DARK },
    { label: 'Pacientes nuevos del mes', val: `${data.otrosIndicadores.pacientesNuevosMes}`, color: COLOR_TEXT_DARK },
    { label: 'Ausentes / Cancelados', val: `${data.otrosIndicadores.ausentesCantidad}`, color: COLOR_RED },
    { label: 'Plus cobrados', val: `${data.otrosIndicadores.plusCobradosCantidad}`, color: COLOR_TEAL },
  ]

  let oY = btmY + 12
  otros.forEach((item) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text(item.label, b4X + 4, oY)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.8)
    doc.setTextColor(...item.color)
    doc.text(item.val, b4X + btmW - 4, oY, { align: 'right' })

    oY += 7.2
  })
}

/**
 * HOJA 2 EN ADELANTE: RESUMEN CUIDAR + TURNOS SIN PAGAR + RESUMEN DE PAGOS
 */
function renderResumenPages(doc: jsPDF, data: ResumenMensualCalculado): void {
  doc.addPage('a4', 'landscape')

  const subtitle = `Período: ${data.periodo.desdeFormateada} al ${data.periodo.hastaFormateada} — Médico: ${data.periodo.medicoLabel}`
  let cursorY = drawLandscapeHeader(
    doc,
    'Centro Medico - Gestión Resumen Cuidar',
    subtitle,
    `Mes: ${data.periodo.anioMes}`,
  )

  // ── 1. Tabla Principal: Resumen Cuidar ───────────────────────────────────
  const headStyle = {
    fillColor: COLOR_NAVY,
    textColor: [255, 255, 255] as [number, number, number],
    fontStyle: 'bold' as const,
    fontSize: 7.5,
    minCellHeight: 6,
    halign: 'left' as const,
    valign: 'middle' as const,
  }

  const footStyle = {
    fillColor: [240, 245, 252] as [number, number, number],
    textColor: COLOR_NAVY,
    fontStyle: 'bold' as const,
    fontSize: 8,
    minCellHeight: 6.5,
    valign: 'middle' as const,
  }

  const bodyRows = data.tablaResumenCuidar.map((r) => [
    r.fechaFormateada,
    r.turno,
    r.cantPagos.toString(),
    r.porcentajeLabel,
    formatMonto(r.totalFacturado),
    formatMonto(r.totalTransferencias),
    formatMonto(r.totalMedico),
    formatMonto(r.montoCuidar),
  ])

  autoTable(doc, {
    startY: cursorY,
    pageBreak: 'auto',
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    head: [
      [
        'Fecha',
        'Turno',
        'Cant. Pagos',
        '% Cuidar',
        'Total Facturado',
        'Total Transferencias',
        'Total Médico',
        'Monto Cuidar',
      ],
    ],
    body: bodyRows,
    foot: [
      [
        { content: 'TOTALES', styles: { halign: 'left' } },
        { content: '', styles: { halign: 'center' } },
        { content: data.totalesResumenCuidar.cantPagos.toString(), styles: { halign: 'center' } },
        { content: data.totalesResumenCuidar.porcentajeLabel, styles: { halign: 'center' } },
        {
          content: formatMonto(data.totalesResumenCuidar.totalFacturado),
          styles: { halign: 'right', fontStyle: 'bold', textColor: COLOR_BLUE },
        },
        { content: formatMonto(data.totalesResumenCuidar.totalTransferencias), styles: { halign: 'right' } },
        { content: formatMonto(data.totalesResumenCuidar.totalMedico), styles: { halign: 'right' } },
        { content: formatMonto(data.totalesResumenCuidar.montoCuidar), styles: { halign: 'right' } },
      ],
    ],
    theme: 'grid',
    tableWidth: CONTENT_W,
    margin: { left: MARGIN_X, right: MARGIN_X, top: 12, bottom: 12 },
    styles: {
      fontSize: 7.2,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2.2, right: 2.2 },
      lineColor: COLOR_BORDER,
      lineWidth: 0.15,
      textColor: COLOR_TEXT_DARK,
    },
    headStyles: headStyle,
    footStyles: footStyle,
    alternateRowStyles: {
      fillColor: COLOR_CARD_BG,
    },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' }, // Fecha
      1: { cellWidth: 22, halign: 'center' }, // Turno
      2: { cellWidth: 22, halign: 'center' }, // Cant. Pagos
      3: { cellWidth: 22, halign: 'center' }, // % Cuidar
      4: { cellWidth: 46, halign: 'right', fontStyle: 'bold' }, // Total Facturado
      5: { cellWidth: 46, halign: 'right' }, // Total Transferencias
      6: { cellWidth: 46, halign: 'right' }, // Total Médico
      7: { cellWidth: 47, halign: 'right' }, // Monto Cuidar
    },
    didParseCell: (hookData) => {
      // En el pie, forzar alineación y estilizar Total Facturado en azul y negrita
      if (hookData.section === 'foot') {
        if (hookData.column.index >= 4) {
          hookData.cell.styles.halign = 'right'
        } else if (hookData.column.index === 2 || hookData.column.index === 3) {
          hookData.cell.styles.halign = 'center'
        }
        if (hookData.column.index === 4) {
          hookData.cell.styles.textColor = COLOR_BLUE
          hookData.cell.styles.fontStyle = 'bold'
        }
      }
    },
  })

  // Obtener la posición final de la tabla
  cursorY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY
  cursorY += 8

  // ── 2. Tabla de Turnos sin pagar ─────────────────────────────────────────
  if (data.turnosSinPagar.length > 0) {
    // Si queda poco espacio vertical (< 40mm), agregar página antes de arrancar los turnos sin pagar
    if (cursorY + 40 > PAGE_H - 15) {
      doc.addPage('a4', 'landscape')
      cursorY = drawLandscapeHeader(
        doc,
        'Centro Medico - Gestión Resumen Cuidar',
        subtitle,
        `Mes: ${data.periodo.anioMes}`,
      )
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...COLOR_NAVY)
    doc.text(`Turnos sin pagar (${data.turnosSinPagar.length})`, MARGIN_X, cursorY)
    cursorY += 3.5

    const pendientesBody = data.turnosSinPagar.map((t) => [
      t.fechaFormateada,
      t.turno,
      t.paciente,
      t.medico,
      t.obraSocial,
      formatMonto(t.montoAdeudado),
      'Pendiente',
    ])

    autoTable(doc, {
      startY: cursorY,
      pageBreak: 'auto',
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
      head: [
        [
          'Fecha',
          'Turno',
          'Paciente',
          'Médico',
          'Obra social',
          'Monto adeudado',
          'Estado',
        ],
      ],
      body: pendientesBody,
      foot: [
        [
          { content: `TOTALES · ${data.turnosSinPagar.length} turnos`, styles: { halign: 'left' } },
          '',
          '',
          '',
          '',
          {
            content: formatMonto(data.totalTurnosSinPagar.montoTotal),
            styles: { halign: 'right', fontStyle: 'bold', textColor: COLOR_BLUE },
          },
          '',
        ],
      ],
      theme: 'grid',
      tableWidth: CONTENT_W,
      margin: { left: MARGIN_X, right: MARGIN_X, top: 12, bottom: 12 },
      styles: {
        fontSize: 7.2,
        cellPadding: { top: 1.6, bottom: 1.6, left: 2.2, right: 2.2 },
        lineColor: COLOR_BORDER,
        lineWidth: 0.15,
        textColor: COLOR_TEXT_DARK,
      },
      headStyles: headStyle,
      footStyles: footStyle,
      alternateRowStyles: {
        fillColor: COLOR_CARD_BG,
      },
      columnStyles: {
        0: { cellWidth: 32, halign: 'center' }, // Fecha
        1: { cellWidth: 22, halign: 'center' }, // Turno
        2: { cellWidth: 55 }, // Paciente
        3: { cellWidth: 55 }, // Médico
        4: { cellWidth: 46 }, // Obra social
        5: { cellWidth: 40, halign: 'right', fontStyle: 'bold' }, // Monto adeudado
        6: { cellWidth: 27, halign: 'center', fontStyle: 'bold' }, // Estado
      },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.column.index === 6) {
          hookData.cell.styles.textColor = COLOR_RED
          hookData.cell.styles.fontStyle = 'bold'
        }
        if (hookData.section === 'foot') {
          if (hookData.column.index === 5) {
            hookData.cell.styles.halign = 'right'
            hookData.cell.styles.textColor = COLOR_BLUE
            hookData.cell.styles.fontStyle = 'bold'
          }
        }
      },
    })

    cursorY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY
    cursorY += 8
  }

  // ── 3. Pastilla final: Resumen de pagos ───────────────────────────────────
  const resumeBoxH = 46
  // Si no entra completa en la página vigente, pasar a la siguiente hoja sin cortarse
  if (cursorY + resumeBoxH > PAGE_H - 12) {
    doc.addPage('a4', 'landscape')
    cursorY = drawLandscapeHeader(
      doc,
      'Centro Medico - Gestión Resumen Cuidar',
      subtitle,
      `Mes: ${data.periodo.anioMes}`,
    )
  }

  const boxY = cursorY
  doc.setFillColor(...COLOR_CARD_BG)
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.3)
  doc.roundedRect(MARGIN_X, boxY, CONTENT_W, resumeBoxH, 2.5, 2.5, 'FD')

  // Título del bloque
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Resumen de pagos', MARGIN_X + 4.5, boxY + 6.5)

  // Separadores verticales
  const cA_W = 100
  const cB_W = 86
  const cC_W = CONTENT_W - cA_W - cB_W // 91 mm

  const sep1X = MARGIN_X + cA_W
  const sep2X = sep1X + cB_W
  doc.setDrawColor(...COLOR_BORDER)
  doc.setLineWidth(0.2)
  doc.line(sep1X, boxY + 3, sep1X, boxY + resumeBoxH - 3)
  doc.line(sep2X, boxY + 3, sep2X, boxY + resumeBoxH - 3)

  // Subcolumna A (Izquierda): Tabla por método
  const miniHeadY = boxY + 11.5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...COLOR_TEXT_MUTED)
  doc.text('MÉTODO', MARGIN_X + 5, miniHeadY)
  doc.text('CANT.', MARGIN_X + 45, miniHeadY, { align: 'right' })
  doc.text('MONTO', MARGIN_X + 76, miniHeadY, { align: 'right' })
  doc.text('%', MARGIN_X + 94, miniHeadY, { align: 'right' })

  doc.setDrawColor(...COLOR_BORDER)
  doc.line(MARGIN_X + 4, miniHeadY + 2, sep1X - 4, miniHeadY + 2)

  let miniRowY = miniHeadY + 6
  const metRows = data.resumenMetodos.filas.slice(0, 3)
  metRows.forEach((m) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    doc.setTextColor(...COLOR_TEXT_DARK)
    doc.text(m.metodo, MARGIN_X + 5, miniRowY)
    doc.text(`${m.cantidad}`, MARGIN_X + 45, miniRowY, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(formatMonto(m.monto), MARGIN_X + 76, miniRowY, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text(`${m.porcentaje}%`, MARGIN_X + 94, miniRowY, { align: 'right' })
    miniRowY += 5.5
  })

  // Fila Total del desglose
  doc.setDrawColor(...COLOR_BORDER)
  doc.line(MARGIN_X + 4, boxY + resumeBoxH - 9, sep1X - 4, boxY + resumeBoxH - 9)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Total', MARGIN_X + 5, boxY + resumeBoxH - 4.5)
  doc.text(`${data.resumenMetodos.totalCantidad}`, MARGIN_X + 45, boxY + resumeBoxH - 4.5, { align: 'right' })
  doc.text(formatMonto(data.resumenMetodos.totalMonto), MARGIN_X + 76, boxY + resumeBoxH - 4.5, { align: 'right' })
  doc.text('100%', MARGIN_X + 94, boxY + resumeBoxH - 4.5, { align: 'right' })

  // Subcolumna B (Centro): Indicadores clave
  const indX = sep1X + 6
  let indY = boxY + 12

  const indicadoresB = [
    { label: 'Cobrados', val: formatMonto(data.resumenMetodos.cobradosMonto), color: COLOR_BLUE },
    { label: 'Sin pagar', val: formatMonto(data.resumenMetodos.sinPagarMonto), color: COLOR_AMBER },
    { label: 'Tasa de cobro', val: `${data.resumenMetodos.tasaCobroPorcentaje}%`, color: COLOR_NAVY },
  ]

  indicadoresB.forEach((it) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text(it.label, indX, indY)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...it.color)
    doc.text(it.val, indX, indY + 5)

    indY += 10.5
  })

  // Subcolumna C (Derecha): Gráfico de barras "Cobrado por método"
  const cC_X = sep2X + 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('Cobrado por método', cC_X, boxY + 8.5)

  if (data.resumenMetodos.filas.length > 0) {
    const maxMetMonto = Math.max(...data.resumenMetodos.filas.map((m) => m.monto), 1)
    const mBarBaseY = boxY + 38
    const mBarMaxH = 22
    const mCols = data.resumenMetodos.filas.slice(0, 4)
    const mColW = 16
    const mColGap = 5

    mCols.forEach((m, idx) => {
      const bx = cC_X + idx * (mColW + mColGap)
      const bH = Math.max((m.monto / maxMetMonto) * mBarMaxH, 1.5)

      doc.setFillColor(...COLOR_BLUE)
      doc.rect(bx, mBarBaseY - bH, mColW, bH, 'F')

      // Monto abreviado encima
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(5.5)
      doc.setTextColor(...COLOR_NAVY)
      const kVal = `${Math.round(m.monto / 1000)}k`
      doc.text(kVal, bx + mColW / 2, mBarBaseY - bH - 1, { align: 'center' })

      // Nombre del método debajo
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(...COLOR_TEXT_MUTED)
      const labelShort = m.metodo.length > 7 ? m.metodo.slice(0, 6) + '…' : m.metodo
      doc.text(labelShort, bx + mColW / 2, mBarBaseY + 3.5, { align: 'center' })
    })
  }
}

/**
 * Agrega el pie de página numerado: "Generado el dd-mm-aaaa · Página x de y"
 */
function stampPageFooter(doc: jsPDF): void {
  const totalPages = doc.getNumberOfPages()
  const fechaHoy = format(new Date(), 'dd-MM-yyyy')

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    const footerText = `Generado el ${fechaHoy} · Página ${p} de ${totalPages}`
    doc.text(footerText, PAGE_W / 2, PAGE_H - 4.5, { align: 'center' })
  }
}

/**
 * Función principal generadora del PDF Mensual (Dashboard + Resumen).
 */
export function buildPdfMensual(data: ResumenMensualCalculado): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // 1. Hoja 1: Dashboard
  renderDashboardPage(doc, data)

  // 2. Hoja 2 en adelante: Resumen
  renderResumenPages(doc, data)

  // 3. Pie en todas las hojas
  stampPageFooter(doc)

  // Nombre de archivo según filtro de médico
  const slugMedico = data.periodo.medicoFiltro
    ? ` - ${data.periodo.medicoFiltro.apellido}, ${data.periodo.medicoFiltro.nombre}`
    : ''
  const filename = `PDF Mensual A ${data.periodo.anioMes}${slugMedico}.pdf`

  return { doc, filename }
}
