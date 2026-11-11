import { describe, expect, it } from 'vitest'
import { calcularResumenMensual } from './pdfMensualCalculo'
import type { Appointment, Doctor, ObraSocialCatalog, PagoCancelado, Patient, Payment } from '../types'

function mockDoctor(partial: Partial<Doctor> = {}): Doctor {
  return {
    id: 'doc-1',
    nombre: 'CARMEN',
    apellido: 'ALFONSO',
    dni: '12345678',
    matricula: 'M1234',
    especialidad: 'Endocrinología',
    telefono: '',
    localidad: '',
    email: '',
    porcentaje: 70,
    particular: 40000,
    cuidar: 10000,
    ...partial,
  }
}

function mockPatient(id = 'pac-1', apellido = 'PEREZ', nombre = 'JUAN', obraSocial = 'Particular'): Patient {
  return {
    id,
    apellido,
    nombre,
    dni: '30111222',
    telefono: '',
    obraSocial,
    activo: true,
  }
}

function mockAppointment(partial: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    patientId: 'pac-1',
    doctorId: 'doc-1',
    fechaHora: '2026-11-05T09:00:00',
    duracionMinutos: 15,
    notas: 'Consulta',
    estado: 'atendido',
    ...partial,
  }
}

function mockPayment(partial: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    patientId: 'pac-1',
    doctorId: 'doc-1',
    citaId: 'appt-1',
    monto: 40000,
    fecha: '2026-11-05T09:00:00',
    metodo: 'Efectivo',
    notas: 'Consulta',
    ...partial,
  }
}

