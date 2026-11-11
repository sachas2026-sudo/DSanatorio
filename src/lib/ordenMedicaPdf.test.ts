import { describe, it, expect } from 'vitest'
import {
  buildPrestacionesCatalog,
  generarSiguienteNumeroOrden,
  normalizePrestacionKey,
  agruparPrestaciones,
} from './prestacionesCatalog'
import { buildOrdenMedicaPdf, buildOrdenMedicaHtml } from './ordenMedicaPdf'
import { buildAfiliadoComprobantePdf } from './afiliadoComprobantePdf'
import type { OrdenMedica, Patient, CuotaMensual } from '../types'

describe('prestacionesCatalog', () => {
  it('inicializa con la lista base de prestaciones agrupadas', () => {
    const catalogo = buildPrestacionesCatalog()
    expect(catalogo.length).toBeGreaterThanOrEqual(30)

    const rxTorax = catalogo.find((p) => p.nombre === 'Radiografía de tórax')
    expect(rxTorax).toBeDefined()
    expect(rxTorax?.grupo).toBe('DIAGNÓSTICO POR IMÁGENES')

    const sangre = catalogo.find((p) => p.nombre === 'Extracción de sangre')
    expect(sangre).toBeDefined()
    expect(sangre?.grupo).toBe('LABORATORIO')
  })

  it('no duplica prestaciones y preserva personalizaciones', () => {
    const existentes = [
      { id: 'custom-1', nombre: 'Radiografía de tórax', grupo: 'DIAGNÓSTICO POR IMÁGENES', activa: false },
      { id: 'custom-2', nombre: 'Nueva Práctica Láser', grupo: 'CIRUGÍA', activa: true },
    ]
    const catalogo = buildPrestacionesCatalog(existentes)
    const rx = catalogo.find((p) => p.nombre === 'Radiografía de tórax')
    expect(rx?.activa).toBe(false)

    const laser = catalogo.find((p) => p.nombre === 'Nueva Práctica Láser')
    expect(laser).toBeDefined()
    expect(laser?.grupo).toBe('CIRUGÍA')
  })

  it('agrupa por categoría', () => {
    const catalogo = buildPrestacionesCatalog()
    const grupos = agruparPrestaciones(catalogo)
    expect(grupos.has('DIAGNÓSTICO POR IMÁGENES')).toBe(true)
    expect(grupos.has('LABORATORIO')).toBe(true)
    expect(grupos.has('CARDIOLOGÍA')).toBe(true)
  })

  it('genera correlativo OM-0001, OM-0002...', () => {
    expect(generarSiguienteNumeroOrden([])).toBe('OM-0001')

    const ordenes: OrdenMedica[] = [
      {
        id: '1',
        numero: 'OM-0001',
        patientId: 'p1',
        afiliadoId: 'a1',
        planNombre: 'Plan Individual',
        tipo: 'consulta',
        fecha: '2026-11-09',
        creadaEn: '2026-11-09T10:00:00.000Z',
      },
      {
        id: '2',
        numero: 'OM-0002',
        patientId: 'p2',
        afiliadoId: 'a2',
        planNombre: 'Plan Familiar',
        tipo: 'prestacion',
        prestacionNombre: 'Ecografía abdominal',
        fecha: '2026-11-09',
        creadaEn: '2026-11-09T10:30:00.000Z',
      },
    ]

    expect(generarSiguienteNumeroOrden(ordenes)).toBe('OM-0003')
  })
})

