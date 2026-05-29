import type { MotivoCancelacionPago } from '../types'
import { normalizePagosCancelados } from './parseAppData'

export { normalizePagosCancelados }

export const MOTIVOS_CANCELACION_PAGO: {
  value: MotivoCancelacionPago
  label: string
}[] = [
  { value: 'cancelacion_paciente', label: 'Cancelación del Paciente' },
  { value: 'cancelacion_doctor', label: 'Cancelación del Doctor' },
  { value: 'otros', label: 'Otros' },
]

export function labelMotivoCancelacion(motivo: MotivoCancelacionPago): string {
  return (
    MOTIVOS_CANCELACION_PAGO.find((m) => m.value === motivo)?.label ?? motivo
  )
}
