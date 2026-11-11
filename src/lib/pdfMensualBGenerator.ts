import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import type { DetalleMensualResult } from './pdfMensualBCalculo'
import { formatMonto } from './formatMonto'
import { getPdfLogo } from './pdfLogo'

// Dimensiones A4 landscape (apaisado)
const PAGE_W = 297
const PAGE_H = 210
const MARGIN_X = 10
const CONTENT_W = PAGE_W - MARGIN_X * 2 // 277 mm

// Paleta oficial de colores
const COLOR_NAVY: [number, number, number] = [18, 41, 74] // #12294a
const COLOR_BLUE: [number, number, number] = [47, 111, 228] // #2f6fe4
const COLOR_BG_ALT: [number, number, number] = [247, 249, 252] // #f7f9fc
const COLOR_BG_TOTALS: [number, number, number] = [232, 238, 248] // #e8eef8
const COLOR_BORDER: [number, number, number] = [223, 229, 238] // #dfe5ee
const COLOR_TEXT: [number, number, number] = [30, 41, 59] // #1e293b
const COLOR_TEXT_MUTED: [number, number, number] = [100, 116, 139] // #64748b

/**
 * Dibuja el encabezado superior apaisado con logo Cuidar y franja decorativa.
 */
function drawHeader(
  doc: jsPDF,
  periodoLabel: string,
  titulo: string = 'Centro Medico - Gestión Resumen Cuidar · Resumen por Dia',
  badgeText: string = 'DETALLE MENSUAL',
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
  doc.roundedRect(MARGIN_X, y, 3.5, h, 1.5, 1.5, 'F')

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
  doc.setFontSize(13)
  doc.setTextColor(...COLOR_NAVY)
  doc.text(titulo, textStartX, y + 7.5)

  // Subtítulo con período y médico
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...COLOR_TEXT_MUTED)
  doc.text(periodoLabel, textStartX, y + 13.5)

  // Badge derecho
  const badgeW = 42
  const badgeH = 8
  const badgeX = MARGIN_X + CONTENT_W - badgeW - 5
  const badgeY = y + (h - badgeH) / 2
  doc.setFillColor(...COLOR_BG_TOTALS)
  doc.setDrawColor(...COLOR_BORDER)
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLOR_NAVY)
  doc.text(badgeText, badgeX + badgeW / 2, badgeY + 5.2, { align: 'center' })

  return y + h
}

/**
 * Generador principal del "PDF Mensual B" (Detalle de turnos turno por turno).
 */
