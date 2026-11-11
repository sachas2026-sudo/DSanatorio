export const MOTIVOS_CONSULTA = [
  'Consulta',
  'Control',
  'Laboratorio',
  'Radiografía',
  'Ecografía',
  'Electrocardiograma',
  'Tomografía',
  'Resonancia',
  'Mamografía',
  'Kinesiología',
  'Vacunación',
  'Internación',
  'Cirugía',
  'Curaciones',
  'Certificado Médico',
  'Otro',
] as const

export type MotivoConsulta = (typeof MOTIVOS_CONSULTA)[number]

export const MOTIVO_CONSULTA_DEFAULT: MotivoConsulta = 'Consulta'

const MOTIVOS_SET = new Set<string>(MOTIVOS_CONSULTA)

export function normalizeMotivoConsulta(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function motivoConsultaKey(value: string): string {
  return normalizeMotivoConsulta(value).toLocaleLowerCase('es')
}

export function isMotivoConsultaBuiltin(value: string): boolean {
  return MOTIVOS_SET.has(value)
}

export function mergeMotivosConsulta(custom: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const m of MOTIVOS_CONSULTA) {
    if (m === 'Otro') continue
    const key = motivoConsultaKey(m)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }

  for (const raw of [...custom].sort((a, b) => a.localeCompare(b, 'es'))) {
    const nombre = normalizeMotivoConsulta(raw)
    if (!nombre) continue
    const key = motivoConsultaKey(nombre)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(nombre)
  }

  out.push('Otro')
  return out
}

export function isMotivoConsultaOption(
  value: string,
  custom: string[] = [],
): boolean {
  return mergeMotivosConsulta(custom).some(
    (m) => motivoConsultaKey(m) === motivoConsultaKey(value),
  )
}

export function isMotivoConsulta(value: string): value is MotivoConsulta {
  return MOTIVOS_SET.has(value)
}

/** Interpreta notas guardadas en el turno (texto libre histórico → Otro). */
export function motivoConsultaFromNotas(
  notas: string,
  custom: string[] = [],
): {
  motivo: string
  otroDetalle: string
} {
  const n = notas.trim()
  if (!n) {
    return { motivo: MOTIVO_CONSULTA_DEFAULT, otroDetalle: '' }
  }
  const match = mergeMotivosConsulta(custom).find(
    (m) => m !== 'Otro' && motivoConsultaKey(m) === motivoConsultaKey(n),
  )
  if (match) {
    return { motivo: match, otroDetalle: '' }
  }
  return { motivo: 'Otro', otroDetalle: n }
}

export function notasFromMotivoConsulta(
  motivo: string,
  otroDetalle: string,
  custom: string[] = [],
): string {
  const m = (motivo ?? '').trim()
  if (m === 'Otro') return otroDetalle.trim() || 'Otro'
  if (m) return m
  return MOTIVO_CONSULTA_DEFAULT
}

/** Valor del selector cuando el turno no tiene segundo motivo. */
export const MOTIVO_CONSULTA_2_NINGUNO = ''

/**
 * Normaliza el segundo motivo de consulta.
 *
 * A diferencia del motivo 1, acá el valor vacío significa "no hay motivo 2"
 * (y no "Consulta"), así el turno puede tener un solo motivo.
 */
export function motivoConsulta2Texto(
  motivo: string,
  otroDetalle: string,
  custom: string[] = [],
): string {
  const m = (motivo ?? '').trim()
  if (!m || m === MOTIVO_CONSULTA_2_NINGUNO || m.toLowerCase() === 'sin motivo 2') return ''
  if (m === 'Otro') return otroDetalle.trim()
  return m
}

/** Separador con el que se muestran los dos motivos juntos en textos y reportes. */
export const MOTIVO_CONSULTA_SEPARADOR = ' + '

/**
 * Une motivo 1 y motivo 2 para mostrar en celdas, PDFs y planillas.
 * Sin motivo 2 devuelve sólo el motivo 1, así los turnos viejos se ven igual.
 */
export function joinMotivosConsulta(motivo1: string, motivo2?: string): string {
  const a = motivo1.trim()
  const b = motivo2?.trim() ?? ''
  if (!a) return b
  if (!b) return a
  if (motivoConsultaKey(a) === motivoConsultaKey(b)) return a
  return `${a}${MOTIVO_CONSULTA_SEPARADOR}${b}`
}

/**
 * Motivos a contar para rankings y gráficos.
 *
 * Si el turno tiene motivo 2 se cuentan los dos, porque una consulta puede
 * cubrir más de una práctica. El texto libre ("Otro") sigue contando como un
 * motivo más, igual que antes de agregar el segundo campo.
 */
export function motivosConsultaDelTurno(
  notas: string,
  motivoConsulta2: string | undefined,
  custom: string[] = [],
): string[] {
  const motivos: string[] = []
  for (const texto of [notas, motivoConsulta2]) {
    const t = texto?.trim()
    if (!t) continue
    const motivo = motivoConsultaFromNotas(t, custom).motivo
    if (!motivo) continue
    if (motivos.some((m) => motivoConsultaKey(m) === motivoConsultaKey(motivo))) continue
    motivos.push(motivo)
  }
  return motivos
}