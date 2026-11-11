import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { COBERTURA_PARTICULAR } from './cobertura'
import { safeParseISO } from './safeParseDate'
import type { Appointment, Doctor, Patient, Payment } from '../types'

/** Cómo se muestran las filas de la distribución por médico · obras sociales. */
export type DistribucionModo = 'resumen' | 'completo'

/**
 * Una fila de DETALLE de la distribución: una por pago y, si el pago tiene dos
 * motivos, una por motivo. Es la única fuente de verdad: tanto la vista
 * COMPLETO como la RESUMEN salen de acá.
 *
 * `id` es el médico: se usa para agrupar visualmente (las filas del mismo
 * médico van juntas y sólo la primera muestra nombre y especialidad).
 */
export type DistribucionFila = {
  id: string
  nombre: string
  especialidad: string
  /** Fecha del pago (ISO). Es lo que se muestra en la columna Fecha. */
  fecha: string
  /** Paciente del pago. En las filas de motivo 2 queda, pero no se muestra. */
  paciente: string
  /** El paciente se escribe sólo en la primera fila de su pago. */
  mostrarPaciente: boolean
  motivo: string
  prestacion?: string
  monto: number
  /** Arancel de la obra social del pago (catálogo). Base del cálculo del %; va en la misma fila que el monto. */
  arancel: number
  impBanco: number
  impFactura: number
  gastosAdm: number
  totalCuidar: number
  total: number
  obras: Set<string>
  /** Pagos que aporta la fila (1 en COMPLETO). */
  cantidadPagos: number
  cantidadesPorObraSocial?: Map<string, number>
}

/** Una fila consolidada de la vista RESUMEN: una por médico. */
export type DistribucionFilaResumen = {
  id: string
  nombre: string
  especialidad: string
  /**
   * Fecha del turno más reciente del médico ('YYYY-MM-DD'): la que va en la
   * columna. `fechaDesde`/`fechaHasta` acotan el período, sólo para el tooltip.
   */
  fecha: string
  fechaDesde: string
  fechaHasta: string
  /** Nombre del paciente si es uno solo; "Varios" si hay más de uno. */
  paciente: string
  /** "Consulta", o el motivo principal seguido de "+N" si hay varios. */
  motivo: string
  /** Prestación médica si aplica, o varias en formato "+N". */
  prestacion?: string
  /** Todos los motivos con su monto, para el tooltip de la celda. */
  motivosDetalle: { motivo: string; monto: number }[]
  monto: number
  arancel: number
  /**
   * Arancel ya repartido por obra social. Se calcula fila por fila y después se
   * suma, así la consolidada da el mismo resultado que la suma del detalle.
   */
  porObraSocial: Map<string, number>
  cantidadesPorObraSocial?: Map<string, number>
  /** Suma de `porObraSocial`: lo que la fila reparte entre obras sociales. */
  repartido: number
  impBanco: number
  impFactura: number
  gastosAdm: number
  /** Total Cuidar = repartido (% Cuidar) + Imp. Banco + Imp. Fact. + Gastos Adm. */
  totalCuidar: number
  /** Fila de TOTAL médico: Arancel − Total Cuidar. */
  total: number
  /** Motivos/prestaciones del detalle que Respaldan esta fila. */
  cantidadMotivos: number
  cantidadPagos: number
}

export type DistribucionFilasInput = {
  pagos: Payment[]
  doctorById: (id: string) => Doctor | undefined
  patientById: (id: string) => Patient | undefined
  /**
   * Turno del pago. La columna Fecha muestra la fecha de la cita de la agenda;
   * si el pago no tiene turno (atención sin turno), cae a la fecha del pago.
   */
  citaById?: (id: string) => Appointment | undefined
  /**
   * Cobertura efectiva del pago: override del pago, override del turno, obra
   * social o plan del paciente. Se usa para quedarse sólo con lo que tiene obra
   * social (ver `esCoberturaParticular`).
   */
  obraSocialDe: (p: Payment) => string
  /** Motivos del pago. Si tiene motivo 1 y motivo 2, llegan los dos. */
  motivosDe: (p: Payment) => string[]
  /** Prestación específica del pago/turno, si tiene. */
  prestacionDe?: (p: Payment) => string
  /** Arancel del catálogo de Obras Sociales para una cobertura. Sin esto, 0. */
  arancelDe?: (obraSocial: string) => number
  /** Porcentajes de impuestos y gastos para una cobertura. */
  impuestosDe?: (obraSocial: string) => { impBancoPct: number; impFacturaPct: number; gastosAdmPct: number }
}

/**
 * ¿La cobertura del pago es "Particular"?
 *
 * Esta tabla es la distribución entre obras sociales, así que lo que se paga de
 * bolsillo no entra: no hay a qué repartirlo. Se compara sin distinguir
 * mayúsculas ni espacios y un texto vacío también cuenta como particular.
 */
