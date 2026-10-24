/**
 * Genera JSON vacíos para el instalador (sin pacientes, médicos, turnos ni pagos).
 * Uso: node scripts/write-empty-installer-bases.mjs [carpeta-destino]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dest =
  process.argv[2] ?? join(__dirname, '..', 'src-tauri', 'installer-bases')

const emptyData = {
  patients: [],
  doctors: [],
  horarios: [],
  diasLibres: [],
  atencionesMensuales: [],
  appointments: [],
  payments: [],
  pagosCancelados: [],
  especialidadesCustom: [],
  obrasSocialesCustom: [],
  localidadesCustom: [],
  motivosConsultaCustom: [],
  settings: {
    email: '',
    emailGerente: '',
    telefonoGerente: '',
    clave: '',
    telefono: '',
    cuit: '',
  },
}

const json = `${JSON.stringify(emptyData)}\n`
mkdirSync(dest, { recursive: true })

writeFileSync(join(dest, 'sanatorio-datos.json'), json, 'utf8')
for (const n of [1, 2, 3]) {
  writeFileSync(join(dest, `sanatorio-datos.respaldo-${n}.json`), json, 'utf8')
}

console.log(`Bases vacías escritas en ${dest}`)
