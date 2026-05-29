import type { Doctor } from '../types'

/** Especialidades médicas habituales */
export const ESPECIALIDADES_COMUNES = [
  'Anestesiología',
  'Cardiología',
  'Cirugía general',
  'Clínica médica',
  'Dermatología',
  'Endocrinología',
  'Gastroenterología',
  'Ginecología',
  'Hematología',
  'Infectología',
  'Kinesiología',
  'Medicina general',
  'Nefrología',
  'Neumonología',
  'Neurología',
  'Obstetricia',
  'Oftalmología',
  'Oncología',
  'Otorrinolaringología',
  'Pediatría',
  'Psiquiatría',
  'Radiología',
  'Reumatología',
  'Traumatología',
  'Urología',
] as const

export function normalizeEspecialidad(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function especialidadKey(value: string): string {
  return normalizeEspecialidad(value).toLocaleLowerCase('es')
}

export function isEspecialidadComun(value: string): boolean {
  const key = especialidadKey(value)
  return ESPECIALIDADES_COMUNES.some((e) => especialidadKey(e) === key)
}

export function mergeEspecialidades(
  custom: string[],
  doctors: Doctor[],
): string[] {
  const map = new Map<string, string>()
  const add = (raw: string) => {
    const n = normalizeEspecialidad(raw)
    if (!n) return
    const key = especialidadKey(n)
    if (!map.has(key)) map.set(key, n)
  }
  for (const e of ESPECIALIDADES_COMUNES) add(e)
  for (const e of custom) add(e)
  for (const d of doctors) add(d.especialidad)
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

export type EspecialidadConMedicos = {
  key: string
  label: string
  doctors: Doctor[]
}

export function groupDoctorsByEspecialidad(
  doctors: Doctor[],
): EspecialidadConMedicos[] {
  const map = new Map<string, EspecialidadConMedicos>()
  for (const doc of doctors) {
    const label = normalizeEspecialidad(doc.especialidad) || 'Sin especialidad'
    const key = especialidadKey(label)
    const entry = map.get(key) ?? { key, label, doctors: [] }
    entry.doctors.push(doc)
    map.set(key, entry)
  }
  return [...map.values()]
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
    .map((g) => ({
      ...g,
      doctors: [...g.doctors].sort((a, b) =>
        `${a.apellido} ${a.nombre}`.localeCompare(
          `${b.apellido} ${b.nombre}`,
          'es',
        ),
      ),
    }))
}
