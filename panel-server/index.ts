import express from 'express'
import cookieParser from 'cookie-parser'
import { config as loadEnv } from 'dotenv'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computePagosDia,
  computePagosMesConDescuentos,
} from '../src/lib/panelCobranzasMes'
import { parseAppDataJson } from '../src/lib/parseAppData'
import { buildLiveSnapshotFromDatos } from './liveSnapshot'
import { resolvePanelViewPassword } from './panelPassword'
import {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
} from './loginRateLimit'

function resolvePanelRoot(): string {
  const fromEnv = process.env.SANATORIO_PANEL_ROOT?.trim()
  if (fromEnv) return fromEnv
  if (typeof __dirname === 'string') return __dirname
  return dirname(fileURLToPath(import.meta.url))
}

const PANEL_ROOT = resolvePanelRoot()
loadEnv({ path: join(PANEL_ROOT, '.env') })
const DATA_DIR = join(PANEL_ROOT, 'data')
const SNAPSHOT_PATH = join(DATA_DIR, 'snapshot.json')
const COBRANZAS_TEMP_PATH = join(DATA_DIR, 'cobranzas-mes.tmp.json')
const SANATORIO_DATOS =
  process.env.SANATORIO_DATOS?.trim() || String.raw`C:\Sanatorio\datos`
const DESKTOP_COBRANZAS_TEMP = join(
  SANATORIO_DATOS,
  'panel-cobranzas-mes.tmp.json',
)
const PUBLIC_DIR = join(PANEL_ROOT, 'public')

const PORT = Number(process.env.PANEL_PORT || 3780)
const SYNC_SECRET = (process.env.PANEL_SYNC_SECRET || '').trim()
const VIEW_PASSWORD = (process.env.PANEL_VIEW_PASSWORD || '').trim()
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

type PanelSnapshot = {
  updatedAt: string
  turnosHoyFecha: string
  turnosHoy: Array<{
    hora: string
    paciente: string
    medico: string
    estado: string
  }>
  pagosMes: {
    mesLabel: string
    total: number
    totalFacturado?: number
    cantidad: number
  }
  pagosDia?: {
    diaLabel: string
    total: number
    totalFacturado?: number
    totalConDescuentos?: number
    cantidad: number
  }
  pagosPorDia?: Array<{
    dia: string
    total: number
  }>
}

type PanelCobranzasTemporal = {
  mesLabel: string
  total: number
  cantidad: number
  totalFacturado?: number
  computedAt: string
}

type Session = { expiresAt: number }

const sessions = new Map<string, Session>()

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDataDir()
  const body = JSON.stringify(data, null, 2)
  const tmp = `${filePath}.${process.pid}.tmp`
  writeFileSync(tmp, body, 'utf8')
  try {
    renameSync(tmp, filePath)
  } catch {
    writeFileSync(filePath, body, 'utf8')
    try {
      renameSync(tmp, filePath)
    } catch {
      /* destino ya actualizado por fallback */
    }
  }
}

function readSnapshot(): PanelSnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as PanelSnapshot
  } catch {
    return null
  }
}

function writeSnapshot(body: PanelSnapshot): void {
  const clean: PanelSnapshot = {
    updatedAt: body.updatedAt,
    turnosHoyFecha: body.turnosHoyFecha,
    turnosHoy: body.turnosHoy,
    pagosMes: body.pagosMes,
    pagosDia: body.pagosDia,
    pagosPorDia: body.pagosPorDia,
  }
  writeJsonAtomic(SNAPSHOT_PATH, clean)
}

function readCobranzasTemporal(): PanelCobranzasTemporal | null {
  for (const path of [COBRANZAS_TEMP_PATH, DESKTOP_COBRANZAS_TEMP]) {
    if (!existsSync(path)) continue
    try {
      const parsed = JSON.parse(
        readFileSync(path, 'utf8'),
      ) as PanelCobranzasTemporal
      if (isValidCobranzasTemporal(parsed)) return parsed
    } catch {
      /* probar siguiente origen */
    }
  }
  return null
}

