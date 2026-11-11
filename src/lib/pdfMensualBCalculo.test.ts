import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { calcularDetalleMensual, agruparCobrosPorDia, capitalizarDia } from './pdfMensualBCalculo'
import { buildPdfMensualB } from './pdfMensualBGenerator'
import type { Appointment, Doctor, ObraSocialCatalog, PagoCancelado, Patient, Payment } from '../types'

describe('pdfMensualBCalculo - calcularDetalleMensual', () => {
  const doctorA: Doctor = {
    id: 'doc-1',
    nombre: 'Carmen',
    apellido: 'Alfonso',
    dni: '12345678',
    matricula: 'M1',
    especialidad: 'Endocrinología',
    porcentaje: 25,
    particular: 40000,
    cuidar: 10000,
  }

  const doctorB: Doctor = {
    id: 'doc-2',
    nombre: 'Juan',
    apellido: 'Perez',
    dni: '87654321',
    matricula: 'M2',
    especialidad: 'Cardiología',
    porcentaje: 20,
    particular: 30000,
  }

  const patient1: Patient = {
    id: 'pac-1',
    nombre: 'Miguela',
    apellido: 'Portillo',
    dni: '11111111',
    telefono: '',
    email: '',
    obraSocial: 'Particular',
  }

  const patient2: Patient = {
    id: 'pac-2',
    nombre: 'Santiago',
    apellido: 'Cardozo',
    dni: '22222222',
    telefono: '',
    email: '',
    obraSocial: 'OSDE',
  }

  const patient3: Patient = {
    id: 'pac-3',
    nombre: 'Ana',
    apellido: 'Gomez',
    dni: '33333333',
    telefono: '',
    email: '',
    obraSocial: 'IOMA',
  }

  const catalog: ObraSocialCatalog[] = [
    {
      nombre: 'OSDE',
      plus: 15000,
      arancel: 25000,
      cuidar: 5000,
      impBanco: 0,
      impFactura: 0,
      gastosAdm: 0,
      suspendida: false,
      version: 1,
    },
    {
      nombre: 'IOMA',
      plus: 0, // Sin Plus
      arancel: 18000,
      cuidar: 3000,
      impBanco: 0,
      impFactura: 0,
      gastosAdm: 0,
      suspendida: false,
      version: 1,
    },
  ]

  it('mes vacío: devuelve listas y totales en cero', () => {
    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments: [],
      appointments: [],
      doctors: [doctorA],
      patients: [patient1],
      obrasSocialesCatalog: catalog,
    })

    expect(res.filasCobrados).toHaveLength(0)
    expect(res.totalesCobrados.cantidadTurnos).toBe(0)
    expect(res.totalesCobrados.totalFacturado).toBe(0)
    expect(res.totalesCobrados.totalMedico).toBe(0)
    expect(res.totalesCobrados.montoCuidar).toBe(0)

    expect(res.filasNoPagos).toHaveLength(0)
    expect(res.totalesNoPagos.cantidadTurnos).toBe(0)
    expect(res.totalesNoPagos.totalAdeudado).toBe(0)
  })

  it('pagos cobrados: calcula totales, transferencias y liquidación correctamente', () => {
    const payment1: Payment = {
      id: 'pay-1',
      doctorId: 'doc-1',
      patientId: 'pac-1',
      citaId: 'cita-1',
      monto: 40000,
      fecha: '2026-11-02T08:30:00',
      metodo: 'Transferencia',
      notas: '',
    }

    const appt1: Appointment = {
      id: 'cita-1',
      doctorId: 'doc-1',
      patientId: 'pac-1',
      fechaHora: '2026-11-02T08:30:00',
      estado: 'atendido',
    }

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments: [payment1],
      appointments: [appt1],
      doctors: [doctorA],
      patients: [patient1],
      obrasSocialesCatalog: catalog,
    })

    expect(res.filasCobrados).toHaveLength(1)
    const fila = res.filasCobrados[0]
    expect(fila.cantPagos).toBe(1)
    expect(fila.totalFacturado).toBe(40000)
    expect(fila.totalTransferencias).toBe(40000)
    expect(fila.totalMedico).toBe(30000)
    expect(fila.montoCuidar).toBe(10000)
    expect(fila.porcentajeLabel).toBe('—') // Tiene cuidar fijo configurado

    expect(res.totalesCobrados.totalFacturado).toBe(40000)
    expect(res.totalesCobrados.totalTransferencias).toBe(40000)
    expect(res.totalesCobrados.totalMedico).toBe(30000)
    expect(res.totalesCobrados.montoCuidar).toBe(10000)
  })

  it('pagos en dos montos: agrupa 2 cobros del mismo turno en una sola fila con cantPagos = 2', () => {
    const paymentA: Payment = {
      id: 'pay-part-1',
      doctorId: 'doc-2',
      patientId: 'pac-2',
      citaId: 'cita-partida',
      monto: 10000,
      fecha: '2026-11-05T10:00:00',
      metodo: 'Efectivo',
      notas: '',
    }
    const paymentB: Payment = {
      id: 'pay-part-2',
      doctorId: 'doc-2',
      patientId: 'pac-2',
      citaId: 'cita-partida',
      monto: 5000,
      fecha: '2026-11-05T10:00:00',
      metodo: 'Transferencia',
      notas: '',
    }
    const appt: Appointment = {
      id: 'cita-partida',
      doctorId: 'doc-2',
      patientId: 'pac-2',
      fechaHora: '2026-11-05T10:00:00',
      estado: 'atendido',
    }

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments: [paymentA, paymentB],
      appointments: [appt],
      doctors: [doctorB],
      patients: [patient2],
      obrasSocialesCatalog: catalog,
    })

    expect(res.filasCobrados).toHaveLength(1)
    const fila = res.filasCobrados[0]
    expect(fila.cantPagos).toBe(2)
    expect(fila.totalFacturado).toBe(15000)
    expect(fila.totalTransferencias).toBe(5000)
    expect(fila.totalEfectivo).toBe(10000)
    // Doctor B tiene 20% para Cuidar -> 80% para médico
    expect(fila.totalMedico).toBe(12000)
    expect(fila.montoCuidar).toBe(3000)
    expect(fila.porcentajeLabel).toBe('20%')
    expect(res.totalesCobrados.totalEfectivo).toBe(10000)
  })

  it('pagos cancelados: quedan estrictamente excluidos de los totales y no se listan', () => {
    const activePay: Payment = {
      id: 'pay-act',
      doctorId: 'doc-1',
      patientId: 'pac-1',
      citaId: 'cita-act',
      monto: 40000,
      fecha: '2026-11-10T09:00:00',
      metodo: 'Efectivo',
      notas: '',
    }
    const cancelledPay: Payment = {
      id: 'pay-canc',
      doctorId: 'doc-1',
      patientId: 'pac-1',
      citaId: 'cita-canc',
      monto: 40000,
      fecha: '2026-11-10T10:00:00',
      metodo: 'Efectivo',
      notas: '',
    }

    const pagoCanceladoRecord: PagoCancelado = {
      id: 'canc-rec-1',
      motivo: 'error_monto',
      canceladoEn: '2026-11-10T11:00:00',
      payment: cancelledPay,
      appointment: null,
      notasOtros: '',
    }

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments: [activePay, cancelledPay],
      appointments: [],
      doctors: [doctorA],
      patients: [patient1],
      obrasSocialesCatalog: catalog,
      pagosCancelados: [pagoCanceladoRecord],
    })

    expect(res.filasCobrados).toHaveLength(1)
    expect(res.filasCobrados[0].id).toBe('cita-act')
    expect(res.totalesCobrados.totalFacturado).toBe(40000)
  })

  it('no pagos: clasifica correctamente entre "Pendiente" y "Sin Plus"', () => {
    // Turno con OSDE (tiene plus 15000) sin cobrar -> Pendiente
    const apptPendiente: Appointment = {
      id: 'cita-pend',
      doctorId: 'doc-2',
      patientId: 'pac-2', // OSDE
      fechaHora: '2026-11-12T15:00:00',
      estado: 'programado',
    }

    // Turno con IOMA (plus 0) -> Sin Plus
    const apptSinPlus: Appointment = {
      id: 'cita-sin-plus',
      doctorId: 'doc-2',
      patientId: 'pac-3', // IOMA
      fechaHora: '2026-11-12T16:00:00',
      estado: 'programado',
    }

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments: [],
      appointments: [apptPendiente, apptSinPlus],
      doctors: [doctorB],
      patients: [patient2, patient3],
      obrasSocialesCatalog: catalog,
    })

    expect(res.filasNoPagos).toHaveLength(2)

    const pendiente = res.filasNoPagos.find((f) => f.id === 'cita-pend')
    expect(pendiente?.estado).toBe('Pendiente')
    expect(pendiente?.montoAdeudado).toBe(15000)

    const sinPlus = res.filasNoPagos.find((f) => f.id === 'cita-sin-plus')
    expect(sinPlus?.estado).toBe('Sin Plus')
    expect(sinPlus?.montoAdeudado).toBe(0)

    expect(res.totalesNoPagos.cantidadTurnos).toBe(2)
    expect(res.totalesNoPagos.cantidadPendientes).toBe(1)
    expect(res.totalesNoPagos.cantidadSinPlus).toBe(1)
    expect(res.totalesNoPagos.totalAdeudado).toBe(15000)
    expect(res.totalesNoPagos.labelResumen).toBe('2 turnos (1 pendientes · 1 sin Plus)')
  })

  it('filtro por médico: filtra tanto cobrados como no pagos', () => {
    const payA: Payment = {
      id: 'p-a',
      doctorId: 'doc-1',
      patientId: 'pac-1',
      citaId: 'c-a',
      monto: 40000,
      fecha: '2026-11-03T09:00:00',
      metodo: 'Efectivo',
      notas: '',
    }
    const payB: Payment = {
      id: 'p-b',
      doctorId: 'doc-2',
      patientId: 'pac-2',
      citaId: 'c-b',
      monto: 30000,
      fecha: '2026-11-03T10:00:00',
      metodo: 'Efectivo',
      notas: '',
    }

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      doctorId: 'doc-1',
      payments: [payA, payB],
      appointments: [],
      doctors: [doctorA, doctorB],
      patients: [patient1, patient2],
      obrasSocialesCatalog: catalog,
    })

    expect(res.filasCobrados).toHaveLength(1)
    expect(res.filasCobrados[0].medico).toContain('Alfonso')
    expect(res.medicoLabel).toBe('ALFONSO, CARMEN')
  })

  it('buildPdfMensualB: genera un PDF válido y pagina adecuadamente', () => {
    // Generar 30 cobros y 15 no pagos para probar paginación
    const appointments: Appointment[] = []
    const payments: Payment[] = []
    const patients: Patient[] = []

    for (let i = 1; i <= 40; i++) {
      const pId = `pac-${i}`
      patients.push({
        id: pId,
        nombre: `Paciente ${i}`,
        apellido: `Apellido ${i}`,
        dni: `3000000${i}`,
        obraSocial: i % 3 === 0 ? 'OSDE' : i % 3 === 1 ? 'IOMA' : 'Particular',
      })

      const day = (i % 28) + 1
      const dayStr = day.toString().padStart(2, '0')
      const hour = i % 2 === 0 ? '09:00' : '16:00'
      const citaId = `cita-${i}`

      appointments.push({
        id: citaId,
        doctorId: i % 2 === 0 ? 'doc-1' : 'doc-2',
        patientId: pId,
        fechaHora: `2026-11-${dayStr}T${hour}:00`,
        estado: 'atendido',
      })

      if (i <= 25) {
        payments.push({
          id: `pay-${i}`,
          doctorId: i % 2 === 0 ? 'doc-1' : 'doc-2',
          patientId: pId,
          citaId: citaId,
          monto: 30000,
          fecha: `2026-11-${dayStr}T${hour}:00`,
          metodo: i % 2 === 0 ? 'Transferencia' : 'Efectivo',
          notas: '',
        })
      }
    }

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments,
      appointments,
      doctors: [doctorA, doctorB],
      patients,
      obrasSocialesCatalog: catalog,
    })

    const { doc, filename } = buildPdfMensualB(res, '2026-11')
    expect(filename).toBe('PDF Mensual B 2026-11.pdf')
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })

  it('médico con arancel diario (doctor.valor): Cuidar absorbe el valor una sola vez por día y el resto va al médico', () => {
    const docFijo: Doctor = {
      id: 'doc-ayala',
      nombre: 'Marcela',
      apellido: 'Ayala',
      dni: '99999999',
      matricula: 'M99',
      especialidad: 'Ginecología',
      particular: 70000,
      valor: 70000, // Arancel diario de consultorio
    }

    const payments: Payment[] = [
      {
        id: 'p1',
        doctorId: 'doc-ayala',
        patientId: 'pac-1',
        monto: 70000,
        fecha: '2026-11-05T08:00:00',
        metodo: 'Efectivo',
        notas: '',
      },
      {
        id: 'p2',
        doctorId: 'doc-ayala',
        patientId: 'pac-2',
        monto: 70000,
        fecha: '2026-11-05T09:00:00',
        metodo: 'Efectivo',
        notas: '',
      },
      {
        id: 'p3',
        doctorId: 'doc-ayala',
        patientId: 'pac-3',
        monto: 70000,
        fecha: '2026-11-05T10:00:00',
        metodo: 'Efectivo',
        notas: '',
      },
    ]

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments,
      appointments: [],
      doctors: [docFijo],
      patients: [patient1, patient2, patient3],
      obrasSocialesCatalog: catalog,
    })

    expect(res.totalesCobrados.totalFacturado).toBe(210000)
    // El primer turno de $70.000 cubre el valor diario de Cuidar ($70.000).
    // Los otros 2 turnos ($140.000) van 100% al médico.
    expect(res.totalesCobrados.montoCuidar).toBe(70000)
    expect(res.totalesCobrados.totalMedico).toBe(140000)
  })

  it('agrupación y resumen por día con 5 días / 34 turnos e invariantes cumplidas', () => {
    const days = ['02', '03', '04', '05', '06']
    const payments: Payment[] = []
    let pCount = 0

    // Distribuir 34 turnos en 5 días
    for (let dIdx = 0; dIdx < days.length; dIdx++) {
      const day = days[dIdx]
      const countForDay = dIdx === 0 ? 5 : dIdx === 1 ? 6 : dIdx === 2 ? 7 : dIdx === 3 ? 8 : 8 // Suma = 34
      for (let k = 0; k < countForDay; k++) {
        pCount++
        const isTransf = (pCount % 3 === 0)
        payments.push({
          id: `pay-34-${pCount}`,
          doctorId: 'doc-1',
          patientId: 'pac-1',
          monto: 30000,
          fecha: `2026-11-${day}T0${8 + (k % 4)}:${k < 2 ? '00' : '30'}:00`,
          metodo: isTransf ? 'Transferencia' : 'Efectivo',
          notas: '',
        })
      }
    }

    expect(payments).toHaveLength(34)

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments,
      appointments: [],
      doctors: [doctorA],
      patients: [patient1],
      obrasSocialesCatalog: catalog,
    })

    // Resumen por día con 5 filas
    expect(res.resumenPorDia).toHaveLength(5)
    expect(res.gruposPorDia).toHaveLength(5)

    // Días ordenados y con nombre en español capitalizado
    expect(res.resumenPorDia[0].diaSemana).toBe('Lunes')
    expect(res.resumenPorDia[0].fecha).toBe('02/11/2026')
    expect(res.resumenPorDia[1].diaSemana).toBe('Martes')
    expect(res.resumenPorDia[2].diaSemana).toBe('Miércoles')
    expect(res.resumenPorDia[3].diaSemana).toBe('Jueves')
    expect(res.resumenPorDia[4].diaSemana).toBe('Viernes')

    // Invariantes por cada día
    for (const r of res.resumenPorDia) {
      expect(r.totalFacturado).toBe(r.totalTransferencias + r.totalEfectivo)
      expect(r.totalFacturado).toBe(r.totalMedico + r.montoCuidar)
    }

    // Totales del resumen coinciden exactamente con totalesCobrados y suma de subtotales
    const sumFacturado = res.resumenPorDia.reduce((s, r) => s + r.totalFacturado, 0)
    const sumTransferencias = res.resumenPorDia.reduce((s, r) => s + r.totalTransferencias, 0)
    const sumEfectivo = res.resumenPorDia.reduce((s, r) => s + r.totalEfectivo, 0)
    const sumMedico = res.resumenPorDia.reduce((s, r) => s + r.totalMedico, 0)
    const sumCuidar = res.resumenPorDia.reduce((s, r) => s + r.montoCuidar, 0)

    expect(sumFacturado).toBe(res.totalesCobrados.totalFacturado)
    expect(sumTransferencias).toBe(res.totalesCobrados.totalTransferencias)
    expect(sumEfectivo).toBe(res.totalesCobrados.totalEfectivo)
    expect(sumMedico).toBe(res.totalesCobrados.totalMedico)
    expect(sumCuidar).toBe(res.totalesCobrados.montoCuidar)

    // Render del PDF
    const { doc, filename } = buildPdfMensualB(res, '2026-11')
    expect(filename).toBe('PDF Mensual B 2026-11.pdf')
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)

    // Guardar en scratch para inspección visual
    const scratchDir = 'C:/Users/L/.gemini/antigravity/brain/acb6eb89-98cb-487f-aa72-774560775231/scratch'
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true })
    }
    const pdfPath = path.join(scratchDir, 'ejemplo-pdf-mensual-b-34turnos.pdf')
    fs.writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')))
  })

  it('un día con 0 transferencias y otro con transferencias: Efectivo = Facturado - Transferencias', () => {
    const payments: Payment[] = [
      {
        id: 'p-efec',
        doctorId: 'doc-1',
        patientId: 'pac-1',
        monto: 40000,
        fecha: '2026-11-02T10:00:00',
        metodo: 'Efectivo',
      },
      {
        id: 'p-transf',
        doctorId: 'doc-1',
        patientId: 'pac-1',
        monto: 50000,
        fecha: '2026-11-03T11:00:00',
        metodo: 'Transferencia',
      },
    ]

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments,
      appointments: [],
      doctors: [doctorA],
      patients: [patient1],
      obrasSocialesCatalog: catalog,
    })

    const dia1 = res.resumenPorDia.find((r) => r.fechaKey === '2026-11-02')!
    expect(dia1.totalTransferencias).toBe(0)
    expect(dia1.totalEfectivo).toBe(40000)

    const dia2 = res.resumenPorDia.find((r) => r.fechaKey === '2026-11-03')!
    expect(dia2.totalTransferencias).toBe(50000)
    expect(dia2.totalEfectivo).toBe(0)
  })

  it('turnos fuera de orden de entrada se ordenan por fecha, turno y hora', () => {
    const payments: Payment[] = [
      {
        id: 'p-tarde',
        doctorId: 'doc-1',
        patientId: 'pac-1',
        monto: 20000,
        fecha: '2026-11-04T16:00:00',
        metodo: 'Efectivo',
      },
      {
        id: 'p-manana',
        doctorId: 'doc-1',
        patientId: 'pac-1',
        monto: 20000,
        fecha: '2026-11-04T08:00:00',
        metodo: 'Efectivo',
      },
      {
        id: 'p-ayer',
        doctorId: 'doc-1',
        patientId: 'pac-1',
        monto: 20000,
        fecha: '2026-11-03T09:00:00',
        metodo: 'Efectivo',
      },
    ]

    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments,
      appointments: [],
      doctors: [doctorA],
      patients: [patient1],
      obrasSocialesCatalog: catalog,
    })

    expect(res.filasCobrados[0].fecha).toBe('03/11/2026')
    expect(res.filasCobrados[1].fecha).toBe('04/11/2026')
    expect(res.filasCobrados[1].turno).toBe('Mañana')
    expect(res.filasCobrados[2].fecha).toBe('04/11/2026')
    expect(res.filasCobrados[2].turno).toBe('Tarde')
  })

  it('período sin cobros: muestra hoja 1 con mensaje "Sin cobros en el período" sin errores', () => {
    const res = calcularDetalleMensual({
      anioMes: '2026-11',
      payments: [],
      appointments: [],
      doctors: [doctorA],
      patients: [patient1],
      obrasSocialesCatalog: catalog,
    })

    expect(res.resumenPorDia).toHaveLength(0)
    const { doc } = buildPdfMensualB(res, '2026-11')
    expect(doc.getNumberOfPages()).toBe(2) // Hoja 1 (Sin cobros) + Hoja 2 (Sin pagos pendientes)
    const text = doc.output()
    expect(text).toContain('Sin cobros en el período')
  })

  it('capitalizarDia formatea correctamente los días en español', () => {
    expect(capitalizarDia('lunes')).toBe('Lunes')
    expect(capitalizarDia('martes')).toBe('Martes')
    expect(capitalizarDia('miércoles')).toBe('Miércoles')
  })
})
