import type { ResumenDiario, SupabaseConfig } from './types'

const STORAGE_KEY_CONFIG = 'cuidar_supabase_config_v1'
const STORAGE_KEY_CACHE_PREFIX = 'cuidar_resumen_cache_'

export const DEFAULT_SUPABASE_CONFIG: SupabaseConfig = {
  url: 'https://mzfyzabgdlzqkvufqrxh.supabase.co',
  anonKey: 'sb_publishable_5E4thTDbweeAZOd4wcypsw_I5O7F4fM',
}

export function getStoredSupabaseConfig(): SupabaseConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.url && parsed.anonKey) return parsed
    }
  } catch {
    // fallback
  }
  return DEFAULT_SUPABASE_CONFIG
}

export function saveStoredSupabaseConfig(cfg: SupabaseConfig): void {
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(cfg))
}

export function getCachedResumen(fecha: string): ResumenDiario | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_CACHE_PREFIX}${fecha}`)
    if (raw) return JSON.parse(raw)
  } catch {
    // fallback
  }
  return null
}

export function setCachedResumen(fecha: string, data: ResumenDiario): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_CACHE_PREFIX}${fecha}`, JSON.stringify(data))
  } catch {
    // quota
  }
}

export async function fetchResumenDiario(
  fecha: string,
  cfg: SupabaseConfig,
): Promise<{ data: ResumenDiario | null; error?: string; fromCache?: boolean }> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()

  if (!url || !key) {
    const cached = getCachedResumen(fecha)
    if (cached) return { data: cached, fromCache: true }
    return { data: null, error: 'Configure la URL y Anon Key de Supabase en ajustes.' }
  }

  try {
    const endpoint = `${url}/rest/v1/resumen_diario?fecha=eq.${fecha}&select=*`
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const cached = getCachedResumen(fecha)
      if (cached) return { data: cached, fromCache: true, error: `Error ${res.status}: Mostrando copia guardada.` }
      return { data: null, error: `Error al consultar Supabase (${res.status})` }
    }

    const rows = (await res.json()) as ResumenDiario[]
    if (rows && rows.length > 0) {
      const item = rows[0]
      setCachedResumen(fecha, item)
      return { data: item }
    }

    return { data: null, error: 'No hay datos cargados para esta fecha.' }
  } catch (err: unknown) {
    const cached = getCachedResumen(fecha)
    if (cached) {
      return {
        data: cached,
        fromCache: true,
        error: 'Sin conexión a internet: Mostrando última copia guardada.',
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { data: null, error: `Error de red: ${msg}` }
  }
}

export interface FechaResumenItem {
  fecha: string
  total_cobrado: number
}

/**
 * Obtiene la lista de fechas disponibles con su total de cobro.
 */
export async function fetchAvailableDates(
  cfg: SupabaseConfig,
): Promise<FechaResumenItem[]> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  if (!url || !key) return []

  try {
    const res = await fetch(`${url}/rest/v1/resumen_diario?select=fecha,total_cobrado&order=fecha.desc&limit=100`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return []
    return (await res.json()) as FechaResumenItem[]
  } catch {
    return []
  }
}

/**
 * Obtiene todos los resúmenes de un mes (formato YYYY-MM) para calcular el acumulado.
 */
export async function fetchMonthRows(
  mesStr: string, // YYYY-MM
  cfg: SupabaseConfig,
): Promise<ResumenDiario[]> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  if (!url || !key) return []

  try {
    const res = await fetch(
      `${url}/rest/v1/resumen_diario?fecha=gte.${mesStr}-01&fecha=lte.${mesStr}-31&order=fecha.desc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      },
    )
    if (!res.ok) return []
    return (await res.json()) as ResumenDiario[]
  } catch {
    return []
  }
}
