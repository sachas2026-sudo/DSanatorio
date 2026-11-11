import type { MedicoResumenItem, MedicoDirectorio, ResumenDiario, SupabaseConfig } from './types'

const STORAGE_KEY_CONFIG = 'cuidar_supabase_config_v1'
const STORAGE_KEY_SESSION = 'cuidar_supabase_session_v1'
const STORAGE_KEY_CACHE_PREFIX = 'cuidar_resumen_cache_'
const STORAGE_KEY_AGENDA_CACHE = 'cuidar_agenda_medicos_cache_v1'
const AGENDA_TURNOS_MEDICO_ID = '__agenda_turnos_por_fecha__'

export interface AgendaMedicoItem {
  id?: string
  nombre: string
  especialidad?: string
  pacientes: number
}

const DEFAULT_AGENDA_MEDICOS_POR_FECHA: Record<string, AgendaMedicoItem[]> = {
  '2026-11-10': [
    { id: 'mq0yzq4r-3n6mcg5x', nombre: 'BULOS, CLAUDIO', especialidad: 'Traumatología', pacientes: 4 },
    { id: 'mr5gbf3s-gzdpkvqv', nombre: 'AGUIRRE, RAFAEL', especialidad: 'Diabetólogia', pacientes: 1 },
  ],
  '2026-11-13': [
    { id: 'mr5gbf3s-gzdpkvqv', nombre: 'AGUIRRE, RAFAEL', especialidad: 'Diabetólogia', pacientes: 6 },
    { id: 'mpv5rfk3-9cirdcq9', nombre: 'VIDONDO, MATIAS', especialidad: 'Otorrinolaringología', pacientes: 5 },
  ],
  '2026-11-17': [
    { id: 'mpx7mw73-rdiqsol6', nombre: 'ALFONSO, CARMEN', especialidad: 'Endocrinología', pacientes: 17 },
  ],
}

let inMemoryAgendaMedicosMap: Record<string, AgendaMedicoItem[]> | null = null

function normalizeDoctorKey(nombre?: string): string {
  return (nombre || '').trim().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').toUpperCase()
}

export function getAgendaMedicosMap(): Record<string, AgendaMedicoItem[]> {
  if (inMemoryAgendaMedicosMap) return inMemoryAgendaMedicosMap
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AGENDA_CACHE)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const merged: Record<string, AgendaMedicoItem[]> = {
          ...DEFAULT_AGENDA_MEDICOS_POR_FECHA,
          ...parsed,
        }
        inMemoryAgendaMedicosMap = merged
        return merged
      }
    }
  } catch {
    // fallback
  }
  const fallback: Record<string, AgendaMedicoItem[]> = { ...DEFAULT_AGENDA_MEDICOS_POR_FECHA }
  inMemoryAgendaMedicosMap = fallback
  return fallback
}

export async function fetchAgendaMedicosMap(
  cfg: SupabaseConfig,
  token?: string,
): Promise<Record<string, AgendaMedicoItem[]>> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  if (!url || !key) return getAgendaMedicosMap()

  const authHeader = token ? `Bearer ${token}` : `Bearer ${key}`
  try {
    const res = await fetch(
      `${url}/rest/v1/medicos_directorio?medico_id=eq.${AGENDA_TURNOS_MEDICO_ID}&select=especialidad`,
      {
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      },
    )
    if (!res.ok) return getAgendaMedicosMap()
    const rows = (await res.json()) as Array<{ especialidad?: string }>
    if (Array.isArray(rows) && rows.length > 0 && rows[0]?.especialidad) {
      const parsed = JSON.parse(rows[0].especialidad)
      if (parsed && typeof parsed === 'object') {
        const merged = { ...DEFAULT_AGENDA_MEDICOS_POR_FECHA, ...parsed }
        inMemoryAgendaMedicosMap = merged
        try {
          localStorage.setItem(STORAGE_KEY_AGENDA_CACHE, JSON.stringify(merged))
        } catch {
          // quota
        }
        return merged
      }
    }
  } catch {
    // fallback
  }
  return getAgendaMedicosMap()
}

