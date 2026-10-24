import { describe, expect, it } from 'vitest'
import type { AppData, Doctor, DoctorHorario } from '../types'
import { buildDefaultDoctorHorarios } from './doctorAgenda'
import { generateSlotsForDay, findProximoTurnoLibreDoctor, planDoctorDay } from './weekSlots'

const doctor: Doctor = {
  id: 'doc-ana',
  nombre: 'Ana',
  apellido: 'Benitez',
  dni: '',
  matricula: '',
  especialidad: '',
  telefono: '',
  localidad: '',
  email: '',
  duracionTurnoMinutos: 30,
  tipoAgenda: 'semanal',
  activo: true,
}

function baseData(horarios: DoctorHorario[]): AppData {
  return {
    patients: [],
    doctors: [doctor],
    horarios,
    diasLibres: [],
    atencionesMensuales: [],
    appointments: [],
    payments: [],
    pagosCancelados: [],
    especialidadesCustom: [],
    obrasSocialesCustom: [],
    localidadesCustom: [],
    settings: {
      email: '',
      emailGerente: '',
      telefonoGerente: '',
      clave: '',
      telefono: '',
      cuit: '',
    },
  }
}

describe('planDoctorDay con franjas personalizadas', () => {
  it('solo muestra cupos en la franja cargada (lun 12:30–13:30)', () => {
    const data = baseData([
      {
        id: 'h1',
        doctorId: 'doc-ana',
        diaSemana: 1,
        horaInicio: '12:30',
        horaFin: '13:30',
      },
    ])
    const lunes = new Date(2026, 5, 1)
    expect(lunes.getDay()).toBe(1)

    const plan = planDoctorDay('doc-ana', lunes, data)
    expect(plan.kind).toBe('slots')
    if (plan.kind === 'slots') {
      expect(plan.ranges).toEqual([[12 * 60 + 30, 13 * 60 + 30]])
    }

    const slots = generateSlotsForDay({
      date: lunes,
      doctorId: 'doc-ana',
      duracionMinutos: 30,
      data,
    })
    expect(slots.map((s) => s.hm)).toEqual(['12:30', '13:00'])
  })

  it('sin franjas usa horario general del sistema', () => {
    const data = baseData([])
    const lunes = new Date(2026, 5, 1)
    const plan = planDoctorDay('doc-ana', lunes, data)
    expect(plan.kind).toBe('slots')
    if (plan.kind === 'slots') {
      expect(plan.ranges.length).toBe(2)
    }
    const slots = generateSlotsForDay({
      date: lunes,
      doctorId: 'doc-ana',
      duracionMinutos: 30,
      data,
    })
    expect(slots.some((s) => s.hm === '08:00')).toBe(true)
    expect(slots.some((s) => s.hm === '15:00')).toBe(true)
    expect(slots.some((s) => s.hm === '12:30')).toBe(false)
  })

  it('ignora el bloque automático lun–vie y aplica franjas reales', () => {
    const auto = buildDefaultDoctorHorarios('doc-ana', (n) => `auto-${n}`)
    const data = baseData([
      ...auto,
      {
        id: 'h-medio',
        doctorId: 'doc-ana',
        diaSemana: 1,
        horaInicio: '12:30',
        horaFin: '13:30',
      },
    ])
    const lunes = new Date(2026, 5, 1)
    const slots = generateSlotsForDay({
      date: lunes,
      doctorId: 'doc-ana',
      duracionMinutos: 30,
      data,
    })
    expect(slots.some((s) => s.hm === '12:30')).toBe(true)
    expect(slots.some((s) => s.hm === '08:00')).toBe(true)
  })
})

describe('findProximoTurnoLibreDoctor', () => {
  it('propone el primer hueco libre del médico después del turno cancelado', () => {
    const data = baseData([
      {
        id: 'h-jue',
        doctorId: 'doc-ana',
        diaSemana: 4,
        horaInicio: '11:00',
        horaFin: '12:00',
      },
    ])
    data.appointments = [
      {
        id: 'c-cancel',
        patientId: 'p1',
        doctorId: 'doc-ana',
        fechaHora: new Date(2026, 5, 4, 11, 0, 0).toISOString(),
        duracionMinutos: 30,
        estado: 'cancelado',
        notas: '',
      },
    ]

    const proximo = findProximoTurnoLibreDoctor({
      doctorId: 'doc-ana',
      desde: new Date(2026, 5, 4, 11, 0, 0),
      data,
      excludeAppointmentId: 'c-cancel',
    })

    expect(proximo).not.toBeNull()
    expect(proximo!.hora).toBe('11:00')
    expect(proximo!.fecha.getFullYear()).toBe(2026)
    expect(proximo!.fecha.getMonth()).toBe(5)
    expect(proximo!.fecha.getDate()).toBe(11)
  })
})
