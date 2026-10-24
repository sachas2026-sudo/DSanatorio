import { describe, expect, it } from 'vitest'
import {
  buildAllDoctorsPaymentsPdf,
  buildDoctorPaymentsPdf,
} from './doctorPaymentsPdf'

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
})
