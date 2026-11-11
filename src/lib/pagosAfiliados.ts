import type { Afiliado, CuotaMensual, FormaPago, Patient, PlanAfiliado } from '../types'
import { createId } from './id'

/**
 * Lógica de la pantalla reducida "Pagos de afiliados".
 *
 * La deuda de un contratante es la misma que muestra el módulo Afiliados: se
 * recorren todos los meses desde `fechaInicio` hasta el mes actual y cada mes
 * sin cuota (o con cuota no paga) cuenta como deuda. La deuda es siempre la del
 * titular: los adherentes no generan filas ni deuda propia.
 *
 * Este archivo no toca el estado de la app. Recibe datos y devuelve resultados
 * para que la pantalla funcione igual en modo local y en modo cliente.
 */

export const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

/** Una cuota pendiente concreta de un contratante. */
export interface CuotaPendienteAfiliado {
  anio: number
  mes: number
  monto: number
  /** Id de la cuota ya existente; undefined si todavía no se generó. */
  cuotaId?: string
}

/** Fila de la tabla de deudores. */
export interface DeudorAfiliado {
  afiliadoId: string
  patientId: string
  /** "Apellido, Nombre" tal como se muestra en el recibo. */
  nombre: string
  dni: string
  cobertura: string
  adeudado: number
  /** Cuotas impagas, de la más antigua a la más nueva. */
  cuotas: CuotaPendienteAfiliado[]
}

export interface ListadoPagosAfiliados {
  deudores: DeudorAfiliado[]
  totalAdeudado: number
  cantidad: number
  /**
   * true cuando la búsqueda encontró contratantes pero ninguno tiene deuda.
   * La pantalla muestra sólo "Sin deuda", sin nombre ni otros datos.
   */
  sinDeuda: boolean
}

export interface SeleccionCuota {
  anio: number
  mes: number
}

export type FiltroPlanPagosAfiliados = 'todos' | 'individual' | 'familiar'
export type OrdenPagosAfiliados = 'nombre-asc' | 'nombre-desc' | 'deuda-asc' | 'deuda-desc'

/** Filtrado y orden de presentación, independiente de la fuente de datos. */
export function prepararTablaPagosAfiliados(
  deudores: readonly DeudorAfiliado[],
  consulta: string,
  plan: FiltroPlanPagosAfiliados,
  orden: OrdenPagosAfiliados,
): DeudorAfiliado[] {
  const q = normalizarTexto(consulta)
  const filas = deudores.filter((deudor) => {
    const coincidePlan = plan === 'todos' || normalizarTexto(deudor.cobertura).includes(plan)
    const coincideConsulta = !q
      || normalizarTexto(deudor.nombre).includes(q)
      || normalizarTexto(deudor.dni).includes(q)
    return coincidePlan && coincideConsulta
  })
  return [...filas].sort((a, b) => {
    if (orden.startsWith('nombre')) {
      const comparacion = a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
      return orden === 'nombre-asc' ? comparacion : -comparacion
    }
    const comparacion = a.adeudado - b.adeudado
    return orden === 'deuda-asc' ? comparacion : -comparacion
  })
}

export type ResultadoCobroLocal =
  | { ok: true; cuotas: CuotaMensual[] }
  | { ok: false; error: 'cuota_ya_pagada'; anio: number; mes: number }
  | { ok: false; error: 'sin_seleccion' }

