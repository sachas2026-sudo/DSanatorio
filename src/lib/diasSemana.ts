const DIA_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DIA_LARGO = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
]

export function diaSemanaLabel(d: number): string {
  return DIA_LABEL[d] ?? String(d)
}

export function diaSemanaLabelLargo(d: number): string {
  return DIA_LARGO[d] ?? String(d)
}

/** Orden Lun → Dom para formularios */
export const DIAS_SEMANA_FORM = [1, 2, 3, 4, 5, 6, 0] as const
