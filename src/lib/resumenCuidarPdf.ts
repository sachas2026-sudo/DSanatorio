import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format, parseISO } from 'date-fns'
import {
  drawPdfHeader,
  pdfBodyStartYAfterHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
} from './pdfHeader'
import {
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
} from './pagosPdfLayout'
import { formatMonto } from './formatMonto'
import { appendDoctorDebtSummaryPage, type DoctorDebtPdfRow } from './doctorDebtPdfTable'

export type ResumenCuidarPdfRow = {
  day: string
  turno: string
  cantidad: number
  facturado: number
  transferencias: number
  medico: number
  cuidar: number
}

/** Una fila del tablero de cobranzas agrupado por obra social. */
export type ObraSocialDashboardPdfRow = {
  obraSocial: string
  cantidad: number
  facturado: number
  cuidar: number
  medico: number
}

export type ObraSocialListadoPdfRow = {
  fecha: string
  turno: string
  paciente: string
  medico: string
  obraSocial: string
  motivoConsulta: string
  totalOS: string
  totalCuidar: string
}

function formatPorcentaje(cuidar: number, facturado: number): string {
  if (facturado <= 0) return '—'
  const pct = Math.round((cuidar / facturado) * 1000) / 10
  return `${pct % 1 === 0 ? pct : pct.toFixed(1)}%`
}

/**
 * Tablero ejecutivo para el botón «PDF Obra Social» de Pagos.
 * Es intencionalmente distinto del Resumen Cuidar diario: agrupa por cobertura.
 */
