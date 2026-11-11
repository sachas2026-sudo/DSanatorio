import { format, parseISO } from 'date-fns'
import type { AppData, Payment } from '../types'
import { aggregateResumenSettlementForPayments } from './paymentPorcentaje'
import { esPagoTransferencia } from './pagosPdfLayout'

export interface MedicoResumenItem {
  id?: string
  nombre: string
  especialidad?: string
  pacientes: number
  monto: number // Honorarios del médico requeridos por resumen_periodo
  totalCobrado?: number
  totalCentro?: number
  totalMedico?: number
}

export interface TurnosClasificacionItem {
  obra_social: number
  individual: number
  familiar: number
  plan_plus: number // legacy: planes antiguos (Plan Plus, Estándar, Ultra) y afiliados sin tipo
  particular: number
}

export interface TurnosClasificacion {
  atendidos: TurnosClasificacionItem
  pendientes: TurnosClasificacionItem
  cancelados: TurnosClasificacionItem
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
  turnos_clasificacion: TurnosClasificacion
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

  // 4. Turnos del día según la fecha local (misma lógica que la Agenda)
  const turnosDelDia = data.appointments.filter((a) => {
    try {
      return format(parseISO(a.fechaHora), 'yyyy-MM-dd') === fechaTarget
    } catch {
      return false
    }
  })

  // Agrupar turnos activos (no cancelados) por médico para contar todos los turnos hayan pagado o no plus/abono
  const turnosActivosPorMedico = new Map<string, typeof turnosDelDia>()
  for (const t of turnosDelDia) {
    const estado = (t.estado || '').toLowerCase().trim()
    if (estado === 'cancelado') continue
    const list = turnosActivosPorMedico.get(t.doctorId) ?? []
    list.push(t)
    turnosActivosPorMedico.set(t.doctorId, list)
  }

  // 5. Detalle y liquidación por médico (incluye médicos con pagos y/o turnos sin pago de plus/abono)
  const allDoctorIds = new Set<string>([
    ...pagosPorMedico.keys(),
    ...turnosActivosPorMedico.keys(),
  ])
  const medicosDetalle: MedicoResumenItem[] = []
  for (const doctorId of allDoctorIds) {
    const docPagos = pagosPorMedico.get(doctorId) ?? []
    const docTurnos = turnosActivosPorMedico.get(doctorId) ?? []
    const docInfo = doctorMap.get(doctorId)
    const docNombre = docInfo?.nombre ?? 'Médico eliminado'
    const pctFallback = () => docInfo?.porcentaje

    const settlement = aggregateResumenSettlementForPayments(docPagos, pctFallback)

    const cobradoDoc = settlement.facturado
    const centroDoc = settlement.comision
    const medicoDoc = settlement.efectivoAEntregar

    totalCentro += centroDoc
    totalMedicos += medicoDoc

    // Contar todos los turnos del médico (hayan pagado o no plus/abono) + pagos directos sin cita en agenda
    const turnoIds = new Set(docTurnos.map((t) => t.id))
    const turnoPacientes = new Set(docTurnos.map((t) => t.patientId))
    let pagosSinTurnoCount = 0
    for (const p of docPagos) {
      if (p.citaId && turnoIds.has(p.citaId)) continue
      if (turnoPacientes.has(p.patientId)) continue
      pagosSinTurnoCount++
    }
    const totalPacientesDoc = docTurnos.length + pagosSinTurnoCount

    medicosDetalle.push({
      id: doctorId,
      nombre: docNombre,
      especialidad: docInfo?.especialidad,
      pacientes: totalPacientesDoc,
      monto: Math.round(medicoDoc * 100) / 100,
      totalCobrado: Math.round(cobradoDoc * 100) / 100,
      totalCentro: Math.round(centroDoc * 100) / 100,
      totalMedico: Math.round(medicoDoc * 100) / 100,
    })
  }

  // Ordenar médicos por mayor monto y luego por cantidad de turnos/pacientes
  medicosDetalle.sort((a, b) => b.monto - a.monto || b.pacientes - a.pacientes)

  // Mapas para clasificación unívoca de cobertura (incluye titulares y adherentes de planes activos)
  const patientMap = new Map((data.patients || []).map((p) => [p.id, p]))
  const afiliadosActivosSet = new Set<string>()
  for (const a of data.afiliados || []) {
    if (a.activo !== false) {
      if (a.patientId) afiliadosActivosSet.add(a.patientId)
      for (const adh of a.adherentes || []) {
        if (adh.patientId) afiliadosActivosSet.add(adh.patientId)
      }
    }
  }
  const planNombresSet = new Set(
    (data.planesAfiliados || []).map((pl) => pl.nombre.trim().toLowerCase()),
  )
  for (const p of [
    'plan estándar',
    'plan estandar',
    'plan plus',
    'plan ultra',
    'familiar',
    'individual',
    'plan familiar',
    'plan individual',
  ]) {
    planNombresSet.add(p)
  }

