import { describe, expect, it } from 'vitest'
import { collectAgendaWhatsAppPacientesDays } from './agendaWhatsAppPacientesPdf'
import type { AppData } from '../types'

const baseData: AppData = {
  patients: [
    {
      id: 'p1',
      nombre: 'Luis',
      apellido: 'Piray',
      dni: '1',
      telefono: '3751 123456',
      email: '',
      domicilio: '',
      localidad: '',
      fechaNacimiento: '',
      obraSocial: '',
      notas: '',
    },
  ],
  doctors: [
    {
      id: 'd1',
      nombre: 'Ana',
      apellido: 'Benitez',
      dni: '',
      matricula: '',
      especialidad: 'Clínica',
      telefono: '',
      localidad: '',
      email: '',
    },
  ],
  horarios: [],
  diasLibres: [],
  atencionesMensuales: [],
  appointments: [
    {
      id: 'c1',
      patientId: 'p1',
      doctorId: 'd1',
      fechaHora: '2026-06-08T16:00:00.000Z',
      duracionMinutos: 30,
      notas: '',
      estado: 'programado',
      whatsappRecordatorioEnviadoEn: '2026-06-08T10:00:00.000Z',
    },
  ],
  payments: [],
  atencionesSinTurno: [],
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

describe('collectAgendaWhatsAppPacientesDays', () => {
  it('omite turnos cancelados', () => {
    const day = new Date(2026, 5, 8, 12, 0, 0)
    const data = {
      ...baseData,
      appointments: [{ ...baseData.appointments[0]!, estado: 'cancelado' as const }],
    }
    const days = collectAgendaWhatsAppPacientesDays({
      scope: 'day',
      data,
      weekCursor: day,
      selectedDay: day,
      weekDays: [day],
      patientLabel: () => 'Piray, Luis',
      doctorLabel: () => 'Benitez, Ana',
    })
    expect(days).toHaveLength(0)
  })

  it('incluye mensaje de recordatorio por turno marcado con WhatsApp', () => {
    const day = new Date(2026, 5, 8, 12, 0, 0)
    const days = collectAgendaWhatsAppPacientesDays({
      scope: 'day',
      data: baseData,
      weekCursor: day,
      selectedDay: day,
      weekDays: [day],
      patientLabel: () => 'Piray, Luis',
      doctorLabel: () => 'Benitez, Ana',
    })
    expect(days).toHaveLength(1)
    expect(days[0]!.rows).toHaveLength(1)
    expect(days[0]!.rows[0]!.mensaje).toContain('confirme su asistencia')
    expect(days[0]!.rows[0]!.mensaje).toContain('Benitez Ana')
  })

  it('omite turnos sin WhatsApp abierto desde la app', () => {
    const day = new Date(2026, 5, 8, 12, 0, 0)
    const { whatsappRecordatorioEnviadoEn: _omit, ...citaSinMarca } =
      baseData.appointments[0]!
    const data = {
      ...baseData,
      appointments: [citaSinMarca],
    }
    const days = collectAgendaWhatsAppPacientesDays({
      scope: 'day',
      data,
      weekCursor: day,
      selectedDay: day,
      weekDays: [day],
      patientLabel: () => 'Piray, Luis',
      doctorLabel: () => 'Benitez, Ana',
    })
    expect(days).toHaveLength(0)
  })
})
