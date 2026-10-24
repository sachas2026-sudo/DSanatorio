import { describe, expect, it } from 'vitest'
import type { AppData, Appointment, Doctor } from '../types'
import {
  collectAgendaTurnosPdfDays,
  buildAgendaTurnosPdf,
} from './agendaTurnosPdf'

const doctor: Doctor = {
  id: 'doc-ana',
  nombre: 'Ana',
  apellido: 'Benitez',
  dni: '',
  matricula: '',
  especialidad: 'Clínica',
  telefono: '',
  localidad: '',
  email: '',
  duracionTurnoMinutos: 30,
  tipoAgenda: 'semanal',
  activo: true,
}

function citaMediodia(): Appointment {
  const d = new Date(2026, 5, 3, 12, 30, 0, 0)
  return {
    id: 'c-1230',
    patientId: 'p1',
    doctorId: 'doc-ana',
    fechaHora: d.toISOString(),
    duracionMinutos: 30,
    estado: 'programado',
    notas: '',
  }
}

const baseData = (): AppData => ({
  patients: [
    {
      id: 'p1',
      nombre: 'Luis',
      apellido: 'Piray',
      dni: '1',
      telefono: '',
      email: '',
      obraSocial: 'OSDE',
      localidad: '',
      activo: true,
    },
  ],
  doctors: [doctor],
  horarios: [
    {
      id: 'h1',
      doctorId: 'doc-ana',
      diaSemana: 3,
      horaInicio: '12:30',
      horaFin: '13:30',
    },
  ],
  diasLibres: [],
  atencionesMensuales: [],
  appointments: [citaMediodia()],
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
})

