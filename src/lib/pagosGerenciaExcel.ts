import { format, parseISO } from 'date-fns'
import { isTauri } from '@tauri-apps/api/core'
import * as XLSX from 'xlsx'
import type { Appointment, Doctor, Patient, Payment } from '../types'

export type PagosGerenciaExcelRow = {
  'ID pago': string
  Fecha: string
  Hora: string
  Médico: string
  Matrícula: string
  Especialidad: string
  'Localidad médico': string
  Paciente: string
  'Historia Clínica': string
  DNI: string
  Domicilio: string
  Localidad: string
  'Obra social': string
  Monto: number
  Método: string
  'Notas pago': string
}

export type PagosGerenciaExcelInput = {
  payments: Payment[]
  patientById: (id: string) => Patient | undefined
  doctorById: (id: string) => Doctor | undefined
  appointmentById?: (id: string) => Appointment | undefined
}

export function resolvePagoHistoriaClinica(
  payment: Payment,
  appointmentById?: (id: string) => Appointment | undefined,
): string {
  if (!payment.citaId || !appointmentById) return ''
  return appointmentById(payment.citaId)?.notas?.trim() ?? ''
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

export function buildPagosGerenciaExcelRows(
  input: PagosGerenciaExcelInput,
): PagosGerenciaExcelRow[] {
  const { payments, patientById, doctorById, appointmentById } = input
  return [...payments]
    .sort((a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime())
    .map((p) => {
      const when = parseISO(p.fecha)
      const patient = patientById(p.patientId)
      const doctor = doctorById(p.doctorId)
      return {
        'ID pago': p.id,
        Fecha: format(when, 'dd/MM/yyyy'),
        Hora: format(when, 'HH:mm'),
        Médico: doctor ? `${doctor.apellido}, ${doctor.nombre}` : '—',
        Matrícula: doctor?.matricula ?? '',
        Especialidad: doctor?.especialidad ?? '',
        'Localidad médico': doctor?.localidad ?? '',
        Paciente: patient ? `${patient.apellido}, ${patient.nombre}` : '—',
        'Historia Clínica': resolvePagoHistoriaClinica(p, appointmentById),
        DNI: patient?.dni ?? '',
        Domicilio: patient?.domicilio ?? '',
        Localidad: patient?.localidad ?? '',
        'Obra social': patient?.obraSocial ?? '',
        Monto: p.monto,
        Método: p.metodo,
        'Notas pago': p.notas ?? '',
      }
    })
}

const EXCEL_HEADERS: (keyof PagosGerenciaExcelRow)[] = [
  'ID pago',
  'Fecha',
  'Hora',
  'Médico',
  'Matrícula',
  'Especialidad',
  'Localidad médico',
  'Paciente',
  'Historia Clínica',
  'DNI',
  'Domicilio',
  'Localidad',
  'Obra social',
  'Monto',
  'Método',
  'Notas pago',
]

export function buildPagosGerenciaWorkbook(
  input: PagosGerenciaExcelInput,
): XLSX.WorkBook {
  const rows = buildPagosGerenciaExcelRows(input)
  const sheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([EXCEL_HEADERS])
  sheet['!cols'] = [
    { wch: 38 },
    { wch: 12 },
    { wch: 8 },
    { wch: 28 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 28 },
    { wch: 32 },
    { wch: 12 },
    { wch: 22 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 24 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Pagos')
  return wb
}

export function workbookToXlsxBytes(wb: XLSX.WorkBook): Uint8Array {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Uint8Array(buf)
}

export function gerenciaExcelFilename(
  fileStamp: string,
  medicoSuffix: string,
): string {
  const stamp = fileStamp.trim() || 'export'
  const suffix = medicoSuffix.trim() || 'todos'
  return `pagos-gerencia-${suffix}-${stamp}.xlsx`
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
