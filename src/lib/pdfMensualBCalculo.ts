import { format, isWithinInterval, parseISO, startOfMonth, endOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Appointment, Doctor, ObraSocialCatalog, PagoCancelado, Patient, Payment } from '../types'
import { getTurnoFromFecha } from './dayTurnos'
import {
  buildPaymentsSettlementMap,
  esPagoTransferencia,
  pagoPdfGroupKey,
  resolveDoctorPaymentSettlement,
} from './pagosPdfLayout'
import { calcularMontoSugerido, isParticularCobertura, normalizeOsName } from './turnoMonto'

export interface DetalleMensualParams {
  anioMes: string // YYYY-MM
  doctorId?: string
  payments: Payment[]
  appointments: Appointment[]
  doctors: Doctor[]
  patients: Patient[]
  obrasSocialesCatalog: ObraSocialCatalog[]
  pagosCancelados?: PagoCancelado[]
}

export interface FilaPagoCobrado {
  id: string // Identificador del grupo / turno
  citaId: string | null
  rawFechaHora: string
  fecha: string // dd/MM/yyyy
  turno: 'Mañana' | 'Tarde'
  paciente: string
  medico: string
  obraSocial: string
  cantPagos: number
  porcentajeLabel: string
  totalFacturado: number
  totalTransferencias: number
  totalEfectivo: number
  totalMedico: number
  montoCuidar: number
}

export interface FilaNoPago {
  id: string
  rawFechaHora: string
  fecha: string // dd/MM/yyyy
  turno: 'Mañana' | 'Tarde'
  paciente: string
  medico: string
  obraSocial: string
  montoAdeudado: number
  estado: 'Pendiente' | 'Sin Plus'
}

export interface TotalesPagosCobrados {
  cantidadTurnos: number
  cantidadPagos: number
  totalFacturado: number
  totalTransferencias: number
  totalEfectivo: number
  totalMedico: number
  montoCuidar: number
}

export interface TotalesNoPagos {
  cantidadTurnos: number
  cantidadPendientes: number
  cantidadSinPlus: number
  totalAdeudado: number
  labelResumen: string // "N turnos (X pendientes · Y sin Plus)"
}

export interface ResumenDiaCobros {
  fechaKey: string // YYYY-MM-DD
  fecha: string // dd/MM/yyyy
  diaSemana: string // 'Lunes', 'Martes', etc.
  cantidadTurnos: number
  cantidadPagos: number
  totalFacturado: number
  totalTransferencias: number
  totalEfectivo: number
  totalMedico: number
  montoCuidar: number
}

export interface GrupoDiaDetalle {
  fechaKey: string // YYYY-MM-DD
  fecha: string // dd/MM/yyyy
  diaSemana: string // 'Lunes'
  franjaLabel: string // "Lunes 02/11/2026 · 5 turnos"
  subtotalLabel: string // "Subtotal Lunes 02/11 · 5 turnos"
  filas: FilaPagoCobrado[]
  totales: {
    cantidadTurnos: number
    cantidadPagos: number
    totalFacturado: number
    totalTransferencias: number
    totalEfectivo: number
    totalMedico: number
    montoCuidar: number
  }
}

export interface DetalleMensualResult {
  periodoLabel: string
  periodoDesdeHasta: { desde: string; hasta: string }
  medicoLabel: string
  doctorSeleccionado?: Doctor
  filasCobrados: FilaPagoCobrado[]
  totalesCobrados: TotalesPagosCobrados
  resumenPorDia: ResumenDiaCobros[]
  gruposPorDia: GrupoDiaDetalle[]
  filasNoPagos: FilaNoPago[]
  totalesNoPagos: TotalesNoPagos
  casosEspeciales: Array<{
    citaId: string
    paciente: string
    medico: string
    motivo: string
  }>
}

/**
 * Capitaliza el día de la semana (ej. "lunes" -> "Lunes").
 */
export function capitalizarDia(dia: string): string {
  if (!dia) return ''
  return dia.charAt(0).toUpperCase() + dia.slice(1).toLowerCase()
}

