import { format, parseISO } from 'date-fns'
import { isTauri } from '@tauri-apps/api/core'
import * as XLSX from 'xlsx/xlsx.mjs'
import { DNI_MED_LABEL, DNI_PAC_LABEL } from './dniLabels'
import { labelMotivoCancelacion } from './pagosCancelados'
import { computeDoctorPorcentajeSettlement, resolvePaymentPorcentaje, computeDoctorResumenSettlement } from './pagosPdfLayout'
import { getTurnoFromFecha } from './dayTurnos'
import { resolveUserRealName, getCurrentUserDisplayName, isGenericRoleName } from './auth'
import {
  edadDesdeFechaNacimiento,
} from './patientAge'
import { joinMotivosConsulta, motivoConsultaFromNotas } from './motivoConsulta'
import type {
  Appointment,
  Doctor,
  Patient,
  PagoCancelado,
  DoctorDebtPayment,
  Payment,
} from '../types'

export type PagosGerenciaExcelRow = {
  'ID pago': string
  Fecha: string
  Hora: string
  Médico: string
  [DNI_MED_LABEL]: string
  Matrícula: string
  Especialidad: string
  'Localidad médico': string
  Paciente: string
  'Motivo de la Consulta': string
  'Motivo consulta': string
  [DNI_PAC_LABEL]: string
  'F. nacimiento': string
  Edad: number | ''
  Domicilio: string
  Localidad: string
  'Obra social': string
  Monto: number | ''
  Método: string
  'Total Transferencias': number | ''
  'Total Efectivo': number | ''
  '% Cuidar': number
  'Total Cuidar': number | ''
  'Total Médico': number | ''
  'Entregado Medico': number | ''
  'Notas pago': string
  'Cancelado en': string
  'Motivo cancelación': string
  'Detalle cancelación': string
  'Turno cancelado': string
  'Monto Cancelado': number | ''
  'Fecha deuda': string
  'Médico deuda': string
  'Concepto deuda': string
  Deuda: number | ''
  Pagado: number | ''
  Saldo: number | ''
  'Estado deuda': string
  'Fecha pago deuda': string
  'Método pago deuda': string
  'Destinatario deuda': string
  'N° comprobante deuda': string
  'Nota pago deuda': string
  'Exportado por': string
  'Registrado por': string
  'Modificado por': string
  'Cancelado por': string
  Turno: string
}

export type PagosGerenciaExcelInput = {
  payments: Payment[]
  pagosCancelados?: PagoCancelado[]
  pagosDeudasMedicos?: DoctorDebtPayment[]
  patientById?: (id: string) => Patient | undefined
  doctorById?: (id: string) => Doctor | undefined
  appointmentById?: (id: string) => Appointment | undefined
  patients?: Patient[]
  doctors?: Doctor[]
  appointments?: Appointment[]
  motivosConsultaCustom?: string[]
  periodLabel?: string
  userLabel?: string
  shiftLabel?: string
  exportUserDisplayName?: string
  /**
   * Si todos los pagos del export entraron por transferencia, "Total Cuidar"
   * sale en negativo (mismo criterio que la columna "% Cuidar" del listado).
   */
  todosTransferencia?: boolean
}

type DebtExcelAggregate = {
  doctorId: string
  fecha: string
  facturado: number
  comision: number
  transferencias: number
}

export type PagosGerenciaDebtExcelRow = {
  'ID deuda': string
  'Médico': string
  'Fecha deuda': string
  Concepto: string
  'Deuda total': number
  'Pago aplicado': number
  'Saldo restante': number
  Estado: string
  'Fecha último pago': string
  'Método pago': string
  /** Destinatario del pago de deuda (por defecto "Gerencia"). */
  Destinatario: string
  'N° comprobante': string
  Nota: string
}

function debtAggregateKey(doctorId: string, fecha: string): string {
  return `${doctorId}__${fecha}`
}

