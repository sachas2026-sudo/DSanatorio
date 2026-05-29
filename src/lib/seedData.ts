import { createId } from './id'
import type { Doctor, Patient } from '../types'

export const DEMO_PATIENT_COUNT = 5
export const DEMO_DOCTOR_COUNT = 5

const demoPatients: Omit<Patient, 'id'>[] = [
  {
    nombre: 'María',
    apellido: 'García',
    dni: '30123456',
    telefono: '+54 11 4521-8834',
    email: 'maria.garcia@mail.demo',
    domicilio: 'Av. Corrientes 1234, CABA',
    localidad: '',
    fechaNacimiento: '1985-03-12',
    obraSocial: 'PAMI',
    notas: 'Control anual',
  },
  {
    nombre: 'Juan',
    apellido: 'Rodríguez',
    dni: '28456789',
    telefono: '+54 341 555-1200',
    email: 'juan.rodriguez@mail.demo',
    domicilio: 'San Martín 450, Rosario',
    localidad: '',
    fechaNacimiento: '1978-07-22',
    obraSocial: 'OSDE',
    notas: '',
  },
  {
    nombre: 'Lucía',
    apellido: 'Martínez',
    dni: '35789123',
    telefono: '+54 351 444-9021',
    email: 'lucia.martinez@mail.demo',
    domicilio: 'Bv. Oroño 2100, Rosario',
    localidad: '',
    fechaNacimiento: '1992-11-05',
    obraSocial: 'IPS',
    notas: 'Alergia a penicilina',
  },
  {
    nombre: 'Carlos',
    apellido: 'López',
    dni: '32147856',
    telefono: '+54 11 6090-3341',
    email: 'carlos.lopez@mail.demo',
    domicilio: 'Rivadavia 8900, CABA',
    localidad: '',
    fechaNacimiento: '1965-01-18',
    obraSocial: 'Galeno',
    notas: 'Hipertensión controlada',
  },
  {
    nombre: 'Ana',
    apellido: 'González',
    dni: '33654210',
    telefono: '+54 221 455-7788',
    email: 'ana.gonzalez@mail.demo',
    domicilio: 'Calle 7 Nº 1234, La Plata',
    localidad: '',
    fechaNacimiento: '1998-09-30',
    obraSocial: 'IOMA',
    notas: '',
  },
]

const demoDoctors: Omit<Doctor, 'id'>[] = [
  {
    nombre: 'Roberto',
    apellido: 'Fernández',
    matricula: 'MN-45231',
    especialidad: 'Cardiología',
    telefono: '+54 11 4321-5500',
    localidad: '',
    email: 'r.fernandez@sanatorio.demo',
  },
  {
    nombre: 'Elena',
    apellido: 'Torres',
    matricula: 'MN-51890',
    especialidad: 'Pediatría',
    telefono: '+54 11 4321-5501',
    localidad: '',
    email: 'e.torres@sanatorio.demo',
  },
  {
    nombre: 'Martín',
    apellido: 'Díaz',
    matricula: 'MN-60442',
    especialidad: 'Traumatología',
    telefono: '+54 351 422-1100',
    localidad: '',
    email: 'm.diaz@sanatorio.demo',
  },
  {
    nombre: 'Paula',
    apellido: 'Herrera',
    matricula: 'MN-33120',
    especialidad: 'Clínica médica',
    telefono: '+54 341 455-2200',
    localidad: '',
    email: 'p.herrera@sanatorio.demo',
  },
  {
    nombre: 'Fernando',
    apellido: 'Ruiz',
    matricula: 'MN-72901',
    especialidad: 'Dermatología',
    telefono: '+54 11 4321-5504',
    localidad: '',
    email: 'f.ruiz@sanatorio.demo',
  },
]

export function generateDemoPatients(): Patient[] {
  return demoPatients.map((row) => ({ ...row, id: createId() }))
}

export function generateDemoDoctors(): Doctor[] {
  return demoDoctors.map((row) => ({ ...row, id: createId() }))
}
