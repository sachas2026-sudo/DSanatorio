import type {
  Afiliado,
  AdherenteAfiliado,
  AdherenteCambioProgramado,
  HistorialCoberturaItem,
  MovimientoContratante,
  OpcionAdherentesFamiliarAIndividual,
  Patient,
  PlanAfiliado,
} from '../types'
import { coberturaMatchesPlan } from './consumoAfiliados'

function makeId(prefix = 'mov'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function hoyIsoLocal(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function primerDiaMesSiguienteIso(baseDate = new Date()): string {
  const y = baseDate.getMonth() === 11 ? baseDate.getFullYear() + 1 : baseDate.getFullYear()
  const m = baseDate.getMonth() === 11 ? 1 : baseDate.getMonth() + 2
  return `${y}-${String(m).padStart(2, '0')}-01`
}

export function formatearFechaLatina(iso?: string | null): string {
  if (!iso) return '—'
  const clean = iso.split('T')[0].trim()
  const parts = clean.split('-')
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`
  }
  return clean
}

/**
 * Determina si una obra social guardada como "anterior" es en realidad el nombre
 * de una cobertura interna del sanatorio (Individual/Familiar). Si no existe dato
 * o coincide con un plan interno, devuelve '' al restaurar.
 */
export function limpiarObraSocialRestaurada(
  obraSocialAnterior: string | undefined | null,
  planes: readonly PlanAfiliado[],
): string {
  const raw = (obraSocialAnterior ?? '').trim()
  if (!raw) return ''
  const esPlanInterno = planes.some((p) => coberturaMatchesPlan(raw, p))
  return esPlanInterno ? '' : raw
}

/**
 * Devuelve la obra social anterior a guardar antes de sobrescribir la obraSocial
 * de un paciente con el nombre de una cobertura.
 */
export function resolverObraSocialAnteriorParaGuardar(
  paciente: Patient | undefined,
  afiliadoOsAnterior: string | undefined,
  planes: readonly PlanAfiliado[],
): string {
  if (typeof afiliadoOsAnterior === 'string' && afiliadoOsAnterior.trim() !== '') {
    const limpia = limpiarObraSocialRestaurada(afiliadoOsAnterior, planes)
    if (limpia) return limpia
  }
  if (typeof paciente?.obraSocialAnterior === 'string' && paciente.obraSocialAnterior.trim() !== '') {
    const limpia = limpiarObraSocialRestaurada(paciente.obraSocialAnterior, planes)
    if (limpia) return limpia
  }
  const actual = (paciente?.obraSocial ?? '').trim()
  if (!actual) return ''
  const esPlanInterno = planes.some((p) => coberturaMatchesPlan(actual, p))
  return esPlanInterno ? '' : actual
}

/**
 * ¿Está dado de baja efectiva el contratante?
 */
export function esContratanteDadoDeBaja(afiliado: Afiliado, hoyIso = hoyIsoLocal()): boolean {
  if (!afiliado.activo) return true
  if (afiliado.baja?.activa) {
    if (afiliado.baja.programada && afiliado.baja.fecha > hoyIso) {
      return false
    }
    return true
  }
  return false
}

/**
 * ¿Está suspendido actualmente el contratante?
 */
export function esContratanteSuspendido(afiliado: Afiliado, hoyIso = hoyIsoLocal()): boolean {
  if (esContratanteDadoDeBaja(afiliado, hoyIso)) return false
  const susp = afiliado.suspension
  if (!susp || !susp.activa) return false
  if (susp.desde && susp.desde > hoyIso) return false
  if (susp.hasta && susp.hasta <= hoyIso) return false
  return true
}

/**
 * Construye la lista ordenada de movimientos (del más reciente al más antiguo)
 * para mostrar en la fila desplegada del contratante.
 */
export function obtenerMovimientosContratante(
  afiliado: Afiliado,
  planes: readonly PlanAfiliado[],
  patientsById: ReadonlyMap<string, Patient>,
): MovimientoContratante[] {
  const registrados = Array.isArray(afiliado.movimientos) ? [...afiliado.movimientos] : []
  const tieneAlta = registrados.some((m) => m.tipo === 'alta')

  if (!tieneAlta) {
    const planInicialId =
      afiliado.historialCoberturas && afiliado.historialCoberturas.length > 0
        ? afiliado.historialCoberturas[0].planId
        : afiliado.planId
    const planInicialNombre =
      afiliado.historialCoberturas && afiliado.historialCoberturas.length > 0
        ? afiliado.historialCoberturas[0].planNombre
        : planes.find((p) => p.id === planInicialId)?.nombre ?? 'Cobertura'

    const adhNombres = (afiliado.adherentes ?? [])
      .map((a) => {
        const p = patientsById.get(a.patientId)
        return p ? `${p.apellido}, ${p.nombre}` : null
      })
      .filter(Boolean)

    const detalleAlta =
      adhNombres.length > 0
        ? `Alta en cobertura ${planInicialNombre} con adherentes: ${adhNombres.join('; ')}`
        : `Alta en cobertura ${planInicialNombre}`

    registrados.push({
      id: `alta_inicial_${afiliado.id}`,
      afiliadoId: afiliado.id,
      fecha: afiliado.fechaInicio || '2026-01-01',
      tipo: 'alta',
      detalle: detalleAlta,
      usuario: 'Sistema',
      creadoEn: `${afiliado.fechaInicio || '2026-01-01'}T00:00:00.000Z`,
    })
  }

  return registrados.sort((a, b) => {
    const cmpFecha = (b.fecha || '').localeCompare(a.fecha || '')
    if (cmpFecha !== 0) return cmpFecha
    return (b.creadoEn || '').localeCompare(a.creadoEn || '')
  })
}

export interface AplicarCambioCoberturaParams {
  afiliadoId: string
  planNuevoId: string
  fechaVigencia: string // YYYY-MM-DD
  programado: boolean
  opcionAdherentes?: OpcionAdherentesFamiliarAIndividual
  nuevosAdherentes?: AdherenteCambioProgramado[]
  usuario: string
}

export interface ResultadoTransicionContratante {
  patients: Patient[]
  afiliados: Afiliado[]
  pacientesExistentesReutilizados: string[]
}

/**
 * Ejecuta el cambio efectivo de cobertura sobre el estado { patients, afiliados }.
 */
export function ejecutarCambioCoberturaEfectivo(
  state: {
    patients: readonly Patient[]
    afiliados: readonly Afiliado[]
    planesAfiliados: readonly PlanAfiliado[]
  },
  params: {
    afiliadoId: string
    planNuevoId: string
    fechaVigencia: string
    opcionAdherentes?: OpcionAdherentesFamiliarAIndividual
    nuevosAdherentes?: AdherenteCambioProgramado[]
    usuario: string
    esAplicacionProgramada?: boolean
  },
): ResultadoTransicionContratante {
  const { patients, afiliados, planesAfiliados } = state
  const afil = afiliados.find((a) => a.id === params.afiliadoId)
  const planNuevo = planesAfiliados.find((p) => p.id === params.planNuevoId)
  if (!afil || !planNuevo) {
    return {
      patients: [...patients],
      afiliados: [...afiliados],
      pacientesExistentesReutilizados: [],
    }
  }

  const planAnterior = planesAfiliados.find((p) => p.id === afil.planId)
  const planAnteriorNombre = planAnterior?.nombre ?? 'Anterior'
  const titular = patients.find((p) => p.id === afil.patientId)
  const titularNombreCompleto = titular
    ? `${titular.apellido}, ${titular.nombre}`
    : 'Titular'

  const pacientesModificados = new Map<string, Partial<Patient>>()
  const nuevosPacientes: Patient[] = []
  const nuevosAfiliadosIndividuales: Afiliado[] = []
  const reutilizados: string[] = []

  // 1. Actualizar obraSocial del titular a la nueva cobertura, preservando obraSocialAnterior
  if (titular) {
    const osAnt = resolverObraSocialAnteriorParaGuardar(
      titular,
      afil.obraSocialAnterior,
      planesAfiliados,
    )
    pacientesModificados.set(titular.id, {
      obraSocial: planNuevo.nombre,
      obraSocialAnterior: osAnt,
    })
  }

  let adherentesFinales: AdherenteAfiliado[] | undefined = undefined
  let detalleAdherentesMovimiento = ''

  if (planNuevo.tipo === 'familiar') {
    // Individual -> Familiar (o Familiar -> Familiar)
    const listaAdh: AdherenteAfiliado[] = []
    const nombresAgregados: string[] = []

    const borradores = params.nuevosAdherentes ?? []
    for (const adh of borradores) {
      const dniClean = adh.dni.trim()
      const existente =
        (adh.pacienteExistenteId
          ? patients.find((p) => p.id === adh.pacienteExistenteId)
          : undefined) ??
        patients.find((p) => p.dni.trim() === dniClean && dniClean !== '')

      if (existente) {
        reutilizados.push(`${existente.apellido}, ${existente.nombre} (DNI ${existente.dni})`)
        const osAnt = resolverObraSocialAnteriorParaGuardar(
          existente,
          existente.obraSocialAnterior,
          planesAfiliados,
        )
        listaAdh.push({
          patientId: existente.id,
          relacion: adh.relacion || 'Otro',
          obraSocialAnterior: osAnt,
        })
        pacientesModificados.set(existente.id, {
          obraSocial: planNuevo.nombre,
          obraSocialAnterior: osAnt,
        })
        nombresAgregados.push(`${existente.apellido}, ${existente.nombre} (${adh.relacion || 'Otro'})`)
      } else {
        const newPacId = makeId('pac')
        const ap = adh.apellido.trim()
        const nom = adh.nombre.trim()
        nuevosPacientes.push({
          id: newPacId,
          nombre: nom,
          apellido: ap,
          dni: dniClean,
          fechaNacimiento: (adh.fechaNacimiento || '').trim(),
          telefono: '',
          email: '',
          domicilio: '',
          localidad: '',
          obraSocial: planNuevo.nombre,
          obraSocialAnterior: '',
          notas: '',
          activo: true,
        })
        listaAdh.push({
          patientId: newPacId,
          relacion: adh.relacion || 'Otro',
          obraSocialAnterior: '',
        })
        nombresAgregados.push(`${ap}, ${nom} (${adh.relacion || 'Otro'})`)
      }
    }

    adherentesFinales = listaAdh
    if (nombresAgregados.length > 0) {
      detalleAdherentesMovimiento = ` · Adherentes agregados: ${nombresAgregados.join('; ')}`
    }
  } else {
    // Familiar -> Individual
    const adherentesActuales = afil.adherentes ?? []
    if (adherentesActuales.length > 0) {
      const nombresAdh: string[] = []
      for (const adh of adherentesActuales) {
        const pac = patients.find((p) => p.id === adh.patientId)
        if (pac) {
          nombresAdh.push(`${pac.apellido}, ${pac.nombre}`)
        }
        const osAnt = limpiarObraSocialRestaurada(
          adh.obraSocialAnterior ?? pac?.obraSocialAnterior,
          planesAfiliados,
        )

        if (params.opcionAdherentes === 'pasan_individual') {
          // Cada adherente pasa a ser contratante Individual propio
          if (pac) {
            pacientesModificados.set(pac.id, {
              obraSocial: planNuevo.nombre,
              obraSocialAnterior: osAnt,
            })
          }
          const nuevoAfilId = makeId('afil')
          const ahoraIso = new Date().toISOString()
          nuevosAfiliadosIndividuales.push({
            id: nuevoAfilId,
            patientId: adh.patientId,
            planId: planNuevo.id,
            fechaInicio: params.fechaVigencia,
            activo: true,
            obraSocialAnterior: osAnt,
            historialCoberturas: [
              {
                planId: planNuevo.id,
                planNombre: planNuevo.nombre,
                desde: params.fechaVigencia,
              },
            ],
            movimientos: [
              {
                id: makeId('mov'),
                afiliadoId: nuevoAfilId,
                fecha: params.fechaVigencia,
                tipo: 'alta',
                detalle: `Alta en ${planNuevo.nombre} (pase desde cobertura Familiar de ${titularNombreCompleto})`,
                usuario: params.usuario || 'Sistema',
                creadoEn: ahoraIso,
              },
            ],
          })
        } else {
          // Quedan sin cobertura: restaurar su obraSocialAnterior
          if (pac) {
            pacientesModificados.set(pac.id, {
              obraSocial: osAnt,
              obraSocialAnterior: undefined,
            })
          }
        }
      }

      if (params.opcionAdherentes === 'pasan_individual') {
        detalleAdherentesMovimiento = ` · Adherentes pasaron a Individual: ${nombresAdh.join('; ')}`
      } else {
        detalleAdherentesMovimiento = ` · Adherentes quitados (sin cobertura): ${nombresAdh.join('; ')}`
      }
    }
    adherentesFinales = undefined
  }

  // 2. Actualizar historial de coberturas del contratante
  const histPrevio: HistorialCoberturaItem[] =
    afil.historialCoberturas && afil.historialCoberturas.length > 0
      ? afil.historialCoberturas.map((h, idx, arr) =>
          idx === arr.length - 1 && !h.hasta ? { ...h, hasta: params.fechaVigencia } : h,
        )
      : [
          {
            planId: afil.planId,
            planNombre: planAnteriorNombre,
            desde: afil.fechaInicio,
            hasta: params.fechaVigencia,
          },
        ]

  const nuevoHistorial: HistorialCoberturaItem[] = [
    ...histPrevio,
    {
      planId: planNuevo.id,
      planNombre: planNuevo.nombre,
      desde: params.fechaVigencia,
    },
  ]

  // 3. Registrar movimiento
  const ahoraIso = new Date().toISOString()
  const nuevoMov: MovimientoContratante = {
    id: makeId('mov'),
    afiliadoId: afil.id,
    fecha: params.fechaVigencia,
    tipo: 'cambio_cobertura',
    detalle: `${planAnteriorNombre} → ${planNuevo.nombre} (rige desde ${formatearFechaLatina(params.fechaVigencia)})${detalleAdherentesMovimiento}`,
    usuario: params.usuario || 'Sistema',
    creadoEn: ahoraIso,
  }

  const titularOsAnt = titular
    ? resolverObraSocialAnteriorParaGuardar(titular, afil.obraSocialAnterior, planesAfiliados)
    : afil.obraSocialAnterior

  const updatedPatients: Patient[] = [
    ...patients.map((pac) => {
      const mod = pacientesModificados.get(pac.id)
      if (!mod) return pac
      return {
        ...pac,
        ...mod,
      }
    }),
    ...nuevosPacientes,
  ]

  const updatedAfiliados: Afiliado[] = [
    ...afiliados.map((a) => {
      if (a.id !== afil.id) return a
      const next: Afiliado = {
        ...a,
        planId: planNuevo.id,
        obraSocialAnterior: titularOsAnt,
        adherentes: adherentesFinales,
        cambioCoberturaProgramado: undefined,
        historialCoberturas: nuevoHistorial,
        movimientos: [nuevoMov, ...(a.movimientos ?? [])],
      }
      return next
    }),
    ...nuevosAfiliadosIndividuales,
  ]

  return {
    patients: updatedPatients,
    afiliados: updatedAfiliados,
    pacientesExistentesReutilizados: reutilizados,
  }
}

/**
 * Programa un cambio de cobertura para una fecha futura (ej. 1.º del mes siguiente).
 * Si hay adherentes nuevos en un pase Individual -> Familiar, se asegura de que
 * existan como Pacientes (sin pisar su obra social hasta el día de vigencia) y
 * registra el cambio programado.
 */
export function programarCambioCoberturaState(
  state: {
    patients: readonly Patient[]
    afiliados: readonly Afiliado[]
    planesAfiliados: readonly PlanAfiliado[]
  },
  params: AplicarCambioCoberturaParams,
): ResultadoTransicionContratante {
  const { patients, afiliados, planesAfiliados } = state
  const afil = afiliados.find((a) => a.id === params.afiliadoId)
  const planNuevo = planesAfiliados.find((p) => p.id === params.planNuevoId)
  if (!afil || !planNuevo) {
    return {
      patients: [...patients],
      afiliados: [...afiliados],
      pacientesExistentesReutilizados: [],
    }
  }

  const planAnterior = planesAfiliados.find((p) => p.id === afil.planId)
  const planAnteriorNombre = planAnterior?.nombre ?? 'Anterior'

  const nuevosPacientes: Patient[] = []
  const reutilizados: string[] = []
  const borradoresNormalizados: AdherenteCambioProgramado[] = []

  if (planNuevo.tipo === 'familiar' && Array.isArray(params.nuevosAdherentes)) {
    for (const adh of params.nuevosAdherentes) {
      const dniClean = adh.dni.trim()
      const existente =
        (adh.pacienteExistenteId
          ? patients.find((p) => p.id === adh.pacienteExistenteId)
          : undefined) ??
        patients.find((p) => p.dni.trim() === dniClean && dniClean !== '')

      if (existente) {
        reutilizados.push(`${existente.apellido}, ${existente.nombre} (DNI ${existente.dni})`)
        borradoresNormalizados.push({
          ...adh,
          pacienteExistenteId: existente.id,
          dni: existente.dni,
          apellido: existente.apellido,
          nombre: existente.nombre,
          fechaNacimiento: existente.fechaNacimiento || adh.fechaNacimiento,
        })
      } else {
        const newPacId = makeId('pac')
        const ap = adh.apellido.trim()
        const nom = adh.nombre.trim()
        nuevosPacientes.push({
          id: newPacId,
          nombre: nom,
          apellido: ap,
          dni: dniClean,
          fechaNacimiento: (adh.fechaNacimiento || '').trim(),
          telefono: '',
          email: '',
          domicilio: '',
          localidad: '',
          obraSocial: '',
          obraSocialAnterior: '',
          notas: '',
          activo: true,
        })
        borradoresNormalizados.push({
          ...adh,
          pacienteExistenteId: newPacId,
          dni: dniClean,
          apellido: ap,
          nombre: nom,
        })
      }
    }
  }

  const ahoraIso = new Date().toISOString()
  const detalleAdh =
    planNuevo.tipo === 'familiar' && borradoresNormalizados.length > 0
      ? ` · Adherentes previstos: ${borradoresNormalizados.map((b) => `${b.apellido}, ${b.nombre} (${b.relacion})`).join('; ')}`
      : planAnterior?.tipo === 'familiar' && (afil.adherentes?.length ?? 0) > 0
        ? params.opcionAdherentes === 'pasan_individual'
          ? ' · Adherentes pasarán a Individual'
          : ' · Adherentes quedarán sin cobertura'
        : ''

  const movProgramado: MovimientoContratante = {
    id: makeId('mov'),
    afiliadoId: afil.id,
    fecha: params.fechaVigencia,
    tipo: 'cambio_cobertura',
    detalle: `Cambio programado: ${planAnteriorNombre} → ${planNuevo.nombre} (rige desde ${formatearFechaLatina(params.fechaVigencia)})${detalleAdh}`,
    usuario: params.usuario || 'Sistema',
    creadoEn: ahoraIso,
  }

  const updatedAfiliados = afiliados.map((a) => {
    if (a.id !== afil.id) return a
    return {
      ...a,
      cambioCoberturaProgramado: {
        planNuevoId: planNuevo.id,
        planNuevoNombre: planNuevo.nombre,
        fechaVigencia: params.fechaVigencia,
        opcionAdherentes: params.opcionAdherentes,
        nuevosAdherentes: borradoresNormalizados.length > 0 ? borradoresNormalizados : undefined,
        usuario: params.usuario || 'Sistema',
        creadoEn: ahoraIso,
      },
      movimientos: [movProgramado, ...(a.movimientos ?? [])],
    }
  })

  return {
    patients: [...patients, ...nuevosPacientes],
    afiliados: updatedAfiliados,
    pacientesExistentesReutilizados: reutilizados,
  }
}

export function cancelarCambioProgramadoState(
  afiliados: readonly Afiliado[],
  afiliadoId: string,
  usuario: string,
): Afiliado[] {
  return afiliados.map((a) => {
    if (a.id !== afiliadoId || !a.cambioCoberturaProgramado) return a
    const prog = a.cambioCoberturaProgramado
    const movCancel: MovimientoContratante = {
      id: makeId('mov'),
      afiliadoId: a.id,
      fecha: hoyIsoLocal(),
      tipo: 'cambio_cobertura',
      detalle: `Se canceló el cambio programado a ${prog.planNuevoNombre} (previsto para el ${formatearFechaLatina(prog.fechaVigencia)})`,
      usuario: usuario || 'Sistema',
      creadoEn: new Date().toISOString(),
    }
    return {
      ...a,
      cambioCoberturaProgramado: undefined,
      movimientos: [movCancel, ...(a.movimientos ?? [])],
    }
  })
}

export function suspenderContratanteState(
  afiliados: readonly Afiliado[],
  params: {
    afiliadoId: string
    motivo: string
    desde: string
    hasta?: string
    observaciones?: string
    usuario: string
  },
): Afiliado[] {
  const ahoraIso = new Date().toISOString()
  return afiliados.map((a) => {
    if (a.id !== params.afiliadoId) return a
    const rangoTexto = params.hasta
      ? `Desde ${formatearFechaLatina(params.desde)} hasta ${formatearFechaLatina(params.hasta)}`
      : `Desde ${formatearFechaLatina(params.desde)} (sin fecha de fin)`
    const obsTexto = params.observaciones?.trim() ? ` · Obs.: ${params.observaciones.trim()}` : ''
    const mov: MovimientoContratante = {
      id: makeId('mov'),
      afiliadoId: a.id,
      fecha: params.desde,
      tipo: 'suspension',
      detalle: `Suspensión de cobertura (${rangoTexto})${obsTexto}`,
      motivo: params.motivo,
      usuario: params.usuario || 'Sistema',
      creadoEn: ahoraIso,
    }
    return {
      ...a,
      suspension: {
        activa: true,
        desde: params.desde,
        ...(params.hasta ? { hasta: params.hasta } : {}),
        motivo: params.motivo,
        ...(params.observaciones?.trim() ? { observaciones: params.observaciones.trim() } : {}),
        usuario: params.usuario || 'Sistema',
      },
      movimientos: [mov, ...(a.movimientos ?? [])],
    }
  })
}

export function reactivarContratanteState(
  afiliados: readonly Afiliado[],
  params: {
    afiliadoId: string
    fecha?: string
    usuario: string
    automatica?: boolean
  },
): Afiliado[] {
  const fechaEfectiva = params.fecha || hoyIsoLocal()
  const ahoraIso = new Date().toISOString()
  return afiliados.map((a) => {
    if (a.id !== params.afiliadoId) return a
    const mov: MovimientoContratante = {
      id: makeId('mov'),
      afiliadoId: a.id,
      fecha: fechaEfectiva,
      tipo: 'reactivacion',
      detalle: params.automatica
        ? `Reactivación automática por cumplimiento de fecha Hasta (${formatearFechaLatina(fechaEfectiva)})`
        : `Reactivación manual de cobertura (${formatearFechaLatina(fechaEfectiva)})`,
      usuario: params.usuario || 'Sistema',
      creadoEn: ahoraIso,
    }
    return {
      ...a,
      suspension: undefined,
      movimientos: [mov, ...(a.movimientos ?? [])],
    }
  })
}

export function darDeBajaContratanteState(
  state: {
    patients: readonly Patient[]
    afiliados: readonly Afiliado[]
    planesAfiliados: readonly PlanAfiliado[]
  },
  params: {
    afiliadoId: string
    motivo: string
    fechaBaja: string
    usuario: string
  },
): { patients: Patient[]; afiliados: Afiliado[] } {
  const { patients, afiliados, planesAfiliados } = state
  const afil = afiliados.find((a) => a.id === params.afiliadoId)
  if (!afil) {
    return { patients: [...patients], afiliados: [...afiliados] }
  }

  const hoy = hoyIsoLocal()
  const esFutura = params.fechaBaja > hoy
  const ahoraIso = new Date().toISOString()

  const movBaja: MovimientoContratante = {
    id: makeId('mov'),
    afiliadoId: afil.id,
    fecha: params.fechaBaja,
    tipo: 'baja',
    detalle: esFutura
      ? `Baja programada para el ${formatearFechaLatina(params.fechaBaja)}`
      : `Baja de afiliación (efectiva el ${formatearFechaLatina(params.fechaBaja)})`,
    motivo: params.motivo,
    usuario: params.usuario || 'Sistema',
    creadoEn: ahoraIso,
  }

  if (esFutura) {
    const updatedAfiliados = afiliados.map((a) => {
      if (a.id !== afil.id) return a
      return {
        ...a,
        baja: {
          activa: true,
          fecha: params.fechaBaja,
          motivo: params.motivo,
          programada: true,
          usuario: params.usuario || 'Sistema',
        },
        movimientos: [movBaja, ...(a.movimientos ?? [])],
      }
    })
    return { patients: [...patients], afiliados: updatedAfiliados }
  }

  // Baja inmediata: restaurar obraSocialAnterior del titular y de sus adherentes
  const pacientesRestaurados = new Map<string, string>()
  const titular = patients.find((p) => p.id === afil.patientId)
  if (titular) {
    const osRestaurada = limpiarObraSocialRestaurada(
      afil.obraSocialAnterior ?? titular.obraSocialAnterior,
      planesAfiliados,
    )
    pacientesRestaurados.set(titular.id, osRestaurada)
  }

  for (const adh of afil.adherentes ?? []) {
    const pacAdh = patients.find((p) => p.id === adh.patientId)
    const osRestaurada = limpiarObraSocialRestaurada(
      adh.obraSocialAnterior ?? pacAdh?.obraSocialAnterior,
      planesAfiliados,
    )
    pacientesRestaurados.set(adh.patientId, osRestaurada)
  }

  const updatedPatients = patients.map((pac) => {
    if (!pacientesRestaurados.has(pac.id)) return pac
    return {
      ...pac,
      obraSocial: pacientesRestaurados.get(pac.id) ?? '',
      obraSocialAnterior: undefined,
    }
  })

  const planActual = planesAfiliados.find((p) => p.id === afil.planId)
  const histPrevio: HistorialCoberturaItem[] =
    afil.historialCoberturas && afil.historialCoberturas.length > 0
      ? afil.historialCoberturas.map((h, idx, arr) =>
          idx === arr.length - 1 && !h.hasta ? { ...h, hasta: params.fechaBaja } : h,
        )
      : [
          {
            planId: afil.planId,
            planNombre: planActual?.nombre ?? 'Cobertura',
            desde: afil.fechaInicio,
            hasta: params.fechaBaja,
          },
        ]

  const updatedAfiliados = afiliados.map((a) => {
    if (a.id !== afil.id) return a
    return {
      ...a,
      activo: false,
      suspension: undefined,
      cambioCoberturaProgramado: undefined,
      baja: {
        activa: true,
        fecha: params.fechaBaja,
        motivo: params.motivo,
        programada: false,
        usuario: params.usuario || 'Sistema',
      },
      historialCoberturas: histPrevio,
      movimientos: [movBaja, ...(a.movimientos ?? [])],
    }
  })

  return {
    patients: updatedPatients,
    afiliados: updatedAfiliados,
  }
}

/**
 * Tarea diaria: aplica automáticamente:
 * 1) Cambios de cobertura programados cuya fechaVigencia <= hoyIso
 * 2) Reactivaciones automáticas cuya fecha Hasta <= hoyIso
 * 3) Bajas programadas cuya fecha <= hoyIso
 */
export function procesarTareasDiariasContratantes(
  state: {
    patients: readonly Patient[]
    afiliados: readonly Afiliado[]
    planesAfiliados: readonly PlanAfiliado[]
  },
  hoyIso = hoyIsoLocal(),
): { changed: boolean; patients: Patient[]; afiliados: Afiliado[] } {
  let currentPatients: Patient[] = [...state.patients]
  let currentAfiliados: Afiliado[] = [...state.afiliados]
  let changed = false

  // 1. Cambios de cobertura programados vencidos
  for (const afil of [...currentAfiliados]) {
    const prog = afil.cambioCoberturaProgramado
    if (prog && prog.fechaVigencia && prog.fechaVigencia <= hoyIso && afil.activo) {
      const res = ejecutarCambioCoberturaEfectivo(
        {
          patients: currentPatients,
          afiliados: currentAfiliados,
          planesAfiliados: state.planesAfiliados,
        },
        {
          afiliadoId: afil.id,
          planNuevoId: prog.planNuevoId,
          fechaVigencia: prog.fechaVigencia,
          opcionAdherentes: prog.opcionAdherentes,
          nuevosAdherentes: prog.nuevosAdherentes,
          usuario: prog.usuario || 'Sistema (automático)',
          esAplicacionProgramada: true,
        },
      )
      currentPatients = res.patients
      currentAfiliados = res.afiliados
      changed = true
    }
  }

  // 2. Reactivaciones automáticas con fecha Hasta cumplida
  for (const afil of [...currentAfiliados]) {
    if (
      afil.activo &&
      afil.suspension?.activa &&
      afil.suspension.hasta &&
      afil.suspension.hasta <= hoyIso
    ) {
      currentAfiliados = reactivarContratanteState(currentAfiliados, {
        afiliadoId: afil.id,
        fecha: afil.suspension.hasta,
        usuario: 'Sistema (automático)',
        automatica: true,
      })
      changed = true
    }
  }

  // 3. Bajas con fecha futura cumplida
  for (const afil of [...currentAfiliados]) {
    if (afil.activo && afil.baja?.activa && afil.baja.programada && afil.baja.fecha <= hoyIso) {
      const res = darDeBajaContratanteState(
        {
          patients: currentPatients,
          afiliados: currentAfiliados,
          planesAfiliados: state.planesAfiliados,
        },
        {
          afiliadoId: afil.id,
          motivo: afil.baja.motivo,
          fechaBaja: afil.baja.fecha,
          usuario: afil.baja.usuario || 'Sistema (automático)',
        },
      )
      currentPatients = res.patients
      currentAfiliados = res.afiliados
      changed = true
    }
  }

  return {
    changed,
    patients: currentPatients,
    afiliados: currentAfiliados,
  }
}
