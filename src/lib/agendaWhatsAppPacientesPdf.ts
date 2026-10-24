import {
  eachDayOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import { getCurrentUserDisplayName } from './auth'
import type { AgendaPdfScope } from './agendaWeekPdf'
import { citasDelDia } from './dayTurnos'
import {
  drawPdfHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
  PDF_HEADER_AGENDA_MARGIN,
  PDF_TITLE_DASH,
  pdfBodyStartYAfterHeader,
} from './pdfHeader'
import { stampPdfGeneratedFooterOnAllPages } from './pagosPdfLayout'
import {
  buildTurnoReminderMessageFromCita,
  normalizePhoneForWhatsApp,
} from './whatsapp'
import type { AppData } from '../types'

const MARGIN = PDF_HEADER_AGENDA_MARGIN
const FOOTER_SPACE = 14
const ROW_GAP = 4
const MSG_PAD = 2.5

export type WhatsAppPacientePdfRow = {
  hora: string
  paciente: string
  medico: string
  telefono: string
  telefonoValido: boolean
  mensaje: string
}

export type WhatsAppPacientePdfDay = {
  dayTitle: string
  rows: WhatsAppPacientePdfRow[]
}

function daysForWhatsAppPdf(params: {
  scope: AgendaPdfScope
  weekCursor: Date
  selectedDay: Date | null
  weekDays: Date[]
}): Date[] {
  const { scope, weekCursor, selectedDay, weekDays } = params
  if (scope === 'day') {
    return selectedDay ? [selectedDay] : []
  }
  if (scope === 'week') {
    return weekDays
  }
  const start = startOfMonth(weekCursor)
  const end = endOfMonth(weekCursor)
  return eachDayOfInterval({ start, end }).filter((d) => d.getDay() !== 0)
}

export function collectAgendaWhatsAppPacientesDays(params: {
  scope: AgendaPdfScope
  data: AppData
  weekCursor: Date
  selectedDay: Date | null
  weekDays: Date[]
  doctorFilterId?: string
  patientLabel: (id: string) => string
  doctorLabel: (id: string) => string
}): WhatsAppPacientePdfDay[] {
  const {
    scope,
    data,
    weekCursor,
    selectedDay,
    weekDays,
    doctorFilterId,
    patientLabel,
    doctorLabel,
  } = params

  const appointments = doctorFilterId
    ? data.appointments.filter((c) => c.doctorId === doctorFilterId)
    : data.appointments

  const days = daysForWhatsAppPdf({ scope, weekCursor, selectedDay, weekDays })
  const out: WhatsAppPacientePdfDay[] = []

  for (const day of days) {
    const citas = citasDelDia(appointments, day)
    const rows: WhatsAppPacientePdfRow[] = []

    for (const c of citas) {
      if (!c.whatsappRecordatorioEnviadoEn) continue

      const paciente = patientLabel(c.patientId)
      const medico = doctorLabel(c.doctorId)
      const patient = data.patients.find((p) => p.id === c.patientId)
      const doctor = data.doctors.find((d) => d.id === c.doctorId)
      const telefono = (patient?.telefono ?? '').trim() || '—'
      const hora = format(parseISO(c.fechaHora), 'HH:mm', { locale: es })
      const mensaje = buildTurnoReminderMessageFromCita({
        fechaHoraIso: c.fechaHora,
        especialidad: doctor?.especialidad,
        medicoApellido: doctor?.apellido,
        medicoNombre: doctor?.nombre,
      })

      rows.push({
        hora,
        paciente,
        medico,
        telefono,
        telefonoValido: telefono !== '—' && normalizePhoneForWhatsApp(telefono) != null,
        mensaje,
      })
    }

    if (rows.length === 0) continue

    out.push({
      dayTitle: format(day, "EEEE d 'de' MMMM yyyy", {
        locale: es,
      }).toLocaleUpperCase('es'),
      rows,
    })
  }

  return out
}

function pageSize(doc: jsPDF): { pageW: number; pageH: number } {
  return {
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
  }
}

function ensureSpace(doc: jsPDF, y: number, need: number): number {
  const { pageH } = pageSize(doc)
  if (y + need <= pageH - FOOTER_SPACE) return y
  doc.addPage('a4', 'p')
  return MARGIN + 2
}

function drawDayTitle(doc: jsPDF, y: number, title: string): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(26, 74, 138)
  doc.text(title, MARGIN, y)
  doc.setDrawColor(196, 218, 228)
  doc.setLineWidth(0.35)
  doc.line(MARGIN, y + 1.8, pageSize(doc).pageW - MARGIN, y + 1.8)
  return y + 7
}

