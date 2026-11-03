import type { AppData } from '../types'
import { calcularResumenDiario, type ResumenDiarioPayload } from './resumenDiario'
import { format, subDays } from 'date-fns'

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export interface SyncResult {
  success: boolean
  message: string
  status?: number
  timestamp?: string
}

/**
 * Normaliza la URL de Supabase para evitar barras finales.
 */
function cleanUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '')
}

/**
 * Prueba la conexión con el proyecto Supabase y verifica si existe la tabla `resumen_diario`.
 */
export async function testSupabaseConnection(url: string, anonKey: string): Promise<SyncResult> {
  const baseUrl = cleanUrl(url)
  const key = anonKey.trim()

  if (!baseUrl || !key) {
    return {
      success: false,
      message: 'Debe ingresar la URL y la Anon Key de Supabase.',
    }
  }

  try {
    const res = await fetch(`${baseUrl}/rest/v1/resumen_diario?select=fecha&limit=1`, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    })

    if (res.ok) {
      return {
        success: true,
        message: '¡Conexión exitosa con Supabase y la tabla resumen_diario!',
        status: res.status,
        timestamp: new Date().toISOString(),
      }
    }

    if (res.status === 404 || res.status === 400) {
      const text = await res.text()
      if (text.includes('does not exist') || text.includes('relation') || res.status === 404) {
        return {
          success: false,
          message: 'Conectó a Supabase pero la tabla "resumen_diario" aún no fue creada. Ejecute el script SQL.',
          status: res.status,
        }
      }
    }

    if (res.status === 401 || res.status === 403) {
      return {
        success: false,
        message: 'Error de autorización: Verifique que la Anon Key sea correcta.',
        status: res.status,
      }
    }

    const errText = await res.text().catch(() => '')
    return {
      success: false,
      message: `Error al conectar (${res.status}): ${errText || res.statusText}`,
      status: res.status,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      message: `No se pudo conectar a Supabase: ${msg}`,
    }
  }
}

/**
 * Sube o actualiza el resumen diario de una fecha específica a Supabase.
 */
export async function pushResumenDiarioToSupabase(
  data: AppData,
  fechaTarget: string = format(new Date(), 'yyyy-MM-dd'),
  configOverride?: SupabaseConfig,
): Promise<SyncResult> {
  const url = cleanUrl(configOverride?.url || data.settings.supabaseUrl || '')
  const key = (configOverride?.anonKey || data.settings.supabaseAnonKey || '').trim()

  if (!url || !key) {
    return {
      success: false,
      message: 'Supabase no está configurado (faltan URL y Clave).',
    }
  }

  const payload: ResumenDiarioPayload = calcularResumenDiario(data, fechaTarget)

  try {
    const res = await fetch(`${baseUrl(url)}/rest/v1/resumen_diario?on_conflict=fecha`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      return {
        success: true,
        message: `Resumen de fecha ${fechaTarget} subido correctamente a la nube.`,
        status: res.status,
        timestamp: payload.ultima_actualizacion,
      }
    }

    const errText = await res.text().catch(() => '')
    return {
      success: false,
      message: `Error al subir resumen (${res.status}): ${errText || res.statusText}`,
      status: res.status,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      message: `Error de red al sincronizar con Supabase: ${msg}`,
    }
  }
}

function baseUrl(url: string): string {
  return cleanUrl(url)
}

/**
 * Sube los resúmenes diarios de los últimos N días a Supabase.
 */
export async function pushHistorialResumenesToSupabase(
  data: AppData,
  diasAtras: number = 30,
  configOverride?: SupabaseConfig,
): Promise<{ success: boolean; subidos: number; errores: string[] }> {
  const url = cleanUrl(configOverride?.url || data.settings.supabaseUrl || '')
  const key = (configOverride?.anonKey || data.settings.supabaseAnonKey || '').trim()

  if (!url || !key) {
    return {
      success: false,
      subidos: 0,
      errores: ['Faltan credenciales de Supabase'],
    }
  }

  const hoy = new Date()
  const payloads: ResumenDiarioPayload[] = []

  for (let i = 0; i <= diasAtras; i++) {
    const d = subDays(hoy, i)
    const fechaStr = format(d, 'yyyy-MM-dd')
    payloads.push(calcularResumenDiario(data, fechaStr))
  }

  try {
    const res = await fetch(`${baseUrl(url)}/rest/v1/resumen_diario?on_conflict=fecha`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(payloads),
    })

    if (res.ok) {
      return {
        success: true,
        subidos: payloads.length,
        errores: [],
      }
    }

    const err = await res.text()
    return {
      success: false,
      subidos: 0,
      errores: [`HTTP ${res.status}: ${err}`],
    }
  } catch (err: unknown) {
    return {
      success: false,
      subidos: 0,
      errores: [err instanceof Error ? err.message : String(err)],
    }
  }
}
