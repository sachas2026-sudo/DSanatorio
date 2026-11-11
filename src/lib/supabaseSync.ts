import type { AppData } from '../types'
import { calcularResumenDiario, type ResumenDiarioPayload } from './resumenDiario'
import { format, subDays, addDays, parseISO } from 'date-fns'
import { isClientMode } from './appMode'

export const DEFAULT_SUPABASE_URL = 'https://mzfyzabgdlzqkvufqrxh.supabase.co'
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_5E4thTDbweeAZOd4wcypsw_I5O7F4fM'
export const DEFAULT_SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_4HAhss-rRoYWNVg9ui1haQ_v1vywr4_'
export const AGENDA_TURNOS_MEDICO_ID = '__agenda_turnos_por_fecha__'

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

export interface MedicoDirectorioPayload {
  medico_id: string
  nombre: string
  especialidad: string
  porcentaje_medico: number
  activo: boolean
  ultima_actualizacion: string
}

export function formatDoctorNombreDirectorio(doc: { apellido?: string; nombre: string }): string {
  const apellido = (doc.apellido || '').trim()
  const nombre = (doc.nombre || '').trim()
  return apellido && nombre ? `${apellido}, ${nombre}` : (apellido || nombre)
}

export function buildAgendaTurnosDirectorioRow(data: AppData): MedicoDirectorioPayload {
  const now = new Date().toISOString()
  const docMap = new Map(
    (data.doctors || []).map((doc) => [
      doc.id,
      {
        nombre: formatDoctorNombreDirectorio(doc),
        especialidad: (doc.especialidad || '').trim(),
      },
    ]),
  )
  const desdeStr = format(subDays(new Date(), 60), 'yyyy-MM-dd')
  const byFechaDoc = new Map<
    string,
    Map<string, { id: string; nombre: string; especialidad: string; pacientes: number }>
  >()

  for (const a of data.appointments || []) {
    if (!a.fechaHora) continue
    const estado = (a.estado || '').toLowerCase().trim()
    if (estado === 'cancelado') continue
    let fechaStr = ''
    try {
      fechaStr = format(parseISO(a.fechaHora), 'yyyy-MM-dd')
    } catch {
      continue
    }
    if (fechaStr < desdeStr) continue
    let docMapForDay = byFechaDoc.get(fechaStr)
    if (!docMapForDay) {
      docMapForDay = new Map()
      byFechaDoc.set(fechaStr, docMapForDay)
    }
    const docInfo = docMap.get(a.doctorId)
    const cur = docMapForDay.get(a.doctorId) || {
      id: a.doctorId,
      nombre: docInfo?.nombre || 'Médico',
      especialidad: docInfo?.especialidad || '',
      pacientes: 0,
    }
    cur.pacientes += 1
    docMapForDay.set(a.doctorId, cur)
  }

  const agendaObj: Record<
    string,
    Array<{ id: string; nombre: string; especialidad: string; pacientes: number }>
  > = {}
  for (const [fecha, mapForDay] of byFechaDoc.entries()) {
    agendaObj[fecha] = Array.from(mapForDay.values()).sort((x, y) => y.pacientes - x.pacientes)
  }

  return {
    medico_id: AGENDA_TURNOS_MEDICO_ID,
    nombre: '__AGENDA__',
    especialidad: JSON.stringify(agendaObj),
    porcentaje_medico: 0,
    activo: false,
    ultima_actualizacion: now,
  }
}