function buildDebtExcelRows(
  input: PagosGerenciaExcelInput,
): PagosGerenciaDebtExcelRow[] {
  const { payments, pagosDeudasMedicos = [] } = input
  const doctorById =
    input.doctorById ?? ((id: string) => input.doctors?.find((d) => d.id === id))
  const aggregates = new Map<string, DebtExcelAggregate>()
  for (const payment of payments) {
    if (payment.monto <= 0) continue
    const fecha = format(parseISO(payment.fecha), 'yyyy-MM-dd')
    const key = debtAggregateKey(payment.doctorId, fecha)
    const current = aggregates.get(key) ?? {
      doctorId: payment.doctorId,
      fecha,
      facturado: 0,
      comision: 0,
      transferencias: 0,
    }
    const settlement = computeDoctorPorcentajeSettlement(
      payment.monto,
      resolvePaymentPorcentaje(
        payment,
        doctorById(payment.doctorId)?.porcentaje,
      ),
    )
    current.facturado += payment.monto
    current.comision += settlement.totalPorcentaje
    if (payment.metodo.trim().toLowerCase() === 'transferencia') {
      current.transferencias += payment.monto
    }
    aggregates.set(key, current)
  }

  const debtPaymentByKey = new Map<string, DoctorDebtPayment[]>()
  for (const payment of pagosDeudasMedicos) {
    const list = debtPaymentByKey.get(payment.deudaKey) ?? []
    list.push(payment)
    debtPaymentByKey.set(payment.deudaKey, list)
  }

  return [...aggregates.entries()]
    .map(([key, aggregate]) => {
      const deudaTotal = Math.max(
        0,
        Math.round((aggregate.comision + aggregate.transferencias - aggregate.facturado) * 100) / 100,
      )
      const debtPayments = debtPaymentByKey.get(key) ?? []
      const pagoAplicado = Math.min(
        deudaTotal,
        debtPayments.reduce((sum, payment) => sum + payment.monto, 0),
      )
      const saldo = Math.max(0, deudaTotal - pagoAplicado)
      const doctor = doctorById(aggregate.doctorId)
      const paymentDates = [...new Set(debtPayments.map((payment) => format(parseISO(payment.fecha), 'dd/MM/yyyy')))]
      const methods = [...new Set(debtPayments.map((payment) => payment.metodo).filter(Boolean))]
      // El destinatario sólo se muestra si la deuda se pagó de verdad: una
      // deuda pendiente no tiene a quién se le pagó. Los pagos viejos que no
      // tienen destinatario cargado se muestran como "Gerencia".
      const recipients = debtPayments.length
        ? [
            ...new Set(
              debtPayments.map((payment) => payment.destinatario?.trim() || 'Gerencia'),
            ),
          ]
        : []
      const receipts = [
        ...new Set(debtPayments.map((payment) => payment.nroComprobante?.trim()).filter(Boolean)),
      ]
      const notes = [...new Set(debtPayments.map((payment) => payment.nota).filter(Boolean))]
      return {
        'ID deuda': key,
        'Médico': doctor ? `${doctor.apellido}, ${doctor.nombre}` : '—',
        'Fecha deuda': format(parseISO(`${aggregate.fecha}T12:00:00`), 'dd/MM/yyyy'),
        Concepto: 'Comisión pendiente - cobros por transferencia',
        'Deuda total': deudaTotal,
        'Pago aplicado': pagoAplicado,
        'Saldo restante': saldo,
        Estado: saldo === 0 ? 'Pagada' : pagoAplicado > 0 ? 'Parcial' : 'Pendiente',
        'Fecha último pago': paymentDates.join(' / '),
        'Método pago': methods.join(' / '),
        Destinatario: recipients.join(' / '),
        'N° comprobante': receipts.join(' / '),
        Nota: notes.join(' / '),
      }
    })
    .filter((row) => row['Deuda total'] > 0)
    .sort((a, b) => a['Fecha deuda'].localeCompare(b['Fecha deuda']))
}

const DEBT_HEADERS: (keyof PagosGerenciaDebtExcelRow)[] = [
  'ID deuda', 'Médico', 'Fecha deuda', 'Concepto', 'Deuda total',
  'Pago aplicado', 'Saldo restante', 'Estado', 'Fecha último pago',
  'Método pago', 'Destinatario', 'N° comprobante', 'Nota',
]

