import type jsPDF from 'jspdf'
import type { CuotaMensual, Patient, PlanAfiliado } from '../types'
import { generarReciboPdf } from './reciboPdf'

function formatFechaPago(fecha: string | null): string {
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

export function buildAfiliadoComprobantePdf(params: {
  patient: Patient
  plan?: PlanAfiliado
  cuota: CuotaMensual
  nombreMes: string
}): { doc: jsPDF; filename: string } {
  const { patient, plan, cuota, nombreMes } = params

  const doc = generarReciboPdf({
    paciente: `${patient.apellido}, ${patient.nombre}`,
    dni: patient.dni || '—',
    cobertura: plan?.nombre || '—',
    periodo: `${nombreMes} ${cuota.anio}`,
    fechaPago: formatFechaPago(cuota.fechaPago),
    formaPago: formaPagoLabel(cuota.formaPago),
    importe: cuota.monto,
    nroRecibo: cuota.id,
  })

  const safeName = `${patient.apellido}-${patient.nombre}`
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return {
    doc,
    filename: `comprobante-pago-${safeName}-${cuota.anio}-${String(cuota.mes).padStart(2, '0')}.pdf`,
  }
}