export function normalizeResumenRow(row: ResumenDiario): ResumenDiario {
  if (!row) return row
  if (!row.turnos_clasificacion || Object.keys(row.turnos_clasificacion).length === 0) {
    if (row.origen && typeof row.origen === 'string' && row.origen.includes('|{')) {
      try {
        const idx = row.origen.indexOf('|{')
        const json = JSON.parse(row.origen.slice(idx + 1))
        if (json.atendidos || json.pendientes || json.cancelados) {
          row.turnos_clasificacion = json
        }
      } catch {}
    }
  }

  const rawList: MedicoResumenItem[] = Array.isArray(row.medicos_detalle)
    ? row.medicos_detalle.map((m) => ({
        ...m,
        nombre: (m.nombre || '').trim().replace(/\s*,\s*/g, ', '),
      }))
    : []

  const agendaMap = getAgendaMedicosMap()
  const agendaForDay = row.fecha ? agendaMap[row.fecha] : undefined

  if (Array.isArray(agendaForDay) && agendaForDay.length > 0) {
    for (const ag of agendaForDay) {
      const agKey = normalizeDoctorKey(ag.nombre)
      const existing = rawList.find(
        (m) => (ag.id && m.id && m.id === ag.id) || normalizeDoctorKey(m.nombre) === agKey,
      )
      if (existing) {
        existing.pacientes = Math.max(Number(existing.pacientes) || 0, Number(ag.pacientes) || 0)
        if (!existing.especialidad && ag.especialidad) {
          existing.especialidad = ag.especialidad
        }
      } else {
        rawList.push({
          id: ag.id,
          nombre: (ag.nombre || '').trim().replace(/\s*,\s*/g, ', '),
          especialidad: ag.especialidad,
          pacientes: Number(ag.pacientes) || 0,
          totalCobrado: 0,
          totalCentro: 0,
          totalMedico: 0,
          monto: 0,
        })
      }
    }
  }

  rawList.sort(
    (a, b) =>
      (Number(b.totalMedico ?? b.monto) || 0) - (Number(a.totalMedico ?? a.monto) || 0) ||
      (Number(b.pacientes) || 0) - (Number(a.pacientes) || 0),
  )
  row.medicos_detalle = rawList

  return row
}

export const DEFAULT_SUPABASE_CONFIG: SupabaseConfig = {
  url: 'https://mzfyzabgdlzqkvufqrxh.supabase.co',
  anonKey: 'sb_publishable_5E4thTDbweeAZOd4wcypsw_I5O7F4fM',
}

export interface UserSession {
  accessToken: string
  refreshToken?: string
  email: string
  rol?: string
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

export function getStoredSession(): UserSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSION)
    if (raw) return JSON.parse(raw)
  } catch {
    // fallback
  }
  return null
}

export function saveStoredSession(session: UserSession | null): void {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY_SESSION)
  } else {
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session))
  }
}

