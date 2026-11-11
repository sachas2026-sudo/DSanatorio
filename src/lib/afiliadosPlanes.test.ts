import { describe, it, expect } from 'vitest'
import { parseAppDataRecord } from './parseAppData'
import type { PlanAfiliado, Afiliado, Patient } from '../types'

describe('Afiliados: Planes y Familias (modelo y persistencia)', () => {
  it('parseAppDataRecord normaliza planes individuales y familiares correctamente', () => {
    const rawData = {
      patients: [],
      doctors: [],
      horarios: [],
      diasLibres: [],
      atencionesMensuales: [],
      appointments: [],
      payments: [],
      atencionesSinTurno: [],
      pagosCancelados: [],
      planesAfiliados: [
        {
          id: 'plan-1',
          nombre: 'Plan Básico',
          precio: 15000,
          descripcion: 'Plan básico individual',
          activo: true,
          cupoConsultas: 2,
        },
        {
          id: 'plan-2',
          nombre: 'Plan Familiar Premium',
          tipo: 'familiar',
          precio: 35000,
          descripcion: 'Plan para toda la familia',
          activo: true,
          cupoConsultas: 4,
          prestacionesPorMes: 3,
          maxAdherentes: 4,
        },
      ],
      afiliados: [
        {
          id: 'afil-1',
          patientId: 'pac-1',
          planId: 'plan-2',
          fechaInicio: '2026-11-01',
          activo: true,
          obraSocialAnterior: 'OSDE',
          adherentes: [
            {
              patientId: 'pac-2',
              relacion: 'Cónyuge',
              obraSocialAnterior: 'Swiss Medical',
            },
            {
              patientId: 'pac-3',
              relacion: 'Hijo/a',
            },
          ],
        },
      ],
      cuotasAfiliados: [],
      settings: {},
    }

    const data = parseAppDataRecord(rawData)

    // Plan 1: migrado hacia atrás como individual con defaults
    expect(data.planesAfiliados[0]).toEqual({
      id: 'plan-1',
      nombre: 'Plan Básico',
      precio: 15000,
      descripcion: 'Plan básico individual',
      activo: true,
      tipo: 'individual',
      cupoConsultas: 2,
      prestacionesPorMes: 0,
      maxAdherentes: 0,
    })

    // Plan 2: familiar con prestaciones y adherentes
    expect(data.planesAfiliados[1]).toEqual({
      id: 'plan-2',
      nombre: 'Plan Familiar Premium',
      precio: 35000,
      descripcion: 'Plan para toda la familia',
      activo: true,
      tipo: 'familiar',
      cupoConsultas: 4,
      prestacionesPorMes: 3,
      maxAdherentes: 4,
    })

    // Afiliación: titular con adherentes
    expect(data.afiliados[0]?.id).toBe('afil-1')
    expect(data.afiliados[0]?.obraSocialAnterior).toBe('OSDE')
    expect(data.afiliados[0]?.adherentes).toHaveLength(2)
    expect(data.afiliados[0]?.adherentes?.[0]).toEqual({
      patientId: 'pac-2',
      relacion: 'Cónyuge',
      obraSocialAnterior: 'Swiss Medical',
    })
    expect(data.afiliados[0]?.adherentes?.[1]).toEqual({
      patientId: 'pac-3',
      relacion: 'Hijo/a',
    })
  })

  it('preserva obraSocialAnterior en pacientes al parsear', () => {
    const rawData = {
      patients: [
        {
          id: 'p1',
          nombre: 'Juan',
          apellido: 'Perez',
          dni: '12345678',
          fechaNacimiento: '1985-05-10',
          obraSocial: 'Plan Familiar',
          obraSocialAnterior: 'IOMA',
        },
      ],
      doctors: [],
      horarios: [],
      diasLibres: [],
      atencionesMensuales: [],
      appointments: [],
      payments: [],
      atencionesSinTurno: [],
      pagosCancelados: [],
      planesAfiliados: [],
      afiliados: [],
      cuotasAfiliados: [],
      settings: {},
    }

    const data = parseAppDataRecord(rawData)
    expect(data.patients[0]?.obraSocial).toBe('Plan Familiar')
    expect(data.patients[0]?.obraSocialAnterior).toBe('IOMA')
  })

  it('lógica de sincronización: titular y adherentes reciben la obra social del plan y guardan la previa', () => {
    const titular: Patient = {
      id: 'p-tit',
      nombre: 'Carlos',
      apellido: 'Gomez',
      dni: '11111111',
      telefono: '',
      email: '',
      domicilio: '',
      localidad: '',
      fechaNacimiento: '1980-01-01',
      obraSocial: 'OSDE',
      notas: '',
      activo: true,
    }

    const adherenteExistente: Patient = {
      id: 'p-adh',
      nombre: 'Maria',
      apellido: 'Gomez',
      dni: '22222222',
      telefono: '',
      email: '',
      domicilio: '',
      localidad: '',
      fechaNacimiento: '1982-02-02',
      obraSocial: 'Swiss Medical',
      notas: '',
      activo: true,
    }

    const planNombre = 'Plan Familiar Oro'

    // Simulación de afiliarConSincronizacion
    const titularPrevOs = titular.obraSocial
    const adhPrevOs = adherenteExistente.obraSocial

    const titularActualizado: Patient = {
      ...titular,
      obraSocial: planNombre,
      obraSocialAnterior: titularPrevOs,
    }

    const adhActualizado: Patient = {
      ...adherenteExistente,
      obraSocial: planNombre,
      obraSocialAnterior: adhPrevOs,
    }

    const nuevoAdherente: Patient = {
      id: 'p-hijo',
      nombre: 'Lucas',
      apellido: 'Gomez',
      dni: '33333333',
      telefono: '',
      email: '',
      domicilio: '',
      localidad: '',
      fechaNacimiento: '2015-03-03',
      obraSocial: planNombre,
      obraSocialAnterior: '',
      notas: '',
      activo: true,
    }

    const afiliado: Afiliado = {
      id: 'afil-1',
      patientId: titular.id,
      planId: 'plan-1',
      fechaInicio: '2026-11-09',
      activo: true,
      obraSocialAnterior: titularPrevOs,
      adherentes: [
        {
          patientId: adherenteExistente.id,
          relacion: 'Cónyuge',
          obraSocialAnterior: adhPrevOs,
        },
        {
          patientId: nuevoAdherente.id,
          relacion: 'Hijo/a',
          obraSocialAnterior: '',
        },
      ],
    }

    // Todos tienen obraSocial = nombre del plan
    expect(titularActualizado.obraSocial).toBe('Plan Familiar Oro')
    expect(adhActualizado.obraSocial).toBe('Plan Familiar Oro')
    expect(nuevoAdherente.obraSocial).toBe('Plan Familiar Oro')

    // Al restaurar por baja de afiliación:
    const restoreMap = new Map<string, string>()
    restoreMap.set(afiliado.patientId, afiliado.obraSocialAnterior ?? '')
    afiliado.adherentes?.forEach(a => restoreMap.set(a.patientId, a.obraSocialAnterior ?? ''))

    const titularRestaurado = { ...titularActualizado, obraSocial: restoreMap.get(titularActualizado.id) ?? '' }
    const adhRestaurado = { ...adhActualizado, obraSocial: restoreMap.get(adhActualizado.id) ?? '' }
    const hijoRestaurado = { ...nuevoAdherente, obraSocial: restoreMap.get(nuevoAdherente.id) ?? '' }

    expect(titularRestaurado.obraSocial).toBe('OSDE')
    expect(adhRestaurado.obraSocial).toBe('Swiss Medical')
    expect(hijoRestaurado.obraSocial).toBe('')
  })
})
