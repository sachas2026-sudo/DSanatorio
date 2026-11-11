import { describe, expect, it } from 'vitest'
import {
  calcularMontoSugerido,
  doctorAttendsCoverage,
  normalizeOsName,
} from './turnoMonto'
import type { Doctor, ObraSocialCatalog } from '../types'

const mockCatalog: ObraSocialCatalog[] = [
  {
    nombre: 'IPS',
    plus: 25000,
    arancel: 15000,
    cuidar: 0,
    impBanco: 0,
    impFactura: 0,
    gastosAdm: 0,
    suspendida: false,
    version: 1,
  },
  {
    nombre: 'OSDE',
    plus: 0, // Sin plus
    arancel: 10000,
    cuidar: 0,
    impBanco: 0,
    impFactura: 0,
    gastosAdm: 0,
    suspendida: false,
    version: 1,
  },
  {
    nombre: 'PAMI',
    plus: 18000,
    arancel: 8000,
    cuidar: 0,
    impBanco: 0,
    impFactura: 0,
    gastosAdm: 0,
    suspendida: false,
    version: 1,
  },
]

const mockDoctor: Doctor = {
  id: 'doc-1',
  nombre: 'CARMEN',
  apellido: 'ALFONSO',
  matricula: '1234',
  especialidad: 'Endocrinología',
  particular: 40000,
  valor: 0,
  cuidar: 0,
  obrasSociales: [{ nombre: 'IPS' }, { nombre: 'OSDE' }], // No atiende PAMI
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
    expect(doctorAttendsCoverage(mockDoctor, 'Particular')).toBe(true) // Particular siempre atendido
  })
})

describe('turnoMonto - calcularMontoSugerido (5 Reglas de Negocio)', () => {
  it('Regla 1: Médico atiende la obra social y tiene Plus cargado (> 0)', () => {
    const res = calcularMontoSugerido({
      doctor: mockDoctor,
      cobertura: 'IPS',
      obrasSocialesCatalog: mockCatalog,
    })

    expect(res.montoCalculado).toBe(25000)
    expect(res.montoCalculadoFormateado).toBe('25.000')
    expect(res.avisoTipo).toBe('automatic-plus')
    expect(res.avisoTexto).toContain('Valor automático · Plus de IPS (Obras sociales).')
    expect(res.mostrarBotonUsarSugerido).toBe(false)
  })

  it('Regla 2: Médico no atiende esa obra social', () => {
    const res = calcularMontoSugerido({
      doctor: mockDoctor,
      cobertura: 'PAMI',
      obrasSocialesCatalog: mockCatalog,
    })

    expect(res.montoCalculado).toBeNull()
    expect(res.avisoTipo).toBe('warning-not-attended')
    expect(res.avisoTexto).toContain('ALFONSO, CARMEN no atiende PAMI. Elegí otra cobertura.')
    expect(res.mostrarBotonUsarSugerido).toBe(false)
  })

  it('Regla 3: Obra social no tiene Plus cargado (vacío o 0)', () => {
    const res = calcularMontoSugerido({
      doctor: mockDoctor,
      cobertura: 'OSDE',
      obrasSocialesCatalog: mockCatalog,
    })

    expect(res.montoCalculado).toBeNull()
    expect(res.avisoTipo).toBe('info-manual')
    expect(res.avisoTexto).toBe('Esta obra social no tiene Plus cargado. Cargá el monto a mano.')
    expect(res.mostrarBotonUsarSugerido).toBe(false)
  })

  it('Regla 4: Cobertura es Particular (usa valor particular de la ficha del médico)', () => {
    const res = calcularMontoSugerido({
      doctor: mockDoctor,
      cobertura: 'Particular',
      obrasSocialesCatalog: mockCatalog,
    })

    expect(res.montoCalculado).toBe(40000)
    expect(res.montoCalculadoFormateado).toBe('40.000')
    expect(res.avisoTipo).toBe('automatic-particular')
    expect(res.avisoTexto).toBe('Valor automático · Particular de ALFONSO, CARMEN.')
    expect(res.mostrarBotonUsarSugerido).toBe(false)
  })

  it('Regla 5: Usuario escribe otro monto manualmente -> respeta monto y ofrece botón "Usar sugerido"', () => {
    const res = calcularMontoSugerido({
      doctor: mockDoctor,
      cobertura: 'IPS', // Sugerido es 25.000
      obrasSocialesCatalog: mockCatalog,
      montoActualInput: '30.000', // Usuario escribió 30.000
      usuarioEditoManualmente: true,
    })

    expect(res.montoCalculado).toBe(25000)
    expect(res.sugeridoParaBoton).toBe(25000)
    expect(res.mostrarBotonUsarSugerido).toBe(true)
  })

  it('Regla 5b: Usuario escribe manualmente el mismo monto que el sugerido -> no muestra botón duplicado', () => {
    const res = calcularMontoSugerido({
      doctor: mockDoctor,
      cobertura: 'IPS',
      obrasSocialesCatalog: mockCatalog,
      montoActualInput: '25.000',
      usuarioEditoManualmente: true,
    })

    expect(res.montoCalculado).toBe(25000)
    expect(res.mostrarBotonUsarSugerido).toBe(false)
  })
})

