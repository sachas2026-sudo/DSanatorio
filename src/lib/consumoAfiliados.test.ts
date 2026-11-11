import { describe, it, expect } from 'vitest'
import {
  tipoDeMotivo,
  analizarAtencionTurno,
  calcularConsumoAfiliadoMes,
  validarCupoPlanParaTurno,
  buscarAfiliacionYPlanPaciente,
} from './consumoAfiliados'
import type { Appointment, PlanAfiliado, Afiliado, OrdenMedica } from '../types'

describe('consumoAfiliados - clasificación de motivos', () => {
  it('clasifica Consulta y Control como consulta', () => {
    expect(tipoDeMotivo('Consulta')).toBe('consulta')
    expect(tipoDeMotivo('Control')).toBe('consulta')
    expect(tipoDeMotivo('consulta médica')).toBe('consulta')
    expect(tipoDeMotivo('Certificado Médico')).toBe('consulta')
  })

  it('clasifica prácticas médicas como prestacion', () => {
    expect(tipoDeMotivo('Laboratorio')).toBe('prestacion')
    expect(tipoDeMotivo('Ecografía')).toBe('prestacion')
    expect(tipoDeMotivo('Radiografía')).toBe('prestacion')
    expect(tipoDeMotivo('Kinesiología')).toBe('prestacion')
    expect(tipoDeMotivo('Electrocardiograma')).toBe('prestacion')
  })

  it('analiza turnos con dos motivos: motivo 1 resta consulta, motivo 2 resta prestacion', () => {
    expect(analizarAtencionTurno('Consulta', '')).toEqual({
      esConsulta: true,
      esPrestacion: false,
    })
    expect(analizarAtencionTurno('Consulta', 'Sin motivo 2')).toEqual({
      esConsulta: true,
      esPrestacion: false,
    })
    expect(analizarAtencionTurno('Consulta', 'Ecografía')).toEqual({
      esConsulta: true,
      esPrestacion: true,
    })
    expect(analizarAtencionTurno('Consulta', 'Radiografía')).toEqual({
      esConsulta: true,
      esPrestacion: true,
    })
  })
})

