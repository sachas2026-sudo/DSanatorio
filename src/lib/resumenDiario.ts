import { format, parseISO } from 'date-fns'
import type { AppData, Payment } from '../types'
import { aggregateResumenSettlementForPayments } from './paymentPorcentaje'
import { esPagoTransferencia } from './pagosPdfLayout'

export interface MedicoResumenItem {
  id: string
  nombre: string
  especialidad?: string
  pacientes: number
  totalCobrado: number
  totalCentro: number
  totalMedico: number
}

export interface ResumenDiarioPayload {
  fecha: string // YYYY-MM-DD
  total_cobrado: number
  total_centro: number
  total_medicos: number
  total_efectivo: number
  total_transferencia: number
  total_otros: number
  turnos_totales: number
  turnos_atendidos: number
  turnos_cancelados: number
  turnos_pendientes: number
  recaudacion_manana: number
  recaudacion_tarde: number
  recaudacion_mary: number
  recaudacion_andrea: number
  medicos_detalle: MedicoResumenItem[]
  ultima_actualizacion: string // ISO
  origen: string
}

/**
 * Calcula el resumen gerencial/administrativo para un día específico (YYYY-MM-DD).
 */
export function calcularResumenDiario(
  data: AppData,
  fechaTarget: string = format(new Date(), 'yyyy-MM-dd'),
): ResumenDiarioPayload {
  // 1. Filtrar pagos del día
  const pagosDelDia = data.payments.filter((p) => {
    try {
      const fechaP = format(parseISO(p.fecha), 'yyyy-MM-dd')
      return fechaP === fechaTarget
    } catch {
      return false
    }
  })

  // 2. Map de nombres y porcentajes de médicos
  const doctorMap = new Map<string, { nombre: string; especialidad?: string; porcentaje?: number }>()
  for (const doc of data.doctors) {
    const nombreCompleto = `${doc.apellido}, ${doc.nombre}`.replace(/^,\s*/, '').trim() || 'Médico'
    doctorMap.set(doc.id, {
      nombre: nombreCompleto,
      especialidad: doc.especialidad,
      porcentaje: doc.porcentaje,
    })
  }

  // 3. Totales globales de pagos
  let totalCobrado = 0
  let totalCentro = 0
  let totalMedicos = 0
  let totalEfectivo = 0
  let totalTransferencia = 0
  let totalOtros = 0
  let recaudacionManana = 0
  let recaudacionTarde = 0
  let recaudacionMary = 0
  let recaudacionAndrea = 0

  // Agrupación por médico
  const pagosPorMedico = new Map<string, Payment[]>()

  for (const p of pagosDelDia) {
    const monto = Number(p.monto) || 0
    totalCobrado += monto

    // Medios de pago
    if (esPagoTransferencia(p.metodo)) {
      totalTransferencia += monto
    } else if (p.metodo.trim().toLowerCase() === 'efectivo') {
      totalEfectivo += monto
    } else {
      totalOtros += monto
    }

    // Por horario (mañana: antes de las 14:00, tarde: 14:00 en adelante)
    try {
      const hora = parseISO(p.fecha).getHours()
      if (hora < 14) {
        recaudacionManana += monto
      } else {
        recaudacionTarde += monto
      }
    } catch {
      recaudacionManana += monto
    }

    // Por usuario registrado
    const reg = (p.registradoPor || '').toLowerCase()
    if (reg.includes('mary') || reg.includes('aguirre')) {
      recaudacionMary += monto
    } else if (reg.includes('andrea') || reg.includes('barua')) {
      recaudacionAndrea += monto
    }

    // Agrupar
    const list = pagosPorMedico.get(p.doctorId) ?? []
    list.push(p)
    pagosPorMedico.set(p.doctorId, list)
  }

  // 4. Detalle y liquidación por médico
  const medicosDetalle: MedicoResumenItem[] = []
  for (const [doctorId, docPagos] of pagosPorMedico.entries()) {
    const docInfo = doctorMap.get(doctorId)
    const docNombre = docInfo?.nombre ?? 'Médico eliminado'
    const pctFallback = () => docInfo?.porcentaje

    const settlement = aggregateResumenSettlementForPayments(docPagos, pctFallback)

    const cobradoDoc = settlement.facturado
    const centroDoc = settlement.comision
    const medicoDoc = settlement.efectivoAEntregar

    totalCentro += centroDoc
    totalMedicos += medicoDoc

    medicosDetalle.push({
      id: doctorId,
      nombre: docNombre,
      especialidad: docInfo?.especialidad,
      pacientes: docPagos.length,
      totalCobrado: Math.round(cobradoDoc * 100) / 100,
      totalCentro: Math.round(centroDoc * 100) / 100,
      totalMedico: Math.round(medicoDoc * 100) / 100,
    })
  }

  // Ordenar médicos por mayor total cobrado
  medicosDetalle.sort((a, b) => b.totalCobrado - a.totalCobrado)

  // 5. Turnos del día
  const turnosDelDia = data.appointments.filter((a) => {
    try {
      return format(parseISO(a.fechaHora), 'yyyy-MM-dd') === fechaTarget
    } catch {
      return false
    }
  })

  let turnosAtendidos = 0
  let turnosCancelados = 0
  let turnosPendientes = 0

  for (const t of turnosDelDia) {
    if (t.estado === 'atendido') {
      turnosAtendidos++
    } else if (t.estado === 'cancelado') {
      turnosCancelados++
    } else {
      turnosPendientes++
    }
  }

  // Sumar también cancelados históricos registrados en pagosCancelados de este día
  const canceladosRegistrados = data.pagosCancelados.filter((pc) => {
    try {
      return format(parseISO(pc.canceladoEn), 'yyyy-MM-dd') === fechaTarget
    } catch {
      return false
    }
  }).length

  const canceladosTotales = Math.max(turnosCancelados, canceladosRegistrados)

  return {
    fecha: fechaTarget,
    total_cobrado: Math.round(totalCobrado * 100) / 100,
    total_centro: Math.round(totalCentro * 100) / 100,
    total_medicos: Math.round(totalMedicos * 100) / 100,
    total_efectivo: Math.round(totalEfectivo * 100) / 100,
    total_transferencia: Math.round(totalTransferencia * 100) / 100,
    total_otros: Math.round(totalOtros * 100) / 100,
    turnos_totales: turnosDelDia.length,
    turnos_atendidos: turnosAtendidos,
    turnos_cancelados: canceladosTotales,
    turnos_pendientes: turnosPendientes,
    recaudacion_manana: Math.round(recaudacionManana * 100) / 100,
    recaudacion_tarde: Math.round(recaudacionTarde * 100) / 100,
    recaudacion_mary: Math.round(recaudacionMary * 100) / 100,
    recaudacion_andrea: Math.round(recaudacionAndrea * 100) / 100,
    medicos_detalle: medicosDetalle,
    ultima_actualizacion: new Date().toISOString(),
    origen: 'Sanatorio Desktop',
  }
}
