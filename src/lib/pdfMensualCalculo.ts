import { format, isWithinInterval, parseISO, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns'
import type { Appointment, Doctor, ObraSocialCatalog, PagoCancelado, Patient, Payment } from '../types'
import { getTurnoFromFecha } from './dayTurnos'
import { buildPaymentsSettlementMap, resolveDoctorPaymentSettlement } from './pagosPdfLayout'
import { formatObraSocialCell } from './doctorPaymentsPdf'
import { calcularMontoSugerido } from './turnoMonto'

export interface ResumenMensualParams {
  anioMes: string // YYYY-MM (ej: '2026-11')
  doctorId?: string // Si se omite o es 'todos', incluye a todos los médicos
  payments: Payment[]
  appointments: Appointment[]
  doctors: Doctor[]
  patients: Patient[]
  obrasSocialesCatalog: ObraSocialCatalog[]
  pagosCancelados?: PagoCancelado[]
}

export interface PastillasDashboard {
  cantidadTurnosMes: number
  turnosManana: number
  turnosTarde: number
  totalFacturado: number
  cantidadPagosCobrados: number
  paraElMedico: number
  porcentajeMedico: number
  paraCuidar: number
  porcentajeCuidar: number
  pendienteCobroMonto: number
  pendienteCobroCantidad: number
  ticketPromedio: number
}

export interface GraficoObraSocialItem {
  nombre: string
  cantidad: number
  porcentaje: number
}

export interface GraficoMedicoBarra {
  medicoNombre: string
  facturadoTotal: number
  montoMedico: number
  montoCuidar: number
}

export interface GraficoDiaColumna {
  dia: number
  fechaIso: string
  facturado: number
}

export interface MetodoDesgloseItem {
  metodo: string
  cantidad: number
  monto: number
  porcentaje: number
}

export interface EstadoPagosIndicadores {
  cobradosCantidad: number
  cobradosMonto: number
  pendientesCantidad: number
  pendientesMonto: number
  sinCargoCantidad: number
  ausentesCantidad: number
}

export interface MananaVsTardeIndicadores {
  turnosManana: number
  facturadoManana: number
  turnosTarde: number
  facturadoTarde: number
}

export interface OtrosIndicadores {
  tasaCobroPorcentaje: number
  turnosFueraGrilla: number
  pacientesNuevosMes: number
  ausentesCantidad: number
  plusCobradosCantidad: number
}

export interface ResumenCuidarFila {
  fecha: string // YYYY-MM-DD
  fechaFormateada: string // DD/MM/YYYY
  turno: string // Mañana | Tarde | Noche
  cantPagos: number
  porcentajeLabel: string
  totalFacturado: number
  totalTransferencias: number
  totalMedico: number
  montoCuidar: number
}

export interface TurnoSinPagarFila {
  id: string
  fechaHora: string
  fechaFormateada: string // DD/MM/YYYY HH:mm
  fechaSolo: string // DD/MM/YYYY
  hora: string // HH:mm
  turno: string
  paciente: string
  medico: string
  obraSocial: string
  montoAdeudado: number
  estado: 'Pendiente'
}

export interface ResumenMensualCalculado {
  periodo: {
    anioMes: string
    desde: string // YYYY-MM-DD
    hasta: string // YYYY-MM-DD
    desdeFormateada: string // DD-MM-YYYY
    hastaFormateada: string // DD-MM-YYYY
    diasEnMes: number
    medicoFiltro?: Doctor
    medicoLabel: string
  }
  pastillas: PastillasDashboard
  graficoObrasSociales: GraficoObraSocialItem[]
  graficoMedicos: GraficoMedicoBarra[]
  graficoDias: GraficoDiaColumna[]
  estadoPagos: EstadoPagosIndicadores
  metodosDesglose: MetodoDesgloseItem[]
  mananaVsTarde: MananaVsTardeIndicadores
  otrosIndicadores: OtrosIndicadores
  tablaResumenCuidar: ResumenCuidarFila[]
  totalesResumenCuidar: {
    cantPagos: number
    totalFacturado: number
    totalTransferencias: number
    totalMedico: number
    montoCuidar: number
    porcentajeLabel: string
  }
  turnosSinPagar: TurnoSinPagarFila[]
  totalTurnosSinPagar: {
    cantidad: number
    montoTotal: number
  }
  resumenMetodos: {
    filas: MetodoDesgloseItem[]
    totalCantidad: number
    totalMonto: number
    cobradosMonto: number
    sinPagarMonto: number
    tasaCobroPorcentaje: number
  }
}

/**
 * Función pura que calcula todas las cifras y estructuras para el Dashboard y Resumen Mensual.
 */
export function calcularResumenMensual(params: ResumenMensualParams): ResumenMensualCalculado {
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

  const [anioStr, mesStr] = anioMes.split('-')
  const anio = parseInt(anioStr ?? '2026', 10)
  const mesIdx = parseInt(mesStr ?? '1', 10) - 1

  const refDate = new Date(anio, mesIdx, 1, 12, 0, 0)
  const mesStart = startOfMonth(refDate)
  const mesEnd = endOfMonth(refDate)
  const diasEnMes = getDaysInMonth(refDate)

  const desdeStr = format(mesStart, 'yyyy-MM-dd')
  const hastaStr = format(mesEnd, 'yyyy-MM-dd')
  const desdeFormateada = format(mesStart, 'dd-MM-yyyy')
  const hastaFormateada = format(mesEnd, 'dd-MM-yyyy')

  const doctorMap = new Map<string, Doctor>(doctors.map((d) => [d.id, d]))
  const patientMap = new Map<string, Patient>(patients.map((p) => [p.id, p]))
  const appointmentMap = new Map<string, Appointment>(appointments.map((a) => [a.id, a]))

  const selectedDoctor = doctorId && doctorId !== 'todos' ? doctorMap.get(doctorId) : undefined
  const medicoLabel = selectedDoctor
    ? `${selectedDoctor.apellido}, ${selectedDoctor.nombre}`
    : 'TODOS'

  // 1. Filtrar turnos del mes
  const turnosMes = appointments.filter((a) => {
    if (!a.fechaHora) return false
    const d = parseISO(a.fechaHora)
    if (!isWithinInterval(d, { start: mesStart, end: mesEnd })) return false
    if (selectedDoctor && a.doctorId !== selectedDoctor.id) return false
    return true
  })

  // Turnos no cancelados
  const turnosValidos = turnosMes.filter((a) => a.estado !== 'cancelado')
  const turnosCancelados = turnosMes.filter((a) => a.estado === 'cancelado')

  // 2. Filtrar pagos del mes (los pagos cancelados se excluyen)
  const cancelledIds = new Set<string>()
  for (const pc of pagosCancelados ?? []) {
    if (pc.payment?.id) cancelledIds.add(pc.payment.id)
    if (pc.id) cancelledIds.add(pc.id)
  }

  const pagosMes = payments.filter((p) => {
    if (!p.fecha || cancelledIds.has(p.id)) return false
    const d = parseISO(p.fecha)
    if (!isWithinInterval(d, { start: mesStart, end: mesEnd })) return false
    if (selectedDoctor && p.doctorId !== selectedDoctor.id) return false
    return true
  })

  // Cobros con monto > 0
  const cobrosConMonto = pagosMes.filter((p) => Number(p.monto) > 0)
  const cobrosMontoCero = pagosMes.filter((p) => Number(p.monto) === 0)

  // Set de citaId que tienen pago con monto > 0
  const paidCitaIds = new Set<string>()
  for (const p of cobrosConMonto) {
    if (p.citaId) paidCitaIds.add(p.citaId)
  }

  // 3. Turnos sin pagar (Pendientes de cobro)
  // Mismo criterio que pendientesDePago en PagosPage: turnos válidos sin cobro vinculado con monto > 0
  const turnosSinPagar: TurnoSinPagarFila[] = []
  for (const a of turnosValidos) {
    const isPaid = paidCitaIds.has(a.id)

    if (!isPaid) {
      const t = parseISO(a.fechaHora)
      const doc = doctorMap.get(a.doctorId)
      const pac = patientMap.get(a.patientId)
      const os = a.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
      const turno = getTurnoFromFecha(a.fechaHora)

      // Monto adeudado sugerido según reglas vigentes
      const resMonto = calcularMontoSugerido(doc, os)
      const montoAdeudado = Math.max(
        0,
        resMonto.origen === 'ok' ? resMonto.monto : (doc?.particular || 0),
      )

      turnosSinPagar.push({
        id: a.id,
        fechaHora: a.fechaHora,
        fechaFormateada: format(t, 'dd/MM/yyyy HH:mm'),
        fechaSolo: format(t, 'dd/MM/yyyy'),
        hora: format(t, 'HH:mm'),
        turno,
        paciente: pac ? `${pac.apellido}, ${pac.nombre}` : '—',
        medico: doc ? `${doc.apellido}, ${doc.nombre}` : '—',
        obraSocial: os,
        montoAdeudado,
        estado: 'Pendiente',
      })
    }
  }

  turnosSinPagar.sort(
    (a, b) => parseISO(a.fechaHora).getTime() - parseISO(b.fechaHora).getTime(),
  )

  const totalMontoSinPagar = turnosSinPagar.reduce((acc, t) => acc + t.montoAdeudado, 0)

  // 4. Agrupación y liquidación de pagos para Resumen Cuidar y totales
  const byDayAndTurno = new Map<
    string,
    {
      day: string
      turno: string
      facturado: number
      cuidar: number
      transferencias: number
      medico: number
      cantidad: number
      pctSet: Set<number>
      hasFixed: boolean
    }
  >()

  const settlementMap = buildPaymentsSettlementMap(
    pagosMes,
    (id) => doctorMap.get(id),
    (p) => {
      const appt = p.citaId ? appointmentMap.get(p.citaId) : undefined
      const pac = patientMap.get(p.patientId)
      return p.obraSocialOverride || appt?.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
    },
  )
  let totalFacturado = 0
  let totalCuidar = 0
  let totalMedico = 0
  let totalTransferencias = 0

  for (const p of pagosMes) {
    const day = format(parseISO(p.fecha), 'yyyy-MM-dd')
    const appt = p.citaId ? appointmentMap.get(p.citaId) : undefined
    const turno = getTurnoFromFecha(appt?.fechaHora || p.fecha)
    const key = `${day}__${turno}`

    const doc = doctorMap.get(p.doctorId)
    const pac = patientMap.get(p.patientId)
    const os = p.obraSocialOverride || appt?.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
    const s = settlementMap.get(p.id) ?? resolveDoctorPaymentSettlement(p, doc, os)

    const cuidar = s.totalPorcentaje || 0
    const esTransf = p.metodo.trim().toLowerCase() === 'transferencia'
    const transferencias = esTransf ? p.monto : 0
    const medico = s.totalGeneral || 0
    const facturado = p.monto

    totalFacturado += facturado
    totalCuidar += cuidar
    totalMedico += (s.totalGeneral || 0)
    totalTransferencias += transferencias

    const existing = byDayAndTurno.get(key) ?? {
      day,
      turno,
      facturado: 0,
      cuidar: 0,
      transferencias: 0,
      medico: 0,
      cantidad: 0,
      pctSet: new Set<number>(),
      hasFixed: false,
    }
    existing.facturado += facturado
    existing.cuidar += cuidar
    existing.transferencias += transferencias
    existing.medico += medico
    existing.cantidad += 1
    if (s.esMontoFijo) {
      existing.hasFixed = true
    } else if (s.porcentaje > 0) {
      existing.pctSet.add(s.porcentaje)
    }
    byDayAndTurno.set(key, existing)
  }

  const turnoOrder: Record<string, number> = { Mañana: 1, Tarde: 2, Noche: 3 }
  const tablaResumenCuidar: ResumenCuidarFila[] = Array.from(byDayAndTurno.values())
    .sort((a, b) => {
      const cmp = a.day.localeCompare(b.day)
      if (cmp !== 0) return cmp
      return (turnoOrder[a.turno] ?? 9) - (turnoOrder[b.turno] ?? 9)
    })
    .map((r) => {
      const porcentajeLabel =
        r.pctSet.size === 1
          ? `${[...r.pctSet][0]}%`
          : r.pctSet.size > 1
            ? 'Var.'
            : '—'
      return {
        fecha: r.day,
        fechaFormateada: format(parseISO(`${r.day}T12:00:00`), 'dd/MM/yyyy'),
        turno: r.turno,
        cantPagos: r.cantidad,
        porcentajeLabel,
        totalFacturado: r.facturado,
        totalTransferencias: r.transferencias,
        totalMedico: r.medico,
        montoCuidar: r.cuidar,
      }
    })

  const totalPctSet = new Set<number>()
  let totalHasFixed = false
  for (const r of byDayAndTurno.values()) {
    for (const pct of r.pctSet) totalPctSet.add(pct)
    if (r.hasFixed) totalHasFixed = true
  }
  const totalPorcentajeLabel =
    !totalHasFixed && totalPctSet.size === 1
      ? `${[...totalPctSet][0]}%`
      : totalPctSet.size > 1
        ? 'Var.'
        : '—'

  const cantPagosCobrados = cobrosConMonto.length
  const ticketPromedio = cantPagosCobrados > 0 ? Math.round(totalFacturado / cantPagosCobrados) : 0

  const pctMedico = totalFacturado > 0 ? Math.round((totalMedico / totalFacturado) * 100) : 0
  const pctCuidar = totalFacturado > 0 ? Math.round((totalCuidar / totalFacturado) * 100) : 0

  // Turnos mañana y tarde
  let turnosManana = 0
  let turnosTarde = 0
  for (const a of turnosValidos) {
    const t = getTurnoFromFecha(a.fechaHora)
    if (t === 'Mañana') turnosManana++
    else if (t === 'Tarde') turnosTarde++
  }

  // Facturado mañana y tarde
  let facturadoManana = 0
  let facturadoTarde = 0
  for (const p of pagosMes) {
    const appt = p.citaId ? appointmentMap.get(p.citaId) : undefined
    const t = getTurnoFromFecha(appt?.fechaHora || p.fecha)
    if (t === 'Mañana') facturadoManana += p.monto
    else if (t === 'Tarde') facturadoTarde += p.monto
  }

  // 5. Gráfico 1: Turnos por Obra Social (máximo 7 porciones, resto "Otras")
  const osCountMap = new Map<string, number>()
  for (const a of turnosValidos) {
    const pac = patientMap.get(a.patientId)
    const os = (a.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular').trim()
    osCountMap.set(os, (osCountMap.get(os) ?? 0) + 1)
  }

  const sortedOs = Array.from(osCountMap.entries())
    .map(([nombre, cantidad]) => ({ nombre, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad)

  const totalTurnosOs = turnosValidos.length
  const graficoObrasSociales: GraficoObraSocialItem[] = []
  if (sortedOs.length <= 7) {
    for (const item of sortedOs) {
      const porcentaje = totalTurnosOs > 0 ? Math.round((item.cantidad / totalTurnosOs) * 1000) / 10 : 0
      graficoObrasSociales.push({ nombre: item.nombre, cantidad: item.cantidad, porcentaje })
    }
  } else {
    const top6 = sortedOs.slice(0, 6)
    const resto = sortedOs.slice(6)
    for (const item of top6) {
      const porcentaje = totalTurnosOs > 0 ? Math.round((item.cantidad / totalTurnosOs) * 1000) / 10 : 0
      graficoObrasSociales.push({ nombre: item.nombre, cantidad: item.cantidad, porcentaje })
    }
    const otrasCant = resto.reduce((acc, r) => acc + r.cantidad, 0)
    const otrasPct = totalTurnosOs > 0 ? Math.round((otrasCant / totalTurnosOs) * 1000) / 10 : 0
    graficoObrasSociales.push({ nombre: 'Otras', cantidad: otrasCant, porcentaje: otrasPct })
  }

  // 6. Gráfico 2: Facturado por Médico (apilado médico/cuidar, top 6 + "Otros")
  const docBillingMap = new Map<string, { facturado: number; medico: number; cuidar: number; nombre: string }>()
  for (const p of pagosMes) {
    const doc = doctorMap.get(p.doctorId)
    const docNombre = doc ? `${doc.apellido}, ${doc.nombre}` : 'Sin Médico'
    const s = settlementMap.get(p.id)
    const cuidar = s?.totalPorcentaje || 0
    const medico = (s?.totalGeneral || 0)

    const curr = docBillingMap.get(p.doctorId) ?? {
      facturado: 0,
      medico: 0,
      cuidar: 0,
      nombre: docNombre,
    }
    curr.facturado += p.monto
    curr.medico += medico
    curr.cuidar += cuidar
    docBillingMap.set(p.doctorId, curr)
  }

  const sortedDocs = Array.from(docBillingMap.values()).sort((a, b) => b.facturado - a.facturado)
  const graficoMedicos: GraficoMedicoBarra[] = []
  if (sortedDocs.length <= 6) {
    for (const d of sortedDocs) {
      graficoMedicos.push({
        medicoNombre: d.nombre,
        facturadoTotal: d.facturado,
        montoMedico: d.medico,
        montoCuidar: d.cuidar,
      })
    }
  } else {
    const top5 = sortedDocs.slice(0, 5)
    const resto = sortedDocs.slice(5)
    for (const d of top5) {
      graficoMedicos.push({
        medicoNombre: d.nombre,
        facturadoTotal: d.facturado,
        montoMedico: d.medico,
        montoCuidar: d.cuidar,
      })
    }
    const otrosFact = resto.reduce((acc, r) => acc + r.facturado, 0)
    const otrosMed = resto.reduce((acc, r) => acc + r.medico, 0)
    const otrosCuid = resto.reduce((acc, r) => acc + r.cuidar, 0)
    graficoMedicos.push({
      medicoNombre: 'Otros',
      facturadoTotal: otrosFact,
      montoMedico: otrosMed,
      montoCuidar: otrosCuid,
    })
  }

  // 7. Gráfico 3: Facturado por Día (1..diasEnMes)
  const billingByDayMap = new Map<number, number>()
  for (const p of pagosMes) {
    const d = parseISO(p.fecha).getDate()
    billingByDayMap.set(d, (billingByDayMap.get(d) ?? 0) + p.monto)
  }

  const graficoDias: GraficoDiaColumna[] = []
  for (let dia = 1; dia <= diasEnMes; dia++) {
    const diaPadded = String(dia).padStart(2, '0')
    const fechaIso = `${anioStr}-${mesStr}-${diaPadded}`
    graficoDias.push({
      dia,
      fechaIso,
      facturado: billingByDayMap.get(dia) ?? 0,
    })
  }

  // 8. Fila de 4 pastillas inferiores
  // A: Estado de pagos
  const estadoPagos: EstadoPagosIndicadores = {
    cobradosCantidad: cantPagosCobrados,
    cobradosMonto: totalFacturado,
    pendientesCantidad: turnosSinPagar.length,
    pendientesMonto: totalMontoSinPagar,
    sinCargoCantidad: cobrosMontoCero.length,
    ausentesCantidad: turnosCancelados.length,
  }

  // B: Métodos de cobro
  const metodoMap = new Map<string, { cantidad: number; monto: number }>()
  for (const p of pagosMes) {
    const met = (p.metodo || 'Otros').trim()
    const normalizado = met.charAt(0).toUpperCase() + met.slice(1).toLowerCase()
    const curr = metodoMap.get(normalizado) ?? { cantidad: 0, monto: 0 }
    curr.cantidad += 1
    curr.monto += p.monto
    metodoMap.set(normalizado, curr)
  }

  const metodosDesglose: MetodoDesgloseItem[] = Array.from(metodoMap.entries())
    .map(([metodo, val]) => ({
      metodo,
      cantidad: val.cantidad,
      monto: val.monto,
      porcentaje: totalFacturado > 0 ? Math.round((val.monto / totalFacturado) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.monto - a.monto)

  // C: Mañana vs Tarde
  const mananaVsTarde: MananaVsTardeIndicadores = {
    turnosManana,
    facturadoManana,
    turnosTarde,
    facturadoTarde,
  }

  // D: Otros indicadores
  const totalTurnosEvaluables = turnosValidos.length
  const tasaCobroPorcentaje =
    totalTurnosEvaluables > 0
      ? Math.round(((totalTurnosEvaluables - turnosSinPagar.length) / totalTurnosEvaluables) * 100)
      : 100

  // Turnos fuera de grilla: turnos con notas que indiquen "sobreturno" o con hora no estándar
  let turnosFueraGrilla = 0
  for (const a of turnosValidos) {
    if (a.notas?.toLowerCase().includes('sobreturno') || a.notas?.toLowerCase().includes('fuera de grilla')) {
      turnosFueraGrilla++
    }
  }

  // Pacientes nuevos del mes (creados en este mes o cuyo primer turno histórico cae en este mes)
  const pacSetConTurnoPrevio = new Set<string>()
  for (const a of appointments) {
    if (a.fechaHora && parseISO(a.fechaHora).getTime() < mesStart.getTime()) {
      pacSetConTurnoPrevio.add(a.patientId)
    }
  }
  const pacientesAtendidosMes = new Set(turnosValidos.map((a) => a.patientId))
  let pacientesNuevosMes = 0
  for (const pacId of pacientesAtendidosMes) {
    if (!pacSetConTurnoPrevio.has(pacId)) {
      pacientesNuevosMes++
    }
  }

  // Plus cobrados: cobros de turnos cuya obra social no es Particular
  let plusCobradosCantidad = 0
  for (const p of cobrosConMonto) {
    const appt = p.citaId ? appointmentMap.get(p.citaId) : undefined
    const pac = patientMap.get(p.patientId)
    const os = (p.obraSocialOverride || appt?.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular').toLowerCase()
    if (os !== 'particular') {
      plusCobradosCantidad++
    }
  }

  const otrosIndicadores: OtrosIndicadores = {
    tasaCobroPorcentaje,
    turnosFueraGrilla,
    pacientesNuevosMes,
    ausentesCantidad: turnosCancelados.length,
    plusCobradosCantidad,
  }

  // 9. Pastillas superiores Dashboard
  const pastillas: PastillasDashboard = {
    cantidadTurnosMes: turnosValidos.length,
    turnosManana,
    turnosTarde,
    totalFacturado,
    cantidadPagosCobrados: cantPagosCobrados,
    paraElMedico: totalMedico,
    porcentajeMedico: pctMedico,
    paraCuidar: totalCuidar,
    porcentajeCuidar: pctCuidar,
    pendienteCobroMonto: totalMontoSinPagar,
    pendienteCobroCantidad: turnosSinPagar.length,
    ticketPromedio,
  }

  return {
    periodo: {
      anioMes,
      desde: desdeStr,
      hasta: hastaStr,
      desdeFormateada,
      hastaFormateada,
      diasEnMes,
      medicoFiltro: selectedDoctor,
      medicoLabel,
    },
    pastillas,
    graficoObrasSociales,
    graficoMedicos,
    graficoDias,
    estadoPagos,
    metodosDesglose,
    mananaVsTarde,
    otrosIndicadores,
    tablaResumenCuidar,
    totalesResumenCuidar: {
      cantPagos: tablaResumenCuidar.reduce((acc, r) => acc + r.cantPagos, 0),
      totalFacturado,
      totalTransferencias,
      totalMedico,
      montoCuidar: totalCuidar,
      porcentajeLabel: totalPorcentajeLabel,
    },
    turnosSinPagar,
    totalTurnosSinPagar: {
      cantidad: turnosSinPagar.length,
      montoTotal: totalMontoSinPagar,
    },
    resumenMetodos: {
      filas: metodosDesglose,
      totalCantidad: metodosDesglose.reduce((acc, m) => acc + m.cantidad, 0),
      totalMonto: totalFacturado,
      cobradosMonto: totalFacturado,
      sinPagarMonto: totalMontoSinPagar,
      tasaCobroPorcentaje,
    },
  }
}
