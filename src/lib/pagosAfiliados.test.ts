import { describe, expect, it } from 'vitest'
import type { Afiliado, CuotaMensual, Patient, PlanAfiliado } from '../types'
import {
  construirCobroLocal,
  listarPagosAfiliados,
  mesesDeudaAfiliado,
} from './pagosAfiliados'

const HOY = new Date('2026-03-15T12:00:00')

const plan: PlanAfiliado = {
  id: 'plan-1',
  nombre: 'Familiar',
  precio: 1000,
  descripcion: '',
  activo: true,
  cupoConsultas: 0,
}

function paciente(id: string, apellido: string, nombre: string, dni: string): Patient {
  return {
    id,
    apellido,
    nombre,
    dni,
    telefono: '',
    email: '',
    domicilio: '',
    localidad: '',
    fechaNacimiento: '1990-01-01',
    obraSocial: '',
    notas: '',
    activo: true,
  }
}

const ana = paciente('pac-1', 'Pérez', 'Ana', '12345678')
const bruno = paciente('pac-2', 'Gómez', 'Bruno', '87654321')

function afiliado(id: string, patientId: string, fechaInicio: string): Afiliado {
  return { id, patientId, planId: plan.id, fechaInicio, activo: true }
}

function cuota(params: Partial<CuotaMensual> & Pick<CuotaMensual, 'id' | 'afiliadoId' | 'anio' | 'mes'>): CuotaMensual {
  return {
    monto: 1000,
    estado: 'pendiente',
    fechaPago: null,
    formaPago: null,
    comprobante: false,
    notas: '',
    usos: 0,
    ...params,
  }
}

describe('pagos de afiliados · deuda', () => {
  it('calcula todos los meses impagos desde fechaInicio y usa el precio del plan si falta la cuota', () => {
    const afil = afiliado('afil-1', ana.id, '2026-01-01')
    const cuotas = [
      cuota({ id: 'c1', afiliadoId: afil.id, anio: 2026, mes: 1, monto: 900, estado: 'pagado' }),
      cuota({ id: 'c3', afiliadoId: afil.id, anio: 2026, mes: 3, monto: 1100 }),
    ]

    const pendientes = mesesDeudaAfiliado({ afiliado: afil, plan, cuotas, hoy: HOY })
    expect(pendientes).toEqual([
      { anio: 2026, mes: 2, monto: 1000, cuotaId: undefined },
      { anio: 2026, mes: 3, monto: 1100, cuotaId: 'c3' },
    ])
  })

  it('no genera deuda si la fecha de inicio es futura', () => {
    const afil = afiliado('afil-1', ana.id, '2026-04-01')
    expect(mesesDeudaAfiliado({ afiliado: afil, plan, cuotas: [], hoy: HOY })).toEqual([])
  })

  it('muestra cuotas futuras sólo cuando ya fueron creadas como pendientes', () => {
    const afil = afiliado('afil-1', ana.id, '2026-03-01')
    const cuotas = [
      cuota({ id: 'c12', afiliadoId: afil.id, anio: 2026, mes: 12, monto: 900 }),
    ]

    const pendientes = mesesDeudaAfiliado({ afiliado: afil, plan, cuotas, hoy: HOY })
    expect(pendientes.map(({ anio, mes }) => [anio, mes])).toEqual([
      [2026, 3], [2026, 12],
    ])
  })

  it('considera deudores a suspendidos y dados de baja, sin pedir motivo ni estado', () => {
    const afil: Afiliado = {
      ...afiliado('afil-1', ana.id, '2026-01-01'),
      suspension: { activa: true, desde: '2026-02-01', motivo: 'No pagó' },
      baja: { activa: true, fecha: '2026-02-15', motivo: 'Baja' },
    }

    const resultado = listarPagosAfiliados({
      afiliados: [afil],
      planes: [plan],
      cuotas: [],
      patients: [ana],
      hoy: HOY,
    })

    expect(resultado.cantidad).toBe(1)
    expect(resultado.deudores[0]?.nombre).toBe('Pérez, Ana')
    expect(resultado.totalAdeudado).toBe(3000)
  })
})

