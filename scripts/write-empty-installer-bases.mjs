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

const emptyAccounts = [
  {
    username: 'Admi',
    role: 'admin',
    displayName: 'Admi',
    passwordHash: '7BxFDBXLc7cG6WtOZQLSHVRsdzUrEgZj1S72btz1XZg=',
    passwordSalt: 'LfDzGj3a8GL9QnmOkemt9Q==',
    mustChangePassword: false,
  },
  {
    username: 'Barua Andrea',
    role: 'secretaria',
    displayName: 'Barua Andrea',
    turno: 'Tarde',
    passwordHash: 'B39uQCkazYHxMJ9SlDtpZTdn9zL2Ow180XRjmxyfWmA=',
    passwordSalt: '9CVge8phMAx3Z0Fro/1xLQ==',
    mustChangePassword: false,
  },
  {
    username: 'Aguirre Mary',
    role: 'secretaria',
    displayName: 'Aguirre Mary',
    turno: 'Mañana',
    passwordHash: 'hYciznwnfauEs0WX5Kvl35qOfdQqzRuvIeJrH9XaA0o=',
    passwordSalt: '5eblfsE7lEcPSKZL5z3V0w==',
    mustChangePassword: false,
  },
  {
    username: 'Afiliados',
    role: 'afiliado',
    displayName: 'Afiliados',
    passwordHash: 'aOaCzUYT8j8CncD1r6r2TK/ONEUIU89y+IeI78YmRIM=',
    passwordSalt: '3LCSP4eze0v4edkvz64NMQ==',
    mustChangePassword: false,
  },
]

const json = `${JSON.stringify(emptyData)}\n`
const authJson = `${JSON.stringify(emptyAccounts, null, 2)}\n`
mkdirSync(dest, { recursive: true })

writeFileSync(join(dest, 'sanatorio-datos.json'), json, 'utf8')
for (const n of [1, 2, 3]) {
  writeFileSync(join(dest, `sanatorio-datos.respaldo-${n}.json`), json, 'utf8')
}
writeFileSync(join(dest, 'auth-accounts.json'), authJson, 'utf8')

console.log(`Bases vacías escritas en ${dest}`)