function normalizarTexto(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function fechaLocalIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function claveCuota(afiliadoId: string, anio: number, mes: number): string {
  return `${afiliadoId}:${anio}:${mes}`
}

/** Índice rápido por contratante y mes. */
function indexarCuotas(cuotas: readonly CuotaMensual[]): Map<string, CuotaMensual> {
  const mapa = new Map<string, CuotaMensual>()
  for (const cuota of cuotas) {
    const clave = claveCuota(cuota.afiliadoId, cuota.anio, cuota.mes)
    if (!mapa.has(clave)) mapa.set(clave, cuota)
  }
  return mapa
}

/**
 * Meses impagos desde la fecha de contratación. Hasta el mes actual, un mes
 * sin cuota generada también es deuda y usa el precio del plan. Para los meses
 * futuros del año sólo se muestran cuotas que ya existen como pendientes.
 */
export function mesesDeudaAfiliado(params: {
  afiliado: Afiliado
  plan?: PlanAfiliado | null
  cuotas: readonly CuotaMensual[]
  indiceCuotas?: Map<string, CuotaMensual>
  hoy?: Date
}): CuotaPendienteAfiliado[] {
  const { afiliado, plan, cuotas, hoy = new Date() } = params
  const indice = params.indiceCuotas ?? indexarCuotas(cuotas)

  const anioActual = hoy.getFullYear()
  const mesActual = hoy.getMonth() + 1
  const inicio = new Date(`${afiliado.fechaInicio}T00:00:00`)
  if (Number.isNaN(inicio.getTime()) || inicio > hoy) return []
  const anioInicio = inicio.getFullYear()
  const mesInicio = inicio.getMonth() + 1

  const pendientes: CuotaPendienteAfiliado[] = []
  for (let anio = anioInicio; anio <= anioActual; anio++) {
    const primerMes = anio === anioInicio ? mesInicio : 1
    const ultimoMes = 12
    for (let mes = primerMes; mes <= ultimoMes; mes++) {
      const cuota = indice.get(claveCuota(afiliado.id, anio, mes))
      if (cuota?.estado === 'pagado') continue
      const esMesFuturo = anio === anioActual && mes > mesActual
      if (esMesFuturo && !cuota) continue
      pendientes.push({
        anio,
        mes,
        monto: cuota?.monto ?? plan?.precio ?? 0,
        cuotaId: cuota?.id,
      })
    }
  }
  return pendientes
}

export function deudaTotalAfiliado(params: {
  afiliado: Afiliado
  plan?: PlanAfiliado | null
  cuotas: readonly CuotaMensual[]
  indiceCuotas?: Map<string, CuotaMensual>
  hoy?: Date
}): number {
  return mesesDeudaAfiliado(params).reduce((total, c) => total + c.monto, 0)
}

function nombreTitular(paciente: Patient | undefined): string {
  if (!paciente) return '—'
  const apellido = paciente.apellido?.trim() ?? ''
  const nombre = paciente.nombre?.trim() ?? ''
  if (apellido && nombre) return `${apellido}, ${nombre}`
  return apellido || nombre || '—'
}

function coincideBusqueda(
  paciente: Patient | undefined,
  afiliadoId: string,
  consulta: string,
): boolean {
  if (!consulta) return true
  const nombre = paciente
    ? `${paciente.apellido ?? ''} ${paciente.nombre ?? ''}`
    : ''
  const dni = paciente?.dni ?? ''
  return (
    normalizarTexto(nombre).includes(consulta) ||
    normalizarTexto(dni).includes(consulta) ||
    normalizarTexto(afiliadoId).includes(consulta)
  )
}

/**
 * Lista de deudores para la pantalla.
 *
 * Sin búsqueda devuelve todos los contratantes con deuda, ordenados de mayor a
 * menor. Con búsqueda filtra por nombre o DNI y, si el contratante no debe,
 * devuelve `sinDeuda: true` para que la pantalla muestre sólo ese aviso.
 */
export function listarPagosAfiliados(params: {
  afiliados: readonly Afiliado[]
  planes: readonly PlanAfiliado[]
  cuotas: readonly CuotaMensual[]
  patients: readonly Patient[]
  q?: string
  hoy?: Date
}): ListadoPagosAfiliados {
  const { afiliados, planes, cuotas, patients, hoy = new Date() } = params
  const consulta = normalizarTexto(params.q ?? '')
  const indiceCuotas = indexarCuotas(cuotas)
  const planesPorId = new Map(planes.map((p) => [p.id, p]))
  const pacientesPorId = new Map(patients.map((p) => [p.id, p]))

  const deudores: DeudorAfiliado[] = []
  let huboCoincidenciaSinDeuda = false

  for (const afiliado of afiliados) {
    const paciente = pacientesPorId.get(afiliado.patientId)
    if (!coincideBusqueda(paciente, afiliado.id, consulta)) continue

    const plan = planesPorId.get(afiliado.planId)
    const cuotasPendientes = mesesDeudaAfiliado({
      afiliado,
      plan,
      cuotas,
      indiceCuotas,
      hoy,
    })

    if (cuotasPendientes.length === 0) {
      if (consulta) huboCoincidenciaSinDeuda = true
      continue
    }

    const adeudado = cuotasPendientes.reduce((total, c) => total + c.monto, 0)
    deudores.push({
      afiliadoId: afiliado.id,
      patientId: afiliado.patientId,
      nombre: nombreTitular(paciente),
      dni: paciente?.dni?.trim() || '—',
      cobertura: plan?.nombre?.trim() || '—',
      adeudado,
      cuotas: cuotasPendientes,
    })
  }

  deudores.sort((a, b) => {
    if (b.adeudado !== a.adeudado) return b.adeudado - a.adeudado
    return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
  })

  const totalAdeudado = deudores.reduce((total, d) => total + d.adeudado, 0)
  return {
    deudores,
    totalAdeudado,
    cantidad: deudores.length,
    sinDeuda: consulta.length > 0 && deudores.length === 0 && huboCoincidenciaSinDeuda,
  }
}

function pagarCuota(
  cuota: CuotaMensual,
  formaPago: FormaPago,
  cobradoPor: string,
  ahora: Date,
): CuotaMensual {
  return {
    ...cuota,
    estado: 'pagado',
    fechaPago: fechaLocalIso(ahora),
    formaPago,
    comprobante: true,
    cobradoPor,
    registradoEn: ahora.toISOString(),
  }
}

/**
 * Prepara el cobro en modo local (PC servidor): devuelve las cuotas ya pagadas
 * para guardarlas con `upsertCuotaMensual`. No modifica nada por sí sola.
 *
 * Si alguna cuota seleccionada ya estaba paga, no devuelve ninguna: el cobro
 * es todo o nada, igual que en el servidor.
 */
export function construirCobroLocal(params: {
  afiliadoId: string
  precioPlan: number
  cuotas: readonly CuotaMensual[]
  seleccion: readonly SeleccionCuota[]
  formaPago: FormaPago
  cobradoPor: string
  ahora?: Date
}): ResultadoCobroLocal {
  const { afiliadoId, precioPlan, cuotas, formaPago, cobradoPor, ahora = new Date() } = params
  const seleccion = deduplicarSeleccion(params.seleccion)
  if (seleccion.length === 0) return { ok: false, error: 'sin_seleccion' }

  const indice = indexarCuotas(cuotas)
  const resultado: CuotaMensual[] = []

  for (const { anio, mes } of seleccion) {
    const existente = indice.get(claveCuota(afiliadoId, anio, mes))
    if (existente?.estado === 'pagado') {
      return { ok: false, error: 'cuota_ya_pagada', anio, mes }
    }
    const base: CuotaMensual = existente ?? {
      id: createId(),
      afiliadoId,
      anio,
      mes,
      monto: precioPlan,
      estado: 'pendiente',
      fechaPago: null,
      formaPago: null,
      comprobante: false,
      notas: '',
      usos: 0,
    }
    resultado.push(pagarCuota(base, formaPago, cobradoPor, ahora))
  }

  return { ok: true, cuotas: resultado }
}

export function deduplicarSeleccion(seleccion: readonly SeleccionCuota[]): SeleccionCuota[] {
  const vistas = new Set<string>()
  const resultado: SeleccionCuota[] = []
  for (const item of seleccion) {
    const clave = `${item.anio}:${item.mes}`
    if (vistas.has(clave)) continue
    vistas.add(clave)
    resultado.push(item)
  }
  return resultado
}

/** Texto "Enero 2026" para la cuota. */
export function nombrePeriodo(anio: number, mes: number): string {
  return `${NOMBRES_MES[mes - 1] ?? mes} ${anio}`
}

/** Formato de moneda usado en la pantalla. */
export function formatearMonto(monto: number): string {
  return `$${Math.round(monto).toLocaleString('es-AR')}`
}
