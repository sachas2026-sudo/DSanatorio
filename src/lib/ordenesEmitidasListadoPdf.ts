import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import type { OrdenMedica, Patient } from '../types'
import { getPdfLogo } from './pdfLogo'

export interface BuildOrdenesEmitidasListadoPdfParams {
  ordenes: readonly OrdenMedica[]
  patients: readonly Patient[]
  centroNombre?: string
  fechaGeneracion?: Date
}

export interface BuildOrdenesEmitidasListadoPdfResult {
  doc: jsPDF
  filename: string
  totalOrdenes: number
  totalConsultas: number
  totalPrestaciones: number
  totalAfiliados: number
}

function formatFechaAr(fechaIsoOrYmd?: string | null): string {
  if (!fechaIsoOrYmd) return '—'
  const clean = fechaIsoOrYmd.split('T')[0].trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean)
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`
  }
  return clean || '—'
}

export function buildOrdenesEmitidasListadoPdf({
  ordenes,
  patients,
  centroNombre = 'SANATORIO',
  fechaGeneracion = new Date(),
}: BuildOrdenesEmitidasListadoPdfParams): BuildOrdenesEmitidasListadoPdfResult {
  // A4 horizontal: 297 x 210 mm
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = 297
  const pageH = 210
  const margin = 12
  const contentW = pageW - margin * 2 // 273 mm

  const logoCache = getPdfLogo()

  const patientsMap = new Map<string, Patient>()
  patients.forEach((p) => patientsMap.set(p.id, p))

  // Ordenar de mayor a menor según la fecha (y número de orden descendente como desempate)
  const ordenesOrdenadas = [...ordenes].sort((a, b) => {
    const fA = (a.fecha || '').trim()
    const fB = (b.fecha || '').trim()
    if (fB !== fA) {
      return fB.localeCompare(fA)
    }
    return (b.numero || '').localeCompare(a.numero || '')
  })

  // Estadísticas globales
  const totalOrdenes = ordenesOrdenadas.length
  const totalConsultas = ordenesOrdenadas.filter((o) => o.tipo === 'consulta').length
  const totalPrestaciones = ordenesOrdenadas.filter((o) => o.tipo === 'prestacion').length
  const afiliadosSet = new Set(ordenesOrdenadas.map((o) => o.patientId))
  const totalAfiliados = afiliadosSet.size

  function drawTopHeader(startY: number) {
    // 1. Logo
    let textLeftX = margin
    if (logoCache?.dataUrl) {
      const imgH = 12
      const imgW = imgH * (logoCache.aspect || 1.3)
      try {
        doc.addImage(logoCache.dataUrl, logoCache.format, margin, startY, imgW, imgH)
        textLeftX = margin + imgW + 4
      } catch {
        // fallback
      }
    }

    // 2. Nombre del Centro y Subtítulo
    doc.setTextColor(15, 23, 42) // slate-900
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(centroNombre, textLeftX, startY + 5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139) // slate-500
    doc.text('Cobertura de Salud · Sistema de Contratantes', textLeftX, startY + 9.5)

    // 3. Título principal centrado o hacia la derecha
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(14, 116, 144) // cyan-700
    doc.text('LISTADO DE ÓRDENES MÉDICAS EMITIDAS', pageW / 2 + 10, startY + 6, {
      align: 'center',
    })

    // 4. Metadatos a la derecha
    const fechaEmisionStr = format(fechaGeneracion, 'dd/MM/yyyy HH:mm')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(71, 85, 105)
    doc.text(`Emisión: ${fechaEmisionStr}`, pageW - margin, startY + 5, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(14, 116, 144)
    doc.text(
      `Total: ${totalOrdenes} orden${totalOrdenes === 1 ? '' : 'es'}`,
      pageW - margin,
      startY + 9.5,
      { align: 'right' },
    )

    // Línea separadora
    doc.setDrawColor(226, 232, 240) // slate-200
    doc.setLineWidth(0.3)
    doc.line(margin, startY + 14, pageW - margin, startY + 14)
  }

  // Dibujar cabecera inicial en la primera página
  drawTopHeader(margin)

  // ── Tarjetas resumen (KPIs) en página 1 ──
  const kpiY = margin + 17
  const kpiH = 11
  const kpiGap = 4
  const kpiCount = 4
  const kpiW = (contentW - kpiGap * (kpiCount - 1)) / kpiCount // ~65 mm cada una

  const kpis = [
    { label: 'ÓRDENES EMITIDAS', val: `${totalOrdenes}`, sub: 'al momento', color: [14, 116, 144] },
    { label: 'CONSULTAS MÉDICAS', val: `${totalConsultas}`, sub: 'consultorios', color: [16, 185, 129] },
    { label: 'PRESTACIONES', val: `${totalPrestaciones}`, sub: 'estudios y prácticas', color: [139, 92, 246] },
    { label: 'CONTRATANTES / BENEFICIARIOS', val: `${totalAfiliados}`, sub: 'titulares y adherentes', color: [217, 119, 6] },
  ]

  kpis.forEach((k, idx) => {
    const kX = margin + idx * (kpiW + kpiGap)
    // Fondo de tarjeta
    doc.setFillColor(248, 250, 252) // slate-50
    doc.setDrawColor(226, 232, 240) // slate-200
    doc.setLineWidth(0.2)
    doc.roundedRect(kX, kpiY, kpiW, kpiH, 1.2, 1.2, 'FD')

    // Borde vertical de acento
    doc.setFillColor(k.color[0], k.color[1], k.color[2])
    doc.rect(kX, kpiY, 1.8, kpiH, 'F')

    // Textos
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.2)
    doc.setTextColor(100, 116, 139)
    doc.text(k.label, kX + 4.5, kpiY + 4)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(15, 23, 42)
    doc.text(k.val, kX + 4.5, kpiY + 8.8)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(148, 163, 184)
    doc.text(k.sub, kX + kpiW - 2.5, kpiY + 8.8, { align: 'right' })
  })

  // ── Generar filas de la tabla ──
  const tableHead = [
    [
      'N° ORDEN',
      'FECHA',
      'CONTRATANTE / PACIENTE',
      'COBERTURA',
      'TIPO',
      'PRESTACIÓN / DETALLE',
      'MÉDICO SOLICITANTE',
      'OBSERVACIONES',
    ],
  ]

  const tableBody =
    ordenesOrdenadas.length > 0
      ? ordenesOrdenadas.map((ord) => {
          const pac = patientsMap.get(ord.patientId)
          const apellido = (pac?.apellido || '').trim().toUpperCase()
          const nombre = (pac?.nombre || '').trim()
          const nombreCompleto = pac ? `${apellido}, ${nombre}` : '—'
          const dniStr = pac?.dni ? `DNI: ${pac.dni.trim()}` : ''
          const pacienteCol = dniStr ? `${nombreCompleto}\n${dniStr}` : nombreCompleto

          const detalle =
            ord.tipo === 'consulta'
              ? 'Consulta médica en consultorio'
              : (ord.prestacionNombre || 'Prestación médica')

          return [
            ord.numero || '—',
            formatFechaAr(ord.fecha),
            pacienteCol,
            ord.planNombre || '—',
            ord.tipo === 'consulta' ? 'Consulta' : 'Prestación',
            detalle,
            ord.medicoNombre || 'No especificado',
            ord.observaciones?.trim() || '—',
          ]
        })
      : [['No hay órdenes médicas emitidas registradas', '', '', '', '', '', '', '']]

  const tableStartY = kpiY + kpiH + 4

  autoTable(doc, {
    startY: tableStartY,
    head: tableHead,
    body: tableBody,
    margin: { left: margin, right: margin, bottom: 14 },
    tableWidth: contentW,
    columnStyles: {
      0: { cellWidth: 22, halign: 'center', fontStyle: 'bold', textColor: [14, 116, 144] },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 50, fontStyle: 'bold' },
      3: { cellWidth: 32 },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 47 },
      6: { cellWidth: 42 },
      7: { cellWidth: 38 },
    },
    styles: {
      font: 'helvetica',
      fontSize: 6.8,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 },
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [14, 116, 144], // #0e7490
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.2,
      halign: 'center',
      cellPadding: { top: 2.8, right: 1, bottom: 2.8, left: 1 },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        // Columna Tipo: colorear Consulta (verde) y Prestación (morado)
        if (data.column.index === 4) {
          const val = String(data.cell.raw ?? '')
          if (val === 'Consulta') {
            data.cell.styles.textColor = [5, 150, 105] // emerald-600
            data.cell.styles.fontStyle = 'bold'
          } else if (val === 'Prestación') {
            data.cell.styles.textColor = [124, 58, 237] // violet-600
            data.cell.styles.fontStyle = 'bold'
          }
        }
      }
    },
    didDrawPage: (data) => {
      // En páginas posteriores a la primera, redibujar la cabecera resumida
      if (data.pageNumber > 1) {
        drawTopHeader(margin)
      }
    },
  })

  // ── Numeración de páginas en pie ──
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.2)
    doc.line(margin, pageH - 9, pageW - margin, pageH - 9)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(148, 163, 184)
    doc.text(
      `Generado el ${format(fechaGeneracion, 'dd/MM/yyyy HH:mm')} · Sanatorio Sistema de Contratantes`,
      margin,
      pageH - 5.5,
    )
    doc.text(`Página ${i} de ${totalPages}`, pageW - margin, pageH - 5.5, { align: 'right' })
  }

  const filename = `ordenes-medicas-emitidas-${format(fechaGeneracion, 'yyyy-MM-dd')}.pdf`

  return {
    doc,
    filename,
    totalOrdenes,
    totalConsultas,
    totalPrestaciones,
    totalAfiliados,
  }
}