describe('pagos de afiliados · listado y búsqueda', () => {
  it('lista sólo deudores, ordenados por mayor deuda', () => {
    const afil1 = afiliado('afil-1', ana.id, '2026-01-01')
    const afil2 = afiliado('afil-2', bruno.id, '2026-03-01')
    const cuotas = [
      cuota({ id: 'c2', afiliadoId: afil2.id, anio: 2026, mes: 3, monto: 500 }),
      cuota({ id: 'c1', afiliadoId: afil1.id, anio: 2026, mes: 1, monto: 100, estado: 'pagado' }),
    ]

    const resultado = listarPagosAfiliados({
      afiliados: [afil2, afil1],
      planes: [plan],
      cuotas,
      patients: [ana, bruno],
      hoy: HOY,
    })

    expect(resultado.deudores.map((d) => d.afiliadoId)).toEqual(['afil-1', 'afil-2'])
    expect(resultado.totalAdeudado).toBe(2500)
    // afil-1: enero pago + febrero faltante + marzo faltante = 2000.
    // afil-2: marzo con cuota de 500 = 500.
    expect(resultado.deudores[0]?.adeudado).toBe(2000)
    expect(resultado.deudores[1]?.adeudado).toBe(500)
  })

  it('busca sin distinguir tildes y devuelve "Sin deuda" para un contratante al día', () => {
    const afil1 = afiliado('afil-1', ana.id, '2026-01-01')
    const afil2 = afiliado('afil-2', bruno.id, '2026-03-01')
    const cuotas = [
      cuota({ id: 'c2', afiliadoId: afil2.id, anio: 2026, mes: 3, estado: 'pagado' }),
    ]

    const porNombre = listarPagosAfiliados({
      afiliados: [afil1, afil2],
      planes: [plan],
      cuotas,
      patients: [ana, bruno],
      q: 'perez',
      hoy: HOY,
    })
    expect(porNombre.cantidad).toBe(1)
    expect(porNombre.deudores[0]?.dni).toBe('12345678')

    const porDni = listarPagosAfiliados({
      afiliados: [afil1, afil2],
      planes: [plan],
      cuotas,
      patients: [ana, bruno],
      q: '87654321',
      hoy: HOY,
    })
    expect(porDni.cantidad).toBe(0)
    expect(porDni.sinDeuda).toBe(true)
  })

  it('la deuda es la del titular y no crea filas para adherentes', () => {
    const afil: Afiliado = {
      ...afiliado('afil-1', ana.id, '2026-03-01'),
      adherentes: [{ patientId: bruno.id, relacion: 'Hijo/a' }],
    }
    const cuotas = [
      cuota({ id: 'c1', afiliadoId: afil.id, anio: 2026, mes: 3, estado: 'pagado' }),
    ]

    const resultado = listarPagosAfiliados({
      afiliados: [afil],
      planes: [plan],
      cuotas,
      patients: [ana, bruno],
      hoy: HOY,
    })

    expect(resultado.cantidad).toBe(0)
  })
})

describe('pagos de afiliados · cobro local', () => {
  it('marca pagadas las cuotas elegidas y conserva montos existentes', () => {
    const afil = afiliado('afil-1', ana.id, '2026-01-01')
    const cuotas = [
      cuota({ id: 'c1', afiliadoId: afil.id, anio: 2026, mes: 1, estado: 'pagado' }),
      cuota({ id: 'c3', afiliadoId: afil.id, anio: 2026, mes: 3, monto: 1100, usos: 2, notas: 'nota' }),
    ]

    const resultado = construirCobroLocal({
      afiliadoId: afil.id,
      precioPlan: plan.precio,
      cuotas,
      seleccion: [
        { anio: 2026, mes: 2 },
        { anio: 2026, mes: 3 },
        { anio: 2026, mes: 2 },
      ],
      formaPago: 'efectivo',
      cobradoPor: 'Mary',
      ahora: HOY,
    })

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.cuotas).toHaveLength(2)

    const febrero = resultado.cuotas.find((c) => c.mes === 2)!
    expect(febrero.monto).toBe(1000)
    expect(febrero.id.length).toBeGreaterThan(0)
    expect(febrero.estado).toBe('pagado')
    expect(febrero.fechaPago).toBe('2026-03-15')
    expect(febrero.formaPago).toBe('efectivo')
    expect(febrero.comprobante).toBe(true)
    expect(febrero.cobradoPor).toBe('Mary')
    expect(febrero.registradoEn).toBe(HOY.toISOString())

    const marzo = resultado.cuotas.find((c) => c.mes === 3)!
    expect(marzo.id).toBe('c3')
    expect(marzo.monto).toBe(1100)
    expect(marzo.usos).toBe(2)
    expect(marzo.notas).toBe('nota')
  })

  it('rechaza todo el cobro si una cuota ya estaba paga', () => {
    const afil = afiliado('afil-1', ana.id, '2026-01-01')
    const cuotas = [
      cuota({ id: 'c1', afiliadoId: afil.id, anio: 2026, mes: 1, estado: 'pagado' }),
    ]

    const resultado = construirCobroLocal({
      afiliadoId: afil.id,
      precioPlan: plan.precio,
      cuotas,
      seleccion: [
        { anio: 2026, mes: 1 },
        { anio: 2026, mes: 2 },
      ],
      formaPago: 'debito',
      cobradoPor: 'Mary',
      ahora: HOY,
    })

    expect(resultado).toEqual({ ok: false, error: 'cuota_ya_pagada', anio: 2026, mes: 1 })
  })

  it('no permite registrar sin selección', () => {
    const resultado = construirCobroLocal({
      afiliadoId: 'afil-1',
      precioPlan: 1000,
      cuotas: [],
      seleccion: [],
      formaPago: 'efectivo',
      cobradoPor: 'Mary',
      ahora: HOY,
    })
    expect(resultado).toEqual({ ok: false, error: 'sin_seleccion' })
  })
})
