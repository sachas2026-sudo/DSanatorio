/** Etiquetas visibles: distinguir DNI de médico vs paciente en UI y exportaciones. */
export const DNI_MED_LABEL = 'DNI Med'
export const DNI_PAC_LABEL = 'DNI Pac'

export function dniMedDuplicadoMsg(apellido: string, nombre: string, revisar = false): string {
  const base = `Ese ${DNI_MED_LABEL} ya está cargado: ${apellido}, ${nombre}.`
  return revisar ? `${base} Revisá antes de guardar.` : base
}

export function dniPacDuplicadoMsg(apellido: string, nombre: string, revisar = false): string {
  const base = `Ese ${DNI_PAC_LABEL} ya está cargado: ${apellido}, ${nombre}.`
  return revisar ? `${base} Revisá antes de guardar.` : base
}

/** Línea de paciente en buscadores (agenda, etc.). */
export function patientPickerLine(
  dni: string | undefined,
  apellido: string,
  nombre: string,
): string {
  const id = (dni ?? '').trim()
  const prefix = id ? `${DNI_PAC_LABEL} ${id} · ` : ''
  return `${prefix}${apellido}, ${nombre}`
}

/** Formato anterior (solo número · apellido, nombre) — sigue reconociéndose al guardar turnos. */
export function patientPickerLineLegacy(
  dni: string | undefined,
  apellido: string,
  nombre: string,
): string {
  const id = (dni ?? '').trim()
  const prefix = id ? `${id} · ` : ''
  return `${prefix}${apellido}, ${nombre}`
}

export type ParsedPatientPickerQuery = {
  dni?: string
  apellidoNombre?: string
}

/** Interpreta lo escrito o elegido en el buscador de pacientes. */
export function parsePatientPickerQuery(query: string): ParsedPatientPickerQuery {
  const q = query.trim()
  if (!q) return {}

  const label = DNI_PAC_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withLabel = new RegExp(
    `^${label}\\s+(\\S+)\\s*·\\s*(.+)$`,
    'i',
  ).exec(q)
  if (withLabel) {
    return { dni: withLabel[1]!.trim(), apellidoNombre: withLabel[2]!.trim() }
  }

  const legacy = /^(\S+)\s*·\s*(.+)$/.exec(q)
  if (legacy) {
    return { dni: legacy[1]!.trim(), apellidoNombre: legacy[2]!.trim() }
  }

  if (/^\d[\d.\s-]*\d$|^\d+$/.test(q.replace(/\s/g, ''))) {
    return { dni: q.replace(/\s/g, '') }
  }

  if (q.includes(',')) {
    return { apellidoNombre: q }
  }

  return {}
}

/** DNI Pac interno corto: solo dígitos, de 1 a 3 caracteres (ej. 1, 62, 456). */
export const DNI_PAC_CORTO_RE = /^\d{1,3}$/

export function isDniPacCorto(dni: string | undefined): boolean {
  return DNI_PAC_CORTO_RE.test((dni ?? '').trim())
}

const ULTIMO_DNI_PAC_CORTO_KEY = 'sanatorio-ultimo-dni-pac-corto'

export function saveUltimoDniPacCorto(dni: string | undefined): void {
  const norm = (dni ?? '').trim()
  if (!isDniPacCorto(norm)) return
  try {
    localStorage.setItem(ULTIMO_DNI_PAC_CORTO_KEY, norm)
  } catch {
    /* quota / modo privado */
  }
}

function readUltimoDniPacCortoGuardado(): string | null {
  try {
    const raw = localStorage.getItem(ULTIMO_DNI_PAC_CORTO_KEY)?.trim() ?? ''
    return isDniPacCorto(raw) ? raw : null
  } catch {
    return null
  }
}

function maxDniPacCortoEnPacientes(
  patients: readonly { dni?: string }[],
): string | null {
  let maxNum = -1
  let maxDni = ''
  for (const p of patients) {
    const dni = (p.dni ?? '').trim()
    if (!isDniPacCorto(dni)) continue
    const n = Number(dni)
    if (!Number.isFinite(n) || n <= maxNum) continue
    maxNum = n
    maxDni = dni
  }
  return maxDni || null
}

/** Último DNI Pac corto (1–3 dígitos). Ignora DNIs largos como 2356598. */
export function ultimoDniPacCorto(
  patients: readonly { dni?: string }[],
): string | null {
  return readUltimoDniPacCortoGuardado() ?? maxDniPacCortoEnPacientes(patients)
}

/** @deprecated Usar ultimoDniPacCorto */
export function ultimoDniPacTresDigitos(
  patients: readonly { dni?: string }[],
): string | null {
  return ultimoDniPacCorto(patients)
}

export function patientMatchesPickerQuery(
  p: { dni?: string; apellido: string; nombre: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false

  const labels = [
    patientPickerLine(p.dni, p.apellido, p.nombre).toLowerCase(),
    patientPickerLineLegacy(p.dni, p.apellido, p.nombre).toLowerCase(),
  ]
  if (labels.includes(q)) return true

  const parsed = parsePatientPickerQuery(query)
  const dni = (p.dni ?? '').trim().toLowerCase()
  const dniDigits = dni.replace(/\D/g, '')
  const nombreCompleto = `${p.apellido}, ${p.nombre}`.toLowerCase()

  if (parsed.dni) {
    const queryDniDigits = parsed.dni.replace(/\D/g, '').toLowerCase()
    if (!queryDniDigits || !dniDigits.startsWith(queryDniDigits)) return false
  }
  if (parsed.apellidoNombre) {
    return nombreCompleto === parsed.apellidoNombre.toLowerCase()
  }

  return (
    dni === q ||
    nombreCompleto === q ||
    dni.includes(q) ||
    nombreCompleto.includes(q) ||
    (p.apellido ?? '').toLowerCase().includes(q)
  )
}
