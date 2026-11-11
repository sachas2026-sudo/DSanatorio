import { format } from 'date-fns'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { AdherenteAfiliado, Afiliado, CuotaMensual, Patient, PlanAfiliado } from '../types'
import { drawPdfHeader, pdfBodyStartYAfterHeader } from './pdfHeader'

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function formaPagoLabel(formaPago: CuotaMensual['formaPago']): string {
  switch (formaPago) {
    case 'efectivo': return 'Efectivo'
    case 'transferencia': return 'Transferencia'
    case 'deposito': return 'Depósito'
    case 'mercadopago': return 'Mercado Pago'
    case 'debito': return 'Débito'
    default: return '—'
  }
}

type Row = {
  paciente: Patient | undefined
  plan: PlanAfiliado | undefined
  cuotas: Map<number, CuotaMensual>
  adherentes: AdherenteAfiliado[]
}

export function buildAfiliadosPagosPdf(params: {
  patients: Patient[]
  afiliados: Afiliado[]
  planes: PlanAfiliado[]
  cuotas: CuotaMensual[]
  anio: number
  titulo?: string
  encabezadoSecundario?: string
  filename?: string
  showSinglePatientDetails?: boolean
}): { doc: jsPDF; filename: string; count: number } {
  const {
    patients,
    afiliados,
    planes,
    cuotas,
    anio,
    titulo = 'CENTRO MEDICO - COBERTURA DE SALUD',
    encabezadoSecundario = `Cuotas ${anio}`,
    showSinglePatientDetails = true,
  } = params
  const patientById = new Map(patients.map(p => [p.id, p]))
  const planById = new Map(planes.map(p => [p.id, p]))
  const cuotasByAfiliado = new Map<string, Map<number, CuotaMensual>>()

  for (const cuota of cuotas) {
    if (cuota.anio !== anio) continue
    const byMonth = cuotasByAfiliado.get(cuota.afiliadoId) ?? new Map<number, CuotaMensual>()
    byMonth.set(cuota.mes, cuota)
    cuotasByAfiliado.set(cuota.afiliadoId, byMonth)
  }

  const rows = afiliados
    .filter(a => a.activo)
    .map(a => ({
      paciente: patientById.get(a.patientId),
      plan: planById.get(a.planId),
      cuotas: cuotasByAfiliado.get(a.id) ?? new Map(),
      adherentes: Array.isArray(a.adherentes) ? a.adherentes : [],
    }))
    .filter((row): row is Row & { paciente: Patient } => Boolean(row.paciente))
    .sort((a, b) => `${a.paciente.apellido} ${a.paciente.nombre}`.localeCompare(`${b.paciente.apellido} ${b.paciente.nombre}`, 'es', { sensitivity: 'base' }))

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 10

  const drawHeader = () => {
    return drawPdfHeader(doc, pageW, '', {
      titleOverride: `${titulo} - Año ${anio}`,
      secondLine: encabezadoSecundario,
    })
  }

  const headerBottom = drawHeader()

  const tableW = pageW - margin * 2
  const fixedWidths = 48 + 17 + 16 + 16 + 14
  const monthWidth = (tableW - fixedWidths) / MESES_CORTOS.length
  const widths = [48, 17, 16, 16, ...MESES_CORTOS.map(() => monthWidth), 14]
  const paidMonths = rows.map(row => new Set(
    [...row.cuotas.entries()].filter(([, cuota]) => cuota.estado === 'pagado').map(([mes]) => mes),
  ))
  const totalsPaid = rows.map(row => [...row.cuotas.values()]
    .filter(cuota => cuota.estado === 'pagado')
    .reduce((total, cuota) => total + cuota.monto, 0))
  const body = rows.map((row, rowIndex) => {
    return [
      `${row.paciente.apellido}, ${row.paciente.nombre}`,
      row.paciente.dni || '-',
      row.plan?.nombre?.replace(/^Plan\s+/i, '') || '-',
      row.plan ? `$${row.plan.precio.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}` : '-',
      ...MESES_CORTOS.map(() => ''),
      `$${totalsPaid[rowIndex]!.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`,
    ]
  })
  let tableStartY = pdfBodyStartYAfterHeader(headerBottom, 4)

  if (rows.length === 1 && showSinglePatientDetails) {
    const cuotaRow = rows[0]
    const cuotasDelAnio = [...cuotaRow.cuotas.values()]
    const cuotasPorMes = Array.from({ length: 12 }, (_, index) => cuotaRow.cuotas.get(index + 1))
    const montosPorMes = cuotasPorMes.map(cuota => cuota?.monto ?? cuotaRow.plan?.precio ?? 0)
    const pagadas = cuotasDelAnio.filter(cuota => cuota.estado === 'pagado').length
    const noPagadas = Math.max(0, 12 - pagadas)
    const totalPlan = montosPorMes.reduce((total, monto) => total + monto, 0)
    const totalPagado = cuotasDelAnio
      .filter(cuota => cuota.estado === 'pagado')
      .reduce((total, cuota) => total + cuota.monto, 0)
    const totalAdeudado = cuotasPorMes
      .filter(cuota => cuota?.estado !== 'pagado')
      .reduce((total, cuota, index) => total + (cuota?.monto ?? montosPorMes[index] ?? 0), 0)
    const boxY = tableStartY
    const boxH = 19
    const boxW = pageW - margin * 2
    const itemW = boxW / 5
    doc.setFillColor(244, 249, 252)
    doc.setDrawColor(211, 225, 235)
    doc.setLineWidth(0.25)
    doc.rect(margin, boxY, boxW, boxH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(35, 76, 101)
    ;['Cuotas Adeudadas', 'Cuotas Pagadas', 'Total Adeudado', 'Total Pagado', 'Total Cobertura'].forEach((label, index) => {
      doc.text(label, margin + itemW * index + itemW / 2, boxY + 7, { align: 'center' })
    })
    doc.setFontSize(11)
    doc.setTextColor(217, 119, 6)
    doc.text(String(noPagadas), margin + itemW / 2, boxY + 14, { align: 'center' })
    doc.setTextColor(22, 132, 115)
    doc.text(String(pagadas), margin + itemW + itemW / 2, boxY + 14, { align: 'center' })
    doc.setTextColor(217, 119, 6)
    doc.text(`$${totalAdeudado.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`, margin + itemW * 2 + itemW / 2, boxY + 14, { align: 'center' })
    doc.setTextColor(22, 132, 115)
    doc.text(`$${totalPagado.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`, margin + itemW * 3 + itemW / 2, boxY + 14, { align: 'center' })
    doc.text(`$${totalPlan.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`, margin + itemW * 4 + itemW / 2, boxY + 14, { align: 'center' })
    tableStartY = boxY + boxH + 7
  }

  autoTable(doc, {
    startY: tableStartY,
    head: [['Paciente', 'DNI', 'Cobertura', 'Valor', ...MESES_CORTOS, 'Total']],
    body: body.length ? body : [['No hay contratantes registrados', '', '', '', ...MESES_CORTOS.map(() => ''), '']],
    margin: { left: margin, right: margin },
    tableWidth: tableW,
    columnStyles: Object.fromEntries(widths.map((cellWidth, index) => [index, {
      cellWidth,
      halign: index >= 4 && index <= 15 ? 'center' : 'left',
    }])),
    styles: {
      font: 'helvetica',
      fontSize: 6.8,
      textColor: [49, 65, 84],
      lineColor: [222, 231, 241],
      lineWidth: 0.15,
      cellPadding: { top: 1.7, right: 1.2, bottom: 1.7, left: 1.2 },
      valign: 'middle',
      overflow: 'ellipsize',
    },
    headStyles: {
      fillColor: [39, 111, 137],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'center',
      cellPadding: { top: 3, right: 0.5, bottom: 3, left: 0.5 },
    },
    alternateRowStyles: { fillColor: [247, 250, 253] },
    didParseCell: data => {
      if (data.section === 'body' && (data.column.index === 3 || data.column.index === 16) && data.cell.text[0] !== '-') {
        data.cell.styles.textColor = [22, 132, 115]
        data.cell.styles.fontStyle = 'bold'
      }
    },
    didDrawCell: data => {
      const monthIndex = data.column.index - 4
      if (data.section !== 'body' || monthIndex < 0 || data.row.index >= paidMonths.length) return
      if (!paidMonths[data.row.index]?.has(monthIndex + 1)) return
      const x = data.cell.x + data.cell.width / 2
      const y = data.cell.y + data.cell.height / 2
      doc.setDrawColor(22, 132, 115)
      doc.setLineWidth(0.38)
      doc.line(x - 0.9, y, x - 0.2, y + 0.75)
      doc.line(x - 0.2, y + 0.75, x + 1.15, y - 0.95)
      doc.setLineWidth(0.15)
    },
    didDrawPage: data => {
      if (data.pageNumber > 1) drawHeader()
    },
  })

  const totalPages = doc.getNumberOfPages()
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    doc.setPage(pageNumber)
    doc.setDrawColor(220, 228, 237)
    doc.line(margin, pageH - 13, pageW - margin, pageH - 13)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(112, 128, 148)
    doc.text(`Generado el ${format(new Date(), 'dd-MM-yy')}`, margin, pageH - 8)
    doc.text(`Página ${pageNumber} de ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' })
  }

  if (rows.length === 1 && showSinglePatientDetails) {
    const cuotaRow = rows[0]
    const cuotasDelAnio = [...cuotaRow.cuotas.values()]
    const cuotasPorMes = Array.from({ length: 12 }, (_, index) => cuotaRow.cuotas.get(index + 1))
    const montosPorMes = cuotasPorMes.map(cuota => cuota?.monto ?? cuotaRow.plan?.precio ?? 0)
    let finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60
    const adherentes = cuotaRow.plan?.tipo === 'familiar'
      ? cuotaRow.adherentes
        .map((adherente) => {
          const paciente = patientById.get(adherente.patientId)
          return paciente
            ? [`${paciente.apellido}, ${paciente.nombre}`, paciente.dni || '—', adherente.relacion || '—']
            : null
        })
        .filter((adherente): adherente is [string, string, string] => adherente !== null)
      : []

    if (adherentes.length > 0) {
      const adherentesTitleY = finalY + 7
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(35, 76, 101)
      doc.text('Adherentes incluidos en el plan familiar', margin, adherentesTitleY)
      autoTable(doc, {
        startY: adherentesTitleY + 3,
        head: [['Adherente', 'DNI', 'Relación']],
        body: adherentes,
        margin: { left: margin, right: margin },
        tableWidth: tableW,
        columnStyles: {
          0: { cellWidth: 88 },
          1: { cellWidth: 42 },
          2: { cellWidth: tableW - 130 },
        },
        styles: {
          font: 'helvetica',
          fontSize: 7.5,
          textColor: [49, 65, 84],
          lineColor: [222, 231, 241],
          lineWidth: 0.15,
          cellPadding: { top: 1.8, right: 2, bottom: 1.8, left: 2 },
        },
        headStyles: {
          fillColor: [39, 111, 137],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [247, 250, 253] },
        didDrawPage: data => {
          if (data.pageNumber > 1) drawHeader()
        },
      })
      finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? finalY
    }

    const boxY = finalY + 7
    const boxW = pageW - margin * 2

    const resumenValores: Array<{
      monto: number
      meses: number[]
      pagadas: number
      abonado: number
      adeudado: number
    }> = []
    montosPorMes.forEach((monto, index) => {
      const cuota = cuotasPorMes[index]
      const anterior = resumenValores[resumenValores.length - 1]
      if (!anterior || anterior.monto !== monto) {
        resumenValores.push({ monto, meses: [index + 1], pagadas: 0, abonado: 0, adeudado: 0 })
      } else {
        anterior.meses.push(index + 1)
      }
      const grupo = resumenValores[resumenValores.length - 1]!
      if (cuota?.estado === 'pagado') {
        grupo.pagadas += 1
        grupo.abonado += cuota.monto
      } else {
        grupo.adeudado += cuota?.monto ?? monto
      }
    })

    const detalleY = boxY + 8
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(35, 76, 101)
    doc.text('Resumen por valor de cuota', margin, detalleY)

    const detalleTop = detalleY + 4
    const detalleRowH = 7
    const detalleCols = [
      margin,
      margin + 31,
      margin + 63,
      margin + 101,
      margin + 132,
      pageW - margin,
    ]
    doc.setFillColor(39, 111, 137)
    doc.setDrawColor(222, 231, 241)
    doc.rect(margin, detalleTop, boxW, detalleRowH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(255, 255, 255)
    doc.text('Tipo', detalleCols[0] + 2, detalleTop + 4.6)
    doc.text('Meses', detalleCols[1] + 2, detalleTop + 4.6)
    doc.text('Valor cuota', detalleCols[2] + 2, detalleTop + 4.6)
    doc.text('Pagadas', detalleCols[3] + 2, detalleTop + 4.6)
    doc.text('Total abonado', detalleCols[4] + 2, detalleTop + 4.6)
    doc.text('Total adeudado', detalleCols[5] - 2, detalleTop + 4.6, { align: 'right' })

    resumenValores.forEach((grupo, index) => {
      const y = detalleTop + detalleRowH + index * detalleRowH
      const meses = grupo.meses.length === 1
        ? MESES_CORTOS[grupo.meses[0]! - 1]
        : `${MESES_CORTOS[grupo.meses[0]! - 1]}–${MESES_CORTOS[grupo.meses[grupo.meses.length - 1]! - 1]}`
      doc.setFillColor(index % 2 === 0 ? 247 : 255, index % 2 === 0 ? 250 : 255, index % 2 === 0 ? 253 : 255)
      doc.setDrawColor(222, 231, 241)
      doc.rect(margin, y, boxW, detalleRowH, 'FD')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(49, 65, 84)
      doc.text(index === 0 ? 'Valor inicial' : 'Cambio de valor', detalleCols[0] + 2, y + 4.6)
      doc.text(meses, detalleCols[1] + 2, y + 4.6)
      doc.setTextColor(22, 132, 115)
      doc.text(`$${grupo.monto.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`, detalleCols[2] + 2, y + 4.6)
      doc.text(String(grupo.pagadas), detalleCols[3] + 2, y + 4.6)
      doc.text(`$${grupo.abonado.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`, detalleCols[4] + 2, y + 4.6)
      doc.setTextColor(217, 119, 6)
      doc.text(`$${grupo.adeudado.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`, detalleCols[5] - 2, y + 4.6, { align: 'right' })
    })

    const pagos = cuotasDelAnio
      .filter(cuota => cuota.estado === 'pagado')
      .sort((a, b) => a.mes - b.mes)
    const pagosTitleY = detalleTop + (resumenValores.length + 1) * detalleRowH + 8
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(35, 76, 101)
    doc.text('Resumen de cuotas pagadas', margin, pagosTitleY)

    const pagosTop = pagosTitleY + 4
    const pagosRowH = 7
    const pagosCols = [margin, margin + 27, margin + 59, margin + 100, margin + 151, pageW - margin]
    doc.setFillColor(39, 111, 137)
    doc.setDrawColor(222, 231, 241)
    doc.rect(margin, pagosTop, boxW, pagosRowH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(255, 255, 255)
    doc.text('Mes', pagosCols[0] + 2, pagosTop + 4.6)
    doc.text('Fecha pago', pagosCols[1] + 2, pagosTop + 4.6)
    doc.text('Importe', pagosCols[2] + 2, pagosTop + 4.6)
    doc.text('Forma de pago', pagosCols[3] + 2, pagosTop + 4.6)
    doc.text('Comprobante', pagosCols[5] - 2, pagosTop + 4.6, { align: 'right' })

    const pagosRows = pagos.length ? pagos : [null]
    pagosRows.forEach((cuota, index) => {
      const y = pagosTop + pagosRowH + index * pagosRowH
      doc.setFillColor(index % 2 === 0 ? 247 : 255, index % 2 === 0 ? 250 : 255, index % 2 === 0 ? 253 : 255)
      doc.setDrawColor(222, 231, 241)
      doc.rect(margin, y, boxW, pagosRowH, 'FD')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(49, 65, 84)
      if (!cuota) {
        doc.text('No hay cuotas pagadas', margin + 2, y + 4.6)
        return
      }
      const fecha = cuota.fechaPago
        ? format(new Date(`${cuota.fechaPago}T00:00:00`), 'dd-MM-yy')
        : '—'
      doc.text(MESES_CORTOS[cuota.mes - 1] ?? '—', pagosCols[0] + 2, y + 4.6)
      doc.text(fecha, pagosCols[1] + 2, y + 4.6)
      doc.setTextColor(22, 132, 115)
      doc.text(`$${cuota.monto.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`, pagosCols[2] + 2, y + 4.6)
      doc.setTextColor(49, 65, 84)
      doc.text(formaPagoLabel(cuota.formaPago), pagosCols[3] + 2, y + 4.6)
      doc.text(cuota.comprobante ? 'Sí' : 'No', pagosCols[5] - 2, y + 4.6, { align: 'right' })
    })
  }

  return {
    doc,
    filename: params.filename ?? `lista-pacientes-pagos-${anio}.pdf`,
    count: rows.length,
  }
}