export function buildObraSocialDashboardLegacyPdf(
  desde: string,
  hasta: string,
  filterLabel: string,
  rows: ObraSocialDashboardPdfRow[],
  footerLabel?: string,
  turnoLabel?: string,
): { doc: jsPDF; filename: string; title: string } {
  // Formato panorámico: replica el tablero compacto del modelo de referencia.
  const doc = new jsPDF({ format: [297, 91], orientation: 'landscape', unit: 'mm' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 4
  const periodText =
    desde === hasta
      ? format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')
      : `${format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')} al ${format(parseISO(`${hasta}T12:00:00`), 'dd-MM-yyyy')}`
  const turnoPart = turnoLabel ? ` — Turno: ${turnoLabel}` : ''
  const orderedRows = [...rows].sort((a, b) => b.facturado - a.facturado)
  const totalFacturado = orderedRows.reduce((sum, row) => sum + row.facturado, 0)
  const totalTurnos = orderedRows.reduce((sum, row) => sum + row.cantidad, 0)
  const totalCuidar = orderedRows.reduce((sum, row) => sum + row.cuidar, 0)
  const maxFacturado = Math.max(...orderedRows.map((row) => row.facturado), 1)

  doc.setDrawColor(137, 190, 246)
  doc.setLineWidth(0.35)
  doc.roundedRect(1, 1, pageW - 2, pageH - 2, 2, 2, 'S')

  // Cabecera horizontal ligera, sin el cartel "MODELO 3".
  doc.setFillColor(239, 248, 255)
  doc.roundedRect(margin, 4, pageW - margin * 2, 14, 1.8, 1.8, 'F')
  doc.setFillColor(28, 102, 190)
  doc.circle(margin + 7, 11, 4.3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(255, 255, 255)
  doc.text('+', margin + 7, 12.7, { align: 'center' })
  doc.setTextColor(15, 58, 111)
  doc.setFontSize(5.5)
  doc.text('Centro Médico', margin + 16, 9.4)
  doc.setFontSize(3.8)
  doc.setFont('helvetica', 'normal')
  doc.text('Gestión Obras Sociales', margin + 16, 13)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(5.5)
  doc.text('Resumen por Obra Social', pageW - margin - 4, 9.4, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(3.6)
  doc.text(`Período: ${periodText}${turnoPart}`, pageW - margin - 4, 12.5, { align: 'right' })
  doc.text(`Filtro: ${filterLabel}`, pageW - margin - 4, 15.3, { align: 'right' })

  const cardsY = 21
  const gap = 3
  const cardW = (pageW - margin * 2 - gap * 2) / 3
  const drawCompactMetric = (x: number, label: string, value: string, symbol: string) => {
    doc.setDrawColor(202, 222, 247)
    doc.setFillColor(252, 254, 255)
    doc.roundedRect(x, cardsY, cardW, 11, 1.7, 1.7, 'FD')
    doc.setFillColor(225, 241, 255)
    doc.circle(x + 6, cardsY + 5.5, 2.8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(3.8)
    doc.setTextColor(22, 99, 185)
    doc.text(symbol, x + 6, cardsY + 6.8, { align: 'center' })
    doc.setFontSize(3.8)
    doc.setTextColor(49, 92, 142)
    doc.text(label, x + 12, cardsY + 4.2)
    doc.setFontSize(6)
    doc.setTextColor(12, 50, 96)
    doc.text(value, x + 12, cardsY + 8.5)
  }
  drawCompactMetric(margin, 'Total Obras Sociales', String(orderedRows.length), 'OS')
  drawCompactMetric(margin + cardW + gap, 'Total Turnos', String(totalTurnos), '#')
  drawCompactMetric(margin + (cardW + gap) * 2, 'Total Facturado', formatMonto(totalFacturado), '$')

  const panelY = 36
  const panelH = 48
  const leftW = 188
  const rightX = margin + leftW + 3
  const rightW = pageW - margin - rightX
  doc.setDrawColor(202, 222, 247)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(margin, panelY, leftW, panelH, 2.2, 2.2, 'FD')
  doc.roundedRect(rightX, panelY, rightW, panelH, 2.2, 2.2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(5)
  doc.setTextColor(11, 58, 111)
  doc.text('▥  Obras Sociales', margin + 6, panelY + 6.3)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(3.7)
  doc.text('(por facturación)', margin + 31, panelY + 6.3)
  const headY = panelY + 10
  doc.setFillColor(231, 243, 255)
  doc.roundedRect(margin + 2, headY, leftW - 4, 6, 1.1, 1.1, 'F')
  const columns = [margin + 5, margin + 13, margin + 63, margin + 91, margin + 115, margin + leftW - 5]
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(3.3)
  doc.setTextColor(32, 79, 128)
  ;['#', 'Obra Social', 'Cant. Turnos', '% Cuidar', '', 'Total Facturado'].forEach((label, index) => {
    doc.text(label, columns[index], headY + 4, { align: index === 5 ? 'right' : 'left' })
  })

  const visibleRows = orderedRows.slice(0, 5)
  const rowH = 5.4
  visibleRows.forEach((row, index) => {
    const y = headY + 9 + index * rowH
    if (index % 2 === 0) {
      doc.setFillColor(249, 252, 255)
      doc.rect(margin + 2, y, leftW - 4, rowH, 'F')
    }
    doc.setDrawColor(223, 235, 248)
    doc.line(margin + 2, y + rowH, margin + leftW - 2, y + rowH)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(3.6)
    doc.setTextColor(21, 65, 113)
    doc.text(String(index + 1), columns[0], y + 3.5)
    doc.text(row.obraSocial, columns[1], y + 3.5, { maxWidth: 44 })
    doc.text(String(row.cantidad), columns[2], y + 3.5)
    doc.text(formatPorcentaje(row.cuidar, row.facturado), columns[3], y + 3.5)
    const barX = columns[4]
    const barW = 45
    doc.setFillColor(220, 234, 248)
    doc.roundedRect(barX, y + 1.4, barW, 2.1, 0.8, 0.8, 'F')
    doc.setFillColor(29, 120, 224)
    doc.roundedRect(barX, y + 1.4, Math.max(1, barW * (row.facturado / maxFacturado)), 2.1, 0.8, 0.8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.text(formatMonto(row.facturado), columns[5], y + 3.5, { align: 'right' })
  })
  const totalY = headY + 6 + Math.max(visibleRows.length, 1) * rowH + 1.5
  doc.setFillColor(226, 241, 255)
  doc.roundedRect(margin + 2, totalY, leftW - 4, 6, 1.1, 1.1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(3.8)
  doc.setTextColor(10, 53, 101)
  doc.text('TOTAL', margin + 7, totalY + 3.8)
  doc.text(String(totalTurnos), columns[2], totalY + 3.8)
  doc.text(formatMonto(totalFacturado), margin + leftW - 5, totalY + 3.8, { align: 'right' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(5)
  doc.text('▣  Comisión Cuidar', rightX + 6, panelY + 6.3)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(3.7)
  doc.text('Montos pendientes de cobro', rightX + 6, panelY + 10.2)
  doc.setDrawColor(210, 228, 246)
  doc.line(rightX + 4, panelY + 13, rightX + rightW - 4, panelY + 13)
  const commissionRows = orderedRows.filter((row) => row.cuidar > 0).slice(0, 5)
  if (commissionRows.length === 0) {
    doc.setFontSize(3.8)
    doc.setTextColor(87, 117, 151)
    doc.text('No hay comisiones pendientes.', rightX + 6, panelY + 20)
  }
  commissionRows.forEach((row, index) => {
    const y = panelY + 16 + index * 5.8
    doc.setDrawColor(226, 237, 249)
    doc.line(rightX + 4, y + 8.5, rightX + rightW - 4, y + 8.5)
    doc.setFillColor(31, 120, 218)
    doc.circle(rightX + 8, y + 2.5, 2.3, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(3.5)
    doc.setTextColor(255, 255, 255)
    doc.text('$', rightX + 8, y + 3.7, { align: 'center' })
    doc.setFontSize(3.8)
    doc.setTextColor(18, 62, 111)
    doc.text(row.obraSocial, rightX + 13, y + 3.7, { maxWidth: rightW - 37 })
    doc.text(formatMonto(row.cuidar), rightX + rightW - 7, y + 3.7, { align: 'right' })
  })
  const pendingY = panelY + panelH - 8
  doc.setFillColor(226, 241, 255)
  doc.roundedRect(rightX + 4, pendingY, rightW - 8, 5.5, 1.1, 1.1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(3.8)
  doc.setTextColor(12, 53, 101)
  doc.text('Total pendiente', rightX + 8, pendingY + 3.6)
  doc.setFontSize(4.8)
  doc.text(formatMonto(totalCuidar), rightX + rightW - 8, pendingY + 3.6, { align: 'right' })

  stampPdfGeneratedFooterOnAllPages(doc, footerLabel ? { label: footerLabel } : undefined)
  const filename = `resumen-obra-social-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`
  return { doc, filename, title: 'Resumen Obra Social' }
}

/** PDF de Obras Sociales con la misma lectura tabular del PDF Cuidar. */
export function buildObraSocialDashboardPdf(
  desde: string,
  hasta: string,
  filterLabel: string,
  rows: ObraSocialDashboardPdfRow[],
  footerLabel?: string,
  turnoLabel?: string,
  /** Todo el export por transferencia => "Monto Cuidar" en negativo. */
  todosTransferencia?: boolean,
): { doc: jsPDF; filename: string; title: string } {
  const doc = new jsPDF({ format: 'a4', orientation: 'landscape', unit: 'mm' })
  const pageW = doc.internal.pageSize.getWidth()
  const periodText =
    desde === hasta
      ? format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')
      : `${format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')} al ${format(parseISO(`${hasta}T12:00:00`), 'dd-MM-yyyy')}`
  const turnoText = turnoLabel ? ` - Turno: ${turnoLabel}` : ''
  const title = 'Obras Sociales'
  // Invierte el signo de "Monto Cuidar" cuando todo entró por transferencia.
  const signoCuidar = todosTransferencia ? -1 : 1
    const headerBottom = drawPdfHeader(doc, pageW, title, {
      secondLine: `Período: ${periodText}${turnoText}`,
      fontSize: 18,
    })
  const margin = 12
  let y = pdfBodyStartYAfterHeader(headerBottom, 2)

  const orderedRows = [...rows].sort((a, b) => b.facturado - a.facturado)
  const totals = orderedRows.reduce(
    (acc, row) => ({
      cantidad: acc.cantidad + row.cantidad,
      facturado: acc.facturado + row.facturado,
      medico: acc.medico + row.medico,
      cuidar: acc.cuidar + row.cuidar,
    }),
    { cantidad: 0, facturado: 0, medico: 0, cuidar: 0 },
  )

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[
      'Obra Social',
      'Cant.\nTurnos',
      '% Cuidar',
      'Total Facturado',
      'Total Médico',
      'Monto Cuidar',
    ]],
    body: [
      ...orderedRows.map((row) => [
        row.obraSocial,
        String(row.cantidad),
        formatPorcentaje(row.cuidar, row.facturado),
        formatMonto(row.facturado),
        formatMonto(row.medico),
        formatMonto(row.cuidar * signoCuidar),
      ]),
      [
        'TOTAL',
        String(totals.cantidad),
        formatPorcentaje(totals.cuidar, totals.facturado),
        formatMonto(totals.facturado),
        formatMonto(totals.medico),
        formatMonto(totals.cuidar * signoCuidar),
      ],
    ],
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 41, 66],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 8,
      cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 35, fontStyle: 'bold' },
      1: { cellWidth: 22, halign: 'center' },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 35, halign: 'right' },
      5: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === orderedRows.length) {
        data.cell.styles.fillColor = [226, 232, 240]
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = [15, 41, 66]
        data.cell.styles.lineColor = [180, 195, 215]
        data.cell.styles.lineWidth = 0.25
      }
    },
  })

  stampPdfGeneratedFooterOnAllPages(doc, footerLabel ? { label: footerLabel } : undefined)
  return {
    doc,
    filename: `resumen-obra-social-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`,
    title,
  }
}

export function buildObraSocialListadoPdf(
  desde: string,
  hasta: string,
  filterLabel: string,
  rows: ObraSocialListadoPdfRow[],
  footerLabel?: string,
  turnoLabel?: string,
  mode: 'obra-social' | 'motivos' = 'obra-social',
): { doc: jsPDF; filename: string; title: string } {
  const isMotivos = mode === 'motivos'
  const doc = new jsPDF({ format: 'a4', orientation: 'portrait', unit: 'mm' })
  const pageW = doc.internal.pageSize.getWidth()
  const periodText =
    desde === hasta
      ? format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')
      : `${format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')} al ${format(parseISO(`${hasta}T12:00:00`), 'dd-MM-yyyy')}`
  const turnoText = turnoLabel ? ` - Turno: ${turnoLabel}` : ''
  const filterText = filterLabel ? ` - Filtro: ${filterLabel}` : ''
  const title = isMotivos ? 'Listado Motivos de Consulta' : 'Listado Obras Sociales'
  const headerBottom = drawPdfHeader(doc, pageW, title, {
    secondLine: `Período: ${periodText}${turnoText}${filterText}`,
    fontSize: 18,
  })
  const margin = 10
  let y = pdfBodyStartYAfterHeader(headerBottom, 2)

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [[
      'Fecha',
      'Turno',
      'Paciente',
      'Médico',
      'Obra Social',
      'Motivo Consulta',
      'Total OS',
      'Total Cuidar',
    ]],
    body: [
      ...rows.map((row) => [
        row.fecha,
        row.turno,
        row.paciente,
        row.medico,
        row.obraSocial,
        row.motivoConsulta,
        row.totalOS,
        row.totalCuidar,
      ]),
      [
        'TOTALES',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    ],
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 6.8,
      cellPadding: { top: 1.2, bottom: 1.2, left: 1, right: 1 },
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 41, 66],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 6.8,
      cellPadding: { top: 1.8, bottom: 1.8, left: 1, right: 1 },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 13 },
      2: { cellWidth: 38 },
      3: { cellWidth: 38 },
      4: { cellWidth: 18 },
      5: { cellWidth: 23 },
      6: { cellWidth: 19, halign: 'right' },
      7: { cellWidth: 19, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === rows.length) {
        data.cell.styles.fillColor = [226, 232, 240]
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = [15, 41, 66]
        data.cell.styles.lineColor = [180, 195, 215]
        data.cell.styles.lineWidth = 0.25
      }
    },
  })

  // --- PÁGINA FINAL: GRÁFICO DE COLUMNAS ---
  if (rows.length > 0) {
    doc.addPage()
    const chartHeaderBottom = drawPdfHeader(
      doc,
      pageW,
      isMotivos ? 'Distribución de Motivos de Consulta' : 'Distribución de Obras Sociales',
      {
        secondLine: `Período: ${periodText}${turnoText}${filterText}`,
        fontSize: 18,
      },
    )

    // Agrupar por Obra Social o por Motivo Consulta
    const countMap = new Map<string, number>()
    for (const r of rows) {
      const itemKey = isMotivos
        ? r.motivoConsulta.trim() || 'Consulta'
        : r.obraSocial.trim() || 'Particular'
      countMap.set(itemKey, (countMap.get(itemKey) ?? 0) + 1)
    }

    const sortedOS = Array.from(countMap.entries())
      .map(([nombre, cantidad]) => ({ nombre, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)

    // Tomar top 7 y agrupar el resto en "Otras" / "Otros" si hay más de 8
    let chartItems: { nombre: string; cantidad: number }[] = []
    if (sortedOS.length <= 8) {
      chartItems = sortedOS
    } else {
      chartItems = sortedOS.slice(0, 7)
      const resto = sortedOS.slice(7).reduce((acc, x) => acc + x.cantidad, 0)
      if (resto > 0) {
        chartItems.push({ nombre: isMotivos ? 'Otros' : 'Otras', cantidad: resto })
      }
    }

    const totalRegistros = rows.length
    const maxCantidad = Math.max(...chartItems.map((x) => x.cantidad), 1)

    // Layout del contenedor del gráfico
    const chartBoxX = 15
    const chartBoxY = pdfBodyStartYAfterHeader(chartHeaderBottom, 4)
    const chartBoxW = pageW - 30 // 180mm
    const chartBoxH = 145

    // Dibujar tarjeta contenedor (Fondo Blanco)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(chartBoxX, chartBoxY, chartBoxW, chartBoxH, 4, 4, 'F')
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(chartBoxX, chartBoxY, chartBoxW, chartBoxH, 4, 4, 'D')

    // Título interno del gráfico
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(15, 41, 66)
    doc.text(
      isMotivos
        ? 'MOTIVOS DE CONSULTA (CANTIDAD DE REGISTROS)'
        : 'COBERTURA DE OBRAS SOCIALES (CANTIDAD DE REGISTROS)',
      chartBoxX + 12,
      chartBoxY + 13,
    )

    // Área del gráfico (Plot Area)
    const plotX = chartBoxX + 22
    const plotY = chartBoxY + 28
    const plotW = chartBoxW - 34 // 146mm
    const plotH = 82 // 82mm

    // Líneas de grilla horizontales (Y-axis gridlines)
    const gridSteps = 4
    for (let i = 0; i <= gridSteps; i++) {
      const stepVal = Math.round((maxCantidad / gridSteps) * i)
      const gridY = plotY + plotH - (i / gridSteps) * plotH

      doc.setDrawColor(226, 232, 240)
      doc.setLineWidth(0.2)
      doc.line(plotX, gridY, plotX + plotW, gridY)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      doc.text(String(stepVal), plotX - 4, gridY + 1.2, { align: 'right' })
    }

    // Dibujar Eje X base
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.4)
    doc.line(plotX, plotY + plotH, plotX + plotW, plotY + plotH)

    // Paleta de colores moderna
    const palette: [number, number, number][] = [
      [2, 132, 199],   // Sky Blue
      [13, 148, 136],  // Teal
      [99, 102, 241],  // Indigo
      [139, 92, 246],  // Purple
      [236, 72, 153],  // Pink
      [245, 158, 11],  // Amber
      [16, 185, 129],  // Emerald
      [100, 116, 139], // Slate
    ]

    // Dibujar columnas
    const numCols = chartItems.length
    const slotW = plotW / numCols
    const colW = Math.min(22, slotW * 0.55)

    chartItems.forEach((item, index) => {
      const colX = plotX + index * slotW + (slotW - colW) / 2
      const pct = (item.cantidad / totalRegistros) * 100
      const colH = Math.max(3, (item.cantidad / maxCantidad) * plotH)
      const colY = plotY + plotH - colH

      const [r, g, b] = palette[index % palette.length]

      // Sombra de columna
      doc.setFillColor(248, 250, 252)
      doc.roundedRect(colX, plotY, colW, plotH, 2, 2, 'F')

      // Columna de color
      doc.setFillColor(r, g, b)
      doc.roundedRect(colX, colY, colW, colH, 2, 2, 'F')

      // Valor numérico y % sobre la columna
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(r, g, b)
      doc.text(String(item.cantidad), colX + colW / 2, colY - 5, { align: 'center' })

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(100, 116, 139)
      doc.text(`${pct.toFixed(0)}%`, colX + colW / 2, colY - 1.5, { align: 'center' })

      // Nombre del ítem
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(30, 41, 59)

      const truncatedLabel = item.nombre.length > 14 ? `${item.nombre.substring(0, 13)}…` : item.nombre
      doc.text(truncatedLabel, colX + colW / 2, plotY + plotH + 5.5, {
        align: 'center',
        maxWidth: slotW - 1,
      })
    })

    // Tarjeta resumida al pie de la página (Fondo Blanco)
    const summaryY = chartBoxY + chartBoxH + 8
    const summaryW = chartBoxW
    const summaryH = 26

    doc.setFillColor(255, 255, 255)
    doc.roundedRect(chartBoxX, summaryY, summaryW, summaryH, 3, 3, 'F')
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(chartBoxX, summaryY, summaryW, summaryH, 3, 3, 'D')

    const col3W = summaryW / 3

    // Bloque 1: Total Registros
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text('TOTAL REGISTROS', chartBoxX + col3W * 0.5, summaryY + 7, { align: 'center' })
    doc.setFontSize(13)
    doc.setTextColor(2, 132, 199)
    doc.text(String(totalRegistros), chartBoxX + col3W * 0.5, summaryY + 18, { align: 'center' })

    // Línea divisora 1
    doc.setDrawColor(203, 213, 225)
    doc.line(chartBoxX + col3W, summaryY + 4, chartBoxX + col3W, summaryY + summaryH - 4)

    // Bloque 2: Mayor Cobertura / Motivo Más Frecuente
    const topOS = sortedOS[0]
    const topPct = topOS ? ((topOS.cantidad / totalRegistros) * 100).toFixed(1) : '0'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(
      isMotivos ? 'MOTIVO MÁS FRECUENTE' : 'MAYOR COBERTURA',
      chartBoxX + col3W * 1.5,
      summaryY + 7,
      { align: 'center' },
    )
    doc.setFontSize(10.5)
    doc.setTextColor(15, 41, 66)
    doc.text(topOS ? topOS.nombre : '—', chartBoxX + col3W * 1.5, summaryY + 15, { align: 'center' })
    doc.setFontSize(7)
    doc.setTextColor(2, 132, 199)
    doc.text(`${topOS ? topOS.cantidad : 0} turnos (${topPct}%)`, chartBoxX + col3W * 1.5, summaryY + 21, { align: 'center' })

    // Línea divisora 2
    doc.line(chartBoxX + col3W * 2, summaryY + 4, chartBoxX + col3W * 2, summaryY + summaryH - 4)

    // Bloque 3: Obras Sociales Únicas / Motivos Únicos
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(
      isMotivos ? 'MOTIVOS ÚNICOS' : 'OBRAS SOCIALES ÚNICAS',
      chartBoxX + col3W * 2.5,
      summaryY + 7,
      { align: 'center' },
    )
    doc.setFontSize(13)
    doc.setTextColor(15, 41, 66)
    doc.text(String(sortedOS.length), chartBoxX + col3W * 2.5, summaryY + 18, { align: 'center' })
  }

  stampPdfGeneratedFooterOnAllPages(doc, footerLabel ? { label: footerLabel } : undefined)
  return {
    doc,
    filename: isMotivos
      ? `listado-motivos-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`
      : `listado-obra-social-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`,
    title,
  }
}

export function buildMotivosListadoPdf(
  desde: string,
  hasta: string,
  filterLabel: string,
  rows: ObraSocialListadoPdfRow[],
  footerLabel?: string,
  turnoLabel?: string,
): { doc: jsPDF; filename: string; title: string } {
  return buildObraSocialListadoPdf(
    desde,
    hasta,
    filterLabel,
    rows,
    footerLabel,
    turnoLabel,
    'motivos',
  )
}

export function buildResumenCuidarPdf(
  desde: string,
  hasta: string,
  medicoLabel: string,
  rows: ResumenCuidarPdfRow[],
  totales: { facturado: number; transferencias: number; medico: number; cuidar: number },
  footerLabel?: string,
  turnoLabel?: string,
  options?: {
    title?: string
    filterLabel?: string
    filenamePrefix?: string
    doctorDebtRows?: DoctorDebtPdfRow[]
    doctorDebtLabel?: string
    /**
     * Con todo el export por transferencia, "Monto Cuidar" sale en negativo:
     * la plata nunca pasó por caja, así que lo del médico sale del lado del
     * centro y no es una deuda para él.
     */
    todosTransferencia?: boolean
  },
): { doc: jsPDF; filename: string; title: string } {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' })
  const headerTitle = options?.title ?? 'Resumen Cuidar'
  const pageW = doc.internal.pageSize.getWidth()

  const periodText =
    desde === hasta
      ? format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')
      : `${format(parseISO(`${desde}T12:00:00`), 'dd-MM-yyyy')} al ${format(parseISO(`${hasta}T12:00:00`), 'dd-MM-yyyy')}`
  const turnoPart =
    turnoLabel && turnoLabel !== 'todos' && turnoLabel !== 'Todos los turnos'
      ? ` — Turno: ${turnoLabel}`
      : ''
  const filterLabel = options?.filterLabel ?? 'Médico'
  const subtitle = `Período: ${periodText} — ${filterLabel}: ${medicoLabel}${turnoPart}`
    const bannerHeight = drawPdfHeader(doc, pageW, headerTitle, {
      secondLine: subtitle,
      fontSize: 18,
    })
  let y = pdfBodyStartYAfterHeader(bannerHeight, PDF_BODY_EXTRA_DOWN_PLAIN)

  y += 3 // Margen estético antes de la tabla

  const totalCantidad = rows.reduce((acc, r) => acc + r.cantidad, 0)
  const totalPorcentaje = formatPorcentaje(totales.cuidar, totales.facturado)
  // Invierte el signo de "Monto Cuidar" cuando todo entró por transferencia.
  const signoCuidar = options?.todosTransferencia ? -1 : 1

  autoTable(doc, {
    startY: y,
    head: [
      [
        'Fecha',
        'Turno',
        'Cant. Pagos',
        '% Cuidar',
        'Total Facturado',
        'Total\nTransferencias',
        'Total Médico',
        'Monto Cuidar',
      ],
    ],
    body: [
      ...rows.map((r) => [
        format(parseISO(`${r.day}T12:00:00`), 'dd/MM/yyyy'),
        r.turno || '—',
        r.cantidad.toString(),
        formatPorcentaje(r.cuidar, r.facturado),
        formatMonto(r.facturado),
        formatMonto(r.transferencias),
        formatMonto(r.medico),
        formatMonto(r.cuidar * signoCuidar),
      ]),
      [
        'TOTALES',
        '',
        totalCantidad.toString(),
        totalPorcentaje,
        formatMonto(totales.facturado),
        formatMonto(totales.transferencias),
        formatMonto(totales.medico),
        formatMonto(totales.cuidar * signoCuidar),
      ],
    ],
    theme: 'plain',
    headStyles: {
      fillColor: [15, 41, 66], // #0f2942 Modern Pagos Navy
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
      cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252], // #f8fafc subtle row tint
    },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
      textColor: [30, 41, 59], // #1e293b
      lineColor: [226, 232, 240], // #e2e8f0
      lineWidth: 0.15,
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: 21, halign: 'center' },
      1: { cellWidth: 19, halign: 'center' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 17, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 27, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' },
      6: { cellWidth: 28, halign: 'right' },
      7: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: function (data) {
      if (data.section === 'head') {
        if (data.column.index <= 3) {
          data.cell.styles.halign = 'center'
        } else {
          data.cell.styles.halign = 'right'
        }
      }
      if (data.section === 'body' && data.row.index === rows.length) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fontSize = 8
        data.cell.styles.fillColor = [226, 232, 240] // #e2e8f0 darker subtle contrast
        data.cell.styles.textColor = [15, 41, 66] // #0f2942
        data.cell.styles.lineColor = [180, 195, 215]
        data.cell.styles.lineWidth = 0.25
        if (data.column.index === 4) {
          data.cell.styles.textColor = [2, 132, 199] // #0284c7 Total Facturado
        }
      }
    },
    margin: { left: PAGOS_PDF_MARGIN, right: PAGOS_PDF_MARGIN },
  })

  const deudaConCuidar = Math.max(0, -totales.medico)
  if (deudaConCuidar > 0) {
    const finalY =
      (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
        ?.finalY ?? y
    const left = PAGOS_PDF_MARGIN
    const width = pageW - left * 2
    const noticeY = finalY + 6

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(138, 75, 8)
    doc.text('Comisión pendiente - Deuda del médico con Cuidar', left, noticeY)
    doc.text(formatMonto(deudaConCuidar), left + width - 4, noticeY, {
      align: 'right',
    })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(
      'Se cobrará la comisión en turnos posteriores o con pagos a acordar con Cuidar.',
      left,
      noticeY + 4,
      { maxWidth: width },
    )
  }

  if (options?.doctorDebtRows) {
    appendDoctorDebtSummaryPage(
      doc,
      options.doctorDebtRows,
      periodText,
      options.doctorDebtLabel,
    )
  }

  stampPdfGeneratedFooterOnAllPages(
    doc,
    footerLabel ? { label: footerLabel } : undefined,
  )

  const filename = `${options?.filenamePrefix ?? 'resumen-cuidar'}-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`
  return { doc, filename, title: headerTitle }
}
