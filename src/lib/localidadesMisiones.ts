import type { Patient } from '../types'

/**
 * Localidades / municipios de Misiones (lista para el desplegable).
 * Nota: puede haber variantes de escritura; normalizamos y dejamos sumar "custom".
 */
export const LOCALIDADES_MISIONES = [
  'Posadas',
  'Garupá',
  'Candelaria',
  'San Ignacio',
  'Santa Ana',
  'Loreto',
  'Corpus',
  'Gobernador Roca',
  'Jardín América',
  'Puerto Rico',
  'Eldorado',
  'Montecarlo',
  'Puerto Iguazú',
  'Wanda',
  'Puerto Esperanza',
  'Puerto Libertad',
  'Comandante Andresito',
  'San Antonio',
  'Bernardo de Irigoyen',
  'Dos Hermanas',
  'San Pedro',
  'Tobuna',
  'El Soberbio',
  'Alba Posse',
  '25 de Mayo',
  'Aristóbulo del Valle',
  'Campo Grande',
  'Campo Viera',
  'Oberá',
  'Leandro N. Alem',
  'Apóstoles',
  'Concepción de la Sierra',
  'San Javier',
  'Cerro Azul',
  'Caa Yarí',
  'Mojón Grande',
  'Tres Capones',
  'Azara',
  'Santa María',
  'San José',
  'Itacaruaré',
  'Santo Pipó',
  'General Urquiza',
  'Colonia Polana',
  'Mártires',
  'Profundidad',
  'Fachinal',
  'Bonpland',
  'Olegario Víctor Andrade',
  'Río Colorado',
  'Panambí',
  'Colonia Aurora',
  'Los Helechos',
  'Guaraní',
  'San Martín',
  'Dos de Mayo',
  'Salto Encantado',
  'Cainguás',
  'Villa Bonita',
  'Colonia Alberdi',
  'Almafuerte',
  'Florentino Ameghino',
  '9 de Julio',
  'Santiago de Liniers',
  'Colonia Delicia',
  'Mado',
  'Mayor Otaño',
  'Puerto Piray',
  'Capioví',
  'Ruiz de Montoya',
  'Hipólito Yrigoyen',
  'El Alcázar',
  'Caraguatay',
  'Colonia Victoria',
  'Colonia Wanda',
  'Puerto Leoni',
  'Villa Lanús',
  'Itaembé Guazú',
  'Itaembé Miní',
] as const

export function normalizeLocalidad(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function localidadKey(value: string): string {
  return normalizeLocalidad(value).toLocaleLowerCase('es')
}

export function isLocalidadMisionera(value: string): boolean {
  const key = localidadKey(value)
  return LOCALIDADES_MISIONES.some((l) => localidadKey(l) === key)
}

export function mergeLocalidades(custom: string[], patients: Patient[]): string[] {
  const map = new Map<string, string>()
  const add = (raw: string) => {
    const n = normalizeLocalidad(raw)
    if (!n) return
    const key = localidadKey(n)
    if (!map.has(key)) map.set(key, n)
  }
  for (const l of LOCALIDADES_MISIONES) add(l)
  for (const l of custom) add(l)
  for (const p of patients) add(p.localidad)
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

export function mergeLocalidadesAny(
  custom: string[],
  patients: { localidad: string }[],
  doctors: { localidad: string }[],
): string[] {
  const map = new Map<string, string>()
  const add = (raw: string) => {
    const n = normalizeLocalidad(raw)
    if (!n) return
    const key = localidadKey(n)
    if (!map.has(key)) map.set(key, n)
  }
  for (const l of LOCALIDADES_MISIONES) add(l)
  for (const l of custom) add(l)
  for (const p of patients) add(p.localidad)
  for (const d of doctors) add(d.localidad)
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