export function resolvePagoHistoriaClinica(
  payment: Payment,
  appointmentById?: (id: string) => Appointment | undefined,
): string {
  if (!payment.citaId || !appointmentById) return ''
  const cita = appointmentById(payment.citaId)
  return joinMotivosConsulta(cita?.notas ?? '', cita?.motivoConsulta2)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function formatTurnoCancelado(appointment: Appointment | null | undefined): string {
  if (!appointment) return ''
  const when = parseISO(appointment.fechaHora)
  let out = format(when, 'dd/MM/yyyy HH:mm')
  const notas = appointment.notas?.trim()
  if (notas) {
    out += ` — ${joinMotivosConsulta(notas, appointment.motivoConsulta2)}`
  }
  return out
}

function formatPacienteFechaNacimiento(fechaNacimiento: string): string {
  const raw = fechaNacimiento?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''
  return format(parseISO(`${raw}T12:00:00`), 'dd/MM/yyyy')
}

function splitMontoPorMetodo(
  monto: number | '',
  metodo: string,
): Pick<PagosGerenciaExcelRow, 'Total Transferencias' | 'Total Efectivo'> {
  if (monto === '') {
    return { 'Total Transferencias': '', 'Total Efectivo': '' }
  }
  const key = metodo.trim().toLowerCase()
  if (key === 'transferencia') {
    return { 'Total Transferencias': monto, 'Total Efectivo': '' }
  }
  if (key === 'efectivo') {
    return { 'Total Transferencias': '', 'Total Efectivo': monto }
  }
  return { 'Total Transferencias': '', 'Total Efectivo': '' }
}

function buildPagosGerenciaExcelRow(
  p: Payment,
  input: PagosGerenciaExcelInput,
  cancel?: PagoCancelado,
): PagosGerenciaExcelRow {
  const patientById =
    input.patientById ?? ((id: string) => input.patients?.find((x) => x.id === id))
  const doctorById =
    input.doctorById ?? ((id: string) => input.doctors?.find((x) => x.id === id))
  const appointmentById =
    input.appointmentById ?? ((id: string) => input.appointments?.find((x) => x.id === id))

  const when = parseISO(p.fecha)
  const patient = patientById ? patientById(p.patientId) : undefined
  const doctor = doctorById ? doctorById(p.doctorId) : undefined
  const linkedAppointment =
    cancel?.appointment ??
    (p.citaId && appointmentById ? appointmentById(p.citaId) : undefined)
  // En la planilla van juntos el motivo 1 y el motivo 2. Para la columna
  // "Motivo consulta" (que agrupa) se sigue usando sólo el motivo 1.
  const motivoConsulta1 = linkedAppointment?.notas?.trim() ?? ''
  const historiaClinica = joinMotivosConsulta(
    motivoConsulta1,
    linkedAppointment?.motivoConsulta2,
  )
  const settlement = computeDoctorPorcentajeSettlement(
    p.monto,
    resolvePaymentPorcentaje(p, doctor?.porcentaje),
  )
  const docResumen = computeDoctorResumenSettlement(
    p.monto,
    p.metodo.trim().toLowerCase() === 'transferencia' ? p.monto : 0,
    resolvePaymentPorcentaje(p, doctor?.porcentaje),
  )
  const canceladoEn = cancel
    ? format(parseISO(cancel.canceladoEn), 'dd/MM/yyyy HH:mm')
    : ''
  const motivoCancelacion = cancel
    ? labelMotivoCancelacion(cancel.motivo)
    : ''
  const esPagoCancelado = Boolean(canceladoEn && motivoCancelacion)
  const fechaNacimiento = patient?.fechaNacimiento ?? ''
  const edad = edadDesdeFechaNacimiento(fechaNacimiento, when)
  const monto = esPagoCancelado ? '' : p.monto
  const porMetodo = splitMontoPorMetodo(monto, p.metodo)

  const rowTurno = getTurnoFromFecha(linkedAppointment?.fechaHora || p.fecha)
  const defaultSecretaryForTurno =
    rowTurno === 'Mañana' ? 'Aguirre Mary' : 'Barua Andrea'

  const resolveSecretary = (rawName?: string): string => {
    const trimmed = (rawName || '').trim()
    if (
      !trimmed ||
      isGenericRoleName(trimmed) ||
      trimmed.toLowerCase() === 'admi' ||
      trimmed.toLowerCase() === 'admin'
    ) {
      return defaultSecretaryForTurno
    }
    return resolveUserRealName(trimmed, rowTurno)
  }

  const rawRegistradoPor =
    p.registradoPor?.trim() || linkedAppointment?.creadoPor?.trim() || ''
  const rawModificadoPor =
    p.modificadoPor?.trim() || linkedAppointment?.modificadoPor?.trim() || ''
  const rawModificadoEn = p.modificadoPor?.trim()
    ? p.modificadoEn
    : (linkedAppointment?.modificadoPor?.trim()
        ? linkedAppointment?.modificadoEn
        : undefined)

  return {
    'ID pago': p.id,
    Fecha: format(when, 'dd/MM/yyyy'),
    Hora: format(when, 'HH:mm'),
    Médico: doctor ? `${doctor.apellido}, ${doctor.nombre}` : '—',
    [DNI_MED_LABEL]: doctor?.dni?.trim() ?? '',
    Matrícula: doctor?.matricula ?? '',
    Especialidad: doctor?.especialidad ?? '',
    'Localidad médico': doctor?.localidad ?? '',
    Paciente: patient ? `${patient.apellido}, ${patient.nombre}` : '—',
    'Motivo de la Consulta': historiaClinica,
    'Motivo consulta': (() => {
      const { motivo: mot, otroDetalle } = motivoConsultaFromNotas(
        motivoConsulta1,
        input.motivosConsultaCustom ?? [],
      )
      return mot === 'Otro' ? (otroDetalle ? `Otro (${otroDetalle})` : 'Otro') : mot
    })(),
    [DNI_PAC_LABEL]: patient?.dni ?? '',
    'F. nacimiento': formatPacienteFechaNacimiento(fechaNacimiento),
    Edad: edad == null ? '' : edad,
    Domicilio: patient?.domicilio ?? '',
    Localidad: patient?.localidad ?? '',
    'Obra social':
      p.obraSocialOverride || linkedAppointment?.obraSocialOverride || patient?.obraSocial || '',
    Monto: monto,
    Método: p.metodo,
    ...porMetodo,
    '% Cuidar': settlement.porcentaje,
    // Con todo el export por transferencia, la plata nunca pasó por caja: lo
    // que se le separa al médico sale del lado del centro, no se le adeuda.
    'Total Cuidar': esPagoCancelado
      ? ''
      : input.todosTransferencia
        ? -settlement.totalPorcentaje
        : settlement.totalPorcentaje,
    'Total Médico': esPagoCancelado ? '' : settlement.totalGeneral,
    'Entregado Medico': esPagoCancelado ? '' : docResumen.efectivoAEntregar,
    'Notas pago': p.notas ?? '',
    'Cancelado en': canceladoEn,
    'Motivo cancelación': motivoCancelacion,
    'Detalle cancelación':
      cancel?.motivo === 'otros' ? (cancel.notasOtros ?? '') : '',
    'Turno cancelado': formatTurnoCancelado(cancel?.appointment),
    'Monto Cancelado': esPagoCancelado ? p.monto : '',
    'Fecha deuda': '',
    'Médico deuda': '',
    'Concepto deuda': '',
    Deuda: '',
    Pagado: '',
    Saldo: '',
    'Estado deuda': '',
    'Fecha pago deuda': '',
    'Método pago deuda': '',
    'Destinatario deuda': '',
    'N° comprobante deuda': '',
    'Nota pago deuda': '',
    'Exportado por': resolveSecretary(
      input.userLabel || input.exportUserDisplayName,
    ),
    'Registrado por': resolveSecretary(rawRegistradoPor),
    'Modificado por': rawModificadoPor
      ? `${resolveSecretary(rawModificadoPor)}${
          rawModificadoEn
            ? ` (${format(parseISO(rawModificadoEn), 'dd/MM/yyyy HH:mm')})`
            : ''
        }`
      : '',
    'Cancelado por': cancel
      ? resolveSecretary(cancel.canceladoPor)
      : '',
    Turno: rowTurno,
  }
}

export function buildPagosGerenciaExcelRows(
  input: PagosGerenciaExcelInput,
): PagosGerenciaExcelRow[] {
  const { payments, pagosCancelados = [] } = input
  type Sortable = { when: number; row: PagosGerenciaExcelRow }
  const sortable: Sortable[] = [
    ...payments.map((p) => ({
      when: parseISO(p.fecha).getTime(),
      row: buildPagosGerenciaExcelRow(p, input),
    })),
    ...pagosCancelados.map((c) => ({
      when: parseISO(c.payment.fecha).getTime(),
      row: buildPagosGerenciaExcelRow(c.payment, input, c),
    })),
  ]
  return sortable.sort((a, b) => a.when - b.when).map((x) => x.row)
}

const EXCEL_HEADERS: (keyof PagosGerenciaExcelRow)[] = [
  'ID pago',
  'Fecha',
  'Hora',
  'Médico',
  DNI_MED_LABEL,
  'Matrícula',
  'Especialidad',
  'Localidad médico',
  'Paciente',
  'Motivo de la Consulta',
  DNI_PAC_LABEL,
  'F. nacimiento',
  'Edad',
  'Domicilio',
  'Localidad',
  'Obra social',
  'Monto',
  'Método',
  'Total Transferencias',
  'Total Efectivo',
  '% Cuidar',
  'Total Cuidar',
  'Total Médico',
  'Entregado Medico',
  'Notas pago',
  'Cancelado en',
  'Motivo cancelación',
  'Detalle cancelación',
  'Turno cancelado',
  'Monto Cancelado',
  'Fecha deuda',
  'Médico deuda',
  'Concepto deuda',
  'Deuda',
  'Pagado',
  'Saldo',
  'Estado deuda',
  'Fecha pago deuda',
  'Método pago deuda',
  'Destinatario deuda',
  'N° comprobante deuda',
  'Nota pago deuda',
  'Exportado por',
  'Registrado por',
  'Modificado por',
  'Cancelado por',
  'Turno',
]



function pagosGerenciaRowsToAoa(rows: PagosGerenciaExcelRow[]): unknown[][] {
  const user = getCurrentUserDisplayName()
  return [
    [...EXCEL_HEADERS],
    ...rows.map((row) => EXCEL_HEADERS.map((key) => row[key] ?? '')),
  ]
}

export function buildPagosGerenciaWorkbook(
  input: PagosGerenciaExcelInput,
): XLSX.WorkBook {
  const rows = buildPagosGerenciaExcelRows(input)
  const debtRows = buildDebtExcelRows(input)
  const debtByKey = new Map(debtRows.map((row) => [row['ID deuda'], row]))
  const debtByPaymentId = new Map<string, {
    key: string
    debt: PagosGerenciaDebtExcelRow
  }>()
  for (const payment of [
    ...input.payments,
    ...(input.pagosCancelados ?? []).map((item) => item.payment),
  ]) {
    const fecha = format(parseISO(payment.fecha), 'yyyy-MM-dd')
    const key = debtAggregateKey(payment.doctorId, fecha)
    const debt = debtByKey.get(key)
    if (debt) debtByPaymentId.set(payment.id, { key, debt })
  }
  const emittedDebtKeys = new Set<string>()
  const rowsWithDebt = rows.map((row) => {
    const debtEntry = debtByPaymentId.get(row['ID pago'])
    if (!debtEntry || emittedDebtKeys.has(debtEntry.key)) return row
    emittedDebtKeys.add(debtEntry.key)
    const debt = debtEntry.debt
    return {
      ...row,
      'Fecha deuda': debt['Fecha deuda'],
      'Médico deuda': debt['Médico'],
      'Concepto deuda': debt.Concepto,
      Deuda: debt['Deuda total'],
      Pagado: debt['Pago aplicado'],
      Saldo: debt['Saldo restante'],
      'Estado deuda': debt.Estado,
      'Fecha pago deuda': debt['Fecha último pago'],
      'Método pago deuda': debt['Método pago'],
      'Destinatario deuda': debt.Destinatario,
      'N° comprobante deuda': debt['N° comprobante'],
      'Nota pago deuda': debt.Nota,
    }
  })
  const sheet = XLSX.utils.aoa_to_sheet(pagosGerenciaRowsToAoa(rowsWithDebt))
  const user = getCurrentUserDisplayName()
  const debtSheet = XLSX.utils.aoa_to_sheet([
    [...DEBT_HEADERS],
    ...debtRows.map((row) => DEBT_HEADERS.map((key) => row[key] ?? '')),
  ])
  const debtPayments = input.pagosDeudasMedicos ?? []
  const debtPaymentsSheet = XLSX.utils.aoa_to_sheet([
    [
      'ID pago deuda',
      'ID médico',
      'ID deuda',
      'Fecha pago',
      'Monto',
      'Método pago',
      'Destinatario',
      'N° comprobante',
      'Nota',
    ],
    ...debtPayments.map((payment) => [
      payment.id,
      payment.doctorId,
      payment.deudaKey,
      format(parseISO(payment.fecha), 'dd/MM/yyyy HH:mm'),
      payment.monto,
      payment.metodo,
      payment.destinatario?.trim() || 'Gerencia',
      payment.nroComprobante?.trim() ?? '',
      payment.nota,
    ]),
  ])
  const protectConfig = undefined

  sheet['!cols'] = [
    { wch: 38 },
    { wch: 12 },
    { wch: 8 },
    { wch: 28 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 28 },
    { wch: 32 },
    { wch: 12 },
    { wch: 12 },
    { wch: 8 },
    { wch: 22 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 24 },
    { wch: 8 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 22 },
    { wch: 28 },
    { wch: 28 },
    { wch: 16 },
    { wch: 14 },
    { wch: 28 },
    { wch: 42 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 32 },
    { wch: 24 },
    { wch: 24 },
    { wch: 32 },
    { wch: 24 },
    { wch: 28 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Pagos')
  XLSX.utils.book_append_sheet(wb, debtSheet, 'Deudas médicos')
  XLSX.utils.book_append_sheet(wb, debtPaymentsSheet, 'Pagos deudas')
  debtSheet['!cols'] = [
    { wch: 28 }, { wch: 28 }, { wch: 14 }, { wch: 42 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 32 },
  ]
  debtPaymentsSheet['!cols'] = [
    { wch: 28 }, { wch: 18 }, { wch: 28 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 32 },
  ]
  return wb
}

/**
 * Compacta fechas ya formateadas a dd-mm-aa: "15/05/2026 / 20/05/2026" pasa a
 * "15-05-26 / 20-05-26". Se usa para la columna "Fecha Pago" del libro de
 * deudas por médico, que es angosta y con el año de 4 dígitos se parte en dos
 * líneas. Lo que no matchea el patrón dd/mm/yyyy se deja como está.
 */
export function fechasPagoCortas(valor: string): string {
  return valor
    .split(' / ')
    .map((fecha) => {
      const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha.trim())
      return partes ? `${partes[1]}-${partes[2]}-${partes[3].slice(2)}` : fecha
    })
    .join(' / ')
}

export function buildDoctorDebtWorkbook(params: {
  payments: Payment[]
  debtPayments: DoctorDebtPayment[]
  doctors: Doctor[]
  doctorId?: string
  /** Rango de fechas de la deuda, en YYYY-MM-DD. */
  desde?: string
  hasta?: string
}): XLSX.WorkBook {
  const desde = params.desde ?? ''
  const hasta = params.hasta ?? ''
  const enRango = (fecha: string) =>
    (!desde || fecha.slice(0, 10) >= desde) && (!hasta || fecha.slice(0, 10) <= hasta)
  const pagosRango = params.payments.filter((payment) => enRango(payment.fecha))
  const payments = params.doctorId
    ? pagosRango.filter((payment) => payment.doctorId === params.doctorId)
    : pagosRango
  const deudaDelRango = params.debtPayments.filter((payment) => enRango(payment.fecha))
  const debtPayments = params.doctorId
    ? deudaDelRango.filter((payment) => payment.doctorId === params.doctorId)
    : deudaDelRango
  const doctorById = (id: string) => params.doctors.find((doctor) => doctor.id === id)
  const debtRows = buildDebtExcelRows({
    payments,
    pagosDeudasMedicos: debtPayments,
    patientById: () => undefined,
    doctorById,
  })
  const user = getCurrentUserDisplayName()
  const debtSheet = XLSX.utils.aoa_to_sheet([
    [
      'Fecha',
      'Médico',
      'Concepto',
      'Deuda',
      'Pagado',
      'Fecha Pago',
      'Saldo',
      'Estado',
      'Método',
      'Destinatario',
      'N° Comprobante',
      'Notas',
    ],
    ...debtRows.map((row) => [
      row['Fecha deuda'],
      row.Médico,
      row.Concepto,
      row['Deuda total'],
      row['Pago aplicado'],
      fechasPagoCortas(row['Fecha último pago']),
      row['Saldo restante'],
      row.Estado,
      row['Método pago'],
      row.Destinatario,
      row['N° comprobante'],
      row.Nota,
    ]),
  ])
  const paymentsSheet = XLSX.utils.aoa_to_sheet([
    [
      'Fecha',
      'Médico',
      'ID deuda',
      'Importe',
      'Método',
      'Destinatario',
      'N° Comprobante',
      'Notas',
    ],
    ...debtPayments.map((payment) => [
      format(parseISO(payment.fecha), 'dd/MM/yyyy HH:mm'),
      doctorById(payment.doctorId)
        ? `${doctorById(payment.doctorId)!.apellido}, ${doctorById(payment.doctorId)!.nombre}`
        : '—',
      payment.deudaKey,
      payment.monto,
      payment.metodo,
      payment.destinatario?.trim() || 'Gerencia',
      payment.nroComprobante?.trim() ?? '',
      payment.nota,
    ]),
  ])
  const protectConfig = undefined

  debtSheet['!cols'] = [
    { wch: 14 }, { wch: 28 }, { wch: 48 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 },
    { wch: 22 }, { wch: 18 }, { wch: 32 },
  ]
  paymentsSheet['!cols'] = [
    { wch: 20 }, { wch: 28 }, { wch: 28 }, { wch: 14 }, { wch: 18 },
    { wch: 22 }, { wch: 18 }, { wch: 32 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, debtSheet, 'Deudas médicos')
  XLSX.utils.book_append_sheet(wb, paymentsSheet, 'Pagos directos')
  return wb
}

export function workbookToXlsxBytes(wb: XLSX.WorkBook): Uint8Array {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Uint8Array(buf)
}

export function formatUserFilenameSlug(rawUser: string): string {
  const trimmed = (rawUser || '').trim()
  if (!trimmed || trimmed.toLowerCase() === 'todos' || trimmed.toLowerCase() === 'admin' || trimmed.toLowerCase() === 'admi') {
    return 'Admi'
  }
  const user = resolveUserRealName(trimmed).trim()
  const firstWord = user.split(/\s+/)[0] || user
  return firstWord.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]/g, '')
}

export function gerenciaExcelFilename(
  fileStamp: string,
  userOrSuffix?: string,
): string {
  const stamp = fileStamp.trim() || 'export'
  const userSlug = formatUserFilenameSlug(userOrSuffix || '')
  const suffix = userSlug || 'Admi'
  return `${stamp}_${suffix}.xlsx`
}

export async function savePagosGerenciaExcelFile(
  wb: XLSX.WorkBook,
  filename: string,
): Promise<boolean> {
  const bytes = workbookToXlsxBytes(wb)
  const name = filename.trim() || 'pagos-gerencia.xlsx'

  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<boolean>('save_excel_dialog', {
      defaultFilename: name,
      fileBase64: bytesToBase64(bytes),
    })
  }

  const blob = new Blob([new Uint8Array(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  return true
}
