import { describe, expect, it } from 'vitest'
import { DNI_MED_LABEL, DNI_PAC_LABEL } from './dniLabels'
import {
  buildDoctorDebtWorkbook,
  buildPagosGerenciaExcelRows,
  buildPagosGerenciaWorkbook,
  fechasPagoCortas,
  gerenciaExcelFilename,
} from './pagosGerenciaExcel'
import * as XLSX from 'xlsx/xlsx.mjs'
import type { AppData, PagoCancelado } from '../types'

const patient = {
  id: 'p1',
  nombre: 'Juan',
  apellido: 'Pérez',
  dni: '12345678',
  domicilio: 'Calle 1',
  localidad: 'Posadas',
  obraSocial: 'OSDE',
  telefono: '',
  email: '',
  fechaNacimiento: '1985-03-20',
  notas: '',
}

const doctor = {
  id: 'd1',
  nombre: 'Ana',
  apellido: 'García',
  dni: '20123456',
  matricula: '100',
  especialidad: 'Clínica',
  telefono: '',
  localidad: 'Posadas',
  email: '',
  porcentaje: 10,
}

const payment = {
  id: 'pay-1',
  patientId: 'p1',
  doctorId: 'd1',
  citaId: null,
  monto: 5000,
  fecha: '2026-05-15T10:00:00.000Z',
  metodo: 'Efectivo',
  notas: 'Nota activa',
}

const cancelado: PagoCancelado = {
  id: 'cancel-1',
  motivo: 'cancelacion_paciente',
  canceladoEn: '2026-05-16T14:00:00.000Z',
  notasOtros: '',
  appointment: {
    id: 'c1',
    patientId: 'p1',
    doctorId: 'd1',
    fechaHora: '2026-05-15T09:00:00.000Z',
    duracionMinutos: 30,
    estado: 'cancelado',
    notas: 'Control',
  },
  payment: {
    id: 'pay-2',
    patientId: 'p1',
    doctorId: 'd1',
    citaId: 'c1',
    monto: 7000,
    fecha: '2026-05-20T11:00:00.000Z',
    metodo: 'Transferencia',
    notas: 'Nota cancelada',
  },
}

const baseData: Pick<AppData, 'patients' | 'doctors'> = {
  patients: [patient],
  doctors: [doctor],
}

describe('gerenciaExcelFilename', () => {
  it('usa aaaammdd-aaaammdd_Usuario.xlsx', () => {
    expect(gerenciaExcelFilename('20261001-20261003', 'Admi')).toBe('20261001-20261003_Admi.xlsx')
    expect(gerenciaExcelFilename('20261001-20261003', 'Aguirre Mary')).toBe('20261001-20261003_Aguirre.xlsx')
    expect(gerenciaExcelFilename('20261001-20261003', 'Barua Andrea')).toBe('20261001-20261003_Barua.xlsx')
  })
})

