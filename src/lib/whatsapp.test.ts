import { describe, expect, it } from 'vitest'
import {
  buildTurnoReprogramacionMessage,
  buildTurnoReminderMessage,
  buildTurnoReminderMessageFromCita,
  buildWhatsAppSendUrl,
  buildWhatsAppWebUrl,
  fechaCalendarioTurnoAgenda,
  formatTurnoFechaReprogramacionNueva,
  formatTurnoFechaReprogramacionOriginal,
  formatTurnoFechaWhatsApp,
  formatTurnoHoraReprogramacion,
  profesionalWhatsAppLabel,
  saludoWhatsApp,
} from './whatsapp'

describe('buildTurnoReminderMessage', () => {
  it('usa el texto acordado para recordatorio de turno con hora', () => {
    const fechaTurno = new Date(2026, 9, 1, 10, 0, 0)
    const mensaje = buildTurnoReminderMessage({
      fechaTurno,
      hora: '16:30',
      especialidad: 'Diabetología',
      medicoApellido: 'AGUIRRE',
      medicoNombre: 'RAFAEL',
      saludo: 'Buenas tardes',
    })
    expect(mensaje).toContain(
      'Buenas tardes. Le recordamos su turno mañana, jueves 01/10, a las 16:30 hs con el diabetologo AGUIRRE RAFAEL.',
    )
    expect(mensaje).toContain('Por favor, confirme su asistencia. ¡Muchas gracias!')
    expect(mensaje).toContain('CUIDAR CENTRO MÉDICO')
  })

  it('arma el mensaje desde fecha y médico del turno en agenda incluyendo la hora', () => {
    const mensaje = buildTurnoReminderMessageFromCita({
      fechaHoraIso: '2026-06-02T09:30:00',
      especialidad: 'Neurología',
      medicoApellido: 'Giudici',
      medicoNombre: 'Silvana',
      saludo: 'Buenas tardes',
    })
    expect(mensaje).toContain(
      'Buenas tardes. Le recordamos su turno mañana, martes 02/06, a las 09:30 hs con el neurologo Giudici Silvana.',
    )
    expect(mensaje).toContain('Giudici Silvana')
    expect(mensaje).toContain('con el neurologo')
  })

  it('usa el/la profesional cuando el médico no tiene especialidad cargada', () => {
    const mensaje = buildTurnoReminderMessageFromCita({
      fechaHoraIso: '2026-06-12T18:00:00',
      especialidad: '',
      medicoApellido: 'erte',
      medicoNombre: 'ert',
      saludo: 'Buenas noches',
    })
    expect(mensaje).toContain(
      'Buenas noches. Le recordamos su turno mañana, viernes 12/06, a las 18:00 hs con el/la profesional erte ert.',
    )
  })
})

describe('fechaCalendarioTurnoAgenda', () => {
  it('usa el día del turno en la agenda', () => {
    const d = fechaCalendarioTurnoAgenda(
      new Date(2026, 5, 2, 23, 45, 0).toISOString(),
    )
    expect(d.getDate()).toBe(2)
    expect(d.getMonth()).toBe(5)
  })
})

describe('formatTurnoFechaWhatsApp', () => {
  it('formatea día y fecha como en el mensaje de WhatsApp', () => {
    expect(formatTurnoFechaWhatsApp(new Date(2026, 5, 2, 10, 0, 0))).toBe(
      'Martes 02-06 del cte. Año',
    )
  })
})

describe('saludoWhatsApp', () => {
  it('elige saludo según la hora', () => {
    expect(saludoWhatsApp(new Date(2026, 5, 2, 9, 0, 0))).toBe('Buenos días')
    expect(saludoWhatsApp(new Date(2026, 5, 2, 15, 0, 0))).toBe('Buenas tardes')
    expect(saludoWhatsApp(new Date(2026, 5, 2, 21, 0, 0))).toBe('Buenas noches')
  })
})