describe('consumoAfiliados - cálculo de consumo por mes', () => {
  const planFamiliar: PlanAfiliado = {
    id: 'plan-fam-1',
    nombre: 'Plan Familiar',
    precio: 35000,
    activo: true,
    tipo: 'familiar',
    cupoConsultas: 2,
    prestacionesPorMes: 2,
    maxAdherentes: 3,
  }

  const afiliados: Afiliado[] = [
    {
      id: 'afil-1',
      patientId: 'pac-titular',
      planId: 'plan-fam-1',
      fechaInicio: '2026-01-01',
      activo: true,
      adherentes: [
        { id: 'adh-1', patientId: 'pac-hijo', relacion: 'Hijo/a' },
        { id: 'adh-2', patientId: 'pac-conyuge', relacion: 'Cónyuge' },
      ],
    },
  ]

  it('detecta cobertura activa de titular y adherente', () => {
    const tit = buscarAfiliacionYPlanPaciente('pac-titular', afiliados, [planFamiliar])
    expect(tit).not.toBeNull()
    expect(tit?.esAdherente).toBe(false)
    expect(tit?.plan.nombre).toBe('Plan Familiar')

    const adh = buscarAfiliacionYPlanPaciente('pac-hijo', afiliados, [planFamiliar])
    expect(adh).not.toBeNull()
    expect(adh?.esAdherente).toBe(true)
    expect(adh?.plan.nombre).toBe('Plan Familiar')
  })

  it('cuenta consultas y prestaciones del mes para cada integrante por separado', () => {
    const turnosNoviembre: Appointment[] = [
      // Titular: 1 consulta en Noviembre
      {
        id: 't1',
        patientId: 'pac-titular',
        doctorId: 'd1',
        fechaHora: '2026-11-04T10:00:00.000Z',
        duracionMinutos: 20,
        estado: 'programado',
        notas: 'Consulta',
        obraSocialOverride: 'Plan Familiar',
      },
      // Hijo: 2 consultas y 1 prestación en Noviembre (t2 es consulta, t3 es consulta + prestación)
      {
        id: 't2',
        patientId: 'pac-hijo',
        doctorId: 'd1',
        fechaHora: '2026-11-05T10:00:00.000Z',
        duracionMinutos: 20,
        estado: 'atendido',
        notas: 'Consulta',
        obraSocialOverride: 'Plan Familiar',
      },
      {
        id: 't3',
        patientId: 'pac-hijo',
        doctorId: 'd2',
        fechaHora: '2026-11-08T11:00:00.000Z',
        duracionMinutos: 20,
        estado: 'programado',
        notas: 'Consulta',
        motivoConsulta2: 'Ecografía',
        obraSocialOverride: 'Plan Familiar',
      },
      // Turno cancelado no debe restar cupo
      {
        id: 't5',
        patientId: 'pac-titular',
        doctorId: 'd1',
        fechaHora: '2026-11-06T10:00:00.000Z',
        duracionMinutos: 20,
        estado: 'cancelado',
        notas: 'Consulta',
        obraSocialOverride: 'Plan Familiar',
      },
      // Turno en Diciembre (otro mes, no cuenta para Noviembre)
      {
        id: 't6',
        patientId: 'pac-hijo',
        doctorId: 'd1',
        fechaHora: '2026-12-02T10:00:00.000Z',
        duracionMinutos: 20,
        estado: 'programado',
        notas: 'Consulta',
        obraSocialOverride: 'Plan Familiar',
      },
    ]

    // Consumo del titular en Noviembre: 1 consulta usada, 1 restante, 2 prestaciones restantes
    const consumoTitular = calcularConsumoAfiliadoMes({
      patientId: 'pac-titular',
      anio: 2026,
      mes: 11,
      plan: planFamiliar,
      appointments: turnosNoviembre,
    })
    expect(consumoTitular.consultasUsadas).toBe(1)
    expect(consumoTitular.consultasRestantes).toBe(1)
    expect(consumoTitular.consultasAgotadas).toBe(false)
    expect(consumoTitular.prestacionesUsadas).toBe(0)
    expect(consumoTitular.prestacionesRestantes).toBe(2)

    // Consumo del hijo en Noviembre: 2 consultas usadas (agotado), 1 prestacion usada (1 restante)
    const consumoHijo = calcularConsumoAfiliadoMes({
      patientId: 'pac-hijo',
      anio: 2026,
      mes: 11,
      plan: planFamiliar,
      appointments: turnosNoviembre,
    })
    expect(consumoHijo.consultasUsadas).toBe(2)
    expect(consumoHijo.consultasRestantes).toBe(0)
    expect(consumoHijo.consultasAgotadas).toBe(true)
    expect(consumoHijo.prestacionesUsadas).toBe(1)
    expect(consumoHijo.prestacionesRestantes).toBe(1)
    expect(consumoHijo.prestacionesAgotadas).toBe(false)

    // Validar bloqueo para el hijo si intenta sacar otra consulta en Noviembre
    const checkConsulta = validarCupoPlanParaTurno(consumoHijo, 'Consulta')
    expect(checkConsulta.permitido).toBe(false)
    expect(checkConsulta.motivoBloqueo).toContain('Alcanzó el tope mensual de 2 consultas')

    // Pero si saca una prestación, todavía tiene cupo:
    const checkPrestacion = validarCupoPlanParaTurno(consumoHijo, 'Ecografía')
    expect(checkPrestacion.permitido).toBe(true)

    // Y al nuevo mes (Diciembre 2026), el tope se reinicia para el hijo:
    const consumoHijoDiciembre = calcularConsumoAfiliadoMes({
      patientId: 'pac-hijo',
      anio: 2026,
      mes: 12,
      plan: planFamiliar,
      appointments: turnosNoviembre,
    })
    expect(consumoHijoDiciembre.consultasUsadas).toBe(1) // t6
    expect(consumoHijoDiciembre.consultasRestantes).toBe(1)
    expect(consumoHijoDiciembre.consultasAgotadas).toBe(false)
  })

  it('cuenta las órdenes médicas emitidas en el mes y calcula sus topes correctamente', () => {
    const planIndividual: PlanAfiliado = {
      id: 'plan-ind',
      nombre: 'Plan Individual',
      tipo: 'individual',
      precio: 50000,
      descripcion: '',
      activo: true,
      cupoConsultas: 2,
      prestacionesPorMes: 2,
      maxAdherentes: 0,
    }

    const ordenes: OrdenMedica[] = [
      {
        id: 'om-1',
        numero: 'OM-0001',
        patientId: 'pac-1',
        afiliadoId: 'af-1',
        planNombre: 'Plan Individual',
        tipo: 'consulta',
        fecha: '2026-11-09',
        creadaEn: '2026-11-09T10:00:00.000Z',
      },
      {
        id: 'om-2',
        numero: 'OM-0002',
        patientId: 'pac-1',
        afiliadoId: 'af-1',
        planNombre: 'Plan Individual',
        tipo: 'prestacion',
        prestacionNombre: 'Electrocardiograma',
        fecha: '2026-11-09',
        creadaEn: '2026-11-09T11:00:00.000Z',
      },
      {
        id: 'om-3',
        numero: 'OM-0003',
        patientId: 'pac-1',
        afiliadoId: 'af-1',
        planNombre: 'Plan Individual',
        tipo: 'prestacion',
        prestacionNombre: 'Radiografía de tórax',
        fecha: '2026-11-09',
        creadaEn: '2026-11-09T12:00:00.000Z',
      },
      // Orden de otro mes que no debe contar en noviembre
      {
        id: 'om-4',
        numero: 'OM-0004',
        patientId: 'pac-1',
        afiliadoId: 'af-1',
        planNombre: 'Plan Individual',
        tipo: 'consulta',
        fecha: '2026-10-15',
        creadaEn: '2026-10-15T10:00:00.000Z',
      },
    ]

    const consumo = calcularConsumoAfiliadoMes({
      patientId: 'pac-1',
      anio: 2026,
      mes: 11,
      plan: planIndividual,
      appointments: [],
      ordenesMedicas: ordenes,
    })

    expect(consumo.consultasUsadas).toBe(1)
    expect(consumo.consultasCupo).toBe(2)
    expect(consumo.consultasRestantes).toBe(1)
    expect(consumo.consultasAgotadas).toBe(false)

    expect(consumo.prestacionesUsadas).toBe(2)
    expect(consumo.prestacionesCupo).toBe(2)
    expect(consumo.prestacionesRestantes).toBe(0)
    expect(consumo.prestacionesAgotadas).toBe(true)
  })
})