describe('calcularResumenMensual - función pura', () => {
  it('calcula correctamente totales y pastillas para un mes con pagos en efectivo', () => {
    const doc = mockDoctor({ id: 'doc-1', particular: 40000, cuidar: 10000 })
    const pac = mockPatient('pac-1', 'PEREZ', 'JUAN', 'Particular')
    const appt = mockAppointment({ id: 'a1', fechaHora: '2026-11-05T09:00:00' })
    const pay = mockPayment({ id: 'p1', citaId: 'a1', monto: 40000, metodo: 'Efectivo', fecha: '2026-11-05T09:00:00' })

    const res = calcularResumenMensual({
      anioMes: '2026-11',
      payments: [pay],
      appointments: [appt],
      doctors: [doc],
      patients: [pac],
      obrasSocialesCatalog: [],
    })

    expect(res.pastillas.totalFacturado).toBe(40000)
    expect(res.pastillas.paraCuidar).toBe(10000)
    expect(res.pastillas.paraElMedico).toBe(30000)
    expect(res.pastillas.cantidadTurnosMes).toBe(1)
    expect(res.pastillas.turnosManana).toBe(1)
    expect(res.pastillas.ticketPromedio).toBe(40000)
    expect(res.turnosSinPagar.length).toBe(0)
    expect(res.pastillas.pendienteCobroMonto).toBe(0)
  })

  it('excluye turnos cancelados y detecta turnos sin pagar', () => {
    const doc = mockDoctor({ id: 'doc-1', particular: 40000, cuidar: 10000 })
    const pac = mockPatient('pac-1', 'PEREZ', 'JUAN', 'Particular')

    const apptCobrado = mockAppointment({ id: 'a1', fechaHora: '2026-11-05T09:00:00' })
    const apptSinPagar = mockAppointment({ id: 'a2', fechaHora: '2026-11-05T10:00:00' })
    const apptCancelado = mockAppointment({ id: 'a3', fechaHora: '2026-11-05T11:00:00', estado: 'cancelado' })

    const pay = mockPayment({ id: 'p1', citaId: 'a1', monto: 40000, fecha: '2026-11-05T09:00:00' })

    const res = calcularResumenMensual({
      anioMes: '2026-11',
      payments: [pay],
      appointments: [apptCobrado, apptSinPagar, apptCancelado],
      doctors: [doc],
      patients: [pac],
      obrasSocialesCatalog: [],
    })

    // Turnos válidos son 2 (el cobrado y el pendiente, el cancelado se ignora de los válidos)
    expect(res.pastillas.cantidadTurnosMes).toBe(2)
    expect(res.turnosSinPagar.length).toBe(1)
    expect(res.turnosSinPagar[0]?.id).toBe('a2')
    expect(res.turnosSinPagar[0]?.montoAdeudado).toBe(40000) // Particular del médico
    expect(res.pastillas.pendienteCobroMonto).toBe(40000)
    expect(res.pastillas.pendienteCobroCantidad).toBe(1)
    expect(res.estadoPagos.ausentesCantidad).toBe(1)
  })

  it('agrupa correctamente en "Otras" si hay más de 7 obras sociales', () => {
    const doc = mockDoctor()
    const appointments: Appointment[] = []
    const patients: Patient[] = []

    const osNames = ['OSDE', 'SWISS', 'GALENO', 'MEDIFE', 'IOMA', 'PAMI', 'SANCOR', 'OMINT', 'PREVENCION']
    osNames.forEach((os, i) => {
      const pacId = `pac-${i}`
      patients.push(mockPatient(pacId, `PAC-${i}`, 'TEST', os))
      appointments.push(mockAppointment({ id: `a-${i}`, patientId: pacId, fechaHora: '2026-11-02T09:00:00' }))
    })

    const res = calcularResumenMensual({
      anioMes: '2026-11',
      payments: [],
      appointments,
      doctors: [doc],
      patients,
      obrasSocialesCatalog: [],
    })

    expect(res.graficoObrasSociales.length).toBe(7) // Top 6 + "Otras"
    const otras = res.graficoObrasSociales.find((g) => g.nombre === 'Otras')
    expect(otras).toBeDefined()
    expect(otras?.cantidad).toBe(3) // 9 - 6 = 3
  })

  it('agrupa correctamente en "Otros" si hay más de 6 médicos con facturación', () => {
    const doctors: Doctor[] = []
    const payments: Payment[] = []
    const patients = [mockPatient('pac-1')]

    for (let i = 1; i <= 8; i++) {
      const docId = `doc-${i}`
      doctors.push(mockDoctor({ id: docId, apellido: `DOC${i}`, nombre: `NOM${i}`, particular: 10000 }))
      payments.push(mockPayment({ id: `p-${i}`, doctorId: docId, monto: i * 10000, fecha: '2026-11-03T10:00:00' }))
    }

    const res = calcularResumenMensual({
      anioMes: '2026-11',
      payments,
      appointments: [],
      doctors,
      patients,
      obrasSocialesCatalog: [],
    })

    expect(res.graficoMedicos.length).toBe(6) // Top 5 + "Otros"
    const otros = res.graficoMedicos.find((g) => g.medicoNombre === 'Otros')
    expect(otros).toBeDefined()
    // Los médicos 1, 2, 3 (monto 10k, 20k, 30k) son el resto => 60k
    expect(otros?.facturadoTotal).toBe(60000)
  })

  it('maneja un mes vacío sin errores ni división por cero', () => {
    const res = calcularResumenMensual({
      anioMes: '2026-11',
      payments: [],
      appointments: [],
      doctors: [],
      patients: [],
      obrasSocialesCatalog: [],
    })

    expect(res.pastillas.totalFacturado).toBe(0)
    expect(res.pastillas.cantidadTurnosMes).toBe(0)
    expect(res.pastillas.ticketPromedio).toBe(0)
    expect(res.graficoObrasSociales.length).toBe(0)
    expect(res.graficoMedicos.length).toBe(0)
    expect(res.graficoDias.length).toBe(30) // Noviembre tiene 30 días
    expect(res.tablaResumenCuidar.length).toBe(0)
    expect(res.turnosSinPagar.length).toBe(0)
  })

  it('filtra por médico si se especifica doctorId', () => {
    const doc1 = mockDoctor({ id: 'doc-1', apellido: 'ALFONSO', nombre: 'CARMEN' })
    const doc2 = mockDoctor({ id: 'doc-2', apellido: 'SOSA', nombre: 'LAURA' })
    const pac = mockPatient()

    const pay1 = mockPayment({ id: 'p1', doctorId: 'doc-1', monto: 50000, fecha: '2026-11-05T09:00:00' })
    const pay2 = mockPayment({ id: 'p2', doctorId: 'doc-2', monto: 30000, fecha: '2026-11-05T10:00:00' })

    const res = calcularResumenMensual({
      anioMes: '2026-11',
      doctorId: 'doc-1',
      payments: [pay1, pay2],
      appointments: [],
      doctors: [doc1, doc2],
      patients: [pac],
      obrasSocialesCatalog: [],
    })

    expect(res.pastillas.totalFacturado).toBe(50000)
    expect(res.periodo.medicoLabel).toBe('ALFONSO, CARMEN')
  })

  it('buildPdfMensual genera el documento en A4 apaisado con al menos 2 hojas', async () => {
    const { buildPdfMensual } = await import('./pdfMensualGenerator')
    const doc1 = mockDoctor({ id: 'doc-1', apellido: 'ALFONSO', nombre: 'CARMEN', particular: 40000, cuidar: 10000 })
    const pac = mockPatient()
    const appt = mockAppointment({ id: 'a1', fechaHora: '2026-11-05T09:00:00' })
    const pay = mockPayment({ id: 'p1', citaId: 'a1', monto: 40000, fecha: '2026-11-05T09:00:00', metodo: 'Transferencia' })

    const calculo = calcularResumenMensual({
      anioMes: '2026-11',
      payments: [pay],
      appointments: [appt],
      doctors: [doc1],
      patients: [pac],
      obrasSocialesCatalog: [],
    })

    const { doc, filename } = buildPdfMensual(calculo)
    expect(doc).toBeDefined()
    expect(filename).toBe('PDF Mensual A 2026-11.pdf')
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)

    // Guardar archivo de prueba en scratch
    const outDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231/scratch'
    try {
      const fs = await import('node:fs')
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
      const buffer = Buffer.from(doc.output('arraybuffer'))
      fs.writeFileSync(`${outDir}/test-pdf-mensual-2026-11.pdf`, buffer)
    } catch {
      // Ignorar si no está disponible fs
    }
  })
})