export async function loginWithEmail(
  email: string,
  pass: string,
  cfg: SupabaseConfig,
): Promise<{ success: boolean; session?: UserSession; error?: string }> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()

  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email.trim(), password: pass }),
    })

    const body = await res.json()
    if (!res.ok) {
      return {
        success: false,
        error: body.error_description || body.msg || body.message || 'Error al iniciar sesión.',
      }
    }

    const rol = body.user?.app_metadata?.rol || body.user?.user_metadata?.rol
    if (rol !== 'admin') {
      return {
        success: false,
        error: `Acceso restringido: El usuario ${email} no tiene rol admin (rol actual: ${rol || 'ninguno'}).`,
      }
    }

    const session: UserSession = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      email: body.user?.email || email,
      rol,
    }
    saveStoredSession(session)
    return { success: true, session }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function getCachedResumen(fecha: string): ResumenDiario | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_CACHE_PREFIX}${fecha}`)
    if (raw) return normalizeResumenRow(JSON.parse(raw))
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
  token?: string,
): Promise<{ data: ResumenDiario | null; error?: string; fromCache?: boolean }> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()

  if (!url || !key) {
    const cached = getCachedResumen(fecha)
    if (cached) return { data: cached, fromCache: true }
    return { data: null, error: 'Configure la URL y Anon Key de Supabase en ajustes.' }
  }

  const authHeader = token ? `Bearer ${token}` : `Bearer ${key}`

  try {
    const endpoint = `${url}/rest/v1/resumen_diario?fecha=eq.${fecha}&select=*`
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: authHeader,
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
      const item = normalizeResumenRow(rows[0])
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

export async function fetchAvailableDates(
  cfg: SupabaseConfig,
  token?: string,
): Promise<FechaResumenItem[]> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  if (!url || !key) return []

  const authHeader = token ? `Bearer ${token}` : `Bearer ${key}`

  try {
    const res = await fetch(`${url}/rest/v1/resumen_diario?select=fecha,total_cobrado&order=fecha.desc&limit=100`, {
      headers: {
        apikey: key,
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return []
    return (await res.json()) as FechaResumenItem[]
  } catch {
    return []
  }
}

export async function fetchRecentRows(
  cfg: SupabaseConfig,
  token?: string,
  limit = 120,
): Promise<ResumenDiario[]> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  if (!url || !key) return []

  const authHeader = token ? `Bearer ${token}` : `Bearer ${key}`

  try {
    const res = await fetch(
      `${url}/rest/v1/resumen_diario?select=*&order=fecha.desc&limit=${limit}`,
      {
        headers: {
          apikey: key,
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      },
    )
    if (!res.ok) return []
    const rows = (await res.json()) as ResumenDiario[]
    return (rows || []).map(normalizeResumenRow)
  } catch {
    return []
  }
}

export async function fetchMonthRows(
  mesStr: string, // YYYY-MM
  cfg: SupabaseConfig,
  token?: string,
): Promise<ResumenDiario[]> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  if (!url || !key) return []

  const authHeader = token ? `Bearer ${token}` : `Bearer ${key}`

  try {
    // Ultimo dia real del mes (ej. noviembre = 30; "-31" daba error 400 en Postgres)
    const [y, m] = mesStr.split('-').map(Number)
    const ultimoDia = String(new Date(y, m, 0).getDate()).padStart(2, '0')
    const res = await fetch(
      `${url}/rest/v1/resumen_diario?fecha=gte.${mesStr}-01&fecha=lte.${mesStr}-${ultimoDia}&order=fecha.desc`,
      {
        headers: {
          apikey: key,
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      },
    )
    if (!res.ok) return []
    const rows = (await res.json()) as ResumenDiario[]; return (rows || []).map(normalizeResumenRow);
  } catch {
    return []
  }
}

/**
 * Invoca la función RPC resumen_periodo(p_desde, p_hasta)
 */
export async function fetchResumenPeriodoRpc(
  desde: string,
  hasta: string,
  cfg: SupabaseConfig,
  token?: string,
): Promise<unknown> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  const authHeader = token ? `Bearer ${token}` : `Bearer ${key}`

  try {
    const res = await fetch(`${url}/rest/v1/rpc/resumen_periodo`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_desde: desde, p_hasta: hasta }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

const STORAGE_KEY_MEDICOS_CACHE = 'cuidar_medicos_directorio_cache_v1'

export const DEFAULT_MEDICOS_DIRECTORIO: MedicoDirectorio[] = [
  { medico_id: 'mr5gbf3s-gzdpkvqv', nombre: 'AGUIRRE, RAFAEL', especialidad: 'Diabetólogia', porcentaje_medico: 84.0, activo: true },
  { medico_id: 'mpx7mw73-rdiqsol6', nombre: 'ALFONSO, CARMEN', especialidad: 'Endocrinología', porcentaje_medico: 100.0, activo: true },
  { medico_id: 'mpwqq2u9-atkivl8g', nombre: 'ARJOL, CARLOS O', especialidad: 'Urología', porcentaje_medico: 100.0, activo: true },
  { medico_id: 'mt9208n3-7dyw0uvj', nombre: 'AYALA, MARCELA ALEJANDRA', especialidad: 'Psiquiatría', porcentaje_medico: 80.0, activo: true },
  { medico_id: 'msd9ba2u-pbt3en5m', nombre: 'BOBADILLA, JULIO CESAR', especialidad: 'Odontologia', porcentaje_medico: 50.0, activo: true },
  { medico_id: 'mpzfohrt-h9849fod', nombre: 'BOGADO, CELESTE ELIZABETH', especialidad: 'Odontologia', porcentaje_medico: 0.0, activo: true },
  { medico_id: 'mq0yzq4r-3n6mcg5x', nombre: 'BULOS, CLAUDIO', especialidad: 'Traumatología', porcentaje_medico: 100.0, activo: true },
  { medico_id: 'msreyr76-nlqrwpjj', nombre: 'BUSTAMANTE, JAZMIN BELEN', especialidad: 'Psicóloga', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mpv4jv8n-vn4gk3ze', nombre: 'CABALLERO, YOLANDA', especialidad: 'Cardiología', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mpvne3vb-oy0hxhpc', nombre: 'CASTAÑARES, VALERIA', especialidad: 'Ginecología', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mpv843qo-eiutrxh4', nombre: 'CORREA, ALFARO MARTIN', especialidad: 'Cardiología', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mpwqxpjr-7e8zo1du', nombre: 'DIBIASI, MIGUEL ANGEL C.', especialidad: 'Pediatría', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mq5sdbgm-jetcksf3', nombre: 'GIUDICI, SILVANA', especialidad: 'Neurología', porcentaje_medico: 75.0, activo: true },
  { medico_id: 'mpx2qnjx-qztc17qg', nombre: 'GOMEZ, FERNANDO SEBASTIAN', especialidad: 'Clínica médica', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mpyfn2qj-mbyrs2i7', nombre: 'IMBACH, GUILLERMO', especialidad: 'Gastroenterología', porcentaje_medico: 75.0, activo: true },
  { medico_id: 'mt7s1h4d-fmn9cw3j', nombre: 'LOPEZ, ROSAMARIA', especialidad: 'Psicopedagogía', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mq750k9w-fnvteinu', nombre: 'MARQUEZ, ALEJANDRA', especialidad: 'Dermatología', porcentaje_medico: 75.0, activo: true },
  { medico_id: 'mpzj3txc-nyhfffdy', nombre: 'MENDEZ, PAOLA', especialidad: 'Nutricionista', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'msooc97k-5z5mj8m9', nombre: 'MORTCHEFF, SEBASTIAN', especialidad: 'Traumatología', porcentaje_medico: 100.0, activo: true },
  { medico_id: 'mq56qdsz-efqj51qu', nombre: 'MUYAL, JOEL ERNESTO', especialidad: 'Traumatología', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mpv3xe45-k3q3jv01', nombre: 'OCAMPO, SILVANA', especialidad: 'Psicóloga', porcentaje_medico: 100.0, activo: true },
  { medico_id: 'mpx50ttj-mq0mltch', nombre: 'OSORIO, ERICA', especialidad: 'Cardiología', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mpvrru7i-k6b4cteb', nombre: 'PAREDES, SEBASTIAN', especialidad: 'Fonoaudiólogo', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mqgle7x8-om9eh1s7', nombre: 'QUIROZ, CRISTIAN', especialidad: 'Reumatología', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mqjiqu7y-jq2ganxx', nombre: 'RAVIOLO, CECILIA', especialidad: 'Nutricionista', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mssvlc7d-j1ftu2s7', nombre: 'RIVOIRA, MATIAS', especialidad: 'Urología', porcentaje_medico: 100.0, activo: true },
  { medico_id: 'mpv896l3-bao1mv4j', nombre: 'SCHIMPF, ROALD ARTURO', especialidad: 'Oftalmología', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mpv700bs-g1e0dei1', nombre: 'SENESTRARI, MARIA FERNANDA', especialidad: 'Clínica médica', porcentaje_medico: 100.0, activo: true },
  { medico_id: 'mpva854s-wv1t3834', nombre: 'VELAZQUEZ, ROBERTO', especialidad: 'Clínica médica', porcentaje_medico: 70.0, activo: true },
  { medico_id: 'mq9jbbra-ww7ddpbx', nombre: 'VENIALGO, EVELIN', especialidad: 'Psicopedagogía', porcentaje_medico: 100.0, activo: true },
  { medico_id: 'mpv5rfk3-9cirdcq9', nombre: 'VIDONDO, MATIAS', especialidad: 'Otorrinolaringología', porcentaje_medico: 100.0, activo: true },
]

export interface CachedMedicosDirectorio {
  data: MedicoDirectorio[]
  timeLabel?: string // HH:MM de la última sincronización guardada
}

export function getCachedMedicosDirectorio(): CachedMedicosDirectorio {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MEDICOS_CACHE)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
        return {
          data: parsed.data,
          timeLabel: parsed.timeLabel && parsed.timeLabel !== 'inicial' ? parsed.timeLabel : undefined,
        }
      }
    }
  } catch {
    // fallback
  }
  return {
    data: DEFAULT_MEDICOS_DIRECTORIO,
    timeLabel: undefined,
  }
}

export function setCachedMedicosDirectorio(data: MedicoDirectorio[]): void {
  try {
    const timeLabel = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())

    const cacheObj: CachedMedicosDirectorio = {
      data,
      timeLabel,
    }
    localStorage.setItem(STORAGE_KEY_MEDICOS_CACHE, JSON.stringify(cacheObj))
  } catch {
    // quota
  }
}

export async function fetchMedicosActivosCount(
  cfg: SupabaseConfig,
  token?: string,
): Promise<number> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  const cached = getCachedMedicosDirectorio()

  if (!url || !key) {
    return cached.data.length
  }

  const authHeader = token ? `Bearer ${token}` : `Bearer ${key}`

  try {
    const res = await fetch(`${url}/rest/v1/medicos_directorio?activo=eq.true&select=medico_id`, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      return cached.data.length
    }
    const list = (await res.json()) as Array<{ medico_id: string }>
    if (Array.isArray(list) && list.length > 0) {
      return list.length
    }
    return cached.data.length
  } catch {
    return cached.data.length
  }
}

export async function fetchMedicosDirectorio(
  cfg: SupabaseConfig,
  token?: string,
): Promise<{ data: MedicoDirectorio[]; error?: string; fromCache?: boolean; timeLabel?: string }> {
  const url = cfg.url.trim().replace(/\/+$/, '')
  const key = cfg.anonKey.trim()
  const cached = getCachedMedicosDirectorio()

  if (!url || !key) {
    return {
      data: cached.data,
      fromCache: true,
      timeLabel: cached.timeLabel,
    }
  }

  const authHeader = token ? `Bearer ${token}` : `Bearer ${key}`

  try {
    const endpoint = `${url}/rest/v1/medicos_directorio?activo=eq.true&select=*&order=nombre.asc`
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      return {
        data: cached.data,
        fromCache: true,
        timeLabel: cached.timeLabel,
      }
    }

    const rows = (await res.json()) as MedicoDirectorio[]
    if (Array.isArray(rows) && rows.length > 0) {
      setCachedMedicosDirectorio(rows)
      return { data: rows }
    }
    return {
      data: cached.data,
      fromCache: true,
      timeLabel: cached.timeLabel,
    }
  } catch {
    return {
      data: cached.data,
      fromCache: true,
      timeLabel: cached.timeLabel,
    }
  }
}

export async function logoutUser(cfg: SupabaseConfig, token?: string): Promise<void> {
  const url = cfg.url.trim().replace(/\/+$/, "")
  const key = cfg.anonKey.trim()
  if (token) {
    try {
      await fetch(`${url}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })
    } catch {
      // ignorar
    }
  }
  saveStoredSession(null)
  clearLocalCache()
}

export function clearLocalCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_SESSION)
    localStorage.removeItem(STORAGE_KEY_MEDICOS_CACHE)
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith(STORAGE_KEY_CACHE_PREFIX) || k.startsWith("cuidar_"))) {
        if (k !== STORAGE_KEY_CONFIG) {
          toRemove.push(k)
        }
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k))
  } catch {
    // ignorar
  }
}
