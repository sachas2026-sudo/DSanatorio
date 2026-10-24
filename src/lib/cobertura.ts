import type {
  Afiliado,
  CoberturaTipo,
  CuotaMensual,
  Patient,
  PlanAfiliado,
} from '../types'

/** Valor con el que se guarda "sin cobertura" en `obraSocialOverride`. */
export const COBERTURA_PARTICULAR = 'Particular'

/**
 * Contexto de cobertura de un paciente.
 *
 * Un paciente puede tener, a la vez, obra social nativa y plan de afiliado.
 * Este módulo es el único lugar que decide qué coberturas tiene disponibles y
 * cuál se usa por defecto, para que Agenda, Pagos y Afiliados no calculen lo
 * mismo de tres maneras distintas.
 */
export interface ContextoCobertura {
  /** Obra social nativa del paciente ('' si no tiene). */
  obraSocial: string
  /** Afiliación activa del paciente (null si no está afiliado). */
  afiliado: Afiliado | null
  /** Plan del paciente (null si no está afiliado o el plan fue borrado). */
  plan: PlanAfiliado | null
  /** true si el plan se puede usar para un turno nuevo. */
  planHabilitado: boolean
  /** Por qué no se puede usar el plan, si no se puede ('' si se puede). */
  planMotivo: string
  /** Cuántas consultas del mes ya consumió y cuál es su cupo. */
  consumo: ConsumoPlanMes
  /** Cobertura elegida por defecto en la ficha del paciente. */
  preferida: CoberturaTipo
}

export interface OpcionCobertura {
  tipo: CoberturaTipo
  /** Lo que se guarda en `obraSocialOverride`. */
  valor: string
  /** Lo que se muestra en el selector. */
  label: string
  disabled: boolean
  /** Motivo de la bloqueo, para explicar por qué no se puede elegir. */
  motivo?: string
}