export function esCoberturaParticular(cobertura: string): boolean {
  const t = (cobertura ?? '').trim().toLowerCase()
  return t === '' || t === COBERTURA_PARTICULAR.toLowerCase()
}

/**
 * Coberturas de planes propios del sanatorio (Individual y Familiar).
 * Para estas coberturas no aplica 30% ni monto: se controla sólo la cantidad (1).
 */
export function esPlanCoberturaCantidad(cobertura: string): boolean {
  const norm = (cobertura ?? '').trim().toLowerCase()
  return (
    norm.includes('individual') ||
    norm.includes('individa') ||
    norm.includes('familiar')
  )
}

/**
 * % Cuidar de una obra social que todavía no tiene % guardado.
 *
 * Vive acá y no duplicado en la pantalla y en el PDF porque las dos vistas
 * reparten el mismo número: cuando el default estaba en un lado sí y en el otro
 * no, la pantalla mostraba los importes por obra social y el PDF los dejaba en
 * blanco, y no se sabía cuál de los dos estaba bien.
 */
export const PCT_CUIDAR_POR_DEFECTO = 30

/** 'YYYY-MM-DD' de un ISO con hora, o del propio string si ya es corto. */
function ymdDe(iso: string): string {
  const limpio = (iso ?? '').trim()
  if (!limpio) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(limpio)) return limpio.slice(0, 10)
  const d = safeParseISO(limpio)
  return d ? format(d, 'yyyy-MM-dd') : ''
}

type FilaInterna = DistribucionFila & {
  /** Qué pago generó la fila. */
  pagoId: string
  /** Monto del pago completo, para poder mudarlo a la fila de arriba. */
  montoPago: number
  arancelPago: number
  impBancoPago: number
  impFacturaPago: number
  gastosAdmPago: number
  /** Va a la primera fila de la lista ordenada. */
  montoEnEstaFila: boolean
}

/**
 * Arma las filas de DETALLE: una por pago y una por cada motivo del pago.
 *
 * Se quedan sólo los pagos con cobertura de obra social: lo que se atiende en
 * particular no se reparte entre obras sociales y por eso no tiene fila.
 *
 * Un pago con dos motivos genera dos filas. El monto va entero en la primera
 * fila del pago y en 0 en las demás, así el total nunca cuenta dos veces el
 * mismo pago. Si el motivo 1 ordena antes que el motivo 2, el monto se muda a
 * la fila que quedó primero, para que el importe quede siempre arriba.
 */
