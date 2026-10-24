import { describe, expect, it, vi } from 'vitest'
import {
  ATENCION_SIN_TURNO_NOTAS,
  mergeAtencionSinTurnoStorage,
} from './atencionSinTurno'
import { parseAtencionSinTurnoListado } from './parseAppData'
import type { AtencionSinTurnoListado, Payment } from '../types'

vi.mock('./id', () => ({
  createId: vi.fn(() => 'new-listado-id'),
}))

function astPayment(
  overrides: Partial<Payment> & Pick<Payment, 'doctorId' | 'patientId'>,
): Payment {
  return {
    id: overrides.id ?? 'pay-1',
    patientId: overrides.patientId,
    doctorId: overrides.doctorId,
    citaId: null,
    monto: overrides.monto ?? 100,
    fecha: overrides.fecha ?? '2026-06-02T12:00:00.000Z',
    metodo: 'Efectivo',
    notas: ATENCION_SIN_TURNO_NOTAS,
  }
}

const existingListado: AtencionSinTurnoListado = {
  id: 'lst-1',
  doctorId: 'doc-a',
  fecha: '2026-06-02',
  filas: [{ patientId: 'pat-1', monto: 500 }],
  guardadoEn: '2026-06-02T10:00:00.000Z',
}

describe('mergeAtencionSinTurnoStorage', () => {
  it('migra pagos legacy cuando no hay listados', () => {
    const payments = [
      astPayment({ id: 'p1', doctorId: 'doc-a', patientId: 'pat-1', monto: 200 }),
      astPayment({
        id: 'p2',
        doctorId: 'doc-a',
        patientId: 'pat-2',
        monto: 300,
        fecha: '2026-06-02T15:00:00.000Z',
      }),
    ]

    const { listados, payments: rest } = mergeAtencionSinTurnoStorage([], payments)

    expect(rest).toHaveLength(0)
    expect(listados).toHaveLength(1)
    expect(listados[0]).toMatchObject({
      doctorId: 'doc-a',
      fecha: '2026-06-02',
      filas: [
        { patientId: 'pat-1', monto: 200 },
        { patientId: 'pat-2', monto: 300 },
      ],
    })
  })

  it('elimina pagos legacy ya cubiertos por listados existentes', () => {
    const payments = [
      astPayment({ doctorId: 'doc-a', patientId: 'pat-9', monto: 999 }),
      { id: 'normal', patientId: 'pat-x', doctorId: 'doc-a', citaId: 'c1', monto: 50, fecha: '2026-06-02T12:00:00.000Z', metodo: 'Efectivo', notas: '' },
    ]

    const { listados, payments: rest } = mergeAtencionSinTurnoStorage(
      [existingListado],
      payments,
    )

    expect(listados).toEqual([existingListado])
    expect(rest).toHaveLength(1)
    expect(rest[0]?.id).toBe('normal')
  })

  it('migra pagos legacy huérfanos aunque ya existan otros listados', () => {
    const payments = [
      astPayment({
        id: 'legacy-b',
        doctorId: 'doc-b',
        patientId: 'pat-3',
        monto: 150,
        fecha: '2026-06-03T09:00:00.000Z',
      }),
      astPayment({ doctorId: 'doc-a', patientId: 'pat-9', monto: 999 }),
    ]

    const { listados, payments: rest } = mergeAtencionSinTurnoStorage(
      [existingListado],
      payments,
    )

    expect(rest).toHaveLength(0)
    expect(listados).toHaveLength(2)
    expect(listados[1]).toMatchObject({
      id: 'new-listado-id',
      doctorId: 'doc-b',
      fecha: '2026-06-03',
      filas: [{ patientId: 'pat-3', monto: 150 }],
    })
  })

  it('no altera pagos normales', () => {
    const normal: Payment = {
      id: 'pay-normal',
      patientId: 'pat-1',
      doctorId: 'doc-a',
      citaId: 'cita-1',
      monto: 800,
      fecha: '2026-06-02T12:00:00.000Z',
      metodo: 'Efectivo',
      notas: '',
    }

    const { listados, payments } = mergeAtencionSinTurnoStorage(
      [existingListado],
      [normal],
    )

    expect(listados).toEqual([existingListado])
    expect(payments).toEqual([normal])
  })
})

describe('parseAtencionSinTurnoListado', () => {
  it('parsea un listado válido', () => {
    expect(
      parseAtencionSinTurnoListado({
        id: 'lst-1',
        doctorId: 'doc-a',
        fecha: '2026-06-02',
        filas: [{ patientId: 'pat-1', monto: 100 }],
        guardadoEn: '2026-06-02T10:00:00.000Z',
      }),
    ).toMatchObject({
      id: 'lst-1',
      doctorId: 'doc-a',
      fecha: '2026-06-02',
      filas: [{ patientId: 'pat-1', monto: 100 }],
    })
  })

  it('rechaza listados sin filas o con fecha inválida', () => {
    expect(
      parseAtencionSinTurnoListado({
        id: 'lst-1',
        doctorId: 'doc-a',
        fecha: '2026-06-02',
        filas: [],
      }),
    ).toBeNull()
    expect(
      parseAtencionSinTurnoListado({
        id: 'lst-1',
        doctorId: 'doc-a',
        fecha: '02-06-2026',
        filas: [{ patientId: 'pat-1', monto: 0 }],
      }),
    ).toBeNull()
  })
})
