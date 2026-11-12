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
    passwordHash: 'P1U/65i0gOmqYowAPc3UnzYvQXvplu85GTJ6avQES30=',
    passwordSalt: 'fG8r56seNehNiM3JMddqSg==',
    mustChangePassword: false,
  },
  {
    username: 'Barua Andrea',
    role: 'secretaria',
    displayName: 'Barua Andrea',
    turno: 'Tarde',
    passwordHash: 'YT572xmglGv/oF5MeUWRgq8Va1VuEQ4OaagUPXuVZNE=',
    passwordSalt: 'cvNyyRkx1ju95x/Clzdelg==',
    mustChangePassword: false,
  },
  {
    username: 'Aguirre Mary',
    role: 'secretaria',
    displayName: 'Aguirre Mary',
    turno: 'Mañana',
    passwordHash: '+8z8K3Yq1ypaTr5lAHt8f+ZfzEGEDq++UAS4ok4UTCg=',
    passwordSalt: '4atQN0lY+daonfSIg0516Q==',
    mustChangePassword: false,
  },
  {
    username: 'Contratantes',
    role: 'afiliado',
    displayName: 'Contratantes',
    passwordHash: 'XSB27daQ5HQsdh+d7XTLg4iFNc87l3R3U1WVUdb0gLs=',
    passwordSalt: 'QdWC1HoUiu6h8xqWq2JrKA==',
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
