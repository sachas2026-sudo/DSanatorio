import { describe, expect, it } from 'vitest'
import type { Payment } from '../types'
import { formatPagosLine, paymentsForCita, totalPagosMonto } from './paymentDisplay'

const sample = (partial: Partial<Payment> & Pick<Payment, 'id'>): Payment => ({
  patientId: 'p1',
  doctorId: 'd1',
  citaId: 'c1',
  monto: 100,
  fecha: '2026-01-01',
  metodo: 'Efectivo',
  notas: '',
  ...partial,
})

describe('paymentDisplay', () => {
  it('paymentsForCita agrupa por citaId', () => {
    const list = [
      sample({ id: 'a', monto: 100 }),
      sample({ id: 'b', monto: 50, metodo: 'Tarjeta' }),
      sample({ id: 'c', citaId: 'c2' }),
    ]
    expect(paymentsForCita(list, 'c1')).toHaveLength(2)
  })

  it('formatPagosLine une varios métodos', () => {
    const line = formatPagosLine([
      sample({ id: 'a', monto: 1000, metodo: 'Efectivo' }),
      sample({ id: 'b', monto: 500, metodo: 'Tarjeta' }),
    ])
    expect(line).toContain('Efectivo')
    expect(line).toContain('Tarjeta')
    expect(line).toContain('+')
  })

  it('totalPagosMonto suma montos', () => {
    expect(
      totalPagosMonto([
        sample({ id: 'a', monto: 100 }),
        sample({ id: 'b', monto: 50 }),
      ]),
    ).toBe(150)
  })
})
