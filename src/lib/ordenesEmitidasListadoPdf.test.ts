import { describe, it, expect } from 'vitest'
import { buildOrdenesEmitidasListadoPdf } from './ordenesEmitidasListadoPdf'
import type { OrdenMedica, Patient } from '../types'

describe('ordenesEmitidasListadoPdf', () => {
  const patient1: Patient = {
    id: 'p1',
    apellido: 'ACOSTA',
    nombre: 'ARNALDO',
    dni: '56',
    telefono: '3751 60-7242',
    email: '',
    domicilio: '',
    localidad: 'Puerto Piray',
    fechaNacimiento: '1970-01-01',
    obraSocial: 'Plan Individual',
    notas: '',
    activo: true,
  }

  const patient2: Patient = {
    id: 'p2',
    apellido: 'GONZALEZ',
    nombre: 'MARIA',
    dni: '32145678',
    telefono: '',
    email: '',
    domicilio: '',
    localidad: 'Montecarlo',
    fechaNacimiento: '1985-05-12',
    obraSocial: 'Plan Familiar',
    notas: '',
    activo: true,
  }

  const ordenes: OrdenMedica[] = [
    {
      id: 'om-1',
      numero: 'OM-0001',
      patientId: 'p1',
      afiliadoId: 'af-1',
      planNombre: 'Plan Individual',
      tipo: 'consulta',
      medicoNombre: 'MORTCHEFF, SEBASTIAN (Traumatología)',
      fecha: '2026-11-05',
      creadaEn: '2026-11-05T10:00:00.000Z',
    },
    {
      id: 'om-2',
      numero: 'OM-0002',
      patientId: 'p2',
      afiliadoId: 'af-2',
      planNombre: 'Plan Familiar',
      tipo: 'prestacion',
      prestacionNombre: 'Ecocardiograma Doppler',
      medicoNombre: 'MARQUEZ, ALEJANDRA (Dermatología)',
      fecha: '2026-11-09',
      observaciones: 'Control ecográfico post-quirúrgico',
      creadaEn: '2026-11-09T11:00:00.000Z',
    },
    {
      id: 'om-3',
      numero: 'OM-0003',
      patientId: 'p1',
      afiliadoId: 'af-1',
      planNombre: 'Plan Individual',
      tipo: 'prestacion',
      prestacionNombre: 'Electrocardiograma',
      fecha: '2026-11-08',
      creadaEn: '2026-11-08T09:00:00.000Z',
    },
  ]

  it('ordena las órdenes de mayor a menor según la fecha', () => {
    const res = buildOrdenesEmitidasListadoPdf({
      ordenes,
      patients: [patient1, patient2],
      fechaGeneracion: new Date('2026-11-09T15:00:00.000Z'),
    })

    expect(res.doc).toBeDefined()
    expect(res.totalOrdenes).toBe(3)
    expect(res.totalConsultas).toBe(1)
    expect(res.totalPrestaciones).toBe(2)
    expect(res.totalAfiliados).toBe(2)
    expect(res.filename).toBe('ordenes-medicas-emitidas-2026-11-09.pdf')

    // Documento en apaisado (landscape)
    expect(Math.round(res.doc.internal.pageSize.getWidth())).toBe(297)
    expect(Math.round(res.doc.internal.pageSize.getHeight())).toBe(210)

    const rawPdf = res.doc.output()
    expect(rawPdf).toContain('LISTADO DE')
    expect(rawPdf).toContain('ACOSTA, ARNALDO')
    expect(rawPdf).toContain('GONZALEZ, MARIA')
    expect(rawPdf).toContain('OM-0002')
    expect(rawPdf).toContain('OM-0003')
    expect(rawPdf).toContain('OM-0001')
  })

  it('funciona correctamente sin órdenes registradas', () => {
    const res = buildOrdenesEmitidasListadoPdf({
      ordenes: [],
      patients: [],
    })

    expect(res.totalOrdenes).toBe(0)
    expect(res.totalConsultas).toBe(0)
    expect(res.totalPrestaciones).toBe(0)
    expect(res.totalAfiliados).toBe(0)
    expect(res.doc.getNumberOfPages()).toBe(1)
  })
})
