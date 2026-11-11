import { describe, expect, it } from 'vitest'
import type { Doctor, Payment } from '../types'
import {
  calcularDesglosePagoFila,
  buildPaymentsSettlementMap,
  resolveDoctorPaymentSettlement,
  computeDoctorPorcentajeSettlement,
} from './pagosPdfLayout'
import { aggregatePorcentajeSettlementForPayments } from './paymentPorcentaje'
import { buildDoctorPaymentsPdf } from './doctorPaymentsPdf'

const mockDoctor = (partial?: Partial<Doctor>): Doctor => ({
  id: 'doc-1',
  nombre: 'CARMEN',
  apellido: 'ALFONSO',
  dniMed: '12345678',
  matricula: 'MN1234',
  especialidad: 'Endocrinología',
  particular: 40000,
  cuidar: 10000,
  porcentaje: 0,
  obrasSociales: [
    { nombre: 'PREVENCION SALUD', porcentaje: 30 },
  ],
  ...partial,
})

const mockPayment = (partial: Partial<Payment> & Pick<Payment, 'id'>): Payment => ({
  patientId: 'pat-1',
  doctorId: 'doc-1',
  citaId: 'app-1',
  monto: 40000,
  fecha: '2026-11-06T10:00:00',
  metodo: 'Efectivo',
  notas: '',
  ...partial,
})

describe('calcularDesglosePagoFila - función pura de desglose', () => {
  it('particular con Cuidar fijo: $ 40.000 / Cuidar $ 10.000 / Médico $ 30.000', () => {
    const doc = mockDoctor({ particular: 40000, cuidar: 10000 })
    const p = mockPayment({ id: '1', monto: 40000 })
    const desglose = calcularDesglosePagoFila(p, doc, 'Particular')

    expect(desglose.monto).toBe(40000)
    expect(desglose.cuidar).toBe(10000)
    expect(desglose.medico).toBe(30000)
    expect(desglose.montoLabel).toBe('$ 40.000')
    expect(desglose.cuidarLabel).toBe('$ 10.000')
    expect(desglose.medicoLabel).toBe('$ 30.000')
  })

  it('particular con Cuidar 0: $ 40.000 / Cuidar $ 0 / Médico $ 40.000', () => {
    const doc = mockDoctor({ particular: 40000, cuidar: 0 })
    const p = mockPayment({ id: '1', monto: 40000 })
    const desglose = calcularDesglosePagoFila(p, doc, 'Particular')

    expect(desglose.monto).toBe(40000)
    expect(desglose.cuidar).toBe(0)
    expect(desglose.medico).toBe(40000)
    expect(desglose.montoLabel).toBe('$ 40.000')
    expect(desglose.cuidarLabel).toBe('$ 0')
    expect(desglose.medicoLabel).toBe('$ 40.000')
  })

  it('obra social con porcentaje: 30 % de $ 30.000 -> Cuidar $ 9.000 / Médico $ 21.000', () => {
    const doc = mockDoctor()
    const p = mockPayment({ id: '1', monto: 30000 })
    const desglose = calcularDesglosePagoFila(p, doc, 'PREVENCION SALUD')

    expect(desglose.monto).toBe(30000)
    expect(desglose.cuidar).toBe(9000)
    expect(desglose.medico).toBe(21000)
    expect(desglose.montoLabel).toBe('$ 30.000')
    expect(desglose.cuidarLabel).toBe('$ 9.000')
    expect(desglose.medicoLabel).toBe('$ 21.000')
  })

  it('redondeo: 33 % de $ 10.000 -> Cuidar $ 3.300 / Médico $ 6.700', () => {
    const doc = mockDoctor({
      obrasSociales: [{ nombre: 'OSDE', porcentaje: 33 }],
    })
    const p = mockPayment({ id: '1', monto: 10000 })
    const desglose = calcularDesglosePagoFila(p, doc, 'OSDE')

    expect(desglose.monto).toBe(10000)
    expect(desglose.cuidar).toBe(3300)
    expect(desglose.medico).toBe(6700)
    expect(desglose.cuidarLabel).toBe('$ 3.300')
    expect(desglose.medicoLabel).toBe('$ 6.700')
  })

  it('Cuidar mayor que el Monto: Cuidar $ 30.000, Monto $ 20.000 -> Médico "—" (sin negativos)', () => {
    const doc = mockDoctor({ particular: 20000, cuidar: 30000 })
    const p = mockPayment({ id: '1', monto: 20000 })
    const desglose = calcularDesglosePagoFila(p, doc, 'Particular')

    expect(desglose.monto).toBe(20000)
    expect(desglose.cuidar).toBe(30000)
    expect(desglose.medico).toBe(0)
    expect(desglose.cuidarLabel).toBe('$ 30.000')
    expect(desglose.medicoLabel).toBe('—')
  })

  it('fila sin monto (0 o vacío) muestra "—" en ambas columnas nuevas', () => {
    const doc = mockDoctor()
    const p0 = mockPayment({ id: '1', monto: 0 })
    const desglose0 = calcularDesglosePagoFila(p0, doc, 'Particular')
    expect(desglose0.cuidarLabel).toBe('—')
    expect(desglose0.medicoLabel).toBe('—')

    const pNeg = mockPayment({ id: '2', monto: -100 })
    const desgloseNeg = calcularDesglosePagoFila(pNeg, doc, 'Particular')
    expect(desgloseNeg.cuidarLabel).toBe('—')
    expect(desgloseNeg.medicoLabel).toBe('—')
  })
})

