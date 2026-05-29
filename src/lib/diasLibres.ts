import { parseISO } from 'date-fns'
import { DIAS_SEMANA_FORM } from './diasSemana'
import type { DoctorDiaLibre } from '../types'

export type DiasLibresGrupo = {
  doctorId: string
  nombre: string
  dias: { id: string; diaSemana: number }[]
}

const ORDEN_DIA_SEMANA = new Map<number, number>(
  DIAS_SEMANA_FORM.map((d, i) => [d, i]),
)

export function groupDiasLibresByDoctor(
  diasLibres: DoctorDiaLibre[],
  doctorLabel: (doctorId: string) => string,
): DiasLibresGrupo[] {
  const map = new Map<string, { id: string; diaSemana: number }[]>()
  for (const dl of diasLibres) {
    const list = map.get(dl.doctorId) ?? []
    list.push({ id: dl.id, diaSemana: dl.diaSemana })
    map.set(dl.doctorId, list)
  }
  return [...map.entries()]
    .map(([doctorId, dias]) => ({
      doctorId,
      nombre: doctorLabel(doctorId),
      dias: [...dias].sort(
        (a, b) =>
          (ORDEN_DIA_SEMANA.get(a.diaSemana) ?? 99) -
          (ORDEN_DIA_SEMANA.get(b.diaSemana) ?? 99),
      ),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export function normalizeDiasLibres(raw: unknown[]): DoctorDiaLibre[] {
  const map = new Map<string, DoctorDiaLibre>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const doctorId = rec.doctorId
    if (typeof doctorId !== 'string' || !doctorId) continue

    let diaSemana: number | null = null
    if (typeof rec.diaSemana === 'number' && rec.diaSemana >= 0 && rec.diaSemana <= 6) {
      diaSemana = rec.diaSemana
    } else if (typeof rec.fecha === 'string' && rec.fecha) {
      diaSemana = parseISO(`${rec.fecha}T12:00:00`).getDay()
    }
    if (diaSemana === null) continue

    const key = `${doctorId}-${diaSemana}`
    if (!map.has(key)) {
      map.set(key, {
        id: typeof rec.id === 'string' ? rec.id : `${doctorId}-${diaSemana}`,
        doctorId,
        diaSemana,
      })
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.doctorId.localeCompare(b.doctorId) || a.diaSemana - b.diaSemana,
  )
}

export function isDoctorOffOnWeekday(
  doctorId: string,
  date: Date,
  diasLibres: DoctorDiaLibre[],
): boolean {
  if (!doctorId) return false
  const dow = date.getDay()
  return diasLibres.some((d) => d.doctorId === doctorId && d.diaSemana === dow)
}
