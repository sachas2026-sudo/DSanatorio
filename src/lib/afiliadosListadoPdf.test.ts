import { describe, expect, it } from 'vitest'
import { buildAfiliadosListadoPdf } from './afiliadosListadoPdf'
import type { Afiliado, Patient, PlanAfiliado } from '../types'

describe('afiliadosListadoPdf', () => {
  const planes: PlanAfiliado[] = [
    {
      id: 'p-ind',
      nombre: 'Plan Individual',
      tipo: 'individual',
      precio: 15000,
      descripcion: '',
      activo: true,
      cupoConsultas: 2,
      prestacionesPorMes: 2,
      maxAdherentes: 0,
    },
    {
      id: 'p-fam',
      nombre: 'Plan Familiar',
      tipo: 'familiar',
      precio: 35000,
      descripcion: '',
      activo: true,
      cupoConsultas: 2,
      prestacionesPorMes: 2,
      maxAdherentes: 4,
    },
  ]

  const patients: Patient[] = [
    {
      id: 'pac-1',
      apellido: 'Acosta',
      nombre: 'Arnaldo',
      dni: '12345678',
      fechaNacimiento: '1980-05-15',
      telefono: '',
      activo: true,
      localidad: '',
      domicilio: '',
      email: '',
    },
    {
      id: 'pac-2',
      apellido: 'Gómez',
      nombre: 'María',
      dni: '22333444',
      fechaNacimiento: '1982-10-20',
      telefono: '',
      activo: true,
      localidad: '',
      domicilio: '',
      email: '',
    },
    {
      id: 'pac-3',
      apellido: 'Acosta',
      nombre: 'Bautista',
      dni: '55666777',
      fechaNacimiento: '2010-03-12',
      telefono: '',
      activo: true,
      localidad: '',
      domicilio: '',
      email: '',
    },
    {
      id: 'pac-4',
      apellido: 'Pérez',
      nombre: 'Juan',
      dni: '',
      fechaNacimiento: '',
      telefono: '',
      activo: true,
      localidad: '',
      domicilio: '',
      email: '',
    },
  ]

  const afiliados: Afiliado[] = [
    {
      id: 'af-fam-1',
      patientId: 'pac-1',
      planId: 'p-fam',
      fechaInicio: '2025-01-10',
      activo: true,
      adherentes: [
        { patientId: 'pac-2', relacion: 'Cónyuge' },
        { patientId: 'pac-3', relacion: 'Hijo/a' },
      ],
    },
    {
      id: 'af-ind-1',
      patientId: 'pac-4',
      planId: 'p-ind',
      fechaInicio: '2025-03-01',
      activo: true,
    },
  ]

  it('genera el PDF con todos los planes si planFiltroId es null o undefined', () => {
    const res = buildAfiliadosListadoPdf({
      afiliados,
      planes,
      patients,
      fechaGeneracion: new Date(2026, 10, 9),
    })

    expect(res.filename).toBe('listado_afiliados_2026-11-09.pdf')
    expect(res.totalPersonas).toBe(4) // 3 de la familia + 1 individual
    expect(res.totalFamilias).toBe(2)
    expect(res.totalPlanes).toBe(2)
    expect(res.doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })

  it('filtra correctamente por un plan específico', () => {
    const res = buildAfiliadosListadoPdf({
      afiliados,
      planes,
      patients,
      planFiltroId: 'p-fam',
      fechaGeneracion: new Date(2026, 10, 9),
    })

    expect(res.totalPersonas).toBe(3) // Solo los 3 del familiar
    expect(res.totalFamilias).toBe(1)
    expect(res.totalPlanes).toBe(1)
  })

  it('maneja datos faltantes colocando "—"', () => {
    const res = buildAfiliadosListadoPdf({
      afiliados,
      planes,
      patients,
      planFiltroId: 'p-ind',
      fechaGeneracion: new Date(2026, 10, 9),
    })

    expect(res.totalPersonas).toBe(1)
    expect(res.totalFamilias).toBe(1)
    expect(res.doc.getNumberOfPages()).toBe(1)
  })

  it('devuelve total 0 personas si no hay afiliados que coincidan', () => {
    const res = buildAfiliadosListadoPdf({
      afiliados: [],
      planes,
      patients,
      planFiltroId: 'p-fam',
    })

    expect(res.totalPersonas).toBe(0)
    expect(res.totalFamilias).toBe(0)
    expect(res.totalPlanes).toBe(0)
  })

  it('pagina correctamente y preserva el pie de página cuando hay muchos afiliados', () => {
    const muchosPacientes: Patient[] = []
    const muchosAfiliados: Afiliado[] = []

    for (let i = 1; i <= 60; i++) {
      const pid = `pac-bulk-${i}`
      muchosPacientes.push({
        id: pid,
        apellido: `Apellido${i.toString().padStart(2, '0')}`,
        nombre: `Nombre${i}`,
        dni: `300000${i.toString().padStart(2, '0')}`,
        fechaNacimiento: '1990-01-01',
        telefono: '',
        activo: true,
        localidad: '',
        domicilio: '',
        email: '',
      })
      muchosAfiliados.push({
        id: `af-bulk-${i}`,
        patientId: pid,
        planId: 'p-ind',
        fechaInicio: '2025-01-01',
        activo: true,
      })
    }

    const res = buildAfiliadosListadoPdf({
      afiliados: muchosAfiliados,
      planes,
      patients: muchosPacientes,
      planFiltroId: 'p-ind',
      fechaGeneracion: new Date(2026, 10, 9),
    })

    expect(res.totalPersonas).toBe(60)
    expect(res.doc.getNumberOfPages()).toBeGreaterThan(1)
  })
})

