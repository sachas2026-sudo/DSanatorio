import { describe, expect, it } from 'vitest'
import {
  computeDoctorResumenSettlement,
  computeEfectivoAEntregar,
  countDistinctPagos,
  pagoPdfGroupKey,
  pdfGeneratedLabel,
  sumPagosTransferencia,
} from './pagosPdfLayout'
import type { Payment } from '../types'

function pay(partial: Partial<Payment> & Pick<Payment, 'id'>): Payment {
  return {
    patientId: 'p1',
    doctorId: 'd1',
    citaId: null,
    monto: 100,
    fecha: '2026-05-31T10:00:00.000Z',
    metodo: 'Efectivo',
    notas: '',
    ...partial,
  }
}

describe('countDistinctPagos', () => {
  it('dos registros del mismo turno (pago partido) cuentan como 1', () => {
    const a = pay({ id: 'a', citaId: 'c1', monto: 180, metodo: 'Efectivo' })
    const b = pay({ id: 'b', citaId: 'c1', monto: 20, metodo: 'Transferencia' })
    expect(pagoPdfGroupKey(a)).toBe(pagoPdfGroupKey(b))
    expect(countDistinctPagos([a, b])).toBe(1)
  })

  it('sin cita agrupa por paciente y misma fecha/hora', () => {
    const a = pay({ id: 'a', fecha: '2026-05-31T14:30:00.000Z' })
    const b = pay({ id: 'b', fecha: '2026-05-31T14:30:00.000Z' })
    expect(countDistinctPagos([a, b])).toBe(1)
  })

  it('pagos distintos suman por separado', () => {
    const a = pay({ id: 'a', citaId: 'c1' })
    const b = pay({ id: 'b', citaId: 'c2' })
    expect(countDistinctPagos([a, b])).toBe(2)
  })
})

describe('computeDoctorResumenSettlement', () => {
  it('descuenta las transferencias del total neto a entregar', () => {
    expect(computeEfectivoAEntregar(94500, 60000)).toBe(34500)
  })

  it('resta comisión y transferencias del facturado', () => {
    const payments = [
      pay({ id: 'a', monto: 180, metodo: 'Efectivo' }),
      pay({ id: 'b', monto: 20, metodo: 'Transferencia' }),
    ]
    const facturado = 200
    const transferencias = sumPagosTransferencia(payments)
    expect(transferencias).toBe(20)
    expect(
      computeDoctorResumenSettlement(facturado, transferencias, 10),
    ).toEqual({
      facturado: 200,
      porcentaje: 10,
      comision: 20,
      transferencias: 20,
      efectivoAEntregar: 160,
    })
  })
})

describe('pdfGeneratedLabel', () => {
  it('usa el usuario que convoca/genera el PDF en el pie de página', () => {
    const labelBarua = pdfGeneratedLabel('Barua Andrea')
    expect(labelBarua).toMatch(/^Barua Andrea - Generado: \d{2}-\d{2}-\d{4} \d{2}:\d{2}$/)

    const labelMary = pdfGeneratedLabel('Aguirre Mary')
    expect(labelMary).toMatch(/^Aguirre Mary - Generado: \d{2}-\d{2}-\d{4} \d{2}:\d{2}$/)

    const labelAdmi = pdfGeneratedLabel('Admi')
    expect(labelAdmi).toMatch(/^Admi - Generado: \d{2}-\d{2}-\d{4} \d{2}:\d{2}$/)
  })

  it('respeta el turno especificado cuando aplica', () => {
    const labelTurno = pdfGeneratedLabel('Barua Andrea', 'Turno Tarde')
    expect(labelTurno).toMatch(/^Barua Andrea - Turno Tarde - Generado: \d{2}-\d{2}-\d{4} \d{2}:\d{2}$/)
  })
})

