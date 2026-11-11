import { describe, it, expect } from 'vitest'
import { generarReciboPdf, formatNroRecibo } from './reciboPdf'

describe('reciboPdf - Modelo Franja', () => {
  it('formatea el número de recibo en formato 0001-00000001', () => {
    expect(formatNroRecibo('1')).toBe('0001-00000001')
    expect(formatNroRecibo('45')).toBe('0001-00000045')
    expect(formatNroRecibo('0001-00000005')).toBe('0001-00000005')
    expect(formatNroRecibo(undefined)).toBe('0001-00000001')
  })

  it('genera el PDF con los datos de prueba requeridos', () => {
    const doc = generarReciboPdf({
      paciente: 'ACOSTA, ARNALDO',
      dni: '56',
      cobertura: 'Plan Individual',
      periodo: 'Enero 2026',
      fechaPago: '04-11-2026',
      formaPago: 'Efectivo',
      importe: 50000,
      nroRecibo: '0001-00000001',
    })

    expect(doc).toBeDefined()
    const pdfText = doc.output()
    expect(pdfText).toContain('CENTRO MEDICO - COBERTURA DE SALUD')
    expect(pdfText).toContain('Comprobante de pago')
    expect(pdfText).toContain('0001-00000001')
    expect(pdfText).toContain('$50.000')
    expect(pdfText).toContain('CONTRATANTE')
    expect(pdfText).toContain('ACOSTA, ARNALDO')
    expect(pdfText).toContain('56')
    expect(pdfText).toContain('Plan Individual')
    expect(pdfText).toContain('Enero 2026')
    expect(pdfText).toContain('04-11-2026')
    expect(pdfText).toContain('Efectivo')
    expect(pdfText).toContain('PAGADO')
    expect(pdfText).toContain('Este comprobante acredita el pago de la cuota indicada.')
  })
})