describe('buildPagosGerenciaExcelRows', () => {
  it('incluye columnas vacías para pagos activos', () => {
    const rows = buildPagosGerenciaExcelRows({
      payments: [payment],
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]![DNI_MED_LABEL]).toBe('20123456')
    expect(rows[0]![DNI_PAC_LABEL]).toBe('12345678')
    expect(rows[0]!['F. nacimiento']).toBe('20/03/1985')
    expect(rows[0]!.Edad).toBe(41)
    expect(rows[0]!['Notas pago']).toBe('Nota activa')
    expect(rows[0]!['% Cuidar']).toBe(10)
    expect(rows[0]!['Total Cuidar']).toBe(500)
    expect(rows[0]!['Total Médico']).toBe(4500)
    expect(rows[0]!['Entregado Medico']).toBe(4500)
    expect(rows[0]!['Monto']).toBe(5000)
    expect(rows[0]!['Total Efectivo']).toBe(5000)
    expect(rows[0]!['Total Transferencias']).toBe('')
    expect(rows[0]!['Monto Cancelado']).toBe('')
    expect(rows[0]!['Cancelado en']).toBe('')
    expect(rows[0]!['Motivo cancelación']).toBe('')
  })

  it('agrega datos de pagos cancelados después de Notas pago', () => {
    const rows = buildPagosGerenciaExcelRows({
      payments: [payment],
      pagosCancelados: [cancelado],
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
    })
    expect(rows).toHaveLength(2)
    const rowCancelado = rows.find((r) => r['ID pago'] === 'pay-2')
    expect(rowCancelado?.['Notas pago']).toBe('Nota cancelada')
    expect(rowCancelado?.['Monto']).toBe('')
    expect(rowCancelado?.['Total Transferencias']).toBe('')
    expect(rowCancelado?.['Total Efectivo']).toBe('')
    expect(rowCancelado?.['% Cuidar']).toBe(10)
    expect(rowCancelado?.['Total Cuidar']).toBe('')
    expect(rowCancelado?.['Total Médico']).toBe('')
    expect(rowCancelado?.['Entregado Medico']).toBe('')
    expect(rowCancelado?.['Monto Cancelado']).toBe(7000)
    expect(rowCancelado?.['Motivo cancelación']).toBe('Cancelación del Paciente')
    expect(rowCancelado?.['Cancelado en']).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    expect(rowCancelado?.['Turno cancelado']).toContain('Control')
    expect(rowCancelado?.Turno).toBe('Mañana')
  })

  it('asigna monto a Total Transferencias cuando el método es Transferencia', () => {
    const rows = buildPagosGerenciaExcelRows({
      payments: [{ ...payment, id: 'pay-t', metodo: 'Transferencia', monto: 3000 }],
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
    })
    expect(rows[0]!['Total Transferencias']).toBe(3000)
    expect(rows[0]!['Total Efectivo']).toBe('')
  })

  it('formatea el campo Turno cuando el pago tiene cita vinculada', () => {
    const cita = {
      id: 'c2',
      patientId: 'p1',
      doctorId: 'd1',
      fechaHora: '2026-05-15T11:30:00',
      duracionMinutos: 30,
      estado: 'atendido' as const,
      notas: 'Consulta rutina',
    }
    const rows = buildPagosGerenciaExcelRows({
      payments: [{ ...payment, citaId: 'c2' }],
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
      appointmentById: (id) => (id === 'c2' ? cita : undefined),
    })
    expect(rows[0]?.Turno).toBe('Mañana')
  })

  it('asigna la secretaria según el turno en lugar de Admi', () => {
    const rows = buildPagosGerenciaExcelRows({
      payments: [
        { ...payment, id: 'pay-m', fecha: '2026-05-15T09:30:00.000Z', registradoPor: 'Admi' },
        { ...payment, id: 'pay-t', fecha: '2026-05-15T16:30:00.000Z', registradoPor: 'secretaria' },
      ],
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
      exportUserDisplayName: 'Admi',
    })
    const rowM = rows.find((r) => r['ID pago'] === 'pay-m')
    const rowT = rows.find((r) => r['ID pago'] === 'pay-t')
    expect(rowM?.Turno).toBe('Mañana')
    expect(rowM?.['Exportado por']).toBe('Aguirre Mary')
    expect(rowM?.['Registrado por']).toBe('Aguirre Mary')
    expect(rowT?.Turno).toBe('Tarde')
    expect(rowT?.['Exportado por']).toBe('Barua Andrea')
    expect(rowT?.['Registrado por']).toBe('Barua Andrea')
  })

  it('completa Modificado por y Cancelado por con los usuarios correspondientes', () => {
    const canceladoConUsuario: PagoCancelado = {
      ...cancelado,
      id: 'cancel-user',
      canceladoPor: 'Barua Andrea',
      payment: {
        ...payment,
        id: 'pay-cancelled-user',
        modificadoPor: 'Aguirre Mary',
        modificadoEn: '2026-05-18T10:30:00',
      },
    }

    const rows = buildPagosGerenciaExcelRows({
      payments: [
        {
          ...payment,
          id: 'pay-mod',
          registradoPor: 'Aguirre Mary',
          modificadoPor: 'Barua Andrea',
          modificadoEn: '2026-05-16T15:45:00',
        },
      ],
      pagosCancelados: [canceladoConUsuario],
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
      exportUserDisplayName: 'Barua Andrea',
    })

    const rowMod = rows.find((r) => r['ID pago'] === 'pay-mod')
    expect(rowMod?.['Registrado por']).toBe('Aguirre Mary')
    expect(rowMod?.['Modificado por']).toBe('Barua Andrea (16/05/2026 15:45)')
    expect(rowMod?.['Cancelado por']).toBe('')

    const rowCanc = rows.find((r) => r['ID pago'] === 'pay-cancelled-user')
    expect(rowCanc?.['Cancelado por']).toBe('Barua Andrea')
    expect(rowCanc?.['Modificado por']).toBe('Aguirre Mary (18/05/2026 10:30)')
  })
})