/**
 * Agrupa las filas cobradas día por día para generar el Resumen por Día
 * y el Detalle agrupado con franjas y subtotales.
 */
export function agruparCobrosPorDia(filasCobrados: FilaPagoCobrado[]): {
  resumenPorDia: ResumenDiaCobros[]
  gruposPorDia: GrupoDiaDetalle[]
} {
  const gruposMap = new Map<string, FilaPagoCobrado[]>()
  for (const f of filasCobrados) {
    const dayKey = f.rawFechaHora.slice(0, 10)
    const list = gruposMap.get(dayKey) ?? []
    list.push(f)
    gruposMap.set(dayKey, list)
  }

  const sortedDayKeys = Array.from(gruposMap.keys()).sort((a, b) => a.localeCompare(b))

  const resumenPorDia: ResumenDiaCobros[] = []
  const gruposPorDia: GrupoDiaDetalle[] = []

  for (const dayKey of sortedDayKeys) {
    const filas = gruposMap.get(dayKey)!
    const d = parseISO(`${dayKey}T12:00:00`)
    const fecha = format(d, 'dd/MM/yyyy')
    const rawDia = format(d, 'EEEE', { locale: es })
    const diaSemana = capitalizarDia(rawDia)
    const shortFecha = format(d, 'dd/MM')

    const cantidadTurnos = filas.length
    const cantidadPagos = filas.reduce((acc, f) => acc + f.cantPagos, 0)
    const totalFacturado = filas.reduce((acc, f) => acc + f.totalFacturado, 0)
    const totalTransferencias = filas.reduce((acc, f) => acc + f.totalTransferencias, 0)
    const totalEfectivo = filas.reduce((acc, f) => acc + f.totalEfectivo, 0)
    const totalMedico = filas.reduce((acc, f) => acc + f.totalMedico, 0)
    const montoCuidar = filas.reduce((acc, f) => acc + f.montoCuidar, 0)

    const turnosTxt = `${cantidadTurnos} turno${cantidadTurnos === 1 ? '' : 's'}`
    const franjaLabel = `${diaSemana} ${fecha} · ${turnosTxt}`
    const subtotalLabel = `Subtotal ${diaSemana} ${shortFecha} · ${turnosTxt}`

    const totales = {
      cantidadTurnos,
      cantidadPagos,
      totalFacturado,
      totalTransferencias,
      totalEfectivo,
      totalMedico,
      montoCuidar,
    }

    resumenPorDia.push({
      fechaKey: dayKey,
      fecha,
      diaSemana,
      ...totales,
    })

    gruposPorDia.push({
      fechaKey: dayKey,
      fecha,
      diaSemana,
      franjaLabel,
      subtotalLabel,
      filas,
      totales,
    })
  }

  return { resumenPorDia, gruposPorDia }
}

/**
 * Normaliza el nombre del turno a "Mañana" o "Tarde".
 */
function normalizarTurno(t: string | undefined): 'Mañana' | 'Tarde' {
  if (!t) return 'Mañana'
  const lower = t.toLowerCase()
  if (lower.startsWith('t') || lower.includes('tarde')) return 'Tarde'
  return 'Mañana'
}

/**
 * Función pura de cálculo para PDF Mensual B:
 * Genera el desglose turno por turno dividido en:
 * 1. "PAGOS COBRADOS": una fila por turno cobrado con su liquidación exacta de Resumen Cuidar.
 * 2. "NO PAGOS": turnos pendientes de pago y obras sociales sin Plus (sin cargo).
 */
