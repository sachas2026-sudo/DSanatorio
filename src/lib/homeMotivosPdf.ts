import { format } from 'date-fns'
import jsPDF from 'jspdf'
import type { HomeStats } from './homeInsights'
import {
  drawPdfHeader,
  pdfBodyStartYAfterHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
} from './pdfHeader'
import {
  PAGOS_DOCTOR_BLOCK_RADIUS,
  PAGOS_PDF_MARGIN,
  stampPdfGeneratedFooterOnAllPages,
} from './pagosPdfLayout'

type MotivosPorMes = {
  label: string
  motivos: { nombre: string; cantidad: number }[]
}[]

type BuildHomeMotivosPdfOptions = {
  motivosPorMes?: MotivosPorMes
}

export function buildHomeMotivosPdf(
  stats: HomeStats,
  options: BuildHomeMotivosPdfOptions = {},
): {
  doc: jsPDF
  filename: string
} {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const left = PAGOS_PDF_MARGIN
  const width = pageW - left * 2
  const total = stats.motivosConsultaMes.reduce(
    (sum, item) => sum + item.cantidad,
    0,
  )
  const max = stats.motivosConsultaMes[0]?.cantidad ?? 1

  const headerBottom = drawPdfHeader(doc, pageW, 'Motivos de consulta del mes')
  let y = pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN)

  doc.setFillColor(238, 244, 255)
  doc.setDrawColor(210, 222, 238)
  doc.setLineWidth(0.25)
  doc.roundedRect(left, y, width, 18, PAGOS_DOCTOR_BLOCK_RADIUS, PAGOS_DOCTOR_BLOCK_RADIUS, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(26, 39, 68)
  doc.text(stats.mesLabel, left + 5, y + 7)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(61, 74, 92)
  doc.text(`${total} consultas registradas`, left + 5, y + 13)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(47, 111, 219)
  doc.text(String(total), left + width - 5, y + 11, { align: 'right' })
  y += 27

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(26, 39, 68)
  doc.text('Ranking de motivos', left, y)
  y += 8

  if (stats.motivosConsultaMes.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay consultas registradas este mes.', left, y)
  } else {
    const rowH = 14
    const labelW = 52
    const valueW = 15
    const trackX = left + labelW
    const trackW = width - labelW - valueW

    stats.motivosConsultaMes.forEach((item, index) => {
      if (y + rowH > pageH - 20) {
        doc.addPage()
        y = 20
      }
      const barW = Math.max(3, (item.cantidad / max) * trackW)
      const percentage = total > 0 ? Math.round((item.cantidad / total) * 100) : 0

      if (index % 2 === 0) {
        doc.setFillColor(248, 251, 255)
        doc.roundedRect(left, y - 4, width, rowH, 2, 2, 'F')
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(61, 74, 92)
      doc.text(doc.splitTextToSize(item.nombre, labelW - 4) as string[], left + 2, y + 2, {
        maxWidth: labelW - 4,
      })
      doc.setFillColor(229, 238, 249)
      doc.roundedRect(trackX, y, trackW, 5, 2.5, 2.5, 'F')
      doc.setFillColor(91, 159, 212)
      doc.roundedRect(trackX, y, barW, 5, 2.5, 2.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(26, 74, 138)
      doc.text(`${item.cantidad} · ${percentage}%`, left + width - 2, y + 4, {
        align: 'right',
      })
      y += rowH
    })
  }

  const motivosOcupanMucho = stats.motivosConsultaMes.length > 10
  if (motivosOcupanMucho || y + 24 > pageH - 20) {
    doc.addPage()
    y = 20
  } else {
    y += 5
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(26, 39, 68)
  doc.text('Ranking de obras sociales (top)', left, y)
  y += 8

  if (stats.topObrasSociales.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay obras sociales registradas.', left, y)
  } else {
    const rowH = 13
    const maxObra = stats.topObrasSociales[0]?.cantidad ?? 1
    const labelW = 52
    const valueW = 15
    const trackX = left + labelW
    const trackW = width - labelW - valueW
    stats.topObrasSociales.forEach((item, index) => {
      if (y + rowH > pageH - 20) {
        doc.addPage()
        y = 20
      }
      if (index % 2 === 0) {
        doc.setFillColor(248, 251, 255)
        doc.roundedRect(left, y - 4, width, rowH, 2, 2, 'F')
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(61, 74, 92)
      doc.text(`${index + 1}.`, left + 2, y + 2)
      doc.setFont('helvetica', 'normal')
      doc.text(doc.splitTextToSize(item.nombre, labelW - 13) as string[], left + 11, y + 2, {
        maxWidth: labelW - 13,
      })
      const barW = Math.max(3, (item.cantidad / maxObra) * trackW)
      doc.setFillColor(229, 238, 249)
      doc.roundedRect(trackX, y, trackW, 5, 2.5, 2.5, 'F')
      doc.setFillColor(91, 159, 212)
      doc.roundedRect(trackX, y, barW, 5, 2.5, 2.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(26, 74, 138)
      doc.text(String(item.cantidad), left + width - 2, y + 2, { align: 'right' })
      y += rowH
    })
  }

  if (options.motivosPorMes?.length) {
    doc.addPage()
    const chartTop = 46
    const chartLeft = 50
    const chartW = pageW - chartLeft - 25
    const rowH = 9
    const totals = options.motivosPorMes.map((month) =>
      month.motivos.reduce((sum, item) => sum + item.cantidad, 0),
    )
    const maxTotal = Math.max(...totals, 1)
    const names = new Set<string>()
    options.motivosPorMes.forEach((month) => {
      month.motivos.forEach((item) => names.add(item.nombre))
    })
    const rankedNames = [...names].sort((a, b) => {
      const totalA = options.motivosPorMes!.reduce(
        (sum, month) => sum + (month.motivos.find((item) => item.nombre === a)?.cantidad ?? 0),
        0,
      )
      const totalB = options.motivosPorMes!.reduce(
        (sum, month) => sum + (month.motivos.find((item) => item.nombre === b)?.cantidad ?? 0),
        0,
      )
      return totalB - totalA
    })
    const visibleNames = rankedNames.slice(0, 5)
    const hasOther = rankedNames.length > visibleNames.length
    const seriesNames = hasOther ? [...visibleNames, 'Otros'] : visibleNames
    const colors: [number, number, number][] = [
      [91, 159, 212],
      [122, 163, 176],
      [143, 181, 232],
      [79, 128, 189],
      [163, 184, 215],
      [190, 203, 224],
    ]
    const activeYear = new Date().getFullYear()
    drawPdfHeader(doc, pageW, 'Evolución anual de motivos')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(0, 0, 0)
    doc.text(`Año ${activeYear}`, pageW / 2 + 50, 26)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(26, 39, 68)
    doc.text('Consultas por mes y motivo', pageW / 2, 26, { align: 'center' })

    doc.setDrawColor(210, 222, 238)
    doc.setLineWidth(0.3)
    options.motivosPorMes.forEach((month, monthIndex) => {
      const y = chartTop + monthIndex * rowH
      const values = new Map(month.motivos.map((item) => [item.nombre, item.cantidad]))
      const other = month.motivos.reduce(
        (sum, item) => (visibleNames.includes(item.nombre) ? sum : sum + item.cantidad),
        0,
      )
      let currentX = chartLeft
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(61, 74, 92)
      doc.text(month.label, chartLeft - 7, y + 4, { align: 'right' })
      doc.setFillColor(229, 238, 249)
      doc.roundedRect(chartLeft, y, chartW, 5, 2.5, 2.5, 'F')
      seriesNames.forEach((name, seriesIndex) => {
        const value = name === 'Otros' ? other : values.get(name) ?? 0
        if (value <= 0) return
        const segmentW = (value / maxTotal) * chartW
        const color = colors[seriesIndex] ?? colors[colors.length - 1]
        doc.setFillColor(...color)
        doc.rect(currentX, y, segmentW, 5, 'F')
        currentX += segmentW
      })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(61, 74, 92)
      doc.text(String(totals[monthIndex]), chartLeft + chartW + 4, y + 4)
    })

    let legendX = chartLeft
    let legendY = chartTop + options.motivosPorMes.length * rowH + 12
    seriesNames.forEach((name, index) => {
      const labelW = doc.getTextWidth(name) + 9
      if (legendX + labelW > pageW - left) {
        legendX = chartLeft
        legendY += 7
      }
      const color = colors[index] ?? colors[colors.length - 1]
      doc.setFillColor(...color)
      doc.roundedRect(legendX, legendY - 3.5, 4, 4, 1, 1, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(61, 74, 92)
      doc.text(name, legendX + 6, legendY)
      legendX += labelW + 7
    })
  }

  stampPdfGeneratedFooterOnAllPages(doc)
  return {
    doc,
    filename: `motivos-consulta-${format(new Date(), 'yyyy-MM')}.pdf`,
  }
}
