/**
 * Crea panel-bundle.zip para el instalador (evita extraer panel/ en Program Files).
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const panelDir = join('src-tauri', 'installer-assets', 'panel')
const zipOut = join('src-tauri', 'installer-assets', 'panel-bundle.zip')

if (!existsSync(join(panelDir, 'panel.cjs'))) {
  console.error('Falta panel.cjs. Ejecute: npm run installer:bundle-panel')
  process.exit(1)
}

const panelDirWin = join(process.cwd(), panelDir).replace(/'/g, "''")
const zipOutWin = join(process.cwd(), zipOut).replace(/'/g, "''")

execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${panelDirWin}\\*' -DestinationPath '${zipOutWin}' -Force"`,
  { stdio: 'inherit' },
)

console.log(`Panel ZIP listo en ${zipOut}`)
