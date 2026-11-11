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
  resolveDoctorPaymentSettlement,
  resolvePaymentPorcentaje,
  sumPagosNetTotalByDoctor,
  sumPagosEfectivoEntregarByDoctor,
  buildPaymentsSettlementMap,
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

  it('resolveDoctorPaymentSettlement aplica monto Cuidar en pagos particulares', () => {
    const doc = {
      id: 'd1',
      apellido: 'Alfonso',
      nombre: 'Carmen',
      porcentaje: 0,
      valor: 0,
      particular: 40000,
      cuidar: 10000,
    }
    const payment = pay({ id: 'p1', doctorId: 'd1', monto: 40000, obraSocialOverride: 'Particular' })
    const s = resolveDoctorPaymentSettlement(payment, doc as any, 'Particular')

    expect(s.totalPorcentaje).toBe(10000)
    expect(s.totalGeneral).toBe(30000)
    expect(s.porcentaje).toBe(0)
    expect(s.esMontoFijo).toBe(true)
  })

  it('aggregatePorcentajeSettlementForPayments no genera % ficticio cuando Cuidar es monto fijo', () => {
    const doc = {
      id: 'd1',
      apellido: 'Alfonso',
      nombre: 'Carmen',
      porcentaje: 0,
      particular: 40000,
      cuidar: 10000,
    }
    const payments = [
      pay({ id: 'p1', doctorId: 'd1', monto: 40000, obraSocialOverride: 'Particular' }),
      pay({ id: 'p2', doctorId: 'd1', monto: 40000, obraSocialOverride: 'Particular' }),
    ]
    const agg = aggregatePorcentajeSettlementForPayments(payments, undefined, () => doc as any)
    expect(agg.totalPorcentaje).toBe(20000)
    expect(agg.totalGeneral).toBe(60000)
    expect(agg.porcentaje).toBe(0)
    expect(agg.porcentajeLabel).toBe('')
    expect(agg.esMontoFijo).toBe(true)
  })

  it('resolveDoctorPaymentSettlement aplica porcentaje especifico de obra social', () => {
    const doc = {
      id: 'd1',
      apellido: 'Alfonso',
      nombre: 'Carmen',
      porcentaje: 0,
      obrasSociales: [{ nombre: 'PREVENCION SALUD', porcentaje: 30, monto: 0 }],
    }
    const payment = pay({ id: 'p1', doctorId: 'd1', monto: 50000, obraSocialOverride: 'PREVENCION SALUD' })
    const s = resolveDoctorPaymentSettlement(payment, doc as any, 'PREVENCION SALUD')

    expect(s.totalPorcentaje).toBe(15000)
    expect(s.totalGeneral).toBe(35000)
    expect(s.porcentaje).toBe(30)
  })

  it('sumPagosNetTotalByDoctor suma correctamente con resolver de médico', () => {
    const doc = {
      id: 'd1',
      apellido: 'Alfonso',
      nombre: 'Carmen',
      cuidar: 10000,
      particular: 40000,
    }
    const payments = [
      pay({ id: '1', doctorId: 'd1', monto: 40000, obraSocialOverride: 'Particular' }),
      pay({ id: '2', doctorId: 'd1', monto: 40000, obraSocialOverride: 'Particular' }),
    ]
    const net = sumPagosNetTotalByDoctor(payments, () => doc as any)
    expect(net).toBe(60000)
  })

  it('doctor con valor > 0 descuenta valor fijo para Cuidar por día de atención', () => {
    const docAyala = {
      id: 'd-ayala',
      apellido: 'AYALA',
      nombre: 'MARCELA ALEJANDRA',
      porcentaje: 0,
      cuidar: 0,
      particular: 70000,
      valor: 70000,
    }
    const payments = [
      pay({ id: 'p1', doctorId: 'd-ayala', monto: 70000, fecha: '2026-11-05T08:00:00' }),
      pay({ id: 'p2', doctorId: 'd-ayala', monto: 70000, fecha: '2026-11-05T08:30:00' }),
      pay({ id: 'p3', doctorId: 'd-ayala', monto: 70000, fecha: '2026-11-05T09:30:00' }),
    ]

    const agg = aggregatePorcentajeSettlementForPayments(payments, undefined, () => docAyala as any)
    // Total Facturado = 210.000, Cuidar = 70.000 (1 día x 70.000), Médico = 140.000
    expect(payments.reduce((s, p) => s + p.monto, 0)).toBe(210000)
    expect(agg.totalPorcentaje).toBe(70000)
    expect(agg.totalGeneral).toBe(140000)

    const map = buildPaymentsSettlementMap(payments, () => docAyala as any)
    expect(map.get('p1')).toEqual({
      porcentaje: 0,
      totalPorcentaje: 70000,
      totalGeneral: 0,
      esMontoFijo: true,
    })
    expect(map.get('p2')).toEqual({
      porcentaje: 0,
      totalPorcentaje: 0,
      totalGeneral: 70000,
      esMontoFijo: true,
    })
    expect(map.get('p3')).toEqual({
      porcentaje: 0,
      totalPorcentaje: 0,
      totalGeneral: 70000,
      esMontoFijo: true,
    })

    const net = sumPagosNetTotalByDoctor(payments, () => docAyala as any)
    expect(net).toBe(140000)

    const efectivoEntregar = sumPagosEfectivoEntregarByDoctor(payments, () => docAyala as any)
    expect(efectivoEntregar).toBe(140000)
  })

  it('doctor con valor > 0 descuenta valor fijo por cada día distinto que atiende', () => {
    const docAyala = {
      id: 'd-ayala',
      apellido: 'AYALA',
      nombre: 'MARCELA ALEJANDRA',
      porcentaje: 0,
      cuidar: 0,
      particular: 70000,
      valor: 70000,
    }
    const payments = [
      pay({ id: 'p1', doctorId: 'd-ayala', monto: 70000, fecha: '2026-11-05T08:00:00' }),
      pay({ id: 'p2', doctorId: 'd-ayala', monto: 70000, fecha: '2026-11-05T08:30:00' }),
      pay({ id: 'p3', doctorId: 'd-ayala', monto: 70000, fecha: '2026-11-06T10:00:00' }),
    ]

    const agg = aggregatePorcentajeSettlementForPayments(payments, undefined, () => docAyala as any)
    // 2 días distintos (05 y 06): Cuidar = 2 x 70.000 = 140.000, Médico = 210.000 - 140.000 = 70.000
    expect(payments.reduce((s, p) => s + p.monto, 0)).toBe(210000)
    expect(agg.totalPorcentaje).toBe(140000)
    expect(agg.totalGeneral).toBe(70000)

    const map = buildPaymentsSettlementMap(payments, () => docAyala as any)
    expect(map.get('p1')?.totalPorcentaje).toBe(70000)
    expect(map.get('p1')?.totalGeneral).toBe(0)
    expect(map.get('p2')?.totalPorcentaje).toBe(0)
    expect(map.get('p2')?.totalGeneral).toBe(70000)
    expect(map.get('p3')?.totalPorcentaje).toBe(70000)
    expect(map.get('p3')?.totalGeneral).toBe(0)
  })
})