  let turnosAtendidos = 0
  let turnosCancelados = 0
  let turnosPendientes = 0

  const clasificacion: TurnosClasificacion = {
    atendidos: { obra_social: 0, individual: 0, familiar: 0, plan_plus: 0, particular: 0 },
    pendientes: { obra_social: 0, individual: 0, familiar: 0, plan_plus: 0, particular: 0 },
    cancelados: { obra_social: 0, individual: 0, familiar: 0, plan_plus: 0, particular: 0 },
  }

  for (const t of turnosDelDia) {
    const override = (t.obraSocialOverride || '').trim()
    const overrideNorm = override.toLowerCase()
    const patient = patientMap.get(t.patientId)
    const osPaciente = (patient?.obraSocial || '').trim()
    const osPacienteNorm = osPaciente.toLowerCase()
    const isAfiliado = afiliadosActivosSet.has(t.patientId)

    // Resolver tipo de plan (individual/familiar) para afiliados activos
    const resolverTipoAfiliado = (patientId: string): 'individual' | 'familiar' | null => {
      const af = (data.afiliados || []).find(
        (a) =>
          a.activo !== false &&
          (a.patientId === patientId ||
            (a.adherentes || []).some((adh) => adh.patientId === patientId)),
      )
      if (!af) return null
      const plan = (data.planesAfiliados || []).find((p) => p.id === af.planId)
      if (plan?.tipo === 'individual' || plan?.tipo === 'familiar') return plan.tipo
      return null
    }

    let cat: 'obra_social' | 'individual' | 'familiar' | 'plan_plus' | 'particular' = 'particular'
    if (overrideNorm === 'particular') {
      cat = 'particular'
    } else if (isAfiliado) {
      const tipo = resolverTipoAfiliado(t.patientId)
      cat = tipo === 'individual' ? 'individual' : tipo === 'familiar' ? 'familiar' : 'plan_plus'
    } else if (override && planNombresSet.has(overrideNorm)) {
      if (overrideNorm === 'individual' || overrideNorm === 'plan individual') cat = 'individual'
      else if (overrideNorm === 'familiar' || overrideNorm === 'plan familiar') cat = 'familiar'
      else cat = 'plan_plus'
    } else if (!override && osPaciente && planNombresSet.has(osPacienteNorm)) {
      if (osPacienteNorm === 'individual' || osPacienteNorm === 'plan individual') cat = 'individual'
      else if (osPacienteNorm === 'familiar' || osPacienteNorm === 'plan familiar') cat = 'familiar'
      else cat = 'plan_plus'
    } else if (override) {
      cat = 'obra_social'
    } else if (
      osPaciente &&
      !['particular', 'ninguna', 'sin obra social', 'no tiene', '-'].includes(osPacienteNorm)
    ) {
      cat = 'obra_social'
    } else {
      cat = 'particular'
    }

    const estado = (t.estado || '').toLowerCase().trim()
    if (estado === 'cancelado') {
      turnosCancelados++
      clasificacion.cancelados[cat]++
    } else if (estado === 'atendido') {
      turnosAtendidos++
      clasificacion.atendidos[cat]++
    } else {
      // 'programado', 'presente', o cualquier turno activo en espera de atención
      turnosPendientes++
      clasificacion.pendientes[cat]++
    }
  }

  const turnosTotales = turnosAtendidos + turnosPendientes + turnosCancelados

  return {
    fecha: fechaTarget,
    total_cobrado: Math.round(totalCobrado * 100) / 100,
    total_centro: Math.round(totalCentro * 100) / 100,
    total_medicos: Math.round(totalMedicos * 100) / 100,
    total_efectivo: Math.round(totalEfectivo * 100) / 100,
    total_transferencia: Math.round(totalTransferencia * 100) / 100,
    total_otros: Math.round(totalOtros * 100) / 100,
    turnos_totales: turnosTotales,
    turnos_atendidos: turnosAtendidos,
    turnos_cancelados: turnosCancelados,
    turnos_pendientes: turnosPendientes,
    recaudacion_manana: Math.round(recaudacionManana * 100) / 100,
    recaudacion_tarde: Math.round(recaudacionTarde * 100) / 100,
    recaudacion_mary: Math.round(recaudacionMary * 100) / 100,
    recaudacion_andrea: Math.round(recaudacionAndrea * 100) / 100,
    medicos_detalle: medicosDetalle,
    turnos_clasificacion: clasificacion,
    ultima_actualizacion: new Date().toISOString(),
    origen: `Sanatorio Desktop|${JSON.stringify(clasificacion)}`,
  }
}
