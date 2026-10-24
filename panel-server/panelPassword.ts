import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PANEL_CLAVE_FILE = 'panel-clave-gerente.txt'

/** Contraseña del gerente: archivo local, JSON legacy o .env del panel. */
export function resolvePanelViewPassword(
  datosDir: string,
  envPassword: string,
): string {
  const fromFile = readPanelClaveFromFile(datosDir)
  if (fromFile) return fromFile
  const fromDatos = readPanelClaveFromDatosLegacy(datosDir)
  if (fromDatos) return fromDatos
  return envPassword.trim()
}

function readPanelClaveFromFile(datosDir: string): string {
  const path = join(datosDir, PANEL_CLAVE_FILE)
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

function readPanelClaveFromDatosLegacy(datosDir: string): string {
  const path = join(datosDir, 'sanatorio-datos.json')
  if (!existsSync(path)) return ''
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      settings?: { panelClaveGerente?: unknown }
    }
    const clave = raw.settings?.panelClaveGerente
    return typeof clave === 'string' ? clave.trim() : ''
  } catch {
    return ''
  }
}
