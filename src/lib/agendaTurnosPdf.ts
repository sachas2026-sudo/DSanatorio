import {
  eachDayOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import { eachAgendaWeekDay } from './agendaRules'
import type { AgendaPdfScope } from './agendaWeekPdf'
import {
  citasDelDia,
  citasEnFranja,
  medicoGroupsEnFranja,
  mergeMedicoGroupsDia,
  splitCitasMananaTarde,
} from './dayTurnos'
import {
  drawPdfHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
  PDF_HEADER_AGENDA_MARGIN,
  PDF_TITLE_DASH,
  pdfBodyStartYAfterHeader,
} from './pdfHeader'
import {
  PAGOS_DOCTOR_BLOCK_RADIUS,
  stampPdfGeneratedFooterOnAllPages,
  strokePagosTableRoundFrame,
} from './pagosPdfLayout'
import { DEFAULT_AGENDA_RANGES, turnosLibresMedicoDia } from './weekSlots'
import type { Appointment, AppData } from '../types'

const MARGIN = PDF_HEADER_AGENDA_MARGIN
const COL_GAP = 2.4
const FOOTER_SPACE = 12
const COL_PAD = 2
const MIN_COL_WIDTH = 40
const MAX_COLS = 5
const MEDICOS_PER_PAGE = 5

export type AgendaTurnosPdfCita = {
  hora: string
  paciente: string
  estado: string
}

export type AgendaTurnosPdfMedico = {
  label: string
  libresManana: string | null
  libresTarde: string | null
  citasManana: AgendaTurnosPdfCita[]
  citasTarde: AgendaTurnosPdfCita[]
}

export type AgendaTurnosPdfDay = {
  dayTitle: string
  medicos: AgendaTurnosPdfMedico[]
}

function daysForTurnosPdf(params: {
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

function mapCitas(
  citas: Appointment[],
  patientLabel: (id: string) => string,
  estadoFor: (c: Appointment) => string,
): AgendaTurnosPdfCita[] {
  return citas.map((c) => ({
    hora: format(parseISO(c.fechaHora), 'HH:mm', { locale: es }),
    paciente: patientLabel(c.patientId) || '—',
    estado: estadoFor(c) || '—',
  }))
}

export function collectAgendaTurnosPdfDays(params: {
  scope: AgendaPdfScope
  data: AppData
  weekCursor: Date
  selectedDay: Date | null
  weekDays: Date[]
  doctorFilterId?: string
  doctorLabel: (doctorId: string) => string
  patientLabel: (id: string) => string
  estadoFor: (c: Appointment) => string
}): AgendaTurnosPdfDay[] {
  const {
    scope,
    data,
    weekCursor,
    selectedDay,
    weekDays,
    doctorFilterId,
    doctorLabel,
    patientLabel,
    estadoFor,
  } = params

  const appointments = doctorFilterId
    ? data.appointments.filter((c) => c.doctorId === doctorFilterId)
    : data.appointments

  const days = daysForTurnosPdf({ scope, weekCursor, selectedDay, weekDays })
  const out: AgendaTurnosPdfDay[] = []

  for (const day of days) {
    const citas = citasDelDia(appointments, day)
    const manana = medicoGroupsEnFranja({
      citasFranja: citasEnFranja(citas, DEFAULT_AGENDA_RANGES[0]!),
      selectedDay: day,
      franja: DEFAULT_AGENDA_RANGES[0]!,
      data,
      doctorLabel,
    })
    const tarde = medicoGroupsEnFranja({
      citasFranja: citasEnFranja(citas, DEFAULT_AGENDA_RANGES[1]!),
      selectedDay: day,
      franja: DEFAULT_AGENDA_RANGES[1]!,
      data,
      doctorLabel,
    })
    const groups = mergeMedicoGroupsDia(manana, tarde)
    const groupsToUse = doctorFilterId
      ? groups.filter((g) => g.key === doctorFilterId)
      : groups

    const medicos: AgendaTurnosPdfMedico[] = groupsToUse.map((g) => {
      const libres = turnosLibresMedicoDia(g.key, day, data)
      const { manana: citasManana, tarde: citasTarde } = splitCitasMananaTarde(
        g.citas,
      )
      return {
        label: g.label,
        libresManana:
          libres?.manana.atiende
            ? `Libre ${libres.manana.count} T. Mañana`
            : null,
        libresTarde:
          libres?.tarde.atiende
            ? `Libre ${libres.tarde.count} T. Tarde`
            : null,
        citasManana: mapCitas(citasManana, patientLabel, estadoFor),
        citasTarde: mapCitas(citasTarde, patientLabel, estadoFor),
      }
    })

    if (medicos.length === 0) continue

    out.push({
      dayTitle: format(day, "EEEE d 'de' MMMM yyyy", {
        locale: es,
      }).toLocaleUpperCase('es'),
      medicos,
    })
  }

  return out
}

function isSingleDoctorPdf(
  days: AgendaTurnosPdfDay[],
  singleDoctorLabel?: string,
): boolean {
  if (singleDoctorLabel?.trim()) return true
  if (days.length === 0) return false
  const labels = new Set<string>()
  for (const day of days) {
    if (day.medicos.length !== 1) return false
    labels.add(day.medicos[0]!.label)
  }
  return labels.size === 1
}

type PdfOrientation = 'landscape' | 'portrait'

function addTurnosPdfPage(doc: jsPDF, orientation: PdfOrientation): void {
  doc.addPage('a4', orientation)
}

function pageSize(doc: jsPDF): { pageW: number; pageH: number } {
  return {
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

function layoutColumns(
  count: number,
  contentWidth: number,
): { cols: number; colWidth: number } {
  const maxByWidth = Math.floor(
    (contentWidth + COL_GAP) / (MIN_COL_WIDTH + COL_GAP),
  )
  const cols = Math.max(
    1,
    Math.min(count, MAX_COLS, maxByWidth),
  )
  const colWidth = (contentWidth - (cols - 1) * COL_GAP) / cols
  return { cols, colWidth }
}

type ColumnTypography = {
  name: number
  esp: number
  libres: number
  citaWho: number
  citaEst: number
  lineWho: number
  lineEst: number
  sin: number
}

function columnTypography(colW: number): ColumnTypography {
  if (colW >= 100) {
    return {
      name: 10.5,
      esp: 9.5,
      libres: 8,
      citaWho: 9,
      citaEst: 8.2,
      lineWho: 4,
      lineEst: 3.6,
      sin: 8.5,
    }
  }
  if (colW >= 48) {
    return {
      name: 7.8,
      esp: 7.2,
      libres: 6.2,
      citaWho: 7.2,
      citaEst: 6.5,
      lineWho: 3.3,
      lineEst: 3.0,
      sin: 7,
    }
  }
  if (colW >= 40) {
    return {
      name: 7.4,
      esp: 6.9,
      libres: 6,
      citaWho: 6.9,
      citaEst: 6.3,
      lineWho: 3.2,
      lineEst: 2.9,
      sin: 6.7,
    }
  }
  return {
    name: 7,
    esp: 6.5,
    libres: 5.6,
    citaWho: 6.6,
    citaEst: 6,
    lineWho: 3,
    lineEst: 2.8,
    sin: 6.4,
  }
}

function splitDoctorLabel(label: string): { name: string; esp: string | null } {
  const sep = label.indexOf(' - ')
  if (sep === -1) return { name: label, esp: null }
  return { name: label.slice(0, sep), esp: label.slice(sep + 3) }
}

function drawWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[]
  for (const line of lines) {
    doc.text(line, x, y)
    y += lineHeight
  }
  return y
}

function drawFranjaDivider(doc: jsPDF, x: number, y: number, width: number): number {
  doc.setDrawColor(47, 111, 219)
  doc.setLineWidth(0.35)
  doc.line(x + COL_PAD, y, x + width - COL_PAD, y)
  doc.setLineWidth(0.15)
  return y + 2.5
}

function drawCitaRow(
  doc: jsPDF,
  cita: AgendaTurnosPdfCita,
  x: number,
  y: number,
  innerW: number,
  type: ColumnTypography,
): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(type.citaWho)
  doc.setTextColor(26, 39, 68)
  const whoLines = doc.splitTextToSize(
    `${cita.hora}  ${cita.paciente}`,
    innerW,
  ) as string[]
  for (const line of whoLines.slice(0, 2)) {
    doc.text(line, x, y)
    y += type.lineWho
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(type.citaEst)
  doc.setTextColor(107, 124, 147)
  const estLines = doc.splitTextToSize(cita.estado, innerW) as string[]
  for (const line of estLines.slice(0, 2)) {
    doc.text(line, x, y)
    y += type.lineEst
  }

  y += 1.2
  return y
}

function drawMedicoColumnContent(
  doc: jsPDF,
  x: number,
  startY: number,
  colW: number,
  medico: AgendaTurnosPdfMedico,
  pageH: number,
): number {
  let y = startY + COL_PAD + 1
  const innerW = colW - COL_PAD * 2
  const bottom = pageH - FOOTER_SPACE
  const type = columnTypography(colW)

  const { name, esp } = splitDoctorLabel(medico.label)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(type.name)
  doc.setTextColor(26, 74, 138)
  y = drawWrappedText(doc, name.toUpperCase(), x + COL_PAD, y, innerW, 3.2)

  if (esp) {
    doc.setFontSize(type.esp)
    y = drawWrappedText(doc, esp.toUpperCase(), x + COL_PAD, y, innerW, 3.1)
  }

  y += 0.8

  if (medico.libresManana || medico.libresTarde) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(type.libres)
    doc.setTextColor(29, 107, 74)
    if (medico.libresManana) {
      doc.text(medico.libresManana, x + COL_PAD, y)
      y += 3
    }
    if (medico.libresTarde) {
      doc.text(medico.libresTarde, x + COL_PAD, y)
      y += 3
    }
    y += 0.5
  }

  const drawCitas = (citas: AgendaTurnosPdfCita[]) => {
    for (const cita of citas) {
      if (y > bottom - 8) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(type.citaEst)
        doc.setTextColor(107, 124, 147)
        doc.text('…', x + COL_PAD, y)
        return
      }
      y = drawCitaRow(doc, cita, x + COL_PAD, y, innerW, type)
    }
  }

  if (
    medico.citasManana.length === 0 &&
    medico.citasTarde.length === 0
  ) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(type.sin)
    doc.setTextColor(107, 124, 147)
    doc.text('Sin turnos', x + COL_PAD, y)
    y += 5
  } else {
    drawCitas(medico.citasManana)
    if (medico.citasManana.length > 0 && medico.citasTarde.length > 0) {
      y = drawFranjaDivider(doc, x, y, colW)
    }
    drawCitas(medico.citasTarde)
  }

  return y + COL_PAD
}

function drawDaySectionTitle(doc: jsPDF, y: number, title: string): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(26, 39, 68)
  doc.text(title, MARGIN, y)
  return y + 5.5
}