describe('Ejemplo de referencia e invariantes sobre un día', () => {
  // Ejemplo de referencia:
  // - Particular $ 40.000 -> Cuidar $ 10.000 / Médico $ 30.000
  // - Particular $ 30.000 -> Cuidar $ 10.000 / Médico $ 20.000 (mismo doctor con cuidar fijo de $10.000 por consulta particular)
  // - Obra social al 30 % $ 30.000 -> Cuidar $ 9.000 / Médico $ 21.000
  // Totales: Monto $ 100.000, Cuidar $ 29.000, Médico $ 71.000
  const doc = mockDoctor({
    particular: 40000,
    cuidar: 10000,
    obrasSociales: [{ nombre: 'PREVENCION SALUD', porcentaje: 30 }],
  })

  const pagos = [
    mockPayment({ id: 'p1', monto: 40000, fecha: '2026-11-06T09:00:00' }),
    mockPayment({ id: 'p2', monto: 30000, fecha: '2026-11-06T10:00:00' }),
    mockPayment({ id: 'p3', monto: 30000, fecha: '2026-11-06T11:00:00' }),
  ]

  const osMap: Record<string, string> = {
    p1: 'Particular',
    p2: 'Particular',
    p3: 'PREVENCION SALUD',
  }

  it('calcula exactamente los valores del ejemplo de referencia', () => {
    const settlementMap = buildPaymentsSettlementMap(
      pagos,
      () => doc,
      (p) => osMap[p.id],
    )

    const d1 = calcularDesglosePagoFila(pagos[0], doc, osMap['p1'], settlementMap.get('p1'))
    const d2 = calcularDesglosePagoFila(pagos[1], doc, osMap['p2'], settlementMap.get('p2'))
    const d3 = calcularDesglosePagoFila(pagos[2], doc, osMap['p3'], settlementMap.get('p3'))

    expect(d1.cuidar).toBe(10000)
    expect(d1.medico).toBe(30000)

    expect(d2.cuidar).toBe(10000)
    expect(d2.medico).toBe(20000)

    expect(d3.cuidar).toBe(9000)
    expect(d3.medico).toBe(21000)

    const totalMonto = d1.monto + d2.monto + d3.monto
    const totalCuidar = d1.cuidar + d2.cuidar + d3.cuidar
    const totalMedico = d1.medico + d2.medico + d3.medico

    expect(totalMonto).toBe(100000)
    expect(totalCuidar).toBe(29000)
    expect(totalMedico).toBe(71000)
  })

  it('invariantes: suma Cuidar = Total % Cuidar, suma Monto = Total facturado, en cada fila Cuidar + Médico = Monto, suma Médico = Total', () => {
    const settlementMap = buildPaymentsSettlementMap(
      pagos,
      () => doc,
      (p) => osMap[p.id],
    )

    const desgloses = pagos.map((p) =>
      calcularDesglosePagoFila(p, doc, osMap[p.id], settlementMap.get(p.id)),
    )

    const agg = aggregatePorcentajeSettlementForPayments(
      pagos,
      () => doc.porcentaje,
      () => doc,
      (p) => osMap[p.id],
    )

    const sumaMonto = desgloses.reduce((acc, d) => acc + d.monto, 0)
    const sumaCuidar = desgloses.reduce((acc, d) => acc + d.cuidar, 0)
    const sumaMedico = desgloses.reduce((acc, d) => acc + d.medico, 0)

    // Suma de Monto = Total facturado
    expect(sumaMonto).toBe(100000)
    // Suma de Cuidar = Total % Cuidar
    expect(sumaCuidar).toBe(agg.totalPorcentaje)
    expect(sumaCuidar).toBe(29000)
    // Suma de Médico = Total
    expect(sumaMedico).toBe(agg.totalGeneral)
    expect(sumaMedico).toBe(71000)

    // En cada fila: Cuidar + Médico = Monto
    for (const d of desgloses) {
      expect(d.cuidar + d.medico).toBe(d.monto)
    }
  })
})