describe('collectAgendaTurnosPdfDays', () => {
  it('incluye turno 12:30 en PDF Turnos del día', () => {
    const day = new Date(2026, 5, 3)
    const days = collectAgendaTurnosPdfDays({
      scope: 'day',
      data: baseData(),
      weekCursor: day,
      selectedDay: day,
      weekDays: [],
      doctorLabel: (id) =>
        id === 'doc-ana' ? 'Benitez, Ana - Clínica' : '—',
      patientLabel: () => 'Piray, Luis',
      obraSocialLabel: () => 'OSDE',
      estadoFor: () => 'Programado',
    })
    expect(days).toHaveLength(1)
    const medico = days[0]!.medicos.find((m) => m.label.startsWith('Benitez'))
    expect(medico).toBeDefined()
    const todas = [...medico!.citasManana, ...medico!.citasTarde]
    expect(
      todas.some(
        (c) =>
          c.hora === '12:30' &&
          c.paciente === 'Piray, Luis' &&
          c.obraSocial === 'OSDE',
      ),
    ).toBe(true)
  })

  it('omite al médico seleccionado cuando no tiene turnos en el período', () => {
    const day = new Date(2026, 5, 3)
    const data = baseData()
    data.appointments = []
    const days = collectAgendaTurnosPdfDays({
      scope: 'day',
      data,
      weekCursor: day,
      selectedDay: day,
      weekDays: [],
      doctorFilterId: doctor.id,
      doctorLabel: () => 'Benitez, Ana - Clínica',
      patientLabel: () => 'Piray, Luis',
      obraSocialLabel: () => 'OSDE',
      estadoFor: () => 'Programado',
    })

    expect(days).toEqual([])
  })

  it('incluye el motivo de consulta para mostrarlo antes de Urgencia', () => {
    const day = new Date(2026, 5, 3)
    const data = baseData()
    data.appointments[0]!.notas = 'Urgencia — Ecografía'
    const days = collectAgendaTurnosPdfDays({
      scope: 'day',
      data,
      weekCursor: day,
      selectedDay: day,
      weekDays: [],
      doctorFilterId: doctor.id,
      doctorLabel: () => 'Benitez, Ana - Clínica',
      patientLabel: () => 'Piray, Luis',
      obraSocialLabel: () => 'OSDE',
      estadoFor: () => 'Urgencia',
    })

    const cita = [
      ...(days[0]?.medicos[0]?.citasManana ?? []),
      ...(days[0]?.medicos[0]?.citasTarde ?? []),
    ][0]
    expect(cita).toMatchObject({
      motivoConsulta: 'Ecografía',
      estado: 'Urgencia',
    })
  })

  it('reemplaza la obra social por Particular cuando el turno tiene obraSocialOverride Particular', () => {
    const day = new Date(2026, 5, 3)
    const data = baseData()
    data.appointments[0]!.obraSocialOverride = 'Particular'
    const days = collectAgendaTurnosPdfDays({
      scope: 'day',
      data,
      weekCursor: day,
      selectedDay: day,
      weekDays: [],
      doctorFilterId: doctor.id,
      doctorLabel: () => 'Benitez, Ana - Clínica',
      patientLabel: () => 'Piray, Luis',
      obraSocialLabel: () => 'OSDE',
      estadoFor: () => 'Programado',
    })

    const cita = [
      ...(days[0]?.medicos[0]?.citasManana ?? []),
      ...(days[0]?.medicos[0]?.citasTarde ?? []),
    ][0]
    expect(cita?.obraSocial).toBe('Particular')
    expect(data.patients[0]?.obraSocial).toBe('OSDE')
  })

  it('incluye a médicos que tienen turnos cancelados en el día (ej. LOPEZ, ROSAMARIA)', () => {
    const day = new Date(2026, 5, 3)
    const data = baseData()
    data.appointments[0]!.estado = 'cancelado'
    const days = collectAgendaTurnosPdfDays({
      scope: 'day',
      data,
      weekCursor: day,
      selectedDay: day,
      weekDays: [],
      doctorLabel: () => 'Lopez, Rosamaria - Psicopedagogía',
      patientLabel: () => 'Piray, Luis',
      obraSocialLabel: () => 'OSDE',
      estadoFor: () => 'Cancelado',
    })

    expect(days).toHaveLength(1)
    expect(days[0]?.medicos).toHaveLength(1)
    expect(days[0]?.medicos[0]?.label).toContain('Lopez, Rosamaria')
    const cita = [
      ...(days[0]?.medicos[0]?.citasManana ?? []),
      ...(days[0]?.medicos[0]?.citasTarde ?? []),
    ][0]
    expect(cita?.estado).toBe('Cancelado')
  })

  it('ubica al 6to médico en la segunda hoja cuando hay 6 médicos (máximo 5 columnas por hoja)', () => {
    const makeMed = (name: string, apptCount: number) => ({
      label: name,
      libresManana: null,
      libresTarde: null,
      citasManana: Array.from({ length: apptCount }, (_, i) => ({
        hora: `0${8 + Math.floor(i / 2)}:${i % 2 === 0 ? '00' : '30'}`,
        paciente: `Paciente ${i + 1}`,
        obraSocial: 'OSDE',
        motivoConsulta: null,
        estado: 'Atendido - Pagado',
      })),
      citasTarde: [],
    })

    const medicos = [
      makeMed('CASTAÑARES, VALERIA - GINECOLOGÍA', 8),
      makeMed('GIUDICI, SILVANA - NEUROLOGÍA', 3),
      makeMed('IMBACH, GUILLERMO - GASTROENTEROLOGÍA', 6),
      makeMed('RAVIOLO, CECILIA - NUTRICIONISTA', 2),
      makeMed('SCHIMPF, ROALD ARTURO - OFTALMOLOGÍA', 16),
      makeMed('PEREZ, JUAN - CARDIOLOGÍA', 3), // 6to médico
    ]

    const result = buildAgendaTurnosPdf({
      scope: 'day',
      periodLabel: 'martes 6 de octubre 2026',
      days: [
        {
          dayTitle: 'MARTES 6 DE OCTUBRE 2026',
          medicos,
        },
      ],
      fileStamp: '20261006',
    })

    // Con 5 columnas por hoja, los primeros 5 médicos van a la hoja 1 y el 6to va a la hoja 2
    expect(result.doc.getNumberOfPages()).toBe(2)
  })

  it('divide en varias hojas si un médico tiene más de 18 registros (18 turnos por hoja)', () => {
    const makeMed = (name: string, apptCount: number) => ({
      label: name,
      libresManana: null,
      libresTarde: null,
      citasManana: Array.from({ length: apptCount }, (_, i) => ({
        hora: `0${8 + Math.floor(i / 2)}:${i % 2 === 0 ? '00' : '30'}`,
        paciente: `Paciente ${i + 1}`,
        obraSocial: 'OSDE',
        motivoConsulta: null,
        estado: 'Atendido - Pagado',
      })),
      citasTarde: [],
    })

    const medicos = [
      // 1 médico con 20 turnos (> 18 por hoja)
      makeMed('CASTAÑARES, VALERIA - GINECOLOGÍA', 20),
    ]

    const result = buildAgendaTurnosPdf({
      scope: 'day',
      periodLabel: 'martes 6 de octubre 2026',
      days: [
        {
          dayTitle: 'MARTES 6 DE OCTUBRE 2026',
          medicos,
        },
      ],
      fileStamp: '20261006',
    })

    // Con 20 turnos y 18 registros por hoja, requiere 2 hojas (18 en hoja 1, 2 en hoja 2)
    expect(result.doc.getNumberOfPages()).toBe(2)
  })

  it('mantiene en 1 sola hoja hasta 5 médicos cuando todos tienen 18 turnos o menos', () => {
    const makeMed = (name: string, apptCount: number) => ({
      label: name,
      libresManana: null,
      libresTarde: null,
      citasManana: Array.from({ length: apptCount }, (_, i) => ({
        hora: `0${8 + Math.floor(i / 2)}:${i % 2 === 0 ? '00' : '30'}`,
        paciente: `Paciente ${i + 1}`,
        obraSocial: 'OSDE',
        motivoConsulta: null,
        estado: 'Atendido - Pagado',
      })),
      citasTarde: [],
    })

    const medicos = [
      makeMed('CASTAÑARES, VALERIA - GINECOLOGÍA', 18),
      makeMed('GIUDICI, SILVANA - NEUROLOGÍA', 15),
      makeMed('IMBACH, GUILLERMO - GASTROENTEROLOGÍA', 10),
      makeMed('RAVIOLO, CECILIA - NUTRICIONISTA', 8),
      makeMed('SCHIMPF, ROALD ARTURO - OFTALMOLOGÍA', 18),
    ]

    const result = buildAgendaTurnosPdf({
      scope: 'day',
      periodLabel: 'martes 6 de octubre 2026',
      days: [
        {
          dayTitle: 'MARTES 6 DE OCTUBRE 2026',
          medicos,
        },
      ],
      fileStamp: '20261006',
    })

    expect(result.doc.getNumberOfPages()).toBe(1)
  })
})
