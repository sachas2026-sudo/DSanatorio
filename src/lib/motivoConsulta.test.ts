import { describe, expect, it } from 'vitest'
import {
  joinMotivosConsulta,
  mergeMotivosConsulta,
  motivoConsulta2Texto,
  motivoConsultaFromNotas,
  motivosConsultaDelTurno,
  notasFromMotivoConsulta,
} from './motivoConsulta'

describe('motivoConsulta', () => {
  it('vacío → Consulta por defecto', () => {
    expect(motivoConsultaFromNotas('')).toEqual({
      motivo: 'Consulta',
      otroDetalle: '',
    })
  })

  it('motivo habitual', () => {
    expect(motivoConsultaFromNotas('Laboratorio')).toEqual({
      motivo: 'Laboratorio',
      otroDetalle: '',
    })
  })

  it('texto libre → Otro', () => {
    expect(motivoConsultaFromNotas('Dolor de cabeza')).toEqual({
      motivo: 'Otro',
      otroDetalle: 'Dolor de cabeza',
    })
  })

  it('motivo personalizado agregado', () => {
    const custom = ['Doppler']
    expect(motivoConsultaFromNotas('Doppler', custom)).toEqual({
      motivo: 'Doppler',
      otroDetalle: '',
    })
    expect(mergeMotivosConsulta(custom)).toContain('Doppler')
    expect(mergeMotivosConsulta(custom).at(-1)).toBe('Otro')
  })

  it('notasFromMotivoConsulta', () => {
    expect(notasFromMotivoConsulta('Consulta', '')).toBe('Consulta')
    expect(notasFromMotivoConsulta('Otro', '  Detalle  ')).toBe('Detalle')
    expect(notasFromMotivoConsulta('Doppler', '', ['Doppler'])).toBe('Doppler')
  })

  it('motivoConsulta2Texto: vacío significa "sin motivo 2"', () => {
    expect(motivoConsulta2Texto('', 'se ignora')).toBe('')
    expect(motivoConsulta2Texto('Control', '')).toBe('Control')
    expect(motivoConsulta2Texto('Otro', '  Detalle  ')).toBe('Detalle')
  })

  it('joinMotivosConsulta', () => {
    expect(joinMotivosConsulta('Consulta', undefined)).toBe('Consulta')
    expect(joinMotivosConsulta('Consulta', '  ')).toBe('Consulta')
    expect(joinMotivosConsulta('Consulta', 'Control')).toBe('Consulta + Control')
    expect(joinMotivosConsulta('Consulta', 'consulta')).toBe('Consulta')
    expect(joinMotivosConsulta('', 'Control')).toBe('Control')
  })

  it('motivosConsultaDelTurno: cuenta motivo 1 y motivo 2 sin repetir', () => {
    expect(motivosConsultaDelTurno('Consulta', undefined)).toEqual(['Consulta'])
    expect(motivosConsultaDelTurno('Consulta', 'Control')).toEqual([
      'Consulta',
      'Control',
    ])
    expect(motivosConsultaDelTurno('Consulta', 'Consulta')).toEqual(['Consulta'])
    expect(motivosConsultaDelTurno('', '')).toEqual([])
    expect(motivosConsultaDelTurno('Consulta', '', ['Doppler'])).toEqual(['Consulta'])
    expect(motivosConsultaDelTurno('Consulta', 'Doppler', ['Doppler'])).toEqual([
      'Consulta',
      'Doppler',
    ])
  })
})