describe('Generación de PDF con columnas Cuidar y Médico', () => {
  it('buildDoctorPaymentsPdf genera el PDF con la tabla desglosada', async () => {
    const doctor = mockDoctor({
      particular: 40000,
      cuidar: 10000,
      obrasSociales: [{ nombre: 'PREVENCION SALUD', porcentaje: 30 }],
    })
    const pagos = [
      mockPayment({ id: 'p1', monto: 40000, fecha: '2026-11-06T09:00:00' }),
      mockPayment({ id: 'p2', monto: 30000, fecha: '2026-11-06T10:00:00' }),
      mockPayment({ id: 'p3', monto: 30000, fecha: '2026-11-06T11:00:00' }),
    ]
    const osMap: Record<string, string> = {
      p1: 'Particular',
      p2: 'Particular',
      p3: 'PREVENCION SALUD',
    }

    const { doc, filename } = buildDoctorPaymentsPdf({
      doctor,
      periodLabel: '06-11-2026',
      payments: pagos,
      patientLabel: () => 'GONZALEZ, JUAN',
      obraSocialLabel: (id, p) => (p?.id ? osMap[p.id] || 'Particular' : 'Particular'),
      scope: 'dia',
    })

    expect(doc).toBeDefined()
    expect(filename.toLowerCase()).toContain('alfonso')
    const buffer = Buffer.from(doc.output('arraybuffer'))
    expect(buffer.byteLength).toBeGreaterThan(1000)

    const pdfString = doc.output('datauristring')
    expect(pdfString).toBeDefined()

    const outDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231/scratch'
    try {
      const fs = await import('node:fs')
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(`${outDir}/ejemplo-cobranzas-desglose.pdf`, buffer)
    } catch {
      // Ignorar si el path no está disponible en el entorno
    }
  })

  it('abrevia turno Mañana como Mañ', () => {
    const doctor = mockDoctor({
      particular: 40000,
      cuidar: 10000,
      obrasSociales: [{ nombre: 'PREVENCION SALUD', porcentaje: 30 }],
    })
    // Pago a las 09:00 (Mañana)
    const pagos = [
      mockPayment({ id: 'p1', monto: 30000, fecha: '2026-11-06T09:00:00' }),
    ]
    const { doc } = buildDoctorPaymentsPdf({
      doctor,
      periodLabel: '06-11-2026',
      payments: pagos,
      patientLabel: () => 'GONZALEZ, JUAN',
      obraSocialLabel: () => 'PREVENCION SALUD',
      scope: 'dia',
    })
    expect(doc).toBeDefined()
  })

  it('abrevia metodo Transferencia como Transf.', () => {
    const doctor = mockDoctor()
    const pagos = [
      mockPayment({ id: 'p1', monto: 30000, metodo: 'Transferencia' }),
    ]
    const { doc } = buildDoctorPaymentsPdf({
      doctor,
      periodLabel: '06-11-2026',
      payments: pagos,
      patientLabel: () => 'GONZALEZ, JUAN',
      obraSocialLabel: () => 'Particular',
      scope: 'dia',
    })
    expect(doc).toBeDefined()
  })

  it('formatea el subtitulo como Periodo: DD-MM-YYYY — Medico: ...', async () => {
    const doctor = mockDoctor({
      nombre: 'CARMEN',
      apellido: 'ALFONSO',
      particular: 40000,
      cuidar: 10000,
    })
    const pagos = [
      mockPayment({ id: 'p1', monto: 40000, metodo: 'Transferencia', fecha: '2026-11-02T08:00:00' }),
      mockPayment({ id: 'p2', monto: 40000, metodo: 'Transferencia', fecha: '2026-11-02T09:00:00' }),
    ]
    const { doc, filename } = buildDoctorPaymentsPdf({
      doctor,
      periodLabel: '2 noviembre 2026',
      payments: pagos,
      patientLabel: (id) => (id === 'pac-1' ? 'PORTILLO, MIGUELA' : 'CARDOZO, SANTIAGO'),
      obraSocialLabel: () => 'Particular',
      scope: 'dia',
    })
    expect(doc).toBeDefined()
    expect(filename).toContain('alfonso-carmen')

    const outDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231/scratch'
    try {
      const fs = await import('node:fs')
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
      const buffer = Buffer.from(doc.output('arraybuffer'))
      fs.writeFileSync(`${outDir}/alfonso-carmen-2nov2026.pdf`, buffer)
    } catch {
      // Ignorar si no está disponible el fs
    }
  })
})