describe('buildOrdenMedicaPdf', () => {
  const patientBase: Patient = {
    id: 'p1',
    apellido: 'GONZALEZ VON DER SCHMIDT DE SAN MARTIN',
    nombre: 'MARIA LAURA ALEJANDRA BEATRIZ',
    dni: '32145678',
    telefono: '',
    email: '',
    domicilio: '',
    localidad: '',
    fechaNacimiento: '1985-05-12',
    obraSocial: 'Plan Familiar',
    notas: '',
    activo: true,
  }

  const ordenBase: OrdenMedica = {
    id: 'om-1',
    numero: 'OM-0005',
    patientId: 'p1',
    afiliadoId: 'a1',
    planNombre: 'Plan Familiar',
    tipo: 'prestacion',
    prestacionNombre: 'Resonancia magnética de columna lumbosacra con contraste endovenoso y reconstrucción 3D',
    medicoNombre: 'MORTCHEFF, SEBASTIAN (Traumatología)',
    fecha: '2026-11-09',
    observaciones: 'Control post operatorio extenso. Paciente refiere dolor lumbar persistente que irradia hacia miembro inferior izquierdo. Se solicita estudio urgente.',
    creadaEn: '2026-11-09T10:00:00.000Z',
  }

  it('genera un PDF en una sola hoja A4 con dos copias (oficina y paciente)', () => {
    const { doc, filename } = buildOrdenMedicaPdf({
      orden: ordenBase,
      patient: patientBase,
      consumo: {
        consultasUsadas: 0,
        consultasCupo: 2,
        prestacionesUsadas: 1,
        prestacionesCupo: 2,
      },
    })

    expect(doc).toBeDefined()
    expect(filename).toContain('om-0005-gonzalez')
    expect(doc.getNumberOfPages()).toBe(1)

    const rawPdf = doc.output()
    // Etiquetas de ambas copias
    expect(rawPdf).toContain('COPIA OFICINA')
    expect(rawPdf).toContain('COPIA PACIENTE')
    // No debe contener la palabra CORTAR ni tijeras
    expect(rawPdf).not.toContain('CORTAR')
    expect(rawPdf).not.toContain('✂')
    // Contadores en formato exacto N-M
    expect(rawPdf).toContain('0-2')
    expect(rawPdf).toContain('1-2')
    // Firma del Contratante (no del afiliado)
    expect(rawPdf).toContain('Firma del Contratante')
    expect(rawPdf).not.toContain('Firma del afiliado')
    // Cobertura en lugar de Plan
    expect(rawPdf).toContain('COBERTURA')
    expect(rawPdf).toContain('ESTADO')
    // No debe contener el subtitulo "Plan de Salud"
    expect(rawPdf).not.toContain('Plan de Salud · Sistema de Afiliados')
  })

  it('funciona correctamente para orden tipo Consulta y sin consumo especificado', () => {
    const ordenConsulta: OrdenMedica = {
      ...ordenBase,
      numero: 'OM-0006',
      tipo: 'consulta',
      prestacionNombre: undefined,
    }

    const { doc, filename } = buildOrdenMedicaPdf({
      orden: ordenConsulta,
      patient: patientBase,
    })

    expect(doc).toBeDefined()
    expect(filename).toContain('om-0006')
    expect(doc.getNumberOfPages()).toBe(1)

    const rawPdf = doc.output()
    expect(rawPdf).toContain('COPIA OFICINA')
    expect(rawPdf).toContain('COPIA PACIENTE')
    expect(rawPdf).toContain('CONSULTA MÉDICA EN CONSULTORIO')
  })

  it('genera HTML imprimible para impresión directa sin abrir vista previa', () => {
    const html = buildOrdenMedicaHtml({
      orden: ordenBase,
      patient: patientBase,
      centroNombre: 'SANATORIO',
      consumo: {
        consultasUsadas: 0,
        consultasCupo: 2,
        prestacionesUsadas: 1,
        prestacionesCupo: 2,
      },
    })

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('COPIA OFICINA')
    expect(html).toContain('COPIA PACIENTE')
    expect(html).toContain('OM-0005')
    expect(html).toContain('0-2')
    expect(html).toContain('1-2')
    expect(html).toContain('Firma del Contratante')
    expect(html).not.toContain('Firma del afiliado')
    expect(html).toContain('COBERTURA')
    expect(html).toContain('ESTADO')
    expect(html).not.toContain('Plan de Salud · Sistema de Afiliados')
    expect(html).toContain('@page')
  })

  it('el comprobante de pago de cuota genera el modelo franja correctamente', () => {
    const cuota: CuotaMensual = {
      id: 'c-1',
      afiliadoId: 'a1',
      mes: 11,
      anio: 2026,
      monto: 50000,
      estado: 'pagado',
      fechaPago: '2026-11-09',
      formaPago: 'efectivo',
    }

    const { doc, filename } = buildAfiliadoComprobantePdf({
      patient: patientBase,
      cuota,
      nombreMes: 'Noviembre',
    })

    expect(doc).toBeDefined()
    expect(filename).toContain('comprobante-pago')
    const rawPdf = doc.output()
    expect(rawPdf).toContain('CENTRO MEDICO - COBERTURA DE SALUD')
    expect(rawPdf).toContain('PAGADO')
    expect(rawPdf).toContain('COBERTURA')
    expect(rawPdf).toContain('CONTRATANTE')
    expect(rawPdf).toContain('Este comprobante acredita el pago de la cuota indicada.')
  })
})

