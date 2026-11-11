import { describe, expect, it } from 'vitest'
import {
  extraerInicialesPaciente,
  filtrarPacientes,
  moverIndiceResaltado,
  precargarDatosPacienteNuevo,
  resaltarCoincidencias,
} from '../titularSearch'

const PACIENTES_MOCK = [
  { id: 'p1', apellido: 'ACOSTA', nombre: 'ARNALDO', dni: '58346122', obraSocial: 'IPS' },
  { id: 'p2', apellido: 'Ácosta', nombre: 'Ana María (Hija)', dni: '40123456', obraSocial: 'Particular' },
  { id: 'p3', apellido: 'RAMÍREZ', nombre: 'SONIA BEATRIZ', dni: '31583400', obraSocial: 'ASIS SALUD' },
  { id: 'p4', apellido: 'Gómez', nombre: 'Juan C.', dni: '22999111', obraSocial: 'Particular' },
]

describe('titularSearch - búsqueda y resaltado del Contratante Titular (R1)', () => {
  it('busca sin distinguir tildes ni mayúsculas ("ácosta" y "ACOSTA" dan lo mismo)', () => {
    const r1 = filtrarPacientes(PACIENTES_MOCK, 'ácosta')
    const r2 = filtrarPacientes(PACIENTES_MOCK, 'ACOSTA')
    expect(r1.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(r2.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('permite varias palabras en cualquier orden ("arnaldo acosta" y "ana cos")', () => {
    const rArnaldo = filtrarPacientes(PACIENTES_MOCK, 'arnaldo acosta')
    expect(rArnaldo.map((p) => p.id)).toEqual(['p1'])

    const rAna = filtrarPacientes(PACIENTES_MOCK, 'ana cos')
    expect(rAna.map((p) => p.id)).toEqual(['p2'])
  })

  it('encuentra pacientes por DNI parcial', () => {
    const r = filtrarPacientes(PACIENTES_MOCK, '5834')
    expect(r.map((p) => p.id)).toEqual(['p1', 'p3'])

    const rExacto = filtrarPacientes(PACIENTES_MOCK, '583461')
    expect(rExacto.map((p) => p.id)).toEqual(['p1'])
  })

  it('devuelve lista vacía cuando no hay coincidencias y todos (hasta el límite) con texto vacío', () => {
    expect(filtrarPacientes(PACIENTES_MOCK, 'zzxxyy999')).toEqual([])
    expect(filtrarPacientes(PACIENTES_MOCK, '')).toHaveLength(4)
    expect(filtrarPacientes(PACIENTES_MOCK, '   ', 2)).toHaveLength(2)
  })

  it('resalta coincidencias devolviendo partes antes/coincidencia/después sin romper con tildes ni caracteres especiales', () => {
    const segs = resaltarCoincidencias('Ácosta, Ana María (Hija).', 'acosta (hija)')
    const reconstruido = segs.map((s) => s.text).join('')
    expect(reconstruido).toBe('Ácosta, Ana María (Hija).')
    expect(segs).toEqual([
      { text: 'Ácosta', match: true },
      { text: ', Ana María ', match: false },
      { text: '(Hija)', match: true },
      { text: '.', match: false },
    ])
  })

  it('navega por teclado respetando los topes superior e inferior', () => {
    // 5 opciones (0 = "+ Cargar paciente nuevo", 1..4 = pacientes)
    expect(moverIndiceResaltado(0, -1, 5)).toBe(0)
    expect(moverIndiceResaltado(0, 1, 5)).toBe(1)
    expect(moverIndiceResaltado(4, 1, 5)).toBe(4)
    expect(moverIndiceResaltado(4, -1, 5)).toBe(3)
  })

  it('extrae iniciales y precarga datos para paciente nuevo', () => {
    expect(extraerInicialesPaciente({ apellido: 'Acosta', nombre: 'Arnaldo' })).toBe('AA')
    expect(precargarDatosPacienteNuevo('40123456')).toEqual({
      dni: '40123456',
      apellido: '',
      nombre: '',
    })
    expect(precargarDatosPacienteNuevo('Acosta, Arnaldo')).toEqual({
      dni: '',
      apellido: 'Acosta',
      nombre: 'Arnaldo',
    })
  })
})

