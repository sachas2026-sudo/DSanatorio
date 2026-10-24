import { describe, expect, it } from 'vitest'
import {
  isMedicoActivo,
  isPacienteActivo,
  medicosActivos,
  pacientesActivos,
} from './activo'
import type { Doctor, Patient } from '../types'

const patient = (activo?: boolean): Patient => ({
  id: 'p1',
  nombre: 'Ana',
  apellido: 'López',
  dni: '',
  telefono: '',
  email: '',
  domicilio: '',
  localidad: '',
  fechaNacimiento: '',
  obraSocial: '',
  notas: '',
  activo,
})

const doctor = (activo?: boolean): Doctor => ({
  id: 'd1',
  nombre: 'Dr',
  apellido: 'House',
  dni: '',
  matricula: '',
  especialidad: '',
  telefono: '',
  localidad: '',
  email: '',
  activo,
})

describe('activo helpers', () => {
  it('trata registros sin campo como activos', () => {
    expect(isPacienteActivo(patient())).toBe(true)
    expect(isMedicoActivo(doctor())).toBe(true)
  })

  it('detecta suspendidos', () => {
    expect(isPacienteActivo(patient(false))).toBe(false)
    expect(pacientesActivos([patient(), patient(false)])).toHaveLength(1)
    expect(medicosActivos([doctor(), doctor(false)])).toHaveLength(1)
  })
})
