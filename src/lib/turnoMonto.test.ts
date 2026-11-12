import { describe, expect, it } from 'vitest'
import {
  calcularMontoSugerido,
  doctorAttendsCoverage,
  normalizeOsName,
} from './turnoMonto'
import type { Doctor } from '../types'

const mockDoctor: Doctor = {
  id: 'doc-1',
  nombre: 'CARMEN',
  apellido: 'ALFONSO',
  dni: '',
  matricula: '1234',
  especialidad: 'Endocrinología',
  telefono: '',
  localidad: '',
  email: '',
  particular: 40000,
  valor: 0,
  cuidar: 0,
  obrasSociales: [
    { nombre: 'IPS', porcentaje: 0, monto: 25000 },
    { nombre: 'OSDE', porcentaje: 0, monto: 0 },
  ],
}

describe('turnoMonto - normalización y atención', () => {
  it('normaliza nombres sin mayúsculas ni tildes', () => {
    expect(normalizeOsName('  SANCOR SALUD  ')).toBe('sancor salud')
    expect(normalizeOsName('Prevención Salud')).toBe('prevencion salud')
    expect(normalizeOsName('Médicus')).toBe('medicus')
  })

  it('detecta correctamente si el médico atiende una obra social', () => {
    expect(doctorAttendsCoverage(mockDoctor, 'IPS')).toBe(true)
    expect(doctorAttendsCoverage(mockDoctor, 'ips')).toBe(true)
    expect(doctorAttendsCoverage(mockDoctor, 'PAMI')).toBe(false)
    expect(doctorAttendsCoverage(mockDoctor, 'Particular')).toBe(true)
  })
})

describe('turnoMonto - monto según ficha del médico', () => {
  it('usa el monto cargado para la obra social', () => {
    expect(calcularMontoSugerido(mockDoctor, 'IPS')).toEqual({
      monto: 25000,
      origen: 'ok',
    })
  })

  it('devuelve sin-monto cuando la obra social tiene monto cero', () => {
    expect(calcularMontoSugerido(mockDoctor, 'OSDE')).toEqual({
      monto: 0,
      origen: 'sin-monto',
    })
  })

  it('devuelve sin-monto cuando el médico no atiende la cobertura', () => {
    expect(calcularMontoSugerido(mockDoctor, 'PAMI')).toEqual({
      monto: 0,
      origen: 'sin-monto',
    })
  })

  it('usa el arancel Particular del médico', () => {
    expect(calcularMontoSugerido(mockDoctor, 'Particular')).toEqual({
      monto: 40000,
      origen: 'ok',
    })
  })

  it('devuelve sin-monto para Particular sin arancel', () => {
    expect(calcularMontoSugerido({ ...mockDoctor, particular: 0 }, 'Particular')).toEqual({
      monto: 0,
      origen: 'sin-monto',
    })
  })

  it('compara cobertura ignorando mayúsculas y espacios', () => {
    const doctor = {
      ...mockDoctor,
      obrasSociales: [{ nombre: '  IPS  ', porcentaje: 0, monto: 25000 }],
    }

    expect(calcularMontoSugerido(doctor, ' ips ')).toEqual({
      monto: 25000,
      origen: 'ok',
    })
  })
})
