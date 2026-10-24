import { describe, expect, it } from 'vitest'
import type { Payment } from '../types'
import { formatMonto } from './formatMonto'
import {
  aggregatePorcentajeSettlementForPayments,
  buildRendicionDoctorRows,
  migratePaymentsPorcentajeAplicado,
  sonTodosTransferencia,
} from './paymentPorcentaje'
import {
  computeDoctorPorcentajeSettlement,
  resolvePaymentPorcentaje,
  sumPagosNetTotalByDoctor,
} from './pagosPdfLayout'

const pay = (partial: Partial<Payment> & Pick<Payment, 'id'>): Payment => ({
  patientId: 'p1',
  doctorId: 'd1',
  citaId: null,
  monto: 10000,
  fecha: '2026-06-01T12:00:00',
  metodo: 'Efectivo',
  notas: '',
  ...partial,
})

describe('paymentPorcentaje', () => {
  it('sonTodosTransferencia sólo da true con el listado 100% transferencia', () => {
    const tr = (id: string) => pay({ id, metodo: 'Transferencia' })
    const ef = (id: string) => pay({ id, metodo: 'Efectivo' })

    expect(sonTodosTransferencia([tr('1'), tr('2'), tr('3')])).toBe(true)
    // Un solo efectivo alcanza para que la columna vuelva a mostrar importes.
    expect(sonTodosTransferencia([tr('1'), ef('2')])).toBe(false)
    expect(sonTodosTransferencia([ef('1')])).toBe(false)
    // Sin pagos no se puede afirmar que todo sea transferencia.
    expect(sonTodosTransferencia([])).toBe(false)
    // Cualquier otro método (Tarjeta, Débito, vacío) también rompe el 100%.
    expect(sonTodosTransferencia([tr('1'), pay({ id: '2', metodo: 'Tarjeta' })])).toBe(
      false,
    )
    expect(sonTodosTransferencia([tr('1'), pay({ id: '2', metodo: '' })])).toBe(false)
  })

  it('sonTodosTransferencia ignora mayúsculas y espacios del método', () => {
    const sucio = (id: string, metodo: string) => pay({ id, metodo })
    expect(
      sonTodosTransferencia([
        sucio('1', 'Transferencia'),
        sucio('2', '  transferencia '),
        sucio('3', 'TRANSFERENCIA'),
      ]),
    ).toBe(true)
  })

  it('con todo transferencia "% Cuidar" se muestra como - $ 1.500', () => {
    // El 10% de 15.000. La columna invierte el signo con formatMonto, que
    // escribe "- $ 1.500" (guion, espacio, peso, espacio, miles).
    const montoCuidar = computeDoctorPorcentajeSettlement(15000, 10).totalPorcentaje
    expect(formatMonto(-montoCuidar)).toBe('- $ 1.500')
    expect(formatMonto(montoCuidar)).toBe('$ 1.500')
  })

  it('resolvePaymentPorcentaje usa porcentajeAplicado del pago', () => {
    expect(resolvePaymentPorcentaje(pay({ id: '1', porcentajeAplicado: 10 }), 15)).toBe(
      10,
    )
  })

  it('aggregatePorcentajeSettlementForPayments respeta % distintos por pago', () => {
    const payments = [
      pay({ id: '1', porcentajeAplicado: 10, monto: 10000 }),
      pay({ id: '2', porcentajeAplicado: 15, monto: 10000 }),
    ]
    const agg = aggregatePorcentajeSettlementForPayments(payments)
    expect(agg.porcentajeLabel).toBe('Var.')
    expect(agg.totalPorcentaje).toBe(2500)
    expect(agg.totalGeneral).toBe(17500)
  })

  it('sumPagosNetTotalByDoctor no recalcula con % actual del médico', () => {
    const payments = [pay({ id: '1', porcentajeAplicado: 10, monto: 10000 })]
    const net = sumPagosNetTotalByDoctor(payments, () => 99)
    expect(net).toBe(9000)
  })

  it('migratePaymentsPorcentajeAplicado rellena pagos viejos', () => {
    const { payments, changed } = migratePaymentsPorcentajeAplicado({
      doctors: [{ id: 'd1', porcentaje: 20 }],
      payments: [pay({ id: '1' })],
      pagosCancelados: [],
    })
    expect(changed).toBe(true)
    expect(payments[0]?.porcentajeAplicado).toBe(20)
  })

  it('buildRendicionDoctorRows agrupa por médico y reparte efectivo', () => {
    const payments = [
      pay({ id: '1', doctorId: 'd1', monto: 180, metodo: 'Efectivo' }),
      pay({ id: '2', doctorId: 'd1', monto: 20, metodo: 'Transferencia' }),
      pay({ id: '3', doctorId: 'd2', monto: 5000, metodo: 'Efectivo', porcentajeAplicado: 5 }),
    ]
    const rows = buildRendicionDoctorRows(
      payments,
      (id) => (id === 'd1' ? 'Paredes, Juan' : 'García, Ana'),
      (id) => (id === 'd1' ? 10 : 5),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      medico: 'García, Ana',
      porcentajeLabel: '5',
      cantidadPagos: 1,
      efectivo: 5000,
      totalCentroCuidar: 250,
      totalMedico: 4750,
    })
    expect(rows[1]).toMatchObject({
      medico: 'Paredes, Juan',
      porcentajeLabel: '10',
      cantidadPagos: 2,
      transferencias: 20,
      efectivo: 180,
      totalCobrado: 200,
      totalMedico: 160,
      totalCentroCuidar: 20,
    })
    expect(rows[1]!.totalMedico + rows[1]!.totalCentroCuidar).toBe(rows[1]!.efectivo)
  })
})
