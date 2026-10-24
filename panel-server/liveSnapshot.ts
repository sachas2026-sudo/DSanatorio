import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPanelCobranzasTemporal } from '../src/lib/panelCobranzasTemporal'
import { buildPanelSnapshot, type PanelSnapshot } from '../src/lib/panelSnapshot'
import { parseAppDataJson } from '../src/lib/parseAppData'

/** Arma snapshot al vuelo desde la base de la clínica (mismo PC que el panel). */
export function buildLiveSnapshotFromDatos(
  datosDir: string,
): PanelSnapshot | null {
  const path = join(datosDir, 'sanatorio-datos.json')
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    const data = parseAppDataJson(raw)
    const refDate = new Date()
    const temporal = buildPanelCobranzasTemporal(data, refDate)
    return buildPanelSnapshot(data, refDate, temporal)
  } catch {
    return null
  }
}