describe('profesionalWhatsAppLabel', () => {
  it('mapea especialidades conocidas', () => {
    expect(profesionalWhatsAppLabel('Neurología')).toBe('el neurologo')
    expect(profesionalWhatsAppLabel('Odontología')).toBe('el odontologo')
  })
})

describe('buildTurnoReprogramacionMessage', () => {
  it('usa el texto acordado de cancelación / reprogramación', () => {
    const mensaje = buildTurnoReprogramacionMessage({
      fechaTurnoOriginal: new Date(2026, 5, 4, 11, 0, 0),
      fechaTurnoNueva: new Date(2026, 5, 11, 11, 0, 0),
      horaNueva: '11:00',
      medicoApellido: 'Venialgo',
      medicoNombre: 'Evelin',
      medicoTitulo: 'Lic.',
      saludo: 'Buenos días',
    })
    expect(mensaje).toContain('Buenos días . Soy del Centro Médico Cuidar')
    expect(mensaje).toContain(
      'Te escribo para avisarte que por  fuerza mayor se reprogramara el turno del día Jueves 04/06  . Con la Lic. Venialgo Evelin . Trasladándose  al día Jueves 11-06  horario de las 11.00 hs',
    )
    expect(mensaje).toContain('confirmación de Horario')
    expect(mensaje).toContain('mil disculpas por las molestias ocasionadas')
  })

  it('usa Dr. y «Con el» por defecto en reprogramación', () => {
    const mensaje = buildTurnoReprogramacionMessage({
      fechaTurnoOriginal: new Date(2026, 5, 4, 11, 0, 0),
      horaNueva: '11:00',
      medicoApellido: 'García',
      medicoNombre: 'Jose Luis',
      saludo: 'Buenos días',
    })
    expect(mensaje).toContain('Con el Dr. García Jose Luis')
  })

  it('propone la semana siguiente si no hay nueva fecha', () => {
    const mensaje = buildTurnoReprogramacionMessage({
      fechaTurnoOriginal: new Date(2026, 5, 4, 11, 0, 0),
      horaNueva: '11:00',
      medicoApellido: 'Venialgo',
      medicoNombre: 'Evelin',
      saludo: 'Buenos días',
    })
    expect(mensaje).toContain('Trasladándose  al día Jueves 11-06  horario de las 11.00 hs')
  })

  it('genera enlace de la app de escritorio para mensaje de reprogramación', () => {
    const mensaje = buildTurnoReprogramacionMessage({
      fechaTurnoOriginal: new Date(2026, 5, 4, 11, 0, 0),
      horaNueva: '11:00',
      medicoApellido: 'Venialgo',
      medicoNombre: 'Evelin',
    })
    expect(buildWhatsAppSendUrl('3751 123456', mensaje)).toMatch(
      /^whatsapp:\/\/send\?phone=54/,
    )
  })

  it('genera enlace de WhatsApp Web para mensaje de reprogramación', () => {
    expect(buildWhatsAppWebUrl('3751 123456', 'Hola')).toBe(
      'https://web.whatsapp.com/send?phone=5493751123456&text=Hola',
    )
  })
})

describe('formatTurnoFechaReprogramacionOriginal', () => {
  it('formatea la fecha cancelada con barra', () => {
    expect(
      formatTurnoFechaReprogramacionOriginal(new Date(2026, 5, 4, 11, 0, 0)),
    ).toBe('Jueves 04/06')
  })
})

describe('formatTurnoFechaReprogramacionNueva', () => {
  it('formatea la nueva fecha con guión', () => {
    expect(
      formatTurnoFechaReprogramacionNueva(new Date(2026, 5, 11, 11, 0, 0)),
    ).toBe('Jueves 11-06')
  })
})

describe('formatTurnoHoraReprogramacion', () => {
  it('formatea la hora con punto y hs', () => {
    expect(formatTurnoHoraReprogramacion('11:00')).toBe('11.00 hs')
  })
})
