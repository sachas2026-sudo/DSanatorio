import { describe, expect, it } from 'vitest'
import {
  calculateTotalParticular,
  formatThousands,
  formatTotalParticularDisplay,
  getDoctorInitials,
  hasFormChanges,
  isValidEmail,
  parseThousands,
  validateDoctorForm,
} from './registroProfesionalLogic'

describe('registroProfesionalLogic', () => {
  describe('formatThousands & parseThousands', () => {
    it('formatea montos con punto de miles en formato es-AR', () => {
      expect(formatThousands(0)).toBe('0')
      expect(formatThousands('1000')).toBe('1.000')
      expect(formatThousands('100000')).toBe('100.000')
      expect(formatThousands('1234567')).toBe('1.234.567')
      expect(formatThousands('')).toBe('')
    })

    it('parsea montos con separadores a enteros', () => {
      expect(parseThousands('100.000')).toBe(100000)
      expect(parseThousands('$ 100.000')).toBe(100000)
      expect(parseThousands('0')).toBe(0)
      expect(parseThousands('')).toBe(0)
      expect(parseThousands(undefined)).toBe(0)
    })
  })

  describe('calculateTotalParticular & formatTotalParticularDisplay', () => {
    it('calcula la suma correcta de Particular + Cuidar', () => {
      expect(calculateTotalParticular('40.000', '10.000')).toBe(50000)
      expect(calculateTotalParticular(70000, 20000)).toBe(90000)
      expect(calculateTotalParticular('', '10.000')).toBe(10000)
      expect(calculateTotalParticular(undefined, undefined)).toBe(0)
    })

    it('muestra el total particular formateado con signo de peso', () => {
      expect(formatTotalParticularDisplay('40.000', '10.000')).toBe('$ 50.000')
      expect(formatTotalParticularDisplay('', '')).toBe('$ 0')
    })
  })

  describe('isValidEmail', () => {
    it('valida correos electrónicos correctamente', () => {
      expect(isValidEmail('')).toBe(true)
      expect(isValidEmail('test@medico.com')).toBe(true)
      expect(isValidEmail('invalido')).toBe(false)
      expect(isValidEmail('test@')).toBe(false)
      expect(isValidEmail('test@dominio')).toBe(false)
    })
  })

  describe('validateDoctorForm', () => {
    it('pasa cuando todos los campos requeridos están presentes y válidos', () => {
      const res = validateDoctorForm({
        apellido: 'Pérez',
        nombre: 'Juan',
        dni: '12345678',
        especialidad: 'Cardiología',
        telefono: '3764123456',
        email: 'juan@example.com',
      })
      expect(res.isValid).toBe(true)
      expect(res.errors).toEqual({})
      expect(res.summaryMessage).toBeUndefined()
    })

    it('falla si falta apellido, nombre, dni o especialidad', () => {
      const res = validateDoctorForm({
        apellido: '',
        nombre: '',
        dni: '',
        especialidad: '',
        telefono: '123',
      })
      expect(res.isValid).toBe(false)
      expect(res.errors.apellido).toBe(true)
      expect(res.errors.nombre).toBe(true)
      expect(res.errors.dni).toBe(true)
      expect(res.errors.especialidad).toBe(true)
      expect(res.summaryMessage).toBe('Revisá los campos marcados en rojo')
    })

    it('falla si no tiene ni teléfono ni email', () => {
      const res = validateDoctorForm({
        apellido: 'Pérez',
        nombre: 'Juan',
        dni: '12345678',
        especialidad: 'Cardiología',
        telefono: '',
        email: '',
      })
      expect(res.isValid).toBe(false)
      expect(res.errors.telefono).toBe(true)
      expect(res.errors.email).toBe(true)
    })

    it('falla si el email tiene formato inválido', () => {
      const res = validateDoctorForm({
        apellido: 'Pérez',
        nombre: 'Juan',
        dni: '12345678',
        especialidad: 'Cardiología',
        telefono: '123',
        email: 'invalido',
      })
      expect(res.isValid).toBe(false)
      expect(res.errors.email).toBe(true)
    })
  })

  describe('getDoctorInitials', () => {
    it('obtiene iniciales correctas', () => {
      expect(getDoctorInitials('Ayala', 'Marcela')).toBe('AM')
      expect(getDoctorInitials('Gomez', '')).toBe('G')
      expect(getDoctorInitials('', '')).toBe('DR')
    })
  })

  describe('hasFormChanges', () => {
    it('detecta cambios entre el estado original y el actual', () => {
      const f1 = { nombre: 'A', apellido: 'B' }
      const f2 = { nombre: 'A', apellido: 'B' }
      const f3 = { nombre: 'A', apellido: 'C' }
      expect(hasFormChanges(f1, f2)).toBe(false)
      expect(hasFormChanges(f1, f3)).toBe(true)
    })
  })
})

