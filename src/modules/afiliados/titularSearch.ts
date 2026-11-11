import type { Patient } from '../../types'

export interface HighlightSegment {
  text: string
  match: boolean
}

/**
 * Quita tildes/diacríticos y pasa a minúsculas manteniendo la correspondencia
 * carácter por carácter para búsquedas y resaltado seguro.
 */
export function normalizarTextoBusqueda(texto: string): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Extrae las palabras de búsqueda normalizadas (sin tildes ni mayúsculas).
 */
export function obtenerPalabrasBusqueda(texto: string): string[] {
  const norm = normalizarTextoBusqueda(texto).trim()
  if (!norm) return []
  return norm.split(/\s+/).filter(Boolean)
}

/**
 * Filtra la lista de pacientes según el texto buscado:
 * - No distingue mayúsculas ni tildes ("ácosta" === "ACOSTA").
 * - Separa lo escrito en palabras y exige que TODAS aparezcan en cualquier orden
 *   (en el nombre/apellido o en el DNI parcial).
 * - Si el texto está vacío devuelve todos hasta `limite` (por defecto 50).
 */
export function filtrarPacientes<
  T extends Pick<Patient, 'id' | 'nombre' | 'apellido' | 'dni'>,
>(lista: readonly T[], texto: string, limite = 50): T[] {
  const palabras = obtenerPalabrasBusqueda(texto)
  const cap = limite > 0 ? limite : lista.length

  if (palabras.length === 0) {
    return lista.slice(0, cap)
  }

  const resultado: T[] = []
  for (const p of lista) {
    const nombreCompleto = `${p.apellido || ''}, ${p.nombre || ''}`
    const nombreNorm = normalizarTextoBusqueda(nombreCompleto)
    const dniRaw = normalizarTextoBusqueda(String(p.dni || ''))
    const dniSoloDigitos = dniRaw.replace(/\D/g, '')

    const coincideTodas = palabras.every((palabra) => {
      if (nombreNorm.includes(palabra)) return true
      if (dniRaw.includes(palabra)) return true
      const palabraDigitos = palabra.replace(/\D/g, '')
      if (palabraDigitos && palabraDigitos === palabra && dniSoloDigitos.includes(palabraDigitos)) {
        return true
      }
      return false
    })

    if (coincideTodas) {
      resultado.push(p)
      if (resultado.length >= cap) break
    }
  }

  return resultado
}

/**
 * Divide un texto en partes resaltadas ({ text, match }) según las palabras de búsqueda,
 * sin romper con tildes ni caracteres especiales (paréntesis, puntos, guiones, etc.).
 */
export function resaltarCoincidencias(
  textoOriginal: string,
  consulta: string,
): HighlightSegment[] {
  if (!textoOriginal) return []
  const palabras = obtenerPalabrasBusqueda(consulta)
  if (palabras.length === 0) {
    return [{ text: textoOriginal, match: false }]
  }

  // Construimos la versión normalizada carácter a carácter para mapear índices exactos
  const charsOriginales = Array.from(textoOriginal)
  const charsNorm: string[] = []
  for (const ch of charsOriginales) {
    const n = ch
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
    // Si por algún caso raro un código se expande, tomamos el primer char o espacio
    charsNorm.push(n.slice(0, 1) || ' ')
  }
  const textoNorm = charsNorm.join('')

  // Marcar qué posiciones están resaltadas
  const matchedFlags = new Array<boolean>(charsOriginales.length).fill(false)

  for (const palabra of palabras) {
    if (!palabra) continue
    let startIdx = 0
    while (startIdx <= textoNorm.length - palabra.length) {
      const foundIdx = textoNorm.indexOf(palabra, startIdx)
      if (foundIdx === -1) break
      for (let k = foundIdx; k < foundIdx + palabra.length; k++) {
        matchedFlags[k] = true
      }
      startIdx = foundIdx + 1
    }
  }

  const segmentos: HighlightSegment[] = []
  let actualMatch = matchedFlags[0] ?? false
  let buffer = ''

  for (let i = 0; i < charsOriginales.length; i++) {
    const flag = matchedFlags[i] ?? false
    if (flag !== actualMatch && buffer.length > 0) {
      segmentos.push({ text: buffer, match: actualMatch })
      buffer = ''
      actualMatch = flag
    }
    buffer += charsOriginales[i]
  }
  if (buffer.length > 0) {
    segmentos.push({ text: buffer, match: actualMatch })
  }

  return segmentos
}

/**
 * Navegación por teclado con topes (0 = "+ Cargar paciente nuevo", 1..N = pacientes).
 */
export function moverIndiceResaltado(
  indiceActual: number,
  delta: 1 | -1,
  totalOpciones: number,
): number {
  if (totalOpciones <= 0) return 0
  const siguiente = indiceActual + delta
  if (siguiente < 0) return 0
  if (siguiente >= totalOpciones) return totalOpciones - 1
  return siguiente
}

/**
 * Iniciales de Apellido + Nombre para el avatar circular.
 */
export function extraerInicialesPaciente(
  p: Pick<Patient, 'apellido' | 'nombre'>,
): string {
  const ap = (p.apellido || '').trim()
  const nom = (p.nombre || '').trim()
  const i1 = ap ? ap[0]!.toUpperCase() : ''
  const i2 = nom ? nom[0]!.toUpperCase() : ''
  if (i1 && i2) return `${i1}${i2}`
  return (ap || nom).slice(0, 2).toUpperCase() || 'P'
}

/**
 * Si el usuario escribió texto antes de elegir "+ Cargar paciente nuevo",
 * extrae DNI o Apellido/Nombre para precargar el alta inline.
 */
export function precargarDatosPacienteNuevo(texto: string): {
  dni: string
  apellido: string
  nombre: string
} {
  const limpio = (texto || '').trim()
  if (!limpio) return { dni: '', apellido: '', nombre: '' }

  const soloDigitos = limpio.replace(/\D/g, '')
  if (/^\d+$/.test(limpio.replace(/[.\-\s]/g, '')) && soloDigitos.length > 0) {
    return { dni: soloDigitos.slice(0, 8), apellido: '', nombre: '' }
  }

  if (limpio.includes(',')) {
    const [ap, ...resto] = limpio.split(',')
    return {
      dni: '',
      apellido: (ap || '').trim(),
      nombre: resto.join(',').trim(),
    }
  }

  const partes = limpio.split(/\s+/).filter(Boolean)
  if (partes.length === 1) {
    return { dni: '', apellido: partes[0]!, nombre: '' }
  }
  return {
    dni: '',
    apellido: partes[0]!,
    nombre: partes.slice(1).join(' '),
  }
}
