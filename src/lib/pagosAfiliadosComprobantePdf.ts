import type jsPDF from 'jspdf'
import type { CuotaMensual } from '../types'
import { formatearMonto, nombrePeriodo } from './pagosAfiliados'
import { generarRecibosPdf, getReciboLogo, type ReciboPdfDatos } from './reciboPdf'

export interface ComprobantePagoAfiliado {
  cuota: CuotaMensual
  periodo: string
  fechaPago: string
  formaPago: string
}

function fechaPagoLatina(fecha: string | null): string {
  if (!fecha) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : fecha
}

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

export function datosComprobantePagoAfiliado(
  deudor: { nombre: string; dni: string; cobertura: string },
  cuota: CuotaMensual,
): ComprobantePagoAfiliado {
  return {
    cuota,
    periodo: nombrePeriodo(cuota.anio, cuota.mes),
    fechaPago: fechaPagoLatina(cuota.fechaPago),
    formaPago: formaPagoLabel(cuota.formaPago),
  }
}

/**
 * Un PDF con una página de recibo por cada cuota cobrada.
 * Reutiliza el diseño y la numeración de los comprobantes existentes.
 */
export function buildPagosAfiliadosComprobantePdf(params: {
  deudor: { nombre: string; dni: string; cobertura: string }
  cuotas: readonly CuotaMensual[]
}): { doc: jsPDF; filename: string } {
  const { deudor, cuotas } = params
  const logoDataUrl = getReciboLogo() ?? undefined

  const recibos: ReciboPdfDatos[] = cuotas.map((cuota) => {
    const datos = datosComprobantePagoAfiliado(deudor, cuota)
    return {
      paciente: deudor.nombre,
      dni: deudor.dni,
      cobertura: deudor.cobertura,
      periodo: datos.periodo,
      fechaPago: datos.fechaPago,
      formaPago: datos.formaPago,
      importe: cuota.monto,
      nroRecibo: cuota.id,
      logoDataUrl,
    }
  })

  const doc = generarRecibosPdf(recibos)
  const hoy = new Date()
  const stamp = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`
  const total = cuotas.reduce((sum, c) => sum + c.monto, 0)
  const filename = cuotas.length === 1
    ? `comprobante-pago-${stamp}-${Math.round(total)}.pdf`
    : `comprobantes-pagos-${stamp}-${cuotas.length}-cuotas.pdf`

  return { doc, filename }
}

/** Texto breve para el resumen de un cobro. */
export function resumenComprobantes(cuotas: readonly CuotaMensual[]): string {
  const total = cuotas.reduce((sum, c) => sum + c.monto, 0)
  if (cuotas.length === 1) return `${nombrePeriodo(cuotas[0]!.anio, cuotas[0]!.mes)} · ${formatearMonto(total)}`
  return `${cuotas.length} cuotas · ${formatearMonto(total)}`
}
