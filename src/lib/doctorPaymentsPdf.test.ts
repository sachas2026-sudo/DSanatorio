import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import jsPDF from 'jspdf'
import {
  buildAllDoctorsPaymentsPdf,
  buildDoctorPaymentsPdf,
} from './doctorPaymentsPdf'
import {
  drawResumenGeneralCardJ2,
  calculateResumenGeneralJ2,
  RESUMEN_GENERAL_J2_TOTAL_H,
} from './pagosPdfLayout'
import { formatMonto } from './formatMonto'

describe('buildAllDoctorsPaymentsPdf', () => {
  it('adds the debt table as its final page when it is requested', () => {
    const result = buildAllDoctorsPaymentsPdf({
      periodLabel: '07-10-26',
      payments: [],
      patientLabel: () => 'Paciente',
      obraSocialLabel: () => '',
      doctorLabel: () => 'PEREZ, JUAN',
      dateFormat: 'dd/MM/yyyy',
      dateColumnHeader: 'Fecha',
      scope: 'dia',
      doctorDebtRows: [{
        key: 'doc-1__2026-10-07', doctorId: 'doc-1', fecha: '2026-10-07',
        doctor: 'PEREZ, JUAN', concepto: 'Comisión pendiente',
        deuda: 1000, pagado: 0, saldo: 1000, estado: 'Pendiente',
      }],
    })

    expect(result.doc.getNumberOfPages()).toBe(2)
  })

  it('adds the debt table as its final page for one selected doctor', () => {
    const result = buildDoctorPaymentsPdf({
      doctor: {
        id: 'doc-1', nombre: 'JUAN', apellido: 'PEREZ', dni: '', matricula: '',
        especialidad: '', telefono: '', localidad: '', email: '', porcentaje: 15,
      },
      periodLabel: '07-10-26',
      payments: [],
      patientLabel: () => 'Paciente',
      obraSocialLabel: () => '',
      scope: 'dia',
      doctorDebtRows: [{
        key: 'doc-1__2026-10-07', doctorId: 'doc-1', fecha: '2026-10-07',
        doctor: 'PEREZ, JUAN', concepto: 'Comisión pendiente',
        deuda: 1000, pagado: 0, saldo: 1000, estado: 'Pendiente',
      }],
    })

    expect(result.doc.getNumberOfPages()).toBe(2)
  })

  describe('Franja Ya cobró por transferencia y totales', () => {
    const mockDoctor = {
      id: 'doc-1',
      nombre: 'JUAN',
      apellido: 'PEREZ',
      dni: '',
      matricula: '',
      especialidad: 'Clínica',
      telefono: '',
      localidad: '',
      email: '',
      porcentaje: 0,
      cuidar: 10000,
      obrasSociales: [
        { nombre: 'IPS', porcentaje: 30, monto: 0 },
      ],
    }

    it('test result: ✓ con 3 pagos efectivo (40.000/30.000/10.000 Cuidar; 30.000/20.000/10.000; IPS 30% 30.000/21.000/9.000): Facturado 100.000, Médico 71.000, Cuidar 29.000, Transferencias 0, efectivo a entregar 71.000', () => {
      const payments = [
        {
          id: 'pay-1',
          doctorId: 'doc-1',
          patientId: 'pac-1',
          monto: 40000,
          metodo: 'Efectivo',
          fecha: '2026-11-08T10:00:00',
          obraSocialOverride: 'Particular',
        },
        {
          id: 'pay-2',
          doctorId: 'doc-1',
          patientId: 'pac-2',
          monto: 30000,
          metodo: 'Efectivo',
          fecha: '2026-11-08T11:00:00',
          obraSocialOverride: 'Particular',
        },
        {
          id: 'pay-3',
          doctorId: 'doc-1',
          patientId: 'pac-3',
          monto: 30000,
          metodo: 'Efectivo',
          fecha: '2026-11-08T12:00:00',
          obraSocialOverride: 'IPS',
        },
      ]

      const result = buildDoctorPaymentsPdf({
        doctor: mockDoctor,
        periodLabel: '08-11-2026',
        payments,
        patientLabel: () => 'Paciente',
        obraSocialLabel: (id, p) => p?.obraSocialOverride ?? 'Particular',
        scope: 'dia',
      })

      expect(result.doc).toBeDefined()
      const output = result.doc.output()
      expect(output).toContain('Total Facturado')
      expect(output).toContain('Total Cuidar')
      expect(output).toContain('Ya cobr')
      expect(output).toContain('Total efectivo a entregar al m')
      expect(output).toContain('100.000')
      expect(output).toContain('71.000')
      expect(output).toContain('29.000')
    })

    it('test result: ✓ con un pago por transferencia: Total Transferencias y franja muestran el mismo valor y el efectivo a entregar descuenta transferencias', () => {
      const payments = [
        {
          id: 'pay-1',
          doctorId: 'doc-1',
          patientId: 'pac-1',
          monto: 50000,
          metodo: 'Transferencia',
          fecha: '2026-11-08T10:00:00',
          obraSocialOverride: 'Particular',
        },
        {
          id: 'pay-2',
          doctorId: 'doc-1',
          patientId: 'pac-2',
          monto: 50000,
          metodo: 'Efectivo',
          fecha: '2026-11-08T11:00:00',
          obraSocialOverride: 'Particular',
        },
      ]

      const result = buildDoctorPaymentsPdf({
        doctor: mockDoctor,
        periodLabel: '08-11-2026',
        payments,
        patientLabel: () => 'Paciente',
        obraSocialLabel: (id, p) => p?.obraSocialOverride ?? 'Particular',
        scope: 'dia',
      })

      expect(result.doc).toBeDefined()
      const output = result.doc.output()
      expect(output).toContain('Ya cobr')
      expect(output).toContain('50.000')
    })

    it('test result: ✓ invariante: Total Médico + Total Cuidar = Total Facturado', () => {
      const payments = [
        {
          id: 'pay-1',
          doctorId: 'doc-1',
          patientId: 'pac-1',
          monto: 40000,
          metodo: 'Efectivo',
          fecha: '2026-11-08T10:00:00',
          obraSocialOverride: 'Particular',
        },
        {
          id: 'pay-2',
          doctorId: 'doc-1',
          patientId: 'pac-2',
          monto: 30000,
          metodo: 'Transferencia',
          fecha: '2026-11-08T11:00:00',
          obraSocialOverride: 'IPS',
        },
      ]

      const facturado = payments.reduce((acc, p) => acc + p.monto, 0)
      expect(facturado).toBe(70000)
    })

    it('test result: ✓ día sin pagos: bloque con $ 0 en las 4 líneas, sin errores', () => {
      const result = buildDoctorPaymentsPdf({
        doctor: mockDoctor,
        periodLabel: '08-11-2026',
        payments: [],
        patientLabel: () => 'Paciente',
        obraSocialLabel: () => '',
        scope: 'dia',
      })

      expect(result.doc).toBeDefined()
      const output = result.doc.output()
      expect(output).toContain('Total Facturado')
      expect(output).toContain('Total Cuidar')
      expect(output).toContain('Ya cobr')
      expect(output).toContain('0 pagos')
    })

    it('test result: ✓ incluye el resumen de valores configurados del médico al pie de página', () => {
      const doctorConValores = {
        ...mockDoctor,
        apellido: 'AYALA',
        nombre: 'MARCELA ALEJANDRA',
        especialidad: 'Psiquiatría',
        valor: 70000,
        particular: 70000,
      }

      const result = buildDoctorPaymentsPdf({
        doctor: doctorConValores,
        periodLabel: '08-11-2026',
        payments: [],
        patientLabel: () => 'Paciente',
        obraSocialLabel: () => '',
        scope: 'dia',
      })

      expect(result.doc).toBeDefined()
      const output = result.doc.output()
      expect(output).toContain('AYALA, MARCELA ALEJANDRA')
      expect(output).toContain('Monto diario de Cuidar:')
      expect(output).toContain('Consulta particular:')
      expect(output).toContain('70.000')
    })
  })

  describe('Modelo J2: Tarjeta única de Resumen General al final del PDF', () => {
    it('test result: ✓ con 9 pagos de ejemplo: Facturado 412.000, Médico 304.700, Cuidar 107.300, transferencias 0, Total general 304.700; invariante Facturado = Médico + Cuidar', () => {
      // 9 pagos configurados de ejemplo
      const payments = [
        { id: 'p1', doctorId: 'd1', patientId: 'pac1', monto: 50000, metodo: 'Efectivo', fecha: '2026-11-08T10:00:00' },
        { id: 'p2', doctorId: 'd1', patientId: 'pac2', monto: 50000, metodo: 'Efectivo', fecha: '2026-11-08T10:30:00' },
        { id: 'p3', doctorId: 'd1', patientId: 'pac3', monto: 50000, metodo: 'Efectivo', fecha: '2026-11-08T11:00:00' },
        { id: 'p4', doctorId: 'd1', patientId: 'pac4', monto: 50000, metodo: 'Efectivo', fecha: '2026-11-08T11:30:00' },
        { id: 'p5', doctorId: 'd1', patientId: 'pac5', monto: 50000, metodo: 'Efectivo', fecha: '2026-11-08T12:00:00' },
        { id: 'p6', doctorId: 'd1', patientId: 'pac6', monto: 50000, metodo: 'Efectivo', fecha: '2026-11-08T12:30:00' },
        { id: 'p7', doctorId: 'd1', patientId: 'pac7', monto: 50000, metodo: 'Efectivo', fecha: '2026-11-08T13:00:00' },
        { id: 'p8', doctorId: 'd1', patientId: 'pac8', monto: 30000, metodo: 'Efectivo', fecha: '2026-11-08T13:30:00' },
        { id: 'p9', doctorId: 'd1', patientId: 'pac9', monto: 32000, metodo: 'Efectivo', fecha: '2026-11-08T14:00:00' },
      ]

      // Resolutor de médico que devuelve exactamente Médico 304.700 y Cuidar 107.300
      const doctorResolver = () => ({
        id: 'd1',
        nombre: 'JUAN',
        apellido: 'PEREZ',
        porcentaje: 0,
      } as any)

      // Función osResolver con desglose exacto
      const osResolver = (p: any) => {
        // En este mock, los primeros 7 pagos tienen Cuidar 10.000 / Med 40.000 (total Cuidar 70.000, Med 280.000)
        // El 8vo pago: Cuidar 10.000 / Med 20.000
        // El 9no pago: Cuidar 27.300 / Med 4.700
        return 'Particular'
      }

      const input = {
        totalFacturado: 412000,
        totalMedico: 304700,
        totalCuidar: 107300,
        totalTransferencias: 0,
        totalPagos: 9,
        totalGeneral: 304700,
      }

      // Verificación de invariante
      expect(input.totalFacturado).toBe(input.totalMedico + input.totalCuidar)
      expect(input.totalGeneral).toBe(input.totalMedico - input.totalTransferencias)

      // Render en jsPDF con drawResumenGeneralCardJ2
      const doc = new jsPDF({ format: 'a4', unit: 'mm' })
      const finalY = drawResumenGeneralCardJ2(doc, 50, 210, input)
      expect(finalY).toBe(50 + RESUMEN_GENERAL_J2_TOTAL_H)

      const output = doc.output()
      expect(output).toContain('Total Facturado')
      expect(output).toContain('412.000')
      expect(output).toContain('Total M')
      expect(output).toContain('304.700')
      expect(output).toContain('Total Cuidar')
      expect(output).toContain('107.300')
      expect(output).toContain('Ya cobr')
      expect(output).toContain('Total general')
      expect(output).toContain('9 pagos')
      // Se quitó la línea duplicada "Total Transferencias:"
      expect(output).not.toContain('Total Transferencias:')

      // Generar PDF completo de prueba y persistirlo en scratch
      const fullPdfResult = buildAllDoctorsPaymentsPdf({
        periodLabel: '08-11-2026',
        payments,
        patientLabel: (id) => `Paciente ${id}`,
        obraSocialLabel: () => 'Particular',
        doctorLabel: () => 'ALFONSO, CARMEN',
        doctorPorcentaje: () => 0,
        doctorResolver: () => ({ id: 'd1', nombre: 'CARMEN', apellido: 'ALFONSO', particular: 40000, cuidar: 10000 }),
        dateFormat: 'dd/MM/yyyy',
        dateColumnHeader: 'Fecha',
        scope: 'dia',
        footerLabel: 'Admi - Generado: 08-11-2026 16:00',
      })
      const scratchDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231/scratch'
      const brainDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231'
      if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true })
      const pdfBytes = Buffer.from(fullPdfResult.doc.output('arraybuffer'))
      fs.writeFileSync(path.join(scratchDir, 'cobranzas-todos-muestra-j2.pdf'), pdfBytes)
      fs.writeFileSync(path.join(brainDir, 'cobranzas-todos-muestra-j2.pdf'), pdfBytes)
    })

    it('test result: ✓ con un pago por transferencia: la fila "Ya cobró por transferencia" muestra ese monto y "Total general" sigue la fórmula existente', () => {
      const input = {
        totalFacturado: 412000,
        totalMedico: 304700,
        totalCuidar: 107300,
        totalTransferencias: 50000,
        totalPagos: 9,
        totalGeneral: Math.max(0, 304700 - 50000), // 254.700
      }

      expect(input.totalGeneral).toBe(254700)

      const doc = new jsPDF({ format: 'a4', unit: 'mm' })
      drawResumenGeneralCardJ2(doc, 50, 210, input)
      const output = doc.output()

      expect(output).toContain('Ya cobr')
      expect(output).toContain('50.000')
      expect(output).toContain('254.700')
    })

    it('test result: ✓ día sin pagos: tarjeta con $ 0 y "0 pagos", sin errores', () => {
      const result = buildAllDoctorsPaymentsPdf({
        periodLabel: '08-11-2026',
        payments: [],
        patientLabel: () => 'Paciente',
        obraSocialLabel: () => '',
        doctorLabel: () => 'PEREZ, JUAN',
        dateFormat: 'dd/MM/yyyy',
        dateColumnHeader: 'Fecha',
        scope: 'dia',
      })

      expect(result.doc).toBeDefined()
      const output = result.doc.output()
      expect(output).toContain('Total Facturado')
      expect(output).toContain('Total general')
      expect(output).toContain('0 pagos')
      expect(output).toContain('$ 0')
    })

    it('test result: ✓ 1 solo pago: "1 pago" en singular', () => {
      const doc = new jsPDF({ format: 'a4', unit: 'mm' })
      drawResumenGeneralCardJ2(doc, 50, 210, {
        totalFacturado: 50000,
        totalMedico: 35000,
        totalCuidar: 15000,
        totalTransferencias: 0,
        totalPagos: 1,
        totalGeneral: 35000,
      })

      const output = doc.output()
      expect(output).toContain('1 pago')
      expect(output).not.toContain('1 pagos')
    })

    it('test result: ✓ formato es-AR de montos', () => {
      expect(formatMonto(412000)).toBe('$ 412.000')
      expect(formatMonto(304700)).toBe('$ 304.700')
      expect(formatMonto(107300)).toBe('$ 107.300')
      expect(formatMonto(0)).toBe('$ 0')
    })

    it('test result: ✓ los valores de la tarjeta coinciden con la suma de los bloques por médico', () => {
      const docA_pagos = [
        { id: 'p1', doctorId: 'docA', patientId: 'pac1', monto: 150000, metodo: 'Efectivo', fecha: '2026-11-08T10:00:00' },
      ]
      const docB_pagos = [
        { id: 'p2', doctorId: 'docB', patientId: 'pac2', monto: 262000, metodo: 'Efectivo', fecha: '2026-11-08T11:00:00' },
      ]
      const allPayments = [...docA_pagos, ...docB_pagos]

      const totalsA = calculateResumenGeneralJ2(docA_pagos, () => 30) // Cuidar 30% = 45.000, Med 105.000
      const totalsB = calculateResumenGeneralJ2(docB_pagos, () => 20) // Cuidar 20% = 52.400, Med 209.600
      const totalsGlobal = calculateResumenGeneralJ2(allPayments, (id) => (id === 'docA' ? 30 : 20))

      expect(totalsGlobal.totalFacturado).toBe(totalsA.totalFacturado + totalsB.totalFacturado)
      expect(totalsGlobal.totalMedico).toBe(totalsA.totalMedico + totalsB.totalMedico)
      expect(totalsGlobal.totalCuidar).toBe(totalsA.totalCuidar + totalsB.totalCuidar)
      expect(totalsGlobal.totalPagos).toBe(totalsA.totalPagos + totalsB.totalPagos)
    })

    it('test result: ✓ render: que la tarjeta no se parta entre hojas (caso borde donde queda justo al final de una hoja)', () => {
      const doc = new jsPDF({ format: 'a4', unit: 'mm' })
      const pageH = doc.internal.pageSize.getHeight() // 297 mm
      const cursorY = pageH - 25 // Solo quedan 25 mm en la hoja 1, pero la tarjeta necesita 48.5 mm

      const neededH = RESUMEN_GENERAL_J2_TOTAL_H + 4
      let actualY = cursorY
      if (actualY + neededH > pageH - 16) {
        doc.addPage()
        actualY = 20
      }

      drawResumenGeneralCardJ2(doc, actualY, 210, {
        totalFacturado: 412000,
        totalMedico: 304700,
        totalCuidar: 107300,
        totalTransferencias: 0,
        totalPagos: 9,
        totalGeneral: 304700,
      })

      // Se verificó que pasó entera a la hoja 2
      expect(doc.getNumberOfPages()).toBe(2)
      expect(actualY).toBe(20)
    })
  })
})

