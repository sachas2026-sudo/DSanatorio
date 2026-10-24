import { describe, expect, it } from 'vitest'
import type { AppData, Appointment, Doctor } from '../types'
import {
  citasEnFranja,
  getTurnoFromFecha,
  medicoGroupsCitasDelDia,
  splitCitasMananaTarde,
} from './dayTurnos'
import { DEFAULT_AGENDA_RANGES } from './weekSlots'

function cita(hm: string, day = '2026-06-03'): Appointment {
  const [hh, mm] = hm.split(':').map(Number)
  const d = new Date(`${day}T12:00:00`)
  d.setHours(hh!, mm!, 0, 0)
  return {
    id: `c-${hm}`,
    patientId: 'p1',
    doctorId: 'doc-1',
    fechaHora: d.toISOString(),
    duracionMinutos: 30,
    estado: 'programado',
    notas: '',
  }
}

describe('splitCitasMananaTarde', () => {
  it('incluye turno 12:30 en mañana aunque no esté en franja 08:00–11:30', () => {
    const citas = [cita('12:30')]
    const enManana = citasEnFranja(citas, DEFAULT_AGENDA_RANGES[0]!)
    expect(enManana).toHaveLength(0)

    const { manana, tarde } = splitCitasMananaTarde(citas)
    expect(manana).toHaveLength(1)
    expect(tarde).toHaveLength(0)
    expect(manana[0]!.fechaHora).toBe(citas[0]!.fechaHora)
  })
})

describe('medicoGroupsCitasDelDia', () => {
  it('incluye médico con turno 12:30 aunque no esté en franja mañana estándar', () => {
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
      activo: true,
    }
    const data: AppData = {
      patients: [],
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
    const day = new Date(2026, 5, 3)
    const citas = [cita('12:30', '2026-06-03')]
    const groups = medicoGroupsCitasDelDia({
      citas,
      selectedDay: day,
      data,
      doctorLabel: () => 'Benitez, Ana',
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.citas).toHaveLength(1)
    expect(groups[0]!.citas[0]!.id).toBe('c-12:30')
  })
})

describe('getTurnoFromFecha', () => {
  it('retorna Mañana para horas antes de las 13:30 hs', () => {
    expect(getTurnoFromFecha('2026-10-01T09:00:00')).toBe('Mañana')
    expect(getTurnoFromFecha('2026-10-01T13:29:00')).toBe('Mañana')
  })

  it('retorna Tarde entre 13:30 hs y 21:00 hs', () => {
    expect(getTurnoFromFecha('2026-10-01T13:30:00')).toBe('Tarde')
    expect(getTurnoFromFecha('2026-10-01T15:00:00')).toBe('Tarde')
    expect(getTurnoFromFecha('2026-10-01T17:00:00')).toBe('Tarde')
    expect(getTurnoFromFecha('2026-10-01T20:59:00')).toBe('Tarde')
  })

  it('retorna Noche a partir de las 21:00 hs', () => {
    expect(getTurnoFromFecha('2026-10-01T21:00:00')).toBe('Noche')
    expect(getTurnoFromFecha('2026-10-01T22:30:00')).toBe('Noche')
  })
})