export function buildDistribucionFilas({
  pagos,
  doctorById,
  patientById,
  citaById,
  obraSocialDe,
  motivosDe,
  prestacionDe,
  arancelDe,
  impuestosDe,
}: DistribucionFilasInput): DistribucionFila[] {
  const mapa = new Map<string, FilaInterna>()

  for (const p of pagos) {
    const cobertura = obraSocialDe(p)
    if (esCoberturaParticular(cobertura)) continue
    const doc = doctorById(p.doctorId)
    const nombre = doc ? `${doc.apellido}, ${doc.nombre}` : 'Sin médico'
    const idMedico = doc?.id ?? `__${p.doctorId}`
    const especialidad = doc?.especialidad || '—'
    const paciente = patientById(p.patientId)
    const nombrePaciente = paciente
      ? `${paciente.apellido}, ${paciente.nombre}`
      : 'Sin paciente'
    const obras = new Set<string>([cobertura.trim()].filter(Boolean))
    const motivos = motivosDe(p).map((m) => (m && m !== '—' ? m : 'Sin motivo'))
    // La fecha es la del turno de la agenda; si el pago no tiene turno, la
    // fecha del propio pago.
    const cita = p.citaId ? citaById?.(p.citaId) : undefined
    const fecha = ymdDe(cita?.fechaHora ?? '') || ymdDe(p.fecha)
    const prestacion = (
      prestacionDe ? prestacionDe(p) : (cita?.motivoConsulta2?.trim() || '')
    ).trim()

    motivos.forEach((motivo) => {
      const clave = `${p.id}|${motivo}`
      let fila = mapa.get(clave)
      if (!fila) {
        fila = {
          id: idMedico,
          pagoId: p.id,
          nombre,
          especialidad,
          fecha,
          paciente: nombrePaciente,
          mostrarPaciente: false,
          motivo,
          prestacion: prestacion || '—',
          monto: 0,
          arancel: 0,
          impBanco: 0,
          impFactura: 0,
          gastosAdm: 0,
          totalCuidar: 0,
          total: 0,
          montoPago: 0,
          arancelPago: 0,
          impBancoPago: 0,
          impFacturaPago: 0,
          gastosAdmPago: 0,
          montoEnEstaFila: false,
          obras: new Set<string>(),
          cantidadPagos: 0,
        }
        mapa.set(clave, fila)
      }
      // Sólo la primera fila del pago lleva el monto.
      if (fila.cantidadPagos === 0) {
        fila.monto = p.monto
        fila.cantidadPagos = 1
      }
      // Todas las filas del pago conocen el monto del pago: después de
      // ordenar, la primera es la que lo muestra y las demás quedan en 0.
      fila.montoPago = p.monto
      const arancelVal = Math.round(Number(arancelDe?.(cobertura.trim()) || 0))
      fila.arancelPago = arancelVal
      const imp = impuestosDe?.(cobertura.trim()) ?? { impBancoPct: 0, impFacturaPct: 0, gastosAdmPct: 0 }
      fila.impBancoPago = Math.round((arancelVal * imp.impBancoPct) / 100)
      fila.impFacturaPago = Math.round((arancelVal * imp.impFacturaPct) / 100)
      fila.gastosAdmPago = Math.round((arancelVal * imp.gastosAdmPct) / 100)
      for (const o of obras) fila.obras.add(o)
    })
  }

  const ordenadas = Array.from(mapa.values()).sort((a, b) => {
    const byDoctor = a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
    if (byDoctor !== 0) return byDoctor
    return a.motivo.localeCompare(b.motivo, 'es', { sensitivity: 'base' })
  })

  const pagosResueltos = new Set<string>()
  for (const f of ordenadas) {
    if (pagosResueltos.has(f.pagoId)) continue
    pagosResueltos.add(f.pagoId)
    f.montoEnEstaFila = true
  }

  return ordenadas.map(({ pagoId: _pagoId, montoPago, arancelPago, impBancoPago, impFacturaPago, gastosAdmPago, montoEnEstaFila, ...f }) => {
    const arancel = montoEnEstaFila ? arancelPago : 0
    const impBanco = montoEnEstaFila ? impBancoPago : 0
    const impFactura = montoEnEstaFila ? impFacturaPago : 0
    const gastosAdm = montoEnEstaFila ? gastosAdmPago : 0
    const cantidadesPorObraSocial = new Map<string, number>()
    for (const o of f.obras) {
      if (esPlanCoberturaCantidad(o)) {
        cantidadesPorObraSocial.set(o, 1)
      }
    }
    return {
      ...f,
      monto: montoEnEstaFila ? montoPago : 0,
      arancel,
      impBanco,
      impFactura,
      gastosAdm,
      totalCuidar: 0,
      total: 0,
      mostrarPaciente: montoEnEstaFila,
      cantidadesPorObraSocial,
    }
  })
}

/**
 * Reparto de una fila de detalle entre las obras sociales.
 *
 * Se usa igual en las dos vistas: la consolidada lo aplica fila por fila y
 * después suma, en vez de multiplicar el total del médico por el porcentaje
 * (que daría decimales distintos).
 */
export function repartoDeFila(
  base: number,
  obras: Set<string>,
  pctDe: (obraSocial: string) => number,
  obraSocial: string,
): number {
  if (!obras.has(obraSocial)) return 0
  return (base * pctDe(obraSocial)) / 100
}

/**
 * Consolida las filas de detalle en UNA fila por médico (vista RESUMEN).
 *
 * - Paciente: el nombre si todas las prestaciones son del mismo paciente,
 *   "Varios" si hay más de uno.
 * - Especialidad: la del médico; si alguna fila no tiene, se toma la que sí.
 * - Motivo: si todas las filas comparten motivo, se muestra; si hay varios,
 *   el de mayor monto seguido de "+N" (los demás).
 * - Monto y reparto: sumas del detalle, con el reparto calculado fila por fila.
 */
