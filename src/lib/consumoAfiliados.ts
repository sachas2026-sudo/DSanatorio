import type { Appointment, PlanAfiliado, Afiliado, Patient, OrdenMedica } from '../types'
import { parseISO } from 'date-fns'
import { normalizeOsName } from './turnoMonto'

export type TipoAtencionAfiliado = 'consulta' | 'prestacion'

/**
 * Clasifica un motivo en 'consulta' o 'prestacion' (compatibilidad legacy).
 */
export function tipoDeMotivo(motivo?: string | null): TipoAtencionAfiliado {
  const norm = (motivo ?? '').trim().toLowerCase()
  if (
    !norm ||
    norm === 'consulta' ||
    norm === 'control' ||
    norm.startsWith('consulta') ||
    norm === 'certificado médico' ||
    norm === 'certificado medico'
  ) {
    return 'consulta'
  }
  return 'prestacion'
}

/**
 * Analiza si un turno con cobertura involucra consulta, prestación, o ambas.
 * Regla de negocio:
 * - Motivo de consulta 1: descuenta 1 consulta médica (el turno en sí es la consulta).
 * - Motivo de consulta 2: descuenta 1 prestación médica (si tiene motivo 2 cargado).
 */
export function analizarAtencionTurno(
  motivo1?: string | null,
  motivo2?: string | null,
): { esConsulta: boolean; esPrestacion: boolean } {
  const m1 = motivo1?.trim()
  const m2 = (motivo2 ?? '').trim().toLowerCase()

  const tieneMotivo2 = Boolean(
    m2 &&
    m2 !== 'sin motivo 2' &&
    m2 !== 'sin motivo' &&
    m2 !== 'ninguno' &&
    m2 !== 'no' &&
    m2 !== '-'
  )

  // Si tiene motivo 2 cargado:
  // Motivo 1 resta 1 consulta médica, y Motivo 2 resta 1 prestación
  if (tieneMotivo2) {
    return {
      esConsulta: true,
      esPrestacion: true,
    }
  }

  // Si solo hay motivo 1 y corresponde a una práctica médica aislada:
  if (m1 && tipoDeMotivo(m1) === 'prestacion') {
    return {
      esConsulta: false,
      esPrestacion: true,
    }
  }

  // Por defecto, Motivo 1 representa 1 consulta médica
  return {
    esConsulta: true,
    esPrestacion: false,
  }
}

/**
 * Comprueba si la cobertura de un turno coincide con el plan del afiliado,
 * tolerando variaciones como "Plan Individual", "Individual", "Cobertura Individual", etc.
 */
export function coberturaMatchesPlan(
  cobertura: string | null | undefined,
  plan: PlanAfiliado,
): boolean {
  if (!cobertura) return false
  const c = normalizeOsName(cobertura)
  const p = normalizeOsName(plan.nombre)
  if (!c || !p) return false
  if (c === p) return true

  // Quitar prefijos "plan " y "cobertura "
  const cClean = c.replace(/^(plan|cobertura)\s+/i, '').trim()
  const pClean = p.replace(/^(plan|cobertura)\s+/i, '').trim()
  if (cClean && pClean && cClean === pClean) return true

  // Coincidencia por tipo de plan (individual / familiar)
  if (plan.tipo === 'familiar' && c.includes('familiar')) return true
  if (plan.tipo === 'individual' && (c.includes('individual') || c.includes('individa'))) return true

  return false
}

export interface ConsumoAfiliadoMes {
  consultasUsadas: number
  consultasCupo: number
  consultasRestantes: number | null // null si cupo = 0 (sin límite)
  consultasAgotadas: boolean

  prestacionesUsadas: number
  prestacionesCupo: number
  prestacionesRestantes: number | null // null si cupo = 0 (sin límite)
  prestacionesAgotadas: boolean

  totalUsos: number
}

/**
 * Busca si un paciente está cubierto por un plan activo (sea como titular o como adherente).
 */
export function buscarAfiliacionYPlanPaciente(
  patientId: string,
  afiliados: readonly Afiliado[],
  planes: readonly PlanAfiliado[],
): { afiliado: Afiliado; plan: PlanAfiliado; esAdherente: boolean } | null {
  if (!patientId) return null

  // 1. Como titular
  const afilTitular = afiliados.find((a) => a.activo && a.patientId === patientId)
  if (afilTitular) {
    const plan = planes.find((p) => p.id === afilTitular.planId && p.activo)
    if (plan) {
      return { afiliado: afilTitular, plan, esAdherente: false }
    }
  }

  // 2. Como adherente
  for (const a of afiliados) {
    if (!a.activo || !Array.isArray(a.adherentes)) continue
    const adh = a.adherentes.find((x) => x.patientId === patientId)
    if (adh) {
      const plan = planes.find((p) => p.id === a.planId && p.activo)
      if (plan) {
        return { afiliado: a, plan, esAdherente: true }
      }
    }
  }

  return null
}

/**
 * Calcula el consumo mensual de consultas y prestaciones de un paciente bajo un plan
 * para un año y mes determinados a partir de los turnos registrados.
 */