function drawMessageRow(
  doc: jsPDF,
  y: number,
  row: WhatsAppPacientePdfRow,
  contentW: number,
): number {
  const metaLine = `${row.hora}  ·  ${row.paciente}  ·  ${row.medico}  ·  Tel: ${row.telefono}`
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(30, 41, 59)
  const metaLines = doc.splitTextToSize(metaLine, contentW) as string[]
  const metaH = metaLines.length * 3.6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.2)
  const msgLines = doc.splitTextToSize(row.mensaje, contentW - MSG_PAD * 2) as string[]
  const msgH = msgLines.length * 3.5 + MSG_PAD * 2

  const blockH = metaH + msgH + 2.5
  y = ensureSpace(doc, y, blockH)

  doc.text(metaLines, MARGIN, y)
  let boxY = y + metaH + 1.2

  if (!row.telefonoValido) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(180, 83, 9)
    doc.text('Sin teléfono válido para WhatsApp', MARGIN, boxY - 0.5)
    boxY += 2.5
  }

  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.2)
  doc.roundedRect(MARGIN, boxY, contentW, msgH, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.2)
  doc.setTextColor(51, 65, 85)
  doc.text(msgLines, MARGIN + MSG_PAD, boxY + MSG_PAD + 2.8)

  return boxY + msgH + ROW_GAP
}

export function buildAgendaWhatsAppPacientesPdf(params: {
  scope: AgendaPdfScope
  periodLabel: string
  days: WhatsAppPacientePdfDay[]
  fileStamp: string
  singleDoctorLabel?: string
}): { doc: jsPDF; filename: string } {
  const { scope, periodLabel, days, fileStamp, singleDoctorLabel } = params
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const { pageW } = pageSize(doc)
  const contentW = pageW - MARGIN * 2

  const periodText = periodLabel.replace(/\s*[–—]\s*/g, PDF_TITLE_DASH).trim()
  const headerSubtitle = `WhatsApp pacientes${PDF_TITLE_DASH}${periodText}`

  const headerBottom = drawPdfHeader(doc, pageW, headerSubtitle, {
    secondLine: singleDoctorLabel?.trim(),
    marginX: PDF_HEADER_AGENDA_MARGIN,
  })

  let y = pdfBodyStartYAfterHeader(headerBottom, PDF_BODY_EXTRA_DOWN_PLAIN)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139)
  doc.text(
    'Recordatorios abiertos desde la agenda (botón WhatsApp). Solo turnos marcados al abrir WhatsApp.',
    MARGIN,
    y,
  )
  y += 6

  if (days.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay recordatorios WhatsApp enviados en el período.', MARGIN, y + 2)
  } else {
    for (let di = 0; di < days.length; di++) {
      const day = days[di]!
      if (scope !== 'day' && di > 0) {
        doc.addPage('a4', 'p')
        y = MARGIN + 2
      }
      if (scope !== 'day') {
        y = drawDayTitle(doc, y, day.dayTitle)
      }
      for (const row of day.rows) {
        y = drawMessageRow(doc, y, row, contentW)
      }
      if (scope !== 'day' && di < days.length - 1) {
        y += 2
      }
    }
  }

  const prefix =
    scope === 'day'
      ? 'whatsapp-pacientes-dia'
      : scope === 'week'
        ? 'whatsapp-pacientes-semana'
        : 'whatsapp-pacientes-mes'
  const filename = `${prefix}-${fileStamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc, {
    bold: true,
  })

  return { doc, filename }
}

export function agendaWhatsAppPacientesPdfPreviewTitle(
  scope: AgendaPdfScope,
  periodLabel: string,
): string {
  if (scope === 'day') return `PDF WhatsApp pacientes — ${periodLabel}`
  if (scope === 'week') return `PDF WhatsApp pacientes — Semana ${periodLabel}`
  return `PDF WhatsApp pacientes — Mes ${periodLabel}`
}