export function buildPdfMensualB(
  data: DetalleMensualResult,
  anioMes: string,
): { doc: jsPDF; filename: string; title: string } {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  })

  // ── 1. HOJA 1: RESUMEN POR DÍA ──────────────────────────────────────────────
  const headerBottom = drawHeader(
    doc,
    data.periodoLabel,
    'Centro Medico - Gestión Resumen Cuidar · Resumen Mensual',
    'RESUMEN MENSUAL',
  )

  let currentY = headerBottom + 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('RESUMEN POR DÍA', MARGIN_X, currentY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLOR_TEXT_MUTED)
  doc.text(
    `Totales cobrados por día del mes (${data.resumenPorDia.length} días con cobros · ${data.totalesCobrados.cantidadTurnos} turnos · ${data.totalesCobrados.cantidadPagos} cobros registrados).`,
    MARGIN_X + 38,
    currentY,
  )

  currentY += 3.5

  if (data.resumenPorDia.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...COLOR_TEXT_MUTED)
    doc.text('Sin cobros en el período', PAGE_W / 2, currentY + 35, { align: 'center' })
  } else {
    // Columnas: Fecha | Día | Turnos | Total Facturado | Total Transferencias | Total Efectivo | Total Médico | Monto Cuidar
    // Ancho útil = 277 mm
    const colStylesResumen = {
      0: { cellWidth: 28, halign: 'center' as const },
      1: { cellWidth: 32, halign: 'left' as const },
      2: { cellWidth: 22, halign: 'center' as const },
      3: { cellWidth: 39, halign: 'right' as const },
      4: { cellWidth: 39, halign: 'right' as const },
      5: { cellWidth: 39, halign: 'right' as const },
      6: { cellWidth: 39, halign: 'right' as const },
      7: { cellWidth: 39, halign: 'right' as const },
    }

    const bodyResumen = data.resumenPorDia.map((r) => [
      r.fecha,
      r.diaSemana,
      String(r.cantidadTurnos),
      formatMonto(r.totalFacturado),
      formatMonto(r.totalTransferencias),
      formatMonto(r.totalEfectivo),
      formatMonto(r.totalMedico),
      formatMonto(r.montoCuidar),
    ])

    // Fila TOTAL DEL MES
    bodyResumen.push([
      'TOTAL DEL MES',
      '',
      String(data.totalesCobrados.cantidadTurnos),
      formatMonto(data.totalesCobrados.totalFacturado),
      formatMonto(data.totalesCobrados.totalTransferencias),
      formatMonto(data.totalesCobrados.totalEfectivo),
      formatMonto(data.totalesCobrados.totalMedico),
      formatMonto(data.totalesCobrados.montoCuidar),
    ])

    autoTable(doc, {
      startY: currentY,
      head: [
        [
          'Fecha',
          'Día',
          'Turnos',
          'Total Facturado',
          'Total Transferencias',
          'Total Efectivo',
          'Total Médico',
          'Monto Cuidar',
        ],
      ],
      body: bodyResumen,
      theme: 'plain',
      headStyles: {
        fillColor: COLOR_NAVY,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.8,
        halign: 'center',
        cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
      },
      alternateRowStyles: {
        fillColor: COLOR_BG_ALT,
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 },
        textColor: COLOR_TEXT,
        lineColor: COLOR_BORDER,
        lineWidth: 0.15,
        valign: 'middle',
      },
      columnStyles: colStylesResumen,
      margin: { top: 30, bottom: 15, left: MARGIN_X, right: MARGIN_X },
      didDrawPage: (dataHook) => {
        if (dataHook.pageNumber > 1) {
          drawHeader(
            doc,
            data.periodoLabel,
            'Centro Medico - Gestión Resumen Cuidar · Resumen Mensual',
            'RESUMEN MENSUAL',
          )
        }
      },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.row.index === bodyResumen.length - 1) {
          hookData.cell.styles.fontStyle = 'bold'
          hookData.cell.styles.fillColor = COLOR_BG_TOTALS
          hookData.cell.styles.textColor = COLOR_NAVY
          hookData.cell.styles.lineWidth = 0.25
          hookData.cell.styles.lineColor = [180, 195, 215]
          if (hookData.column.index === 3) {
            hookData.cell.styles.textColor = COLOR_BLUE
          }
        }
      },
    })
  }

  // ── 2. HOJAS SIGUIENTES: DETALLE DÍA POR DÍA ────────────────────────────────
  if (data.filasCobrados.length > 0) {
    doc.addPage()
    const detalleStartPage = doc.getNumberOfPages()

    drawHeader(
      doc,
      data.periodoLabel,
      'Centro Medico - Gestión Resumen Cuidar · Resumen por Dia',
      'DETALLE MENSUAL',
    )

    let currentDetalleY = 32

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...COLOR_NAVY)
    doc.text('PAGOS COBRADOS POR DÍA', MARGIN_X, currentDetalleY)
    currentDetalleY += 4.5

    // Anchos relativos de las 10 columnas del detalle (Suma = 277 mm):
    // Turno, Paciente, Médico, Obra social / Plan, % Cuidar, Total Facturado, Total Transferencias, Total Efectivo, Total Médico, Monto Cuidar
    const colStylesDetalle = {
      0: { cellWidth: 20, halign: 'center' as const },
      1: { cellWidth: 46, halign: 'left' as const },
      2: { cellWidth: 42, halign: 'left' as const },
      3: { cellWidth: 41, halign: 'left' as const },
      4: { cellWidth: 18, halign: 'center' as const, fontStyle: 'bold' as const },
      5: { cellWidth: 22, halign: 'right' as const },
      6: { cellWidth: 22, halign: 'right' as const },
      7: { cellWidth: 22, halign: 'right' as const },
      8: { cellWidth: 22, halign: 'right' as const },
      9: { cellWidth: 22, halign: 'right' as const },
    }

    type RowItem = any
    const bodyDetalle: RowItem[] = []

    for (const grupo of data.gruposPorDia) {
      // Franja de inicio del día (ancho completo, fondo #DCE6F7)
      bodyDetalle.push([
        {
          content: grupo.franjaLabel,
          colSpan: 10,
          styles: {
            fillColor: [220, 230, 247],
            textColor: COLOR_NAVY,
            fontStyle: 'bold',
            halign: 'left',
            minCellHeight: 6,
            fontSize: 8,
          },
        },
      ])

      // Filas de turnos de este día
      for (const f of grupo.filas) {
        bodyDetalle.push([
          f.turno,
          f.paciente,
          f.medico,
          f.obraSocial,
          f.porcentajeLabel,
          formatMonto(f.totalFacturado),
          formatMonto(f.totalTransferencias),
          formatMonto(f.totalEfectivo),
          formatMonto(f.totalMedico),
          formatMonto(f.montoCuidar),
        ])
      }

      // Fila subtotal del día (fondo #EAF1FD, negrita, borde superior)
      bodyDetalle.push([
        {
          content: grupo.subtotalLabel,
          colSpan: 5,
          styles: {
            fillColor: [234, 241, 253],
            textColor: COLOR_NAVY,
            fontStyle: 'bold',
            halign: 'left',
            lineWidth: { top: 0.25 },
            lineColor: [180, 195, 215],
          },
        },
        {
          content: formatMonto(grupo.totales.totalFacturado),
          styles: {
            fillColor: [234, 241, 253],
            textColor: COLOR_NAVY,
            fontStyle: 'bold',
            halign: 'right',
            lineWidth: { top: 0.25 },
            lineColor: [180, 195, 215],
          },
        },
        {
          content: formatMonto(grupo.totales.totalTransferencias),
          styles: {
            fillColor: [234, 241, 253],
            textColor: COLOR_NAVY,
            fontStyle: 'bold',
            halign: 'right',
            lineWidth: { top: 0.25 },
            lineColor: [180, 195, 215],
          },
        },
        {
          content: formatMonto(grupo.totales.totalEfectivo),
          styles: {
            fillColor: [234, 241, 253],
            textColor: COLOR_NAVY,
            fontStyle: 'bold',
            halign: 'right',
            lineWidth: { top: 0.25 },
            lineColor: [180, 195, 215],
          },
        },
        {
          content: formatMonto(grupo.totales.totalMedico),
          styles: {
            fillColor: [234, 241, 253],
            textColor: COLOR_NAVY,
            fontStyle: 'bold',
            halign: 'right',
            lineWidth: { top: 0.25 },
            lineColor: [180, 195, 215],
          },
        },
        {
          content: formatMonto(grupo.totales.montoCuidar),
          styles: {
            fillColor: [234, 241, 253],
            textColor: COLOR_NAVY,
            fontStyle: 'bold',
            halign: 'right',
            lineWidth: { top: 0.25 },
            lineColor: [180, 195, 215],
          },
        },
      ])
    }

    // Fila final TOTAL DEL MES
    bodyDetalle.push([
      {
        content: `TOTAL DEL MES (${data.totalesCobrados.cantidadPagos} pagos)`,
        colSpan: 5,
        styles: {
          fillColor: COLOR_BG_TOTALS,
          textColor: COLOR_NAVY,
          fontStyle: 'bold',
          halign: 'left',
          lineWidth: { top: 0.35 },
          lineColor: [180, 195, 215],
        },
      },
      {
        content: formatMonto(data.totalesCobrados.totalFacturado),
        styles: {
          fillColor: COLOR_BG_TOTALS,
          textColor: COLOR_BLUE,
          fontStyle: 'bold',
          halign: 'right',
          lineWidth: { top: 0.35 },
          lineColor: [180, 195, 215],
        },
      },
      {
        content: formatMonto(data.totalesCobrados.totalTransferencias),
        styles: {
          fillColor: COLOR_BG_TOTALS,
          textColor: COLOR_NAVY,
          fontStyle: 'bold',
          halign: 'right',
          lineWidth: { top: 0.35 },
          lineColor: [180, 195, 215],
        },
      },
      {
        content: formatMonto(data.totalesCobrados.totalEfectivo),
        styles: {
          fillColor: COLOR_BG_TOTALS,
          textColor: COLOR_NAVY,
          fontStyle: 'bold',
          halign: 'right',
          lineWidth: { top: 0.35 },
          lineColor: [180, 195, 215],
        },
      },
      {
        content: formatMonto(data.totalesCobrados.totalMedico),
        styles: {
          fillColor: COLOR_BG_TOTALS,
          textColor: COLOR_NAVY,
          fontStyle: 'bold',
          halign: 'right',
          lineWidth: { top: 0.35 },
          lineColor: [180, 195, 215],
        },
      },
      {
        content: formatMonto(data.totalesCobrados.montoCuidar),
        styles: {
          fillColor: COLOR_BG_TOTALS,
          textColor: COLOR_NAVY,
          fontStyle: 'bold',
          halign: 'right',
          lineWidth: { top: 0.35 },
          lineColor: [180, 195, 215],
        },
      },
    ])

    autoTable(doc, {
      startY: currentDetalleY,
      head: [
        [
          'Turno',
          'Paciente',
          'Médico',
          'Obra social / Plan',
          '% Cuidar',
          'Total Facturado',
          'Total Transferencias',
          'Total Efectivo',
          'Total Médico',
          'Monto Cuidar',
        ],
      ],
      body: bodyDetalle,
      theme: 'plain',
      headStyles: {
        fillColor: COLOR_NAVY,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.8,
        halign: 'center',
        cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
      },
      alternateRowStyles: {
        fillColor: COLOR_BG_ALT,
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 },
        textColor: COLOR_TEXT,
        lineColor: COLOR_BORDER,
        lineWidth: 0.15,
        valign: 'middle',
      },
      columnStyles: colStylesDetalle,
      margin: { top: 30, bottom: 15, left: MARGIN_X, right: MARGIN_X },
      didDrawPage: (dataHook) => {
        if (dataHook.pageNumber > detalleStartPage) {
          drawHeader(
            doc,
            data.periodoLabel,
            'Centro Medico - Gestión Resumen Cuidar · Resumen por Dia',
            'DETALLE MENSUAL',
          )
        }
      },
    })
  }

  const afterTable1Y =
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? currentY + 40

  // ── 2. TABLA 2: NO PAGOS (PENDIENTES DE PAGO) ──────────────────────────────
  doc.addPage()
  const tabla2StartPage = doc.getNumberOfPages()
  drawHeader(doc, data.periodoLabel, 'Centro Medico - Gestión Resumen Cuidar · Sin Pagos')
  currentY = 32

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...COLOR_NAVY)
  doc.text('NO PAGOS', MARGIN_X, currentY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLOR_TEXT_MUTED)
  doc.text(
    'Turnos pendientes de pago y turnos de obras sociales o planes que no cobran Plus (sin cargo).',
    MARGIN_X,
    currentY + 4.2,
  )

  currentY += 7.5

  // Anchos relativos: 60, 58, 130, 110, 120, 100, 110 (Suma = 688)
  const scale2 = CONTENT_W / 688
  const colStyles2 = {
    0: { cellWidth: 60 * scale2, halign: 'center' as const },
    1: { cellWidth: 58 * scale2, halign: 'center' as const },
    2: { cellWidth: 130 * scale2, halign: 'left' as const },
    3: { cellWidth: 110 * scale2, halign: 'left' as const },
    4: { cellWidth: 120 * scale2, halign: 'left' as const },
    5: { cellWidth: 100 * scale2, halign: 'right' as const },
    6: { cellWidth: 110 * scale2, halign: 'center' as const },
  }

  const bodyNoPagos: string[][] = data.filasNoPagos.map((f) => [
    f.fecha,
    f.turno,
    f.paciente,
    f.medico,
    f.obraSocial,
    f.estado === 'Sin Plus' ? '$ 0' : formatMonto(f.montoAdeudado),
    f.estado,
  ])

  // Fila TOTALES de Tabla 2
  bodyNoPagos.push([
    'TOTALES',
    '',
    '',
    '',
    data.totalesNoPagos.labelResumen,
    formatMonto(data.totalesNoPagos.totalAdeudado),
    '',
  ])

  autoTable(doc, {
    startY: currentY,
    head: [
      [
        'Fecha',
        'Turno',
        'Paciente',
        'Médico',
        'Obra social / Plan',
        'Monto adeudado',
        'Estado',
      ],
    ],
    body: bodyNoPagos,
    theme: 'plain',
    headStyles: {
      fillColor: COLOR_NAVY,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.8,
      halign: 'center',
      cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
    },
    alternateRowStyles: {
      fillColor: COLOR_BG_ALT,
    },
    styles: {
      font: 'helvetica',
      fontSize: 7.8,
      cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 },
      textColor: COLOR_TEXT,
      lineColor: COLOR_BORDER,
      lineWidth: 0.15,
      valign: 'middle',
    },
    columnStyles: colStyles2,
    margin: { top: 30, bottom: 15, left: MARGIN_X, right: MARGIN_X },
    didDrawPage: (dataHook) => {
      // Repetir encabezado de Sin Pagos si la tabla de pendientes continúa en hojas siguientes
      if (dataHook.pageNumber > tabla2StartPage) {
        drawHeader(
          doc,
          data.periodoLabel,
          'Centro Medico - Gestión Resumen Cuidar · Sin Pagos',
        )
      }
    },
    didParseCell: (hookData) => {
      // Fila de totales
      if (hookData.section === 'body' && hookData.row.index === bodyNoPagos.length - 1) {
        hookData.cell.styles.fontStyle = 'bold'
        hookData.cell.styles.fillColor = COLOR_BG_TOTALS
        hookData.cell.styles.textColor = COLOR_NAVY
        hookData.cell.styles.lineWidth = 0.25
        hookData.cell.styles.lineColor = [180, 195, 215]
        if (hookData.column.index === 5) {
          hookData.cell.styles.textColor = COLOR_BLUE // Monto adeudado en azul negrita
        }
      }
      // Ocultar texto directo en celda de estado para dibujarlo con badge
      if (
        hookData.section === 'body' &&
        hookData.column.index === 6 &&
        hookData.row.index < bodyNoPagos.length - 1
      ) {
        hookData.cell.text = []
      }
    },
    didDrawCell: (hookData) => {
      // Dibujar etiqueta redondeada (badge) en columna Estado
      if (
        hookData.section === 'body' &&
        hookData.column.index === 6 &&
        hookData.row.index < bodyNoPagos.length - 1
      ) {
        const rawState = hookData.cell.raw as string
        if (rawState === 'Pendiente' || rawState === 'Sin Plus') {
          const badgeW = 22
          const badgeH = 4.8
          const badgeX = hookData.cell.x + (hookData.cell.width - badgeW) / 2
          const badgeY = hookData.cell.y + (hookData.cell.height - badgeH) / 2

          if (rawState === 'Pendiente') {
            doc.setFillColor(254, 226, 226) // #fee2e2
            doc.setDrawColor(252, 165, 165) // #fca5a5
            doc.setTextColor(185, 28, 28) // #b91c1c
          } else {
            doc.setFillColor(232, 238, 248) // #e8eef8
            doc.setDrawColor(203, 213, 225) // #cbd5e1
            doc.setTextColor(...COLOR_NAVY) // #12294a
          }

          doc.setLineWidth(0.2)
          doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'FD')
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(7)
          doc.text(rawState, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1, { align: 'center' })
        }
      }
    },
  })

  // ── 3. PIE DE PÁGINA EN TODAS LAS HOJAS ─────────────────────────────────────
  const totalPages = doc.getNumberOfPages()
  const fechaGenerado = format(new Date(), 'dd-MM-yyyy')

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COLOR_TEXT_MUTED)

    const footerText = `Generado el ${fechaGenerado} · Página ${p} de ${totalPages}`
    doc.text(footerText, PAGE_W - MARGIN_X, PAGE_H - 6.5, { align: 'right' })

    // Rótulo del sistema a la izquierda
    doc.text('Centro Médico — Reporte Mensual Detallado', MARGIN_X, PAGE_H - 6.5)
  }

  // Nombre del archivo
  const filename = data.doctorSeleccionado
    ? `PDF Mensual B ${anioMes} - ${data.doctorSeleccionado.apellido}, ${data.doctorSeleccionado.nombre}.pdf`
    : `PDF Mensual B ${anioMes}.pdf`

  return {
    doc,
    filename,
    title: filename.replace(/\.pdf$/i, ''),
  }
}