function estimateRowHeight(medicos: AgendaTurnosPdfMedico[]): number {
  let max = 22
  for (const m of medicos) {
    const appts = m.citasManana.length + m.citasTarde.length
    const h =
      18 +
      appts * 9 +
      (m.citasManana.length > 0 && m.citasTarde.length > 0 ? 4 : 0)
    max = Math.max(max, h)
  }
  return max
}

function drawMedicoColumnsRow(
  doc: jsPDF,
  pageH: number,
  startY: number,
  medicos: AgendaTurnosPdfMedico[],
  colWidth: number,
): number {
  const rowTop = startY
  const estH = estimateRowHeight(medicos) + COL_PAD * 2

  medicos.forEach((_medico, index) => {
    const x = MARGIN + index * (colWidth + COL_GAP)
    doc.setFillColor(250, 252, 255)
    doc.setDrawColor(220, 228, 240)
    doc.setLineWidth(0.2)
    doc.roundedRect(x, rowTop, colWidth, estH, 4, 4, 'FD')
    strokePagosTableRoundFrame(
      doc,
      x,
      rowTop,
      colWidth,
      estH,
      PAGOS_DOCTOR_BLOCK_RADIUS,
    )
  })

  let maxBottom = rowTop
  medicos.forEach((medico, index) => {
    const x = MARGIN + index * (colWidth + COL_GAP)
    const bottom = drawMedicoColumnContent(
      doc,
      x,
      rowTop,
      colWidth,
      medico,
      pageH,
    )
    maxBottom = Math.max(maxBottom, bottom)
  })

  const actualH = Math.max(estH, maxBottom - rowTop + COL_PAD)
  if (actualH > estH + 1) {
    medicos.forEach((_medico, index) => {
      const x = MARGIN + index * (colWidth + COL_GAP)
      doc.setFillColor(250, 252, 255)
      doc.setDrawColor(220, 228, 240)
      doc.roundedRect(x, rowTop, colWidth, actualH, 4, 4, 'FD')
      strokePagosTableRoundFrame(
        doc,
        x,
        rowTop,
        colWidth,
        actualH,
        PAGOS_DOCTOR_BLOCK_RADIUS,
      )
    })
    medicos.forEach((medico, index) => {
      const x = MARGIN + index * (colWidth + COL_GAP)
      drawMedicoColumnContent(doc, x, rowTop, colWidth, medico, pageH)
    })
    maxBottom = rowTop + actualH - COL_PAD
  }

  return maxBottom + 4
}