/** Normaliza para comparar nombres de obras sociales sin tildes ni mayúsculas. */
function norm(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * El afiliado tiene alguna cuota impaga entre su fecha de inicio y hoy.
 *
 * Una cuota que todavía no fue generada también cuenta como impaga: si ya
 * venció, es deuda igual. Es la misma regla que usa la columna "Estado" de
 * Afiliados, extraída acá para que ambos módulos muestren lo mismo.
 */
export function afiliadoTieneCuotasImpagas(
  afiliado: Afiliado | null | undefined,
  cuotas: readonly CuotaMensual[],
  hoy: Date = new Date(),
): boolean {
  if (!afiliado) return false

  const inicio = new Date(`${afiliado.fechaInicio}T00:00:00`)
  if (Number.isNaN(inicio.getTime()) || inicio > hoy) return false

  const anioActual = hoy.getFullYear()
  const mesActual = hoy.getMonth() + 1
  const anioInicio = inicio.getFullYear()
  const mesInicio = inicio.getMonth() + 1

  for (let anio = anioInicio; anio <= anioActual; anio++) {
    const primerMes = anio === anioInicio ? mesInicio : 1
    const ultimoMes = anio === anioActual ? mesActual : 12
    for (let mes = primerMes; mes <= ultimoMes; mes++) {
      const cuota = cuotas.find(
        (c) => c.afiliadoId === afiliado.id && c.anio === anio && c.mes === mes,
      )
      if (!cuota || cuota.estado !== 'pagado') return true
    }
  }
  return false
}

export interface ConsumoPlanMes {
  /** Atenciones ya registradas en la cuota del mes. */
  usos: number
  /** Consultas gratuitas por mes del plan (0 = sin límite). */
  cupo: number
  /** true si ya consumió el cupo y no puede seguir usándolo este mes. */
  agotado: boolean
}

/**
 * Consumo de un afiliado en el mes en curso.
 *
 * El conteo vive en la cuota mensual (`usos`), que es lo que se incrementa al
 * agendar un turno cubierto por el plan. Un plan sin cupo (0) nunca se agota.
 */
export function consumoPlanDelMes(
  afiliado: Afiliado | null | undefined,
  plan: PlanAfiliado | null | undefined,
  cuotas: readonly CuotaMensual[],
  hoy: Date = new Date(),
): ConsumoPlanMes {
  const cupo = plan?.cupoConsultas ?? 0
  if (!afiliado) return { usos: 0, cupo, agotado: false }
  const cuota = cuotas.find(
    (c) =>
      c.afiliadoId === afiliado.id &&
      c.anio === hoy.getFullYear() &&
      c.mes === hoy.getMonth() + 1,
  )
  const usos = cuota?.usos ?? 0
  return { usos, cupo, agotado: cupo > 0 && usos >= cupo }
}

/**
 * Arma el contexto de cobertura de un paciente a partir del estado de la app.
 *
 * El plan queda deshabilitado (pero visible, para que se vea por qué) cuando
 * no se puede usar: afiliación suspendida, plan dado de baja, cuotas impagas o
 * cupo del mes ya consumido.
 */
export function contextoCoberturaDe(
  paciente: Patient | null | undefined,
  afiliados: readonly Afiliado[],
  planes: readonly PlanAfiliado[],
  cuotas: readonly CuotaMensual[],
  hoy: Date = new Date(),
): ContextoCobertura {
  const obraSocial = (paciente?.obraSocial ?? '').trim()

  // `activo` es opcional: undefined significa activo (mismo criterio que el resto
  // de la app), así que sólo se descarta el paciente con activo === false.
  const afiliado =
    !paciente || paciente.activo === false
      ? null
      : afiliados.find((a) => a.patientId === paciente.id && a.activo) ?? null
  const plan = afiliado
    ? planes.find((p) => p.id === afiliado.planId) ?? null
    : null

  let planHabilitado = true
  let planMotivo = ''
  const consumo = consumoPlanDelMes(afiliado, plan, cuotas, hoy)
  if (!plan) {
    planHabilitado = false
    planMotivo = 'No tiene plan activo.'
  } else if (!plan.activo) {
    planHabilitado = false
    planMotivo = `El plan "${plan.nombre}" está dado de baja.`
  } else if (afiliadoTieneCuotasImpagas(afiliado, cuotas, hoy)) {
    planHabilitado = false
    planMotivo = 'Tiene cuotas impagas: regularizá antes de usarlo.'
  } else if (consumo.agotado) {
    // Consumió las consultas gratuitas del mes. No se bloquea el turno: se
    // bloquea la cobertura por el plan, que sigue disponible por obra social
    // o como particular.
    planHabilitado = false
    planMotivo = `Ya usó sus ${consumo.cupo} consultas de este mes.`
  }

  const preferida = paciente?.coberturaPreferida ?? 'obraSocial'

  return { obraSocial, afiliado, plan, planHabilitado, planMotivo, consumo, preferida }
}

/**
 * Opciones del selector, en el orden en que se muestran.
 *
 * Siempre incluye "Particular". La obra social sólo aparece si el paciente
 * tiene una; el plan aparece siempre que tenga plan, deshabilitado con su
 * motivo si no puede usarlo (así el usuario ve por qué no lo puede elegir).
 */
export function opcionesCobertura(ctx: ContextoCobertura): OpcionCobertura[] {
  const opciones: OpcionCobertura[] = []

  if (ctx.obraSocial) {
    opciones.push({
      tipo: 'obraSocial',
      valor: ctx.obraSocial,
      label: ctx.obraSocial,
      disabled: false,
    })
  }

  if (ctx.plan) {
    opciones.push({
      tipo: 'plan',
      valor: ctx.plan.nombre,
      label: `${ctx.plan.nombre} (plan)`,
      disabled: !ctx.planHabilitado,
      ...(ctx.planMotivo ? { motivo: ctx.planMotivo } : {}),
    })
  }

  opciones.push({
    tipo: 'particular',
    valor: COBERTURA_PARTICULAR,
    label: 'Particular',
    disabled: false,
  })

  return opciones
}

/**
 * Cobertura con la que hay que abrir el selector.
 *
 * Respeta la preferencia del paciente, pero cae a la primera opción
 * disponible si la preferida no existe o no se puede usar (obra social
 * borrada, plan con cuotas impagas). Nunca devuelve una opción deshabilitada.
 */
export function coberturaInicial(ctx: ContextoCobertura): OpcionCobertura {
  const opciones = opcionesCobertura(ctx)
  const preferida = opciones.find((o) => o.tipo === ctx.preferida && !o.disabled)
  if (preferida) return preferida
  return opciones.find((o) => !o.disabled) ?? opciones[opciones.length - 1]!
}

/**
 * Lee la cobertura de un turno o cobro ya guardado.
 *
 * `obraSocialOverride` guarda el nombre tal cual: el de la obra social, el
 * del plan, o "Particular". Si viene vacío, el turno usa la obra social del
 * paciente (o "Particular" si no tiene).
 */
export function coberturaGuardada(
  override: string | null | undefined,
  ctx: ContextoCobertura,
): OpcionCobertura {
  const opciones = opcionesCobertura(ctx)
  const valor = (override ?? '').trim()

  if (valor && norm(valor) === norm(COBERTURA_PARTICULAR)) {
    return opciones.find((o) => o.tipo === 'particular')!
  }
  if (valor && ctx.plan && norm(valor) === norm(ctx.plan.nombre)) {
    return opciones.find((o) => o.tipo === 'plan')!
  }
  if (valor && ctx.obraSocial && norm(valor) === norm(ctx.obraSocial)) {
    return opciones.find((o) => o.tipo === 'obraSocial')!
  }
  return coberturaInicial(ctx)
}

/** La cuota del mes de un turno, para poder contar la atención. */
export function cuotaDelMes(
  cuotas: readonly CuotaMensual[],
  afiliadoId: string,
  fecha: Date,
): CuotaMensual | undefined {
  return cuotas.find(
    (c) =>
      c.afiliadoId === afiliadoId &&
      c.anio === fecha.getFullYear() &&
      c.mes === fecha.getMonth() + 1,
  )
}