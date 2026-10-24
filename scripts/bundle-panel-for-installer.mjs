/**
 * Empaqueta panel-server para el instalador (C:\Sanatorio\panel).
 */
import { buildSync } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join('src-tauri', 'installer-assets', 'panel')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

buildSync({
  entryPoints: ['panel-server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(outDir, 'panel.cjs'),
  logLevel: 'info',
})

cpSync(join('panel-server', 'public'), join(outDir, 'public'), { recursive: true })

console.log(`Panel listo en ${outDir}`)
