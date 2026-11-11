import type { ObraSocialCatalog } from '../types'
import { OBRAS_SOCIALES } from './obrasSociales'

export const MAX_MONTO_PESOS = 100_000_000
export const MAX_CENTESIMAS = 10_000 // 100.00 %

export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Formatea un entero de pesos a formato es-AR con puntos de miles (ej. 20000 -> "20.000") */
export function formatPesosAr(monto: number): string {
  if (!Number.isFinite(monto) || monto <= 0) return '0'
  const clamped = Math.min(Math.floor(Math.max(0, monto)), MAX_MONTO_PESOS)
  return clamped.toLocaleString('es-AR')
}

/** Parsea un texto a monto entero en pesos (solo dígitos, máx 9 dígitos, tope 100.000.000) */
export function parsePesosAr(raw: string): number {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return 0
  const parsed = parseInt(digits.slice(0, 9), 10) || 0
  return Math.min(parsed, MAX_MONTO_PESOS)
}

/**
 * Convierte un valor en centésimas (ej: 250 = 2,5%, 10000 = 100%) a string es-AR con coma.
 * Hasta 2 decimales, omitiendo decimales innecesarios (ej. 250 -> "2,5", 1000 -> "10").
 */
export function formatPorcentajeAr(centesimas: number): string {
  if (!Number.isFinite(centesimas) || centesimas <= 0) return '0'
  const clamped = Math.min(Math.round(Math.max(0, centesimas)), MAX_CENTESIMAS)
  const pct = clamped / 100
  // Formatear hasta 2 decimales en español
  const formatted = pct.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  return formatted
}

/**
 * Parsea un input de porcentaje (ej: "2,5", "2.5", "100") a centésimas enteras (0..10000).
 * Soporta coma o punto decimal, hasta 2 decimales, tope 100%.
 */
export function parsePorcentajeAr(raw: string): number {
  if (!raw || !raw.trim()) return 0
  const cleaned = raw.trim().replace(/\s+/g, '').replace('.', ',')
  if (cleaned.startsWith('-')) return 0
  // Tomar hasta una coma
  const parts = cleaned.split(',')
  const wholePart = parts[0].replace(/\D/g, '') || '0'
  const decimalPart = (parts[1] ? parts[1].replace(/\D/g, '') : '').slice(0, 2)
  const numStr = decimalPart ? `${wholePart}.${decimalPart}` : wholePart
  const val = parseFloat(numStr)
  if (isNaN(val) || val <= 0) return 0
  if (val >= 100) return MAX_CENTESIMAS
  return Math.min(Math.round(val * 100), MAX_CENTESIMAS)
}

/**
 * Convierte y unifica datos viejos o nuevos de obras sociales al modelo unificado `ObraSocialCatalog`.
 * Si vienen strings sueltos se convierten a objetos con ceros y versión 1.
 * Siembra las 12 habituales si no existen, sin duplicar ni perder ninguna.
 */
export function buildObrasSocialesCatalog(
  rawObrasSociales?: unknown,
  rawCustom?: unknown,
  rawPlanesAfiliados?: unknown,
): ObraSocialCatalog[] {
  const map = new Map<string, ObraSocialCatalog>()

  function keyOf(name: string): string {
    return name.trim().toLowerCase()
  }

  // 1. Sembrar las 12 habituales como base
  for (const h of OBRAS_SOCIALES) {
    const k = keyOf(h)
    map.set(k, {
      nombre: h,
      plus: 0,
      arancel: 0,
      cuidar: 0,
      impBanco: 0,
      impFactura: 0,
      gastosAdm: 0,
      suspendida: false,
      version: 1,
    })
  }

  // 2. Si hay lista vieja custom (strings), agregarlas
  if (Array.isArray(rawCustom)) {
    for (const item of rawCustom) {
      if (typeof item === 'string' && item.trim()) {
        const name = item.trim()
        const k = keyOf(name)
        if (!map.has(k)) {
          map.set(k, {
            nombre: name,
            plus: 0,
            arancel: 0,
            cuidar: 0,
            impBanco: 0,
            impFactura: 0,
            gastosAdm: 0,
            suspendida: false,
            version: 1,
          })
        }
      }
    }
  }

  // 3. Si hay planes de afiliados, agregarlos como obras sociales si no existen
  if (Array.isArray(rawPlanesAfiliados)) {
    for (const plan of rawPlanesAfiliados) {
      if (typeof plan === 'string' && plan.trim()) {
        const name = plan.trim()
        const k = keyOf(name)
        if (!map.has(k)) {
          map.set(k, {
            nombre: name,
            plus: 0,
            arancel: 0,
            cuidar: 0,
            impBanco: 0,
            impFactura: 0,
            gastosAdm: 0,
            suspendida: false,
            version: 1,
          })
        }
      } else if (plan && typeof plan === 'object') {
        const name = (
          typeof (plan as { nombre?: unknown }).nombre === 'string'
            ? (plan as { nombre: string }).nombre
            : ''
        ).trim()
        if (name) {
          const k = keyOf(name)
          if (!map.has(k)) {
            map.set(k, {
              nombre: name,
              plus: 0,
              arancel: 0,
              cuidar: 0,
              impBanco: 0,
              impFactura: 0,
              gastosAdm: 0,
              suspendida: false,
              version: 1,
            })
          }
        }
      }
    }
  }

  // 4. Si hay catálogo existente (objetos), combinarlos respetando sus valores y versión
  if (Array.isArray(rawObrasSociales)) {
    for (const item of rawObrasSociales) {
      if (typeof item === 'string' && item.trim()) {
        const name = item.trim()
        const k = keyOf(name)
        if (!map.has(k)) {
          map.set(k, {
            nombre: name,
            plus: 0,
            arancel: 0,
            cuidar: 0,
            impBanco: 0,
            impFactura: 0,
            gastosAdm: 0,
            suspendida: false,
            version: 1,
          })
        }
      } else if (item && typeof item === 'object') {
        const obj = item as Partial<ObraSocialCatalog>
        const name = (obj.nombre ?? '').trim()
        if (name) {
          const k = keyOf(name)
          map.set(k, {
            nombre: name,
            plus: typeof obj.plus === 'number' ? Math.max(0, Math.min(obj.plus, MAX_MONTO_PESOS)) : 0,
            arancel: typeof obj.arancel === 'number' ? Math.max(0, Math.min(obj.arancel, MAX_MONTO_PESOS)) : 0,
            cuidar: typeof obj.cuidar === 'number' ? Math.max(0, Math.min(obj.cuidar, MAX_CENTESIMAS)) : 0,
            impBanco: typeof obj.impBanco === 'number' ? Math.max(0, Math.min(obj.impBanco, MAX_CENTESIMAS)) : 0,
            impFactura: typeof obj.impFactura === 'number' ? Math.max(0, Math.min(obj.impFactura, MAX_CENTESIMAS)) : 0,
            gastosAdm: typeof obj.gastosAdm === 'number' ? Math.max(0, Math.min(obj.gastosAdm, MAX_CENTESIMAS)) : 0,
            suspendida: Boolean(obj.suspendida),
            version: typeof obj.version === 'number' && obj.version > 0 ? obj.version : 1,
          })
        }
      }
    }
  }

  return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