function drawDayColumns(
  doc: jsPDF,
  startY: number,
  medicos: AgendaTurnosPdfMedico[],
  orientation: PdfOrientation,
  dayTitle?: string,
): number {
  const medicsPerPage = orientation === 'portrait' ? 1 : MEDICOS_PER_PAGE
  const pages = chunk(medicos, medicsPerPage)
  let y = startY
  let pageH = pageSize(doc).pageH

  for (let pi = 0; pi < pages.length; pi++) {
    const pageMedicos = pages[pi]!
    if (pi > 0) {
      addTurnosPdfPage(doc, orientation)
      pageH = pageSize(doc).pageH
      y = MARGIN + 2
      if (dayTitle) {
        y = drawDaySectionTitle(doc, y, dayTitle)
      }
    }

    const contentWidth = pageSize(doc).pageW - 2 * MARGIN
    const { colWidth } = layoutColumns(pageMedicos.length, contentWidth)
    y = drawMedicoColumnsRow(doc, pageH, y, pageMedicos, colWidth)
  }

  return y
}

export function buildAgendaTurnosPdf(params: {
  scope: AgendaPdfScope
  periodLabel: string
  days: AgendaTurnosPdfDay[]
  fileStamp: string
  singleDoctorLabel?: string
}): { doc: jsPDF; filename: string } {
  const { scope, periodLabel, days, fileStamp, singleDoctorLabel } = params
  const portrait = isSingleDoctorPdf(days, singleDoctorLabel)
  const orientation: PdfOrientation = portrait ? 'portrait' : 'landscape'
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pageW = pageSize(doc).pageW

  const periodText = periodLabel.replace(/\s*[–—]\s*/g, PDF_TITLE_DASH).trim()
  const headerSubtitle = `Turnos${PDF_TITLE_DASH}${periodText}`

  const headerBottom = drawPdfHeader(doc, pageW, headerSubtitle, {
    secondLine: singleDoctorLabel?.trim(),
    marginX: PDF_HEADER_AGENDA_MARGIN,
  })

  let cursorY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  if (days.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(107, 124, 147)
    doc.text('No hay turnos para exportar en el período.', MARGIN, cursorY + 2)
  } else {
    for (let di = 0; di < days.length; di++) {
      const day = days[di]!
      if (scope !== 'day' && di > 0) {
        addTurnosPdfPage(doc, orientation)
        cursorY = MARGIN + 2
      }
      if (scope !== 'day') {
        cursorY = drawDaySectionTitle(doc, cursorY, day.dayTitle)
      }
      cursorY = drawDayColumns(
        doc,
        cursorY,
        day.medicos,
        orientation,
        day.dayTitle,
      )
    }
  }

  const prefix =
    scope === 'day'
      ? 'agenda-turnos-dia'
      : scope === 'week'
        ? 'agenda-turnos-semana'
        : 'agenda-turnos-mes'
  const filename = `${prefix}-${fileStamp}.pdf`

  stampPdfGeneratedFooterOnAllPages(doc, {
    bold: true,
    label: `Generado: ${format(new Date(), 'dd-MM-yyyy HH:mm', { locale: es })}`,
  })

  return { doc, filename }
}

export function agendaTurnosPdfPreviewTitle(
  scope: AgendaPdfScope,
  periodLabel: string,
): string {
  if (scope === 'day') return `PDF Turnos — ${periodLabel}`
  if (scope === 'week') return `PDF Turnos — Semana ${periodLabel}`
  return `PDF Turnos — Mes ${periodLabel}`
}

export function weekDaysForTurnosExport(weekCursor: Date): Date[] {
  return eachAgendaWeekDay(weekCursor)
}
