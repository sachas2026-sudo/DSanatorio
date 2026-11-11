/**
 * Utilidades de formateo para el directorio de médicos en la app móvil.
 */

/**
 * Convierte un nombre en MAYÚSCULAS ("CABALLERO, YOEL") a mayúscula inicial en cada palabra ("Caballero, Yoel")
 * cuidando partículas y apellidos compuestos (de, del, la, Mc, O'...).
 * No agrega un "Dr." fijo. Si viene con un título prefijado ("Dr. ", "Dra. ", "Lic. "), lo remueve.
 */
export function formatDoctorName(raw: string): string {
  if (!raw) return ''

  // 1. Quitar prefijos Dr./Dra./Lic. si existen
  const clean = raw.trim().replace(/^(dr\.|dra\.|lic\.|dr|dra|lic)\s+/i, '')
  if (!clean) return raw

  const particles = new Set([
    'de',
    'del',
    'la',
    'las',
    'los',
    'y',
    'e',
    'da',
    'di',
    'do',
    'dos',
    'das',
    'von',
    'van',
  ])

  function formatWord(w: string, isFirstInPart: boolean): string {
    if (!w) return ''
    const lower = w.toLowerCase()

    // Partículas en minúscula (ej: "de", "la", "del")
    if (particles.has(lower)) {
      return lower
    }

    // Apóstrofes: ej. O'Higgins, D'Alessandro
    if (lower.includes("'")) {
      const parts = lower.split("'")
      return parts
        .map((p, i) =>
          i === 0 && p.length <= 2
            ? p.toUpperCase()
            : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
        )
        .join("'")
    }

    // Prefijo Mc/Mac: ej. McDonald
    if (lower.startsWith('mc') && lower.length > 2) {
      return 'Mc' + lower.charAt(2).toUpperCase() + lower.slice(3)
    }

    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }

  // Dividir por comas para respetar "Apellido, Nombre"
  const parts = clean.split(',')
  return parts
    .map((part) => {
      const words = part.trim().split(/\s+/)
      return words
        .map((w, wIdx) => {
          if (w.includes('-')) {
            const subs = w.split('-')
            return subs
              .map((sub, sIdx) => formatWord(sub, wIdx === 0 && sIdx === 0))
              .join('-')
          }
          return formatWord(w, wIdx === 0)
        })
        .join(' ')
    })
    .join(', ')
}

/**
 * Obtiene las iniciales (Apellido + Nombre) de un médico a partir de su nombre.
 * Ej: "Caballero, Yolanda" -> "CY"
 *     "Ocampo, Silvana" -> "OS"
 */
export function getDoctorInitials(name: string): string {
  if (!name) return 'DR'
  const clean = name.replace(/^(dr\.|dra\.|lic\.|dr|dra|lic)\s+/i, '').trim()
  if (clean.includes(',')) {
    const [ap, nom] = clean.split(',')
    const apWord = (ap || '').trim().split(/\s+/)[0] || ''
    const nomWord = (nom || '').trim().split(/\s+/)[0] || ''
    const i1 = apWord.charAt(0).toUpperCase()
    const i2 = nomWord.charAt(0).toUpperCase()
    return `${i1}${i2}` || 'DR'
  }
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return `${words[0].charAt(0).toUpperCase()}${words[1].charAt(0).toUpperCase()}`
  }
  return clean.slice(0, 2).toUpperCase() || 'DR'
}
