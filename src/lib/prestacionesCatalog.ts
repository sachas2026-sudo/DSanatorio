import type { PrestacionCatalogo, OrdenMedica } from '../types'

export const GRUPOS_PRESTACIONES_DEFAULT = [
  'DIAGNÓSTICO POR IMÁGENES',
  'LABORATORIO',
  'CARDIOLOGÍA',
  'ODONTOLOGÍA',
  'PROCEDIMIENTOS Y OTROS',
] as const

export const PRESTACIONES_BASE: Array<{ nombre: string; grupo: string }> = [
  // DIAGNÓSTICO POR IMÁGENES
  { nombre: 'Radiografía de tórax', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Radiografía de columna', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Radiografía de miembros', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Ecografía abdominal', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Ecografía ginecológica / obstétrica', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Ecografía mamaria', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Ecografía tiroidea', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Ecografía renal y vías urinarias', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Mamografía', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Densitometría ósea', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Tomografía computada', grupo: 'DIAGNÓSTICO POR IMÁGENES' },
  { nombre: 'Resonancia magnética', grupo: 'DIAGNÓSTICO POR IMÁGENES' },

  // LABORATORIO
  { nombre: 'Extracción de sangre', grupo: 'LABORATORIO' },
  { nombre: 'Hemograma completo', grupo: 'LABORATORIO' },
  { nombre: 'Glucemia', grupo: 'LABORATORIO' },
  { nombre: 'Perfil lipídico', grupo: 'LABORATORIO' },
  { nombre: 'Orina completa', grupo: 'LABORATORIO' },

  // CARDIOLOGÍA
  { nombre: 'Electrocardiograma', grupo: 'CARDIOLOGÍA' },
  { nombre: 'Ergometría', grupo: 'CARDIOLOGÍA' },
  { nombre: 'Ecocardiograma Doppler', grupo: 'CARDIOLOGÍA' },
  { nombre: 'Holter', grupo: 'CARDIOLOGÍA' },

  // ODONTOLOGÍA
  { nombre: 'Extracción dental', grupo: 'ODONTOLOGÍA' },
  { nombre: 'Limpieza dental', grupo: 'ODONTOLOGÍA' },
  { nombre: 'Radiografía dental', grupo: 'ODONTOLOGÍA' },

  // PROCEDIMIENTOS Y OTROS
  { nombre: 'Curación', grupo: 'PROCEDIMIENTOS Y OTROS' },
  { nombre: 'Inyectable', grupo: 'PROCEDIMIENTOS Y OTROS' },
  { nombre: 'Kinesiología (sesión)', grupo: 'PROCEDIMIENTOS Y OTROS' },
  { nombre: 'Espirometría', grupo: 'PROCEDIMIENTOS Y OTROS' },
  { nombre: 'Audiometría', grupo: 'PROCEDIMIENTOS Y OTROS' },
  { nombre: 'Papanicolaou', grupo: 'PROCEDIMIENTOS Y OTROS' },
]

export function normalizePrestacionKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Inicializa o combina el catálogo de prestaciones.
 * Siembra las prestaciones base si no están presentes, sin duplicar ni pisar personalizaciones.
 */
export function buildPrestacionesCatalog(raw?: unknown): PrestacionCatalogo[] {
  const map = new Map<string, PrestacionCatalogo>()

  // 1. Sembrar las base
  for (let i = 0; i < PRESTACIONES_BASE.length; i++) {
    const item = PRESTACIONES_BASE[i]
    const key = normalizePrestacionKey(item.nombre)
    map.set(key, {
      id: `p_base_${i + 1}`,
      nombre: item.nombre,
      grupo: item.grupo,
      activa: true,
    })
  }

  // 2. Si hay datos guardados, incorporarlos respetando IDs, estado activo y nuevos grupos/items
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Partial<PrestacionCatalogo>
      const nombre = (obj.nombre ?? '').trim()
      if (!nombre) continue
      const key = normalizePrestacionKey(nombre)
      const existing = map.get(key)
      map.set(key, {
        id: obj.id || existing?.id || `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        nombre,
        grupo: (obj.grupo ?? existing?.grupo ?? 'PROCEDIMIENTOS Y OTROS').trim().toUpperCase(),
        activa: typeof obj.activa === 'boolean' ? obj.activa : (existing?.activa ?? true),
      })
    }
  }

  return [...map.values()].sort((a, b) => {
    const grupoCmp = a.grupo.localeCompare(b.grupo, 'es')
    if (grupoCmp !== 0) return grupoCmp
    return a.nombre.localeCompare(b.nombre, 'es')
  })
}

/**
 * Agrupa una lista de prestaciones por categoría/grupo para los desplegables.
 */
export function agruparPrestaciones(
  prestaciones: readonly PrestacionCatalogo[],
  soloActivas = true,
): Map<string, PrestacionCatalogo[]> {
  const grupos = new Map<string, PrestacionCatalogo[]>()

  for (const p of prestaciones) {
    if (soloActivas && !p.activa) continue
    const g = p.grupo || 'PROCEDIMIENTOS Y OTROS'
    const arr = grupos.get(g) ?? []
    arr.push(p)
    grupos.set(g, arr)
  }

  return grupos
}

/**
 * Genera el siguiente número correlativo de orden médica en formato OM-0001, OM-0002...
 * Busca el mayor número registrado y le suma 1. Sin repetir ni saltear.
 */
export function generarSiguienteNumeroOrden(ordenesExistentes: readonly OrdenMedica[] = []): string {
  let maxNum = 0

  for (const ord of ordenesExistentes) {
    if (!ord || typeof ord.numero !== 'string') continue
    const match = /OM-(\d+)/i.exec(ord.numero.trim())
    if (match) {
      const val = parseInt(match[1], 10)
      if (Number.isFinite(val) && val > maxNum) {
        maxNum = val
      }
    }
  }

  const next = maxNum + 1
  return `OM-${String(next).padStart(4, '0')}`
}