export function consolidarPorMedico(
  detalle: DistribucionFila[],
  pctDe: (obraSocial: string) => number,
): DistribucionFilaResumen[] {
  const porMedico = new Map<
    string,
    DistribucionFilaResumen & {
      pacienteNombres: Set<string>
      montosPorMotivo: Map<string, number>
      prestacionesSet: Set<string>
    }
  >()

  for (const f of detalle) {
    let fila = porMedico.get(f.id)
    if (!fila) {
      fila = {
        id: f.id,
        nombre: f.nombre,
        especialidad: f.especialidad,
        fecha: f.fecha,
        fechaDesde: f.fecha,
        fechaHasta: f.fecha,
        paciente: '',
        motivo: f.motivo,
        prestacion: f.prestacion || '—',
        motivosDetalle: [],
        monto: 0,
        arancel: 0,
        porObraSocial: new Map<string, number>(),
        cantidadesPorObraSocial: new Map<string, number>(),
        repartido: 0,
        impBanco: 0,
        impFactura: 0,
        gastosAdm: 0,
        totalCuidar: 0,
        total: 0,
        cantidadMotivos: 0,
        cantidadPagos: 0,
        pacienteNombres: new Set<string>(),
        montosPorMotivo: new Map<string, number>(),
        prestacionesSet: new Set<string>(),
      }
      porMedico.set(f.id, fila)
    }
    if (f.paciente) fila.pacienteNombres.add(f.paciente)
    if (f.prestacion && f.prestacion !== '—') fila.prestacionesSet.add(f.prestacion)
    // Período del médico en el filtro; la columna muestra la fecha más reciente.
    if (!fila.fechaDesde || f.fecha < fila.fechaDesde) fila.fechaDesde = f.fecha
    if (!fila.fechaHasta || f.fecha > fila.fechaHasta) {
      fila.fechaHasta = f.fecha
      fila.fecha = f.fecha
    }
    // Una especialidad puede faltar en alguna fila: se queda la que exista.
    if (fila.especialidad === '—' && f.especialidad && f.especialidad !== '—') {
      fila.especialidad = f.especialidad
    }
    fila.monto += f.monto
    fila.arancel += f.arancel
    fila.impBanco += f.impBanco || 0
    fila.impFactura += f.impFactura || 0
    fila.gastosAdm += f.gastosAdm || 0
    fila.cantidadMotivos += 1
    fila.cantidadPagos += f.cantidadPagos
    fila.montosPorMotivo.set(
      f.motivo,
      (fila.montosPorMotivo.get(f.motivo) ?? 0) + f.monto,
    )
    for (const o of f.obras) {
      fila.porObraSocial.set(
        o,
        (fila.porObraSocial.get(o) ?? 0) + repartoDeFila(f.arancel, f.obras, pctDe, o),
      )
    }
    if (f.cantidadesPorObraSocial) {
      if (!fila.cantidadesPorObraSocial) {
        fila.cantidadesPorObraSocial = new Map<string, number>()
      }
      for (const [o, c] of f.cantidadesPorObraSocial.entries()) {
        fila.cantidadesPorObraSocial.set(
          o,
          (fila.cantidadesPorObraSocial.get(o) ?? 0) + c,
        )
      }
    }
  }

  return Array.from(porMedico.values())
    .map(({ pacienteNombres, montosPorMotivo, prestacionesSet, ...fila }) => {
      const motivosDetalle = [...montosPorMotivo.entries()]
        .map(([motivo, monto]) => ({ motivo, monto }))
        // Mayor monto primero; a igual monto, alfabético para que sea estable.
        .sort((a, b) => b.monto - a.monto || a.motivo.localeCompare(b.motivo, 'es'))
      const repartido = [...fila.porObraSocial.entries()]
        .filter(([obra]) => !esPlanCoberturaCantidad(obra))
        .reduce((s, [, v]) => s + v, 0)
      const totalCuidar = repartido + fila.impBanco + fila.impFactura + fila.gastosAdm
      const prestList = [...prestacionesSet].filter(Boolean)
      const prestacion =
        prestList.length === 0
          ? '—'
          : prestList.length === 1
            ? prestList[0]!
            : `${prestList[0]!} +${prestList.length - 1}`
      return {
        ...fila,
        paciente: pacienteNombres.size === 1 ? [...pacienteNombres][0] : 'Varios',
        motivo:
          motivosDetalle.length <= 1
            ? (motivosDetalle[0]?.motivo ?? '')
            : `${motivosDetalle[0]!.motivo} +${motivosDetalle.length - 1}`,
        prestacion,
        motivosDetalle,
        repartido,
        totalCuidar,
        total: fila.arancel - totalCuidar,
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
}

/** Texto del tooltip de la celda de motivo: todos los motivos con su monto. */
export function textoMotivosResumen(fila: DistribucionFilaResumen, fmtMonto: (n: number) => string): string {
  if (fila.motivosDetalle.length <= 1) return fila.motivo
  return fila.motivosDetalle.map((m) => `${m.motivo}: ${fmtMonto(m.monto)}`).join(' · ')
}

/**
 * Columna Fecha, en dd-MM-aa.
 *
 * La fecha del turno de la agenda. Si el médico tiene varias atenciones, la
 * consolidada muestra la más reciente y el rango completo va en el tooltip.
 */
export function textoFechaColumna(fecha: string): string {
  const d = safeParseISO(fecha)
  return d ? format(d, 'dd-MM-yy', { locale: es }) : ''
}

/** Tooltip de la columna Fecha: el período completo cuando hay varias fechas. */
export function textoPeriodoMedico(desde: string, hasta: string): string {
  if (!desde || !hasta || desde === hasta) return textoFechaColumna(hasta)
  return `${textoFechaColumna(desde)} - ${textoFechaColumna(hasta)}`
}