function pagosMesFromTemporal(
  temp: PanelCobranzasTemporal,
): PanelSnapshot['pagosMes'] {
  return {
    mesLabel: temp.mesLabel,
    total: temp.total,
    totalFacturado: temp.totalFacturado,
    cantidad: temp.cantidad,
  }
}

function writeCobranzasTemporal(body: PanelCobranzasTemporal): void {
  writeJsonAtomic(COBRANZAS_TEMP_PATH, body)
}

function isValidCobranzasTemporal(body: unknown): body is PanelCobranzasTemporal {
  if (!body || typeof body !== 'object') return false
  const v = body as Record<string, unknown>
  return (
    typeof v.mesLabel === 'string' &&
    typeof v.total === 'number' &&
    typeof v.cantidad === 'number' &&
    typeof v.computedAt === 'string'
  )
}

function enrichSnapshotPagos(snap: PanelSnapshot): PanelSnapshot {
  const datosPath = join(SANATORIO_DATOS, 'sanatorio-datos.json')
  const temp = readCobranzasTemporal()

  if (!existsSync(datosPath)) {
    if (!temp) return snap
    return { ...snap, pagosMes: pagosMesFromTemporal(temp) }
  }

  try {
    const data = parseAppDataJson(readFileSync(datosPath, 'utf8'))
    const refDate = new Date()
    const mes = computePagosMesConDescuentos(data, refDate)
    const dia = computePagosDia(data, refDate)
    const pagosMes = temp
      ? pagosMesFromTemporal(temp)
      : {
          mesLabel: format(refDate, 'MMMM yyyy', { locale: es }),
          total: mes.total,
          totalFacturado: mes.totalFacturado,
          cantidad: mes.cantidad,
        }

    return {
      ...snap,
      pagosMes,
      pagosDia: {
        diaLabel: format(refDate, "EEEE d 'de' MMMM yyyy", { locale: es }),
        total: dia.total,
        totalFacturado: dia.total,
        totalConDescuentos: dia.totalConDescuentos,
        cantidad: dia.cantidad,
      },
    }
  } catch {
    if (!temp) return snap
    return { ...snap, pagosMes: pagosMesFromTemporal(temp) }
  }
}

/** Datos para la web: siempre desde la base local si existe; si no, snapshot guardado. */
function resolveSnapshotForWeb(): {
  snap: PanelSnapshot | null
  source: 'live' | 'cached' | null
} {
  const live = buildLiveSnapshotFromDatos(SANATORIO_DATOS)
  if (live) {
    return { snap: enrichSnapshotPagos(live), source: 'live' }
  }
  const cached = readSnapshot()
  if (!cached) return { snap: null, source: null }
  return { snap: enrichSnapshotPagos(cached), source: 'cached' }
}

function isValidSnapshot(body: unknown): body is PanelSnapshot {
  if (!body || typeof body !== 'object') return false
  const v = body as Record<string, unknown>
  if (typeof v.updatedAt !== 'string') return false
  if (!Array.isArray(v.turnosHoy)) return false
  if (!v.pagosMes || typeof v.pagosMes !== 'object') return false
  const pm = v.pagosMes as Record<string, unknown>
  return typeof pm.total === 'number' && typeof pm.cantidad === 'number'
}

function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

function pruneSessions(): void {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token)
  }
}

function shouldUseSecureCookie(req: express.Request): boolean {
  if (process.env.PANEL_SECURE_COOKIE !== '1') return false
  if (req.secure) return true
  const proto = req.headers['x-forwarded-proto']
  return proto === 'https'
}

function requireViewSession(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  pruneSessions()
  const token = req.cookies?.panel_session as string | undefined
  if (!token) {
    res.status(401).json({ error: 'Sesión requerida' })
    return
  }
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    res.status(401).json({ error: 'Sesión expirada' })
    return
  }
  next()
}

