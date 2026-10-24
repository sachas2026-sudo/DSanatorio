import { describe, expect, it } from 'vitest'
import {
  buildDoctorDebtPdf,
  buildDoctorDebtPdfRows,
  coincideRangoFechas,
  coincideSituacion,
} from './doctorDebtPdf'
import type { Doctor, DoctorDebtPayment, Payment } from '../types'

/**
 * Textos que el PDF dibuja, en orden. Sirve para assertar sobre la secuencia
 * (qué va pegado a qué), no sólo sobre "contiene".
 */
function celdasDelPdf(pdf: string): string[] {
  return [...pdf.matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]!)
}

describe('doctorDebtPdf', () => {
  it('formats concepto as Comisión pendiente - dd/MM/yyyy', () => {
    const doctors: Doctor[] = [
      {
        id: 'doc-1',
        nombre: 'Juan',
        apellido: 'Perez',
        especialidad: 'Clinica',
        porcentaje: 80,
      } as Doctor,
    ]

    const payments: Payment[] = [
      {
        id: 'p-1',
        doctorId: 'doc-1',
        turno: 'Mañana',
        fecha: '2026-06-17T10:00:00.000Z',
        monto: 10000,
        metodo: 'Transferencia',
        paciente: 'Paciente Uno',
      } as Payment,
    ]

    const rows = buildDoctorDebtPdfRows(payments, [], doctors)
    expect(rows.length).toBe(1)
    expect(rows[0]!.concepto).toBe('Comisión pendiente')
    expect(rows[0]!.doctor).toBe('Perez, Juan')
  })

  describe('filtro de situación', () => {
    const doctors: Doctor[] = [
      { id: 'doc-1', nombre: 'Juan', apellido: 'Perez', porcentaje: 80 } as Doctor,
      { id: 'doc-2', nombre: 'Ana', apellido: 'Gomez', porcentaje: 80 } as Doctor,
    ]

    const pagos = (doctorId: string, monto: number): Payment =>
      ({
        id: `p-${doctorId}`,
        doctorId,
        citaId: null,
        patientId: 'pa-1',
        monto,
        fecha: '2026-06-17T10:00:00.000Z',
        metodo: 'Transferencia',
        notas: '',
      }) as Payment

    const pagoDeuda = (key: string, monto: number): DoctorDebtPayment =>
      ({
        id: `d-${key}`,
        doctorId: key.split('__')[0]!,
        deudaKey: key,
        fecha: '2026-06-18T10:00:00.000Z',
        monto,
        metodo: 'Efectivo',
        destinatario: 'Gerencia',
        nroComprobante: '',
        nota: '',
      }) as DoctorDebtPayment

    // Se paga la deuda completa de doc-1 (queda pagada) y una parte de la de
    // doc-2 (queda pendiente). El importe sale de las filas, no de un número fijo.
    const filasBase = buildDoctorDebtPdfRows(
      [pagos('doc-1', 10000), pagos('doc-2', 10000)],
      [],
      doctors,
    )
    const deudaDoc1 = filasBase.find((r) => r.doctorId === 'doc-1')!.deuda
    const deudaDoc2 = filasBase.find((r) => r.doctorId === 'doc-2')!.deuda
    expect(deudaDoc1).toBeGreaterThan(0)

    const pagosDeuda = [
      pagoDeuda('doc-1__2026-06-17', deudaDoc1),
      pagoDeuda('doc-2__2026-06-17', Math.round(deudaDoc2 / 2)),
    ]

    it('coincideSituacion separa pagadas de pendientes', () => {
      const rows = buildDoctorDebtPdfRows(
        [pagos('doc-1', 10000), pagos('doc-2', 10000)],
        pagosDeuda,
        doctors,
      )
      const pagada = rows.find((r) => r.doctorId === 'doc-1')!
      const pendiente = rows.find((r) => r.doctorId === 'doc-2')!
      expect(pagada.saldo).toBe(0)
      expect(pendiente.saldo).toBeGreaterThan(0)
      expect(coincideSituacion(pagada, 'pagada')).toBe(true)
      expect(coincideSituacion(pagada, 'pendiente')).toBe(false)
      expect(coincideSituacion(pendiente, 'pendiente')).toBe(true)
      expect(coincideSituacion(pendiente, 'pagada')).toBe(false)
      // Sin filtro entra todo.
      expect(coincideSituacion(pagada, undefined)).toBe(true)
      expect(coincideSituacion(pendiente, undefined)).toBe(true)
    })

    it('el PDF aplica médico y situación', () => {
      const pdf = buildDoctorDebtPdf({
        payments: [pagos('doc-1', 10000), pagos('doc-2', 10000)],
        debtPayments: pagosDeuda,
        doctors,
        doctorId: 'doc-1',
        situacion: 'pagada',
      })
      // El archivo lleva el slug del médico y de la situación.
      expect(pdf.filename).toContain('perez')
      expect(pdf.filename).toContain('pagada')
      const texto = pdf.doc.output()
      expect(texto).toContain('Pagadas')
      expect(texto).toContain('Perez, Juan')
      // doc-2 está fuera por el filtro de médico.
      expect(texto).not.toContain('Gomez, Ana')
    })

    it('sin filtro de médico trae todos, pero respeta la situación', () => {
      const pdf = buildDoctorDebtPdf({
        payments: [pagos('doc-1', 10000), pagos('doc-2', 10000)],
        debtPayments: pagosDeuda,
        doctors,
        situacion: 'pendiente',
      })
      const texto = pdf.doc.output()
      expect(texto).toContain('Pendientes')
      // Sólo doc-2, que es la que quedó con saldo.
      expect(texto).toContain('Gomez, Ana')
      expect(texto).not.toContain('Perez, Juan')
    })

    it('sin filtros trae los dos médicos', () => {
      const pdf = buildDoctorDebtPdf({
        payments: [pagos('doc-1', 10000), pagos('doc-2', 10000)],
        debtPayments: pagosDeuda,
        doctors,
      })
      const texto = pdf.doc.output()
      expect(texto).toContain('Todos los médicos')
      expect(texto).toContain('Perez, Juan')
      expect(texto).toContain('Gomez, Ana')
    })
  })

  describe('tabla del PDF', () => {
    const doctors: Doctor[] = [
      { id: 'doc-1', nombre: 'Juan', apellido: 'Perez', porcentaje: 10 } as Doctor,
    ]
    const pago: Payment = {
      id: 'p-1',
      doctorId: 'doc-1',
      patientId: 'pa-1',
      citaId: null,
      monto: 5000,
      fecha: '2026-06-17T10:00:00.000Z',
      metodo: 'Transferencia',
      notas: '',
    } as Payment

    it('sale horizontal con las columnas del pago directo', () => {
      const pdf = buildDoctorDebtPdf({
        payments: [pago],
        debtPayments: [
          {
            id: 'd-1',
            doctorId: 'doc-1',
            deudaKey: 'doc-1__2026-06-17',
            fecha: '2026-06-18T10:00:00.000Z',
            monto: 1000,
            metodo: 'Transferencia',
            destinatario: 'Gerencia',
            nroComprobante: '000123',
            nota: 'Transferencia banco',
          } as DoctorDebtPayment,
        ],
        doctors,
      })
      // Horizontal: el ancho es mayor que el alto.
      const size = pdf.doc.internal.pageSize
      expect(size.getWidth()).toBeGreaterThan(size.getHeight())
      const texto = pdf.doc.output()
      for (const col of [
        'Deuda',
        'Pagado',
        'Saldo',
        'Estado',
        'Método',
        'Destinatario',
        'N° Comprobante',
        'Notas',
      ]) {
        expect(texto).toContain(col)
      }
      expect(texto).toContain('000123')
      expect(texto).toContain('Transferencia banco')
      expect(texto).toContain('Gerencia')
    })

    it('la pastilla de totales dice Pagos Realizados y Deuda total', () => {
      const pagoGrande = { ...pago, monto: 60000 } as Payment
      const pdf = buildDoctorDebtPdf({
        payments: [pagoGrande],
        debtPayments: [
          {
            id: 'd-1',
            doctorId: 'doc-1',
            deudaKey: 'doc-1__2026-06-17',
            fecha: '2026-06-18T10:00:00.000Z',
            monto: 3000,
            metodo: 'Efectivo',
            destinatario: 'Gerencia',
            nroComprobante: '',
            nota: '',
          } as DoctorDebtPayment,
        ],
        doctors,
      })
      const celdas = celdasDelPdf(pdf.doc.output())

      // Un solo texto, con los dos importes y en el orden pedido.
      expect(celdas).toContain('Pagos Realizados: $ 3.000 - Deuda total: $ 6.000')
      // Salieron del pie los rótulos viejos.
      expect(celdas).not.toContain('Saldo pendiente')
      expect(celdas.some((t) => /registros?$/.test(t))).toBe(false)
    })

    it('con Situación = Pendiente la pastilla sólo muestra la deuda total', () => {
      const pagoGrande = { ...pago, monto: 60000 } as Payment
      // Parcial: tiene deuda y a la vez algo pagado, así que el caso es real.
      const parcial = buildDoctorDebtPdf({
        payments: [pagoGrande],
        debtPayments: [
          {
            id: 'd-1',
            doctorId: 'doc-1',
            deudaKey: 'doc-1__2026-06-17',
            fecha: '2026-06-18T10:00:00.000Z',
            monto: 1000,
            metodo: 'Efectivo',
            destinatario: 'Gerencia',
            nroComprobante: '',
            nota: '',
          } as DoctorDebtPayment,
        ],
        doctors,
        situacion: 'pendiente',
      })
      const celdas = celdasDelPdf(parcial.doc.output())
      // Sólo la deuda: el informe es de lo que falta cobrar.
      expect(celdas).toContain('Deuda total: $ 6.000')
      expect(celdas.some((t) => t.startsWith('Pagos Realizados'))).toBe(false)
      // El pago sigue estando en la tabla, sólo no se totaliza.
      expect(celdas).toContain('$ 1.000')
    })

    it('con Situación = Pagado la pastilla sólo muestra los pagos realizados', () => {
      const pagoGrande = { ...pago, monto: 60000 } as Payment
      const deudaPagada: DoctorDebtPayment[] = [
        {
          id: 'd-1',
          doctorId: 'doc-1',
          deudaKey: 'doc-1__2026-06-17',
          fecha: '2026-06-18T10:00:00.000Z',
          monto: 6000,
          metodo: 'Efectivo',
          destinatario: 'Gerencia',
          nroComprobante: '',
          nota: '',
        } as DoctorDebtPayment,
      ]
      const pagada = buildDoctorDebtPdf({
        payments: [pagoGrande],
        debtPayments: deudaPagada,
        doctors,
        situacion: 'pagada',
      })
      const celdas = celdasDelPdf(pagada.doc.output())
      expect(celdas).toContain('Pagos Realizados: $ 6.000')
      expect(celdas.some((t) => t.startsWith('Deuda total'))).toBe(false)
      // La deuda sigue en la tabla: sólo no se totaliza en la pastilla.
      expect(celdas).toContain('$ 6.000')
    })

    it('sin filtro de situación la pastilla lleva los dos totales', () => {
      const pagoGrande = { ...pago, monto: 60000 } as Payment
      const todas = buildDoctorDebtPdf({
        payments: [pagoGrande],
        debtPayments: [
          {
            id: 'd-1',
            doctorId: 'doc-1',
            deudaKey: 'doc-1__2026-06-17',
            fecha: '2026-06-18T10:00:00.000Z',
            monto: 1000,
            metodo: 'Efectivo',
            destinatario: 'Gerencia',
            nroComprobante: '',
            nota: '',
          } as DoctorDebtPayment,
        ],
        doctors,
      })
      expect(celdasDelPdf(todas.doc.output())).toContain(
        'Pagos Realizados: $ 1.000 - Deuda total: $ 6.000',
      )
    })

    it('el resumen se queda en la primera hoja mientras haya papel', () => {
      const many = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          ...pago,
          id: `p-${i}`,
          fecha: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
        })) as Payment[]

      // Con 16 filas la tabla deja unos 40mm libres: antes el total saltaba
      // igual a una hoja nueva porque el umbral era de 45mm.
      const con16 = buildDoctorDebtPdf({ payments: many(16), debtPayments: [], doctors })
      expect(con16.doc.getNumberOfPages()).toBe(1)

      // Con 20 ya no entra ni la tabla ni la barra: ahí sí, segunda hoja.
      const con20 = buildDoctorDebtPdf({ payments: many(20), debtPayments: [], doctors })
      expect(con20.doc.getNumberOfPages()).toBeGreaterThan(1)
    })

    it('los montos salen con signo pesos y separador de miles', () => {
      // La deuda es el 10% de lo cobrado por transferencia: 60.000 -> 6.000.
      const pagoGrande = { ...pago, monto: 60000 } as Payment
      const deuda = buildDoctorDebtPdfRows([pagoGrande], [], doctors)[0]!.deuda
      expect(deuda).toBe(6000)
      const pdf = buildDoctorDebtPdf({
        payments: [pagoGrande],
        debtPayments: [
          {
            id: 'd-1',
            doctorId: 'doc-1',
            deudaKey: 'doc-1__2026-06-17',
            fecha: '2026-06-18T10:00:00.000Z',
            monto: 3000,
            metodo: 'Efectivo',
            destinatario: 'Gerencia',
            nroComprobante: '',
            nota: '',
          } as DoctorDebtPayment,
        ],
        doctors,
      })
      const texto = pdf.doc.output()
      expect(texto).toContain('$ 6.000') // deuda
      expect(texto).toContain('$ 3.000') // pagado
      // Todos los importes llevan el signo pesos y separador de miles.
      const conPesos = texto.match(/\$ [\d.]+/g) ?? []
      expect(conPesos.length).toBeGreaterThanOrEqual(3)
      for (const m of conPesos) {
        expect(m).toMatch(/^\$ [\d.]+$/)
      }
    })
  })

  describe('rango de fechas y destinatario', () => {
    const doctors: Doctor[] = [
      { id: 'doc-1', nombre: 'Juan', apellido: 'Perez', porcentaje: 10 } as Doctor,
    ]
    const pago = (fecha: string, monto: number): Payment =>
      ({
        id: `p-${fecha}`,
        doctorId: 'doc-1',
        patientId: 'pa-1',
        citaId: null,
        monto,
        fecha: `${fecha}T10:00:00.000Z`,
        metodo: 'Transferencia',
        notas: '',
      }) as Payment

    it('coincideRangoFechas respeta desde y hasta', () => {
      expect(coincideRangoFechas('2026-05-15', '', '')).toBe(true)
      expect(coincideRangoFechas('2026-05-15', '2026-05-01', '2026-05-31')).toBe(true)
      expect(coincideRangoFechas('2026-04-30', '2026-05-01', '')).toBe(false)
      expect(coincideRangoFechas('2026-06-01', '', '2026-05-31')).toBe(false)
      // Los bordes van incluidos.
      expect(coincideRangoFechas('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true)
      expect(coincideRangoFechas('2026-05-31', '2026-05-01', '2026-05-31')).toBe(true)
    })

    it('el PDF filtra por rango de fechas', () => {
      const pagos = [pago('2026-05-10', 10000), pago('2026-06-10', 10000)]
      const todas = buildDoctorDebtPdf({ payments: pagos, debtPayments: [], doctors })
      expect(todas.doc.output()).toContain('10/05/2026')
      expect(todas.doc.output()).toContain('10/06/2026')

      const mayo = buildDoctorDebtPdf({
        payments: pagos,
        debtPayments: [],
        doctors,
        desde: '2026-05-01',
        hasta: '2026-05-31',
      })
      const texto = mayo.doc.output()
      expect(texto).toContain('10/05/2026')
      expect(texto).not.toContain('10/06/2026')
      // El alcance del PDF dice qué rango se usó.
      expect(texto).toContain('2026-05-01 a 2026-05-31')
    })

    it('"Fecha Pago" va después de "Pagado" y en dd-mm-aa', () => {
      const pendiente = buildDoctorDebtPdfRows([pago('2026-05-10', 60000)], [], doctors)[0]!
      // Sin pagos no hay fecha de pago.
      expect(pendiente.fechaPago).toBe('')

      const pagada = buildDoctorDebtPdfRows(
        [pago('2026-05-10', 60000)],
        [
          {
            id: 'd-1',
            doctorId: 'doc-1',
            deudaKey: pendiente.key,
            // Dos pagos: gana la fecha más reciente.
            fecha: '2026-05-11T10:00:00.000Z',
            monto: 1000,
            metodo: 'Transferencia',
            destinatario: 'Gerencia',
            nroComprobante: '',
            nota: '',
          } as DoctorDebtPayment,
          {
            id: 'd-2',
            doctorId: 'doc-1',
            deudaKey: pendiente.key,
            fecha: '2026-05-20T10:00:00.000Z',
            monto: 1000,
            metodo: 'Transferencia',
            destinatario: 'Gerencia',
            nroComprobante: '',
            nota: '',
          } as DoctorDebtPayment,
        ],
        doctors,
      )[0]!
      expect(pagada.fechaPago).toBe('2026-05-20')

      const texto = buildDoctorDebtPdf({
        payments: [pago('2026-05-10', 60000)],
        debtPayments: [
          {
            id: 'd-1',
            doctorId: 'doc-1',
            deudaKey: pendiente.key,
            fecha: '2026-05-20T10:00:00.000Z',
            monto: pendiente.deuda,
            metodo: 'Transferencia',
            destinatario: 'Gerencia',
            nroComprobante: '',
            nota: '',
          } as DoctorDebtPayment,
        ],
        doctors,
      }).doc.output()

      // La celda está en dd-mm-aa (ej. 22-10-26), no en dd/mm/aaaa.
      expect(texto).toContain('20-05-26')
      // `aa` en date-fns es el marcador AM/PM: salía "20-05-PM".
      expect(texto).not.toContain('20-05-PM')
      // La columna Fecha (deuda) mantiene su formato largo.
      expect(texto).toContain('10/05/2026')
    })

    it('el destinatario aparece sólo si la deuda se pagó', () => {
      const pendiente = buildDoctorDebtPdfRows([pago('2026-05-10', 60000)], [], doctors)[0]!
      expect(pendiente.saldo).toBeGreaterThan(0)
      // Sin pagos aplicados no hay destinatario.
      expect(pendiente.destinatario).toBe('')
      expect(pendiente.metodo).toBe('')
      expect(pendiente.nroComprobante).toBe('')
      expect(pendiente.nota).toBe('')

      const pagada = buildDoctorDebtPdfRows(
        [pago('2026-05-10', 60000)],
        [
          {
            id: 'd-1',
            doctorId: 'doc-1',
            deudaKey: pendiente.key,
            fecha: '2026-05-11T10:00:00.000Z',
            monto: pendiente.deuda,
            metodo: 'Transferencia',
            // Pago viejo sin destinatario: se muestra como Gerencia.
            destinatario: '',
            nroComprobante: '000777',
            nota: 'Transferencia banco',
          } as DoctorDebtPayment,
        ],
        doctors,
      )[0]!
      expect(pagada.saldo).toBe(0)
      expect(pagada.destinatario).toBe('Gerencia')
      expect(pagada.nroComprobante).toBe('000777')
    })
  })
})