describe('buildPagosGerenciaWorkbook', () => {
  it('encabezados Excel usan DNI Med y DNI Pac', () => {
    const wb = buildPagosGerenciaWorkbook({
      payments: [payment],
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
    })
    const sheet = wb.Sheets.Pagos!
    const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      range: 0,
    })[0] as string[]
    expect(headerRow).toContain(DNI_MED_LABEL)
    expect(headerRow).toContain(DNI_PAC_LABEL)
    expect(headerRow.indexOf('F. nacimiento')).toBe(
      headerRow.indexOf(DNI_PAC_LABEL) + 1,
    )
    expect(headerRow.indexOf('Edad')).toBe(headerRow.indexOf(DNI_PAC_LABEL) + 2)
    expect(headerRow.indexOf('Total Transferencias')).toBe(
      headerRow.indexOf('Método') + 1,
    )
    expect(headerRow.indexOf('Total Efectivo')).toBe(
      headerRow.indexOf('Método') + 2,
    )
    expect(headerRow).not.toContain('DNI')
    expect(headerRow).not.toContain('DNI paciente')
  })

  it('agrega los datos de Gestión de deudas al final de Pagos', () => {
    const wb = buildPagosGerenciaWorkbook({
      payments: [
        { ...payment, monto: 1400, metodo: 'Transferencia' },
        { ...payment, id: 'pay-cash', monto: 100, metodo: 'Efectivo' },
      ],
      pagosDeudasMedicos: [{
        id: 'debt-pay-1',
        doctorId: 'd1',
        deudaKey: 'd1__2026-05-15',
        fecha: '2026-05-20T12:00:00.000Z',
        monto: 50,
        metodo: 'Efectivo',
        nota: 'Pago deuda',
      }],
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
    })
    const sheet = wb.Sheets.Pagos!
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
    expect(rows[0]).toMatchObject({
      'Fecha deuda': '15/05/2026',
      'Médico deuda': 'García, Ana',
      Deuda: 50,
      Pagado: 50,
      Saldo: 0,
      'Estado deuda': 'Pagada',
      'Fecha pago deuda': '20/05/2026',
      'Método pago deuda': 'Efectivo',
      'Nota pago deuda': 'Pago deuda',
    })
    expect(rows[0]?.['Monto']).toBe(1400)
    expect(rows[1]?.['Deuda']).toBe('')
    expect(rows[1]?.['Pagado']).toBe('')
  })

  it('usa obraSocialOverride del turno vinculado si el pago o turno fue marcado como Particular', () => {
    const baseData: AppData = {
      patients: [patient],
      doctors: [doctor],
      horarios: [],
      diasLibres: [],
      atencionesMensuales: [],
      appointments: [
        {
          id: 'c-part',
          patientId: 'p1',
          doctorId: 'd1',
          fechaHora: '2026-05-15T10:00:00.000Z',
          duracionMinutos: 30,
          estado: 'programado',
          notas: '',
          obraSocialOverride: 'Particular',
        },
      ],
      payments: [],
      pagosCancelados: [],
      especialidadesCustom: [],
      obrasSocialesCustom: [],
      localidadesCustom: [],
      settings: {
        email: '',
        emailGerente: '',
        telefonoGerente: '',
        clave: '',
        telefono: '',
        cuit: '',
      },
    }
    const payWithTurno = {
      ...payment,
      id: 'pay-part',
      citaId: 'c-part',
    }
    const rows = buildPagosGerenciaExcelRows({
      payments: [payWithTurno],
      pagosCancelados: [],
      data: baseData,
      patientById: (id) => baseData.patients.find((p) => p.id === id),
      doctorById: (id) => baseData.doctors.find((d) => d.id === id),
      appointmentById: (id) => baseData.appointments.find((a) => a.id === id),
    })

    expect(rows[0]?.['Obra social']).toBe('Particular')
    expect(patient.obraSocial).toBe('OSDE')
  })

  describe('Excel de deudas por médico', () => {
    it('fechasPagoCortas compacta dd/mm/aaaa a dd-mm-aa', () => {
      expect(fechasPagoCortas('15/05/2026')).toBe('15-05-26')
      // Varias fechas van separadas con " / ".
      expect(fechasPagoCortas('15/05/2026 / 20/05/2026')).toBe('15-05-26 / 20-05-26')
      // Sin fechas (deuda pendiente) queda vacía.
      expect(fechasPagoCortas('')).toBe('')
      // Lo que no matchea el patrón se deja como estaba.
      expect(fechasPagoCortas('Sin fecha')).toBe('Sin fecha')
    })

    const pagoDeuda = {
      id: 'debt-1',
      doctorId: 'd1',
      deudaKey: 'd1__2026-05-15',
      fecha: '2026-05-20T12:00:00.000Z',
      monto: 450,
      metodo: 'Transferencia',
      destinatario: 'Gerencia',
      nroComprobante: '000123',
      nota: 'Transferencia banco',
    }

    const pagoBase = {
      id: 'pay-1',
      doctorId: 'd1',
      patientId: 'p1',
      citaId: null,
      monto: 5000,
      // La deuda del médico se genera con cobros por transferencia: lo que
      // entró por transferencia menos su comisión queda a entregar.
      fecha: '2026-05-15T10:00:00.000Z',
      metodo: 'Transferencia',
      notas: '',
    }

    const wb = buildDoctorDebtWorkbook({
      payments: [pagoBase as never],
      debtPayments: [pagoDeuda as never],
      doctors: [doctor as never],
    })

    it('la hoja "Pagos directos" trae Importe, Método, Destinatario, N° Comprobante y Notas', () => {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets['Pagos directos']!,
      )
      expect(Object.keys(rows[0]!)).toEqual([
        'Fecha',
        'Médico',
        'ID deuda',
        'Importe',
        'Método',
        'Destinatario',
        'N° Comprobante',
        'Notas',
      ])
      expect(rows[0]).toMatchObject({
        Importe: 450,
        Método: 'Transferencia',
        Destinatario: 'Gerencia',
        'N° Comprobante': '000123',
        Notas: 'Transferencia banco',
      })
    })

    it('sin destinatario ni comprobante, sale Gerencia y comprobante vacío', () => {
      const wbSin = buildDoctorDebtWorkbook({
        payments: [] as never,
        debtPayments: [
          { ...pagoDeuda, destinatario: '', nroComprobante: '' } as never,
        ],
        doctors: [doctor as never],
      })
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wbSin.Sheets['Pagos directos']!,
      )
      expect(rows[0]?.Destinatario).toBe('Gerencia')
      expect(rows[0]?.['N° Comprobante']).toBe('')
    })

    it('la hoja "Deudas médicos" también suma Destinatario y N° Comprobante', () => {
      const wbDeudas = buildDoctorDebtWorkbook({
        payments: [pagoBase as never],
        debtPayments: [pagoDeuda as never],
        doctors: [doctor as never],
      })
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wbDeudas.Sheets['Deudas médicos']!,
      )
      expect(rows[0]).toMatchObject({
        'Método': 'Transferencia',
        Destinatario: 'Gerencia',
        'N° Comprobante': '000123',
        Notas: 'Transferencia banco',
      })
    })

    it('la hoja "Deudas médicos" sólo muestra Destinatario si la deuda se pagó', () => {
      const pagoTransferencia = {
        id: 'pay-1',
        doctorId: 'd1',
        patientId: 'p1',
        citaId: null,
        monto: 60000,
        fecha: '2026-05-15T10:00:00.000Z',
        metodo: 'Transferencia',
        notas: '',
      }

      // Sin pagos aplicados: la deuda está pendiente y no tiene destinatario.
      const pendiente = buildDoctorDebtWorkbook({
        payments: [pagoTransferencia as never],
        debtPayments: [],
        doctors: [doctor as never],
      })
      const filaPendiente = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        pendiente.Sheets['Deudas médicos']!,
      )[0]!
      expect(filaPendiente.Estado).toBe('Pendiente')
      // Celda vacía: no dice Gerencia porque la deuda no se pagó.
      expect(filaPendiente.Destinatario).toBe('')

      // Con un pago aplicado: aparece el destinatario del pago.
      const pagada = buildDoctorDebtWorkbook({
        payments: [pagoTransferencia as never],
        debtPayments: [
          {
            id: 'debt-1',
            doctorId: 'd1',
            deudaKey: 'd1__2026-05-15',
            fecha: '2026-05-20T12:00:00.000Z',
            monto: 6000,
            metodo: 'Transferencia',
            destinatario: 'Gerencia',
            nroComprobante: '000123',
            nota: 'Transferencia banco',
          } as never,
        ],
        doctors: [doctor as never],
      })
      const filaPagada = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        pagada.Sheets['Deudas médicos']!,
      )[0]!
      expect(filaPagada.Destinatario).toBe('Gerencia')
      expect(filaPagada['N° Comprobante']).toBe('000123')
    })

    it('el Excel respeta el rango de fechas', () => {
      const pagos = [
        { ...pagoBase, id: 'a', fecha: '2026-05-10T10:00:00.000Z' } as never,
        { ...pagoBase, id: 'b', fecha: '2026-06-10T10:00:00.000Z' } as never,
      ]
      const wb = buildDoctorDebtWorkbook({
        payments: pagos,
        debtPayments: [],
        doctors: [doctor as never],
        desde: '2026-05-01',
        hasta: '2026-05-31',
      })
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets['Deudas médicos']!,
      )
      // Sólo entra la deuda de mayo.
      expect(rows).toHaveLength(1)
      expect(rows[0]?.['Fecha']).toBe('10/05/2026')
    })

    it('la columna "Fecha Pago" va después de "Pagado" y en dd-mm-aa', () => {
      const wb = buildDoctorDebtWorkbook({
        payments: [pagoBase as never],
        debtPayments: [pagoDeuda as never],
        doctors: [doctor as never],
      })
      const sheet = wb.Sheets['Deudas médicos']!
      const encabezados = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        header: 1,
        range: 0,
        blankrows: false,
      })[0] as string[]
      // Fecha Pago va inmediatamente después de Pagado.
      expect(encabezados.indexOf('Fecha Pago')).toBe(encabezados.indexOf('Pagado') + 1)

      const fila = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)[0]!
      // El pago se hizo el 20/05/2026, en dd-mm-aa.
      expect(fila['Fecha Pago']).toBe('20-05-26')
      // La columna Fecha (deuda) no cambió de formato.
      expect(fila['Fecha']).toBe('15/05/2026')
    })

    it('"Fecha Pago" queda vacía si la deuda no se pagó', () => {
      const wb = buildDoctorDebtWorkbook({
        payments: [pagoBase as never],
        debtPayments: [],
        doctors: [doctor as never],
      })
      const fila = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets['Deudas médicos']!,
      )[0]!
      expect(fila['Fecha Pago']).toBe('')
    })
  })
})
