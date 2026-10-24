/**
 * Publica snapshot + temporal al panel (dev o producción).
 * Uso: node scripts/push-panel-sync.mjs [panelUrl] [syncSecret]
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const dataPath = 'C:/Sanatorio/datos/sanatorio-datos.json'
const panelUrl = (
  process.argv[2] ||
  process.env.PANEL_URL ||
  'http://localhost:3780'
).replace(/\/+$/, '')
const syncSecret =
  process.argv[3] ||
  process.env.PANEL_SYNC_SECRET ||
  'sanatorio-panel-dev-sync-2026'

const { buildPanelSnapshot } = await import(
  pathToFileURL('src/lib/panelSnapshot.ts').href
)
const { buildPanelCobranzasTemporal } = await import(
  pathToFileURL('src/lib/panelCobranzasTemporal.ts').href
)

const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const refDate = new Date()
const cobranzasMesTemporal = buildPanelCobranzasTemporal(data, refDate)
const snapshot = buildPanelSnapshot(data, refDate, cobranzasMesTemporal)
const payload = { ...snapshot, cobranzasMesTemporal }

const res = await fetch(`${panelUrl}/api/sync`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${syncSecret}`,
  },
  body: JSON.stringify(payload),
})

const body = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error('Sync falló:', res.status, body.error || body)
  process.exit(1)
}

console.log('Panel actualizado:', panelUrl)
console.log('Cobranzas netas:', snapshot.pagosMes.total)
console.log('Turnos hoy:', snapshot.turnosHoy.length, '—', snapshot.turnosHoyFecha)