export function calcularConsumoAfiliadoMes(params: {
  patientId: string
  anio: number
  mes: number // 1..12
  plan: PlanAfiliado
  appointments: readonly Appointment[]
  excludeAppointmentId?: string
  ordenesMedicas?: readonly OrdenMedica[]
}): ConsumoAfiliadoMes {
  const {
    patientId,
    anio,
    mes,
    plan,
    appointments,
    excludeAppointmentId,
    ordenesMedicas,
  } = params

  const cupoConsultas = plan.cupoConsultas ?? 0
  const cupoPrestaciones = plan.prestacionesPorMes ?? 0
  const planNorm = normalizeOsName(plan.nombre)

  let consultasUsadas = 0
  let prestacionesUsadas = 0

  for (const apt of appointments) {
    if (apt.id === excludeAppointmentId) continue
    if (apt.patientId !== patientId) continue
    if (apt.estado === 'cancelado') continue

    // Verificar si el turno fue cubierto por este plan
    const cob = apt.obraSocialOverride?.trim()
    if (!coberturaMatchesPlan(cob, plan)) continue

    // Verificar mes y año
    try {
      const d = parseISO(apt.fechaHora)
      if (d.getFullYear() !== anio || d.getMonth() + 1 !== mes) continue
    } catch {
      continue
    }

    const { esConsulta, esPrestacion } = analizarAtencionTurno(apt.notas, apt.motivoConsulta2)
    if (esConsulta) consultasUsadas++
    if (esPrestacion) prestacionesUsadas++
  }

  // Contar órdenes médicas emitidas para este paciente en el mes/año
  if (Array.isArray(ordenesMedicas)) {
    for (const ord of ordenesMedicas) {
      const matchPac =
        ord.patientId === patientId ||
        (Boolean(ord.afiliadoId) && ord.afiliadoId === patientId)
      if (!matchPac) continue
      try {
        const fechaClean = (ord.fecha ?? '').split('T')[0].trim()
        const slash = fechaClean.split('/')
        const dash = fechaClean.split('-')
        const parts = slash.length >= 3 ? slash : dash
        if (parts.length >= 3) {
          let ordAnio = parseInt(parts[0], 10)
          let ordMes = parseInt(parts[1], 10)
          if (parts[2].length === 4) {
            ordAnio = parseInt(parts[2], 10)
            ordMes = parseInt(parts[1], 10)
          } else if (parts[2].length === 2 && parts[0].length <= 2) {
            ordAnio = 2000 + parseInt(parts[2], 10)
            ordMes = parseInt(parts[1], 10)
          }
          if (ordAnio !== anio || ordMes !== mes) continue
        } else {
          const d = parseISO(ord.fecha)
          if (d.getFullYear() !== anio || d.getMonth() + 1 !== mes) continue
        }
      } catch {
        continue
      }

      if (ord.tipo === 'consulta') {
        consultasUsadas++
      } else if (ord.tipo === 'prestacion') {
        prestacionesUsadas++
      }
    }
  }

  const consultasRestantes = cupoConsultas > 0 ? Math.max(0, cupoConsultas - consultasUsadas) : null
  const prestacionesRestantes =
    cupoPrestaciones > 0 ? Math.max(0, cupoPrestaciones - prestacionesUsadas) : null

  const consultasAgotadas = cupoConsultas > 0 && consultasUsadas >= cupoConsultas
  const prestacionesAgotadas = cupoPrestaciones > 0 && prestacionesUsadas >= cupoPrestaciones

  return {
    consultasUsadas,
    consultasCupo: cupoConsultas,
    consultasRestantes,
    consultasAgotadas,
    prestacionesUsadas,
    prestacionesCupo: cupoPrestaciones,
    prestacionesRestantes,
    prestacionesAgotadas,
    totalUsos: consultasUsadas + prestacionesUsadas,
  }
}

/**
 * Valida si un turno con determinados motivos puede ser cubierto por el plan
 * según el consumo acumulado en el mes.
 */
export function validarCupoPlanParaTurno(
  consumo: ConsumoAfiliadoMes,
  motivo1?: string | null,
  motivo2?: string | null,
): { permitido: boolean; motivoBloqueo?: string } {
  const { esConsulta, esPrestacion } = analizarAtencionTurno(motivo1, motivo2)

  if (esConsulta && consumo.consultasAgotadas) {
    return {
      permitido: false,
      motivoBloqueo: `Alcanzó el tope mensual de ${consumo.consultasCupo} consulta${
        consumo.consultasCupo !== 1 ? 's' : ''
      } gratuitas. No puede usar el plan para consultas hasta el próximo mes.`,
    }
  }

  if (esPrestacion && consumo.prestacionesAgotadas) {
    return {
      permitido: false,
      motivoBloqueo: `Alcanzó el tope mensual de ${consumo.prestacionesCupo} prestación${
        consumo.prestacionesCupo !== 1 ? 'es' : ''
      } gratuitas. No puede usar el plan para prestaciones hasta el próximo mes.`,
    }
  }

  return { permitido: true }
}
