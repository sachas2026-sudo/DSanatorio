import { brandGestiónLine } from './pdfBranding'

export type PagosPorMedicoEmailRow = {
  nombre: string
  monto: string
}

export type PagosDetalleEmailRow = {
  fecha: string
  paciente: string
  medico: string
  monto: string
  metodo: string
}

export function buildPagosResumenEmailBody(params: {
  periodLabel: string
  periodoTipo: string
  filtroMedicoLabel?: string
  totalCobrado: string
  cantidadPagos: number
  porMedico: PagosPorMedicoEmailRow[]
  detalle: PagosDetalleEmailRow[]
}): string {
  const lines: string[] = [
    brandGestiónLine(),
    `Resumen de pagos de consultas — ${params.periodLabel}`,
    `Tipo de período: ${params.periodoTipo}`,
  ]

  if (params.filtroMedicoLabel) {
    lines.push(`Filtro médico: ${params.filtroMedicoLabel}`)
  }

  lines.push(
    '',
    `Total cobrado: ${params.totalCobrado}`,
    `Cantidad de pagos: ${params.cantidadPagos}`,
  )

  if (params.porMedico.length > 0) {
    lines.push('', 'Por médico:')
    for (const row of params.porMedico) {
      lines.push(`  ${row.nombre}  |  ${row.monto}`)
    }
  } else {
    lines.push('', 'Sin cobranzas por médico en este período.')
  }

  if (params.detalle.length > 0) {
    lines.push('', 'Detalle de pagos:')
    for (const r of params.detalle) {
      lines.push(
        `  ${r.fecha}  |  ${r.paciente}  |  ${r.medico}  |  ${r.monto}  |  ${r.metodo}`,
      )
    }
  } else {
    lines.push('', 'No hay pagos registrados en este período.')
  }

  return lines.join('\n')
}

export function periodoTipoLabel(periodo: 'dia' | 'mes' | 'anio'): string {
  if (periodo === 'dia') return 'Día'
  if (periodo === 'mes') return 'Mes'
  return 'Año'
}