export function calcularDetalleMensual(params: DetalleMensualParams): DetalleMensualResult {
  const {
    anioMes,
    doctorId,
    payments,
    appointments,
    doctors,
    patients,
    obrasSocialesCatalog,
    pagosCancelados = [],
  } = params

  const [yearStr, monthStr] = anioMes.split('-')
  const refDate = new Date(Number(yearStr), Number(monthStr) - 1, 1, 12, 0, 0)
  const monthStart = startOfMonth(refDate)
  const monthEnd = endOfMonth(refDate)

  const desdeStr = format(monthStart, 'yyyy-MM-dd')
  const hastaStr = format(monthEnd, 'yyyy-MM-dd')
  const periodoDesdeHasta = {
    desde: format(monthStart, 'dd-MM-yyyy'),
    hasta: format(monthEnd, 'dd-MM-yyyy'),
  }

  const doctorMap = new Map<string, Doctor>(doctors.map((d) => [d.id, d]))
  const patientMap = new Map<string, Patient>(patients.map((p) => [p.id, p]))
  const appointmentMap = new Map<string, Appointment>(appointments.map((a) => [a.id, a]))

  const selectedDoctor = doctorId && doctorId !== 'todos' ? doctorMap.get(doctorId) : undefined
  const medicoLabel = selectedDoctor
    ? `${selectedDoctor.apellido}, ${selectedDoctor.nombre}`.toUpperCase()
    : 'TODOS'

  const periodoLabel = `Período: ${periodoDesdeHasta.desde} al ${periodoDesdeHasta.hasta} — Médico: ${medicoLabel}`

  // 1. Excluir pagos cancelados
  const cancelledIds = new Set<string>()
  for (const pc of pagosCancelados) {
    if (pc.payment?.id) cancelledIds.add(pc.payment.id)
    if (pc.id) cancelledIds.add(pc.id)
  }

  // 2. Filtrar pagos activos del mes (y del médico si aplica)
  const activePayments = payments.filter((p) => {
    if (!p.fecha || cancelledIds.has(p.id)) return false
    if (selectedDoctor && p.doctorId !== selectedDoctor.id) return false
    const d = parseISO(p.fecha)
    return isWithinInterval(d, { start: monthStart, end: monthEnd })
  })

  // 3. Agrupar pagos por turno usando pagoPdfGroupKey
  const pagosPorGrupo = new Map<string, Payment[]>()
  for (const p of activePayments) {
    const key = pagoPdfGroupKey(p)
    const list = pagosPorGrupo.get(key) ?? []
    list.push(p)
    pagosPorGrupo.set(key, list)
  }

  // Sets para identificar turnos ya pagados y evitar duplicados en NO PAGOS
  const paidCitaIds = new Set<string>()
  const paidAppointmentKeys = new Set<string>()

  // 4. Construir mapa de liquidación del período (respetando valor diario por médico)
  const settlementMap = buildPaymentsSettlementMap(
    activePayments,
    (id) => doctorMap.get(id),
    (p) => {
      const appt = p.citaId ? appointmentMap.get(p.citaId) : undefined
      const pac = patientMap.get(p.patientId)
      return p.obraSocialOverride || appt?.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
    },
  )

  // 5. Construir filas de "PAGOS COBRADOS"
  const filasCobrados: FilaPagoCobrado[] = []

  for (const [groupKey, groupPayments] of pagosPorGrupo.entries()) {
    const firstP = groupPayments[0]
    const appt = firstP.citaId ? appointmentMap.get(firstP.citaId) : undefined

    if (firstP.citaId) paidCitaIds.add(firstP.citaId)

    const doc = doctorMap.get(firstP.doctorId)
    const pac = patientMap.get(firstP.patientId)

    const rawFechaHora = appt?.fechaHora || firstP.fecha
    const d = parseISO(rawFechaHora)
    const fecha = format(d, 'dd/MM/yyyy')
    const turno = normalizarTurno(getTurnoFromFecha(rawFechaHora))

    const paciente = pac ? `${pac.apellido}, ${pac.nombre}` : '—'
    const medico = doc ? `${doc.apellido}, ${doc.nombre}` : '—'

    const obraSocial =
      firstP.obraSocialOverride ||
      appt?.obraSocialOverride ||
      pac?.obraSocial?.trim() ||
      'Particular'

    if (firstP.patientId && rawFechaHora) {
      const dayStr = format(d, 'yyyy-MM-dd')
      paidAppointmentKeys.add(`${firstP.patientId}__${dayStr}`)
    }

    const cantPagos = groupPayments.length
    let totalFacturado = 0
    let totalTransferencias = 0
    let totalEfectivo = 0
    let totalMedico = 0
    let montoCuidar = 0

    const pctSet = new Set<string>()
    let esFijo = false

    for (const p of groupPayments) {
      const monto = Number(p.monto) || 0
      totalFacturado += monto
      if (esPagoTransferencia(p.metodo)) {
        totalTransferencias += monto
      } else {
        totalEfectivo += monto
      }

      const settlement = settlementMap.get(p.id) ?? resolveDoctorPaymentSettlement(p, doc, obraSocial)
      totalMedico += settlement.totalGeneral
      montoCuidar += settlement.totalPorcentaje

      if (settlement.esMontoFijo) {
        esFijo = true
      } else {
        pctSet.add(`${settlement.porcentaje}%`)
      }
    }

    const porcentajeLabel = esFijo
      ? '—'
      : pctSet.size === 1
        ? Array.from(pctSet)[0]
        : pctSet.size > 1
          ? Array.from(pctSet).join('/')
          : '—'

    filasCobrados.push({
      id: groupKey,
      citaId: firstP.citaId ?? null,
      rawFechaHora,
      fecha,
      turno,
      paciente,
      medico,
      obraSocial,
      cantPagos,
      porcentajeLabel,
      totalFacturado,
      totalTransferencias,
      totalEfectivo,
      totalMedico,
      montoCuidar,
    })
  }

  // Ordenar Tabla 1: fecha, turno (Mañana antes que Tarde), médico, paciente
  filasCobrados.sort((a, b) => {
    const dayA = a.rawFechaHora.slice(0, 10)
    const dayB = b.rawFechaHora.slice(0, 10)
    if (dayA !== dayB) {
      return dayA.localeCompare(dayB)
    }
    if (a.turno !== b.turno) {
      return a.turno === 'Mañana' ? -1 : 1
    }
    if (a.medico !== b.medico) {
      return a.medico.localeCompare(b.medico, 'es', { sensitivity: 'base' })
    }
    return a.paciente.localeCompare(b.paciente, 'es', { sensitivity: 'base' })
  })

  // Totales de Tabla 1
  const totalesCobrados: TotalesPagosCobrados = {
    cantidadTurnos: filasCobrados.length,
    cantidadPagos: filasCobrados.reduce((acc, f) => acc + f.cantPagos, 0),
    totalFacturado: filasCobrados.reduce((acc, f) => acc + f.totalFacturado, 0),
    totalTransferencias: filasCobrados.reduce((acc, f) => acc + f.totalTransferencias, 0),
    totalEfectivo: filasCobrados.reduce((acc, f) => acc + f.totalEfectivo, 0),
    totalMedico: filasCobrados.reduce((acc, f) => acc + f.totalMedico, 0),
    montoCuidar: filasCobrados.reduce((acc, f) => acc + f.montoCuidar, 0),
  }

  const { resumenPorDia, gruposPorDia } = agruparCobrosPorDia(filasCobrados)

  // 5. Construir filas de "NO PAGOS" (Tabla 2)
  const filasNoPagos: FilaNoPago[] = []
  const casosEspeciales: Array<{
    citaId: string
    paciente: string
    medico: string
    motivo: string
  }> = []

  for (const appt of appointments) {
    if (!appt.fechaHora) continue
    // Excluir ausentes y cancelados
    if (appt.estado === 'cancelado') continue

    const apptDate = parseISO(appt.fechaHora)
    if (!isWithinInterval(apptDate, { start: monthStart, end: monthEnd })) continue
    if (selectedDoctor && appt.doctorId !== selectedDoctor.id) continue

    // Si ya está cobrado, no va a NO PAGOS
    if (paidCitaIds.has(appt.id)) continue
    const apptDayStr = format(apptDate, 'yyyy-MM-dd')
    const matchKey = `${appt.patientId}__${apptDayStr}`
    if (paidAppointmentKeys.has(matchKey)) continue

    const doc = doctorMap.get(appt.doctorId)
    const pac = patientMap.get(appt.patientId)

    const fecha = format(apptDate, 'dd/MM/yyyy')
    const turno = normalizarTurno(getTurnoFromFecha(appt.fechaHora))
    const paciente = pac ? `${pac.apellido}, ${pac.nombre}` : '—'
    const medico = doc ? `${doc.apellido}, ${doc.nombre}` : '—'

    const obraSocial =
      appt.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'

    const normCob = normalizeOsName(obraSocial)
    const esParticular = isParticularCobertura(normCob)

    let estado: 'Pendiente' | 'Sin Plus'
    let montoAdeudado = 0

    if (!esParticular) {
      // Buscar en el catálogo de obras sociales
      const osCatalogItem = obrasSocialesCatalog.find(
        (o) => normalizeOsName(o.nombre) === normCob,
      )
      const plusCatalog = Math.round(Number(osCatalogItem?.plus || 0))

      if (plusCatalog <= 0) {
        // Obra social que no cobra Plus (sin cargo)
        estado = 'Sin Plus'
        montoAdeudado = 0
      } else {
        // Tiene plus pero no se pagó -> Pendiente
        estado = 'Pendiente'
        const sugerido = calcularMontoSugerido(doc, obraSocial)
        montoAdeudado = sugerido.origen === 'ok' ? sugerido.monto : plusCatalog
      }
    } else {
      // Es Particular
      const sugerido = calcularMontoSugerido(doc, obraSocial)
      const partMonto =
        sugerido.origen === 'ok' ? sugerido.monto : Math.round(Number(doc?.particular || 0))

      if (partMonto <= 0) {
        // Caso especial: Particular sin arancel configurado
        casosEspeciales.push({
          citaId: appt.id,
          paciente,
          medico,
          motivo: 'Particular sin arancel configurado en el médico',
        })
        estado = 'Pendiente'
        montoAdeudado = 0
      } else {
        estado = 'Pendiente'
        montoAdeudado = partMonto
      }
    }

    filasNoPagos.push({
      id: appt.id,
      rawFechaHora: appt.fechaHora,
      fecha,
      turno,
      paciente,
      medico,
      obraSocial,
      montoAdeudado,
      estado,
    })
  }

  // Ordenar Tabla 2: fecha, turno (Mañana antes que Tarde), médico, paciente
  filasNoPagos.sort((a, b) => {
    const dayA = a.rawFechaHora.slice(0, 10)
    const dayB = b.rawFechaHora.slice(0, 10)
    if (dayA !== dayB) {
      return dayA.localeCompare(dayB)
    }
    if (a.turno !== b.turno) {
      return a.turno === 'Mañana' ? -1 : 1
    }
    if (a.medico !== b.medico) {
      return a.medico.localeCompare(b.medico, 'es', { sensitivity: 'base' })
    }
    return a.paciente.localeCompare(b.paciente, 'es', { sensitivity: 'base' })
  })

  // Totales de Tabla 2
  const cantidadPendientes = filasNoPagos.filter((f) => f.estado === 'Pendiente').length
  const cantidadSinPlus = filasNoPagos.filter((f) => f.estado === 'Sin Plus').length
  const totalAdeudado = filasNoPagos
    .filter((f) => f.estado === 'Pendiente')
    .reduce((acc, f) => acc + f.montoAdeudado, 0)

  const labelResumen = `${filasNoPagos.length} turnos (${cantidadPendientes} pendientes · ${cantidadSinPlus} sin Plus)`

  const totalesNoPagos: TotalesNoPagos = {
    cantidadTurnos: filasNoPagos.length,
    cantidadPendientes,
    cantidadSinPlus,
    totalAdeudado,
    labelResumen,
  }

  return {
    periodoLabel,
    periodoDesdeHasta,
    medicoLabel,
    doctorSeleccionado: selectedDoctor,
    filasCobrados,
    totalesCobrados,
    resumenPorDia,
    gruposPorDia,
    filasNoPagos,
    totalesNoPagos,
    casosEspeciales,
  }
}