const app = express()
app.set('trust proxy', 1)
app.use(cookieParser())
app.use(express.json({ limit: '512kb' }))

app.use('/api/sync', (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  next()
})

app.options('/api/sync', (_req, res) => {
  res.sendStatus(204)
})

app.post('/api/sync', (req, res) => {
  if (!SYNC_SECRET) {
    res.status(503).json({ error: 'Servidor sin PANEL_SYNC_SECRET configurado' })
    return
  }
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token || !secretsMatch(token, SYNC_SECRET)) {
    res.status(401).json({ error: 'Token de sincronización inválido' })
    return
  }
  if (!isValidSnapshot(req.body)) {
    res.status(400).json({ error: 'Snapshot inválido' })
    return
  }
  const body = req.body as PanelSnapshot & {
    cobranzasMesTemporal?: PanelCobranzasTemporal
  }
  const temporal =
    body.cobranzasMesTemporal &&
    isValidCobranzasTemporal(body.cobranzasMesTemporal)
      ? body.cobranzasMesTemporal
      : null
  if (temporal) {
    writeCobranzasTemporal(temporal)
  }
  const { cobranzasMesTemporal: _temp, ...snapshot } = body
  if (temporal) {
    snapshot.pagosMes = pagosMesFromTemporal(temporal)
  }
  writeSnapshot(snapshot)
  res.json({ ok: true, updatedAt: snapshot.updatedAt })
})

app.post('/api/login', (req, res) => {
  const clientKey =
    (typeof req.ip === 'string' && req.ip) ||
    req.socket.remoteAddress ||
    'unknown'
  const rate = checkLoginRateLimit(clientKey)
  if (!rate.ok) {
    const retrySec = Math.ceil(rate.retryAfterMs / 1000)
    res.status(429).json({
      error: `Demasiados intentos. Probá de nuevo en ${retrySec} s.`,
    })
    return
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const viewPassword = resolvePanelViewPassword(SANATORIO_DATOS, VIEW_PASSWORD)
  if (!viewPassword) {
    res.status(503).json({ error: 'Servidor sin contraseña de gerente configurada' })
    return
  }
  if (!secretsMatch(password, viewPassword)) {
    recordLoginFailure(clientKey)
    res.status(401).json({ error: 'Contraseña incorrecta' })
    return
  }
  recordLoginSuccess(clientKey)
  const sessionToken = randomBytes(32).toString('hex')
  sessions.set(sessionToken, { expiresAt: Date.now() + SESSION_TTL_MS })
  res.cookie('panel_session', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    secure: shouldUseSecureCookie(req),
  })
  res.json({ ok: true })
})

app.post('/api/logout', (_req, res) => {
  res.clearCookie('panel_session')
  res.json({ ok: true })
})

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    ok: true,
    service: 'sanatorio-panel',
    port: PORT,
    hasSyncSecret: Boolean(SYNC_SECRET),
    hasViewPassword: Boolean(VIEW_PASSWORD),
    snapshotReady: existsSync(SNAPSHOT_PATH),
  })
})

app.get('/api/snapshot', requireViewSession, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  const { snap, source } = resolveSnapshotForWeb()
  if (!snap) {
    res.status(404).json({ error: 'Aún no se publicó ningún dato desde la clínica' })
    return
  }
  res.json({
    ...snap,
    fetchedAt: new Date().toISOString(),
    dataSource: source,
  })
})

app.use(
  express.static(PUBLIC_DIR, {
    etag: false,
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
      }
    },
  }),
)

app.use((_req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'index.html'))
})

if (!SYNC_SECRET || !VIEW_PASSWORD) {
  console.warn(
    '[panel] Configure PANEL_SYNC_SECRET y PANEL_VIEW_PASSWORD (ver panel-server/.env.example)',
  )
}

app.listen(PORT, () => {
  console.log(`[panel] Gerente — http://localhost:${PORT}`)
  console.log('[panel] Solo lectura · turnos del día + total del mes (sin DNI)')
})
