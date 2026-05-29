import type { Patient } from '../types'

/** Obras sociales y prepagas habituales en Argentina */
export const OBRAS_SOCIALES = [  'IPS',
  'PAMI',
  'OSDE',
  'Swiss Medical',
  'Galeno',
  'IOMA',
  'OMINT',
  'Medicus',
  'OSECAC',
  'Sancor Salud',
  'Accord Salud',
  'Particular',
] as const

export type ObraSocial = (typeof OBRAS_SOCIALES)[number]

export const OBRA_SOCIAL_VACIA = ''

export function normalizeObraSocial(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function obraSocialKey(value: string): string {
  return normalizeObraSocial(value).toLocaleLowerCase('es')
}

export function isObraSocialComun(value: string): boolean {
  const key = obraSocialKey(value)
  return OBRAS_SOCIALES.some((o) => obraSocialKey(o) === key)
}

export function mergeObrasSociales(
  custom: string[],
  patients: Patient[],
): string[] {
  const map = new Map<string, string>()
  const add = (raw: string) => {
    const n = normalizeObraSocial(raw)
    if (!n) return
    const key = obraSocialKey(n)
    if (!map.has(key)) map.set(key, n)
  }
  for (const o of OBRAS_SOCIALES) add(o)
  for (const o of custom) add(o)
  for (const p of patients) add(p.obraSocial)
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'es'))
}