export async function pushAgendaTurnosMetadataToSupabase(
  data: AppData,
  url: string,
  key: string,
): Promise<void> {
  try {
    const row = buildAgendaTurnosDirectorioRow(data)
    await fetch(`${baseUrl(url)}/rest/v1/medicos_directorio?on_conflict=medico_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([row]),
    })
  } catch {
    // silencioso
  }
}

export function buildMedicosDirectorioPayload(data: AppData): MedicoDirectorioPayload[] {
  const now = new Date().toISOString()
  return (data.doctors || []).map((doc) => {
    // Si el sistema guarda la retención del centro (ej. 30%), porcentaje_medico = 100 - retención (ej. 70%)
    const retencionCentro = Number(doc.porcentaje) || 0
    const porcentaje_medico = Math.max(0, Math.min(100, Math.round((100 - retencionCentro) * 100) / 100))
    return {
      medico_id: doc.id,
      nombre: formatDoctorNombreDirectorio(doc),
      especialidad: (doc.especialidad || '').trim() || 'Sin especialidad',
      porcentaje_medico,
      activo: doc.activo !== false,
      ultima_actualizacion: now,
    }
  })
}

/**
 * Sincroniza el directorio completo de médicos hacia la tabla `medicos_directorio` en Supabase.
 * Usa UPSERT por medico_id (resolution=merge-duplicates) y la service_role key si está disponible.
 */
export async function pushMedicosDirectorioToSupabase(
  data: AppData,
  configOverride?: SupabaseConfig,
): Promise<SyncResult> {
  if (!configOverride && (await isClientMode())) {
    return {
      success: true,
      message: 'Modo cliente: sincronización con Supabase delegada al servidor principal.',
    }
  }
  const url = cleanUrl(configOverride?.url || data.settings?.supabaseUrl || DEFAULT_SUPABASE_URL)
  const key = (configOverride?.anonKey || data.settings?.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY).trim()

  if (!url || !key) {
    return {
      success: false,
      message: 'Supabase no está configurado (faltan URL o Clave).',
    }
  }

  const rows = buildMedicosDirectorioPayload(data)
  if (rows.length === 0) {
    return { success: true, message: 'No hay médicos para sincronizar.' }
  }

  try {
    const res = await fetch(`${baseUrl(url)}/rest/v1/medicos_directorio?on_conflict=medico_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    })

    if (res.ok) {
      return {
        success: true,
        message: `${rows.length} médicos sincronizados correctamente con Supabase.`,
      }
    }

    const err = await res.text().catch(() => '')
    return {
      success: false,
      message: `Error al subir directorio de médicos (${res.status}): ${err || res.statusText}`,
    }
  } catch (err: unknown) {
    return {
      success: false,
      message: `Error de red al sincronizar médicos: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

let medicosSyncTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * Ejecuta la sincronización del directorio de médicos con un debounce (por defecto 5 segundos).
 */
export function pushMedicosDirectorioDebounced(data: AppData, delayMs = 5000): void {
  if (data.settings?.supabaseAutoSync === false) return
  if (medicosSyncTimeout) {
    clearTimeout(medicosSyncTimeout)
  }
  medicosSyncTimeout = setTimeout(() => {
    medicosSyncTimeout = null
    void pushMedicosDirectorioToSupabase(data).catch(() => {})
  }, delayMs)
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
  const url = cleanUrl(configOverride?.url || data.settings?.supabaseUrl || DEFAULT_SUPABASE_URL)
  const key = (configOverride?.anonKey || data.settings?.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY).trim()

  if (!url || !key) {
    return {
      success: false,
      message: 'Supabase no está configurado (faltan URL y Clave).',
    }
  }

  const payload: ResumenDiarioPayload = calcularResumenDiario(data, fechaTarget)

  try {
    let res = await fetch(`${baseUrl(url)}/rest/v1/resumen_diario?on_conflict=fecha`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok && res.status === 400) {
      const errText = await res.text().catch(() => '')
      if (errText.includes('turnos_clasificacion')) {
        // La columna no existe aún en Supabase; reintentar sin la columna (la clasificación viaja en origen)
        const { turnos_clasificacion: _, ...payloadSinColumna } = payload
        res = await fetch(`${baseUrl(url)}/rest/v1/resumen_diario?on_conflict=fecha`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify(payloadSinColumna),
        })
      }
    }

    if (res.ok) {
      void pushAgendaTurnosMetadataToSupabase(data, url, key)
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

let pushMesesEnCurso = false
let pushMesesUltimo = 0
let pendingPushData: AppData | null = null
let pendingPushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Sube a Supabase el resumen del día actual de inmediato y el historial de forma encolada/debounced.
 * Nunca pierde un guardado: si hay una subida en curso o reciente, encola la última versión.
 */
export async function pushMesesRecientesToSupabase(data: AppData, fechaEspecifica?: string): Promise<void> {
  if (data.settings?.supabaseAutoSync === false) return
  // En terminales cliente (ej. PC de Afiliados o Administración en red), los datos están filtrados por rol
  // (ej. Afiliados recibe payments=[] y appointments=[]). Solo el Servidor Principal debe subir a Supabase.
  if (await isClientMode()) return
  if (
    (data.payments?.length ?? 0) === 0 &&
    (data.appointments?.length ?? 0) === 0 &&
    (data.doctors?.length ?? 0) === 0
  ) {
    return
  }
  const url = cleanUrl(data.settings?.supabaseUrl || DEFAULT_SUPABASE_URL)
  const key = (data.settings?.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY).trim()
  if (!url || !key) return

  // 1. Subida inmediata y ligera del día de hoy para que el celular lo vea al instante
  void pushResumenDiarioToSupabase(data, format(new Date(), 'yyyy-MM-dd')).catch(() => {})
  // Si la modificación fue en otra fecha (ej. turno agendado a futuro o pago de ayer), subir esa fecha también de inmediato
  if (fechaEspecifica && fechaEspecifica !== format(new Date(), 'yyyy-MM-dd')) {
    void pushResumenDiarioToSupabase(data, fechaEspecifica).catch(() => {})
  }

  // 2. Si ya hay una subida de meses en curso o muy reciente, encolar para no saturar pero NO descartar
  const ahora = Date.now()
  if (pushMesesEnCurso || ahora - pushMesesUltimo < 5_000) {
    pendingPushData = data
    if (!pendingPushTimer) {
      pendingPushTimer = setTimeout(() => {
        pendingPushTimer = null
        const nextData = pendingPushData
        pendingPushData = null
        if (nextData) {
          void pushMesesRecientesToSupabase(nextData)
        }
      }, 5_000)
    }
    return
  }

  pushMesesEnCurso = true
  pushMesesUltimo = ahora
  try {
    const hoy = new Date()
    const inicioMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
    const dias = Math.ceil((hoy.getTime() - inicioMesAnterior.getTime()) / 86_400_000)
    const res = await pushHistorialResumenesToSupabase(data, dias)
    if (res.success) {
      console.info(`[SupabaseSync] Resúmenes recientes sincronizados (${res.subidos} días).`)
    } else {
      console.warn('[SupabaseSync] Error al sincronizar resúmenes:', res.errores)
    }
  } catch (err) {
    console.warn('[SupabaseSync] Excepción al sincronizar resúmenes:', err)
  } finally {
    pushMesesEnCurso = false
    // Si quedaron cambios pendientes acumulados durante la subida, ejecutarlos ahora
    if (pendingPushData && !pendingPushTimer) {
      const queued = pendingPushData
      pendingPushData = null
      void pushMesesRecientesToSupabase(queued)
    }
  }
}

/**
 * Sube los resúmenes diarios de los últimos N días a Supabase.
 */
export async function pushHistorialResumenesToSupabase(
  data: AppData,
  diasAtras: number = 30,
  configOverride?: SupabaseConfig,
): Promise<{ success: boolean; subidos: number; errores: string[] }> {
  const url = cleanUrl(configOverride?.url || data.settings?.supabaseUrl || DEFAULT_SUPABASE_URL)
  const key = (configOverride?.anonKey || data.settings?.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY).trim()

  if (!url || !key) {
    return {
      success: false,
      subidos: 0,
      errores: ['Faltan credenciales de Supabase'],
    }
  }

  const hoy = new Date()
  const hoyStr = format(hoy, 'yyyy-MM-dd')
  const fechasSet = new Set<string>()

  // 1. Fechas futuras con turnos agendados + próximos 14 días a futuro
  for (const a of data.appointments || []) {
    if (!a.fechaHora) continue
    try {
      const f = format(parseISO(a.fechaHora), 'yyyy-MM-dd')
      if (f > hoyStr) fechasSet.add(f)
    } catch {
      // ignorar
    }
  }
  for (let i = 14; i >= 1; i--) {
    const d = addDays(hoy, i)
    fechasSet.add(format(d, 'yyyy-MM-dd'))
  }

  // 2. Hoy y días hacia el pasado
  for (let i = 0; i <= diasAtras; i++) {
    const d = subDays(hoy, i)
    fechasSet.add(format(d, 'yyyy-MM-dd'))
  }

  const payloads: ResumenDiarioPayload[] = Array.from(fechasSet)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((fechaStr) => calcularResumenDiario(data, fechaStr))

  try {
    void pushAgendaTurnosMetadataToSupabase(data, url, key)
    let res = await fetch(`${baseUrl(url)}/rest/v1/resumen_diario?on_conflict=fecha`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(payloads),
    })

    if (!res.ok && res.status === 400) {
      const errText = await res.text().catch(() => '')
      if (errText.includes('turnos_clasificacion')) {
        const payloadsSinColumna = payloads.map(({ turnos_clasificacion: _, ...rest }) => rest)
        res = await fetch(`${baseUrl(url)}/rest/v1/resumen_diario?on_conflict=fecha`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify(payloadsSinColumna),
        })
      }
    }

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

