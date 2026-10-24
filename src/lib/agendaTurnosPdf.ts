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
import { eachAgendaWeekDay } from './agendaRules'
import type { AgendaPdfScope } from './agendaWeekPdf'
import {
  citasDelDia,
  medicoGroupsCitasDelDia,
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
  stampPdfGeneratedFooterOnAllPages,
} from './pagosPdfLayout'
import { turnosLibresMedicoDia } from './weekSlots'
import { joinMotivosConsulta, motivoConsultaFromNotas } from './motivoConsulta'
import type { Appointment, AppData } from '../types'

const MARGIN = PDF_HEADER_AGENDA_MARGIN
const COL_GAP = 2.4
const FOOTER_SPACE = 12
const COL_PAD = 2
const MIN_COL_WIDTH = 40
const MAX_COLS = 5
const MEDICOS_PER_PAGE = 5
const MAX_APPOINTMENTS_PER_COLUMN = 18
/** Desplazamiento interno del bloque de turnos (un solo médico). */
const SINGLE_DOCTOR_CONTENT_INSET = 8
/** Margen horizontal extra de la tabla (un solo médico). */
const SINGLE_DOCTOR_TABLE_SIDE_INSET = 6
/** Ancho de la columna de turnos vs observaciones (un solo médico). */
const SINGLE_DOCTOR_TURNOS_SHARE = 0.44
const SINGLE_DOCTOR_TABLE_ROW_H = 6
const SINGLE_DOCTOR_SHIFT_GAP = 3
const SINGLE_DOCTOR_SHIFT_HEADING_GAP = 2

export type AgendaTurnosPdfCita = {
  hora: string
  paciente: string
  obraSocial: string
  motivoConsulta: string | null
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

function formatCitaPacienteLine(cita: AgendaTurnosPdfCita): string {
  const who = `${cita.hora}  ${cita.paciente}`
  const os = cita.obraSocial.trim()
  return os ? `${who}  |  ${os}` : who
}

function motivoTexto(parsed: { motivo: string; otroDetalle: string } | null): string {
  if (!parsed) return ''
  return parsed.motivo === 'Otro' ? parsed.otroDetalle : parsed.motivo
}

function mapCitas(
  citas: Appointment[],
  patientLabel: (id: string) => string,
  obraSocialLabel: (id: string) => string,
  motivosConsultaCustom: string[],
  estadoFor: (c: Appointment) => string,
): AgendaTurnosPdfCita[] {
  return citas.map((c) => {
    const notasSinUrgencia = c.notas
      .replace(/^Urgencia\s*[—–-]\s*/i, '')
      .replace(/^Urgencia$/i, '')
      .trim()
    const parsedMotivo = notasSinUrgencia
      ? motivoConsultaFromNotas(notasSinUrgencia, motivosConsultaCustom)
      : null
    const notasMotivo2 = c.motivoConsulta2?.trim() ?? ''
    const parsedMotivo2 = notasMotivo2
      ? motivoConsultaFromNotas(notasMotivo2, motivosConsultaCustom)
      : null

    return {
      hora: format(parseISO(c.fechaHora), 'HH:mm', { locale: es }),
      paciente: patientLabel(c.patientId) || '—',
      obraSocial: c.obraSocialOverride || obraSocialLabel(c.patientId) || '',
      motivoConsulta: joinMotivosConsulta(
        motivoTexto(parsedMotivo),
        motivoTexto(parsedMotivo2),
      ) || null,
      estado: estadoFor(c) || '—',
    }
  })
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
  obraSocialLabel: (id: string) => string
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
    obraSocialLabel,
    estadoFor,
  } = params

  const appointments = doctorFilterId
    ? data.appointments.filter((c) => c.doctorId === doctorFilterId)
    : data.appointments

  const days = daysForTurnosPdf({ scope, weekCursor, selectedDay, weekDays })
  const out: AgendaTurnosPdfDay[] = []

  for (const day of days) {
    const citas = citasDelDia(appointments, day, { includeCancelled: true })
    const groups = medicoGroupsCitasDelDia({
      citas,
      selectedDay: day,
      data,
      doctorLabel,
    })
    const groupsToUse = doctorFilterId
      ? groups.filter(
          (g) => g.key === doctorFilterId && g.citas.length > 0,
        )
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
        citasManana: mapCitas(
          citasManana,
          patientLabel,
          obraSocialLabel,
          data.motivosConsultaCustom ?? [],
          estadoFor,
        ),
        citasTarde: mapCitas(
          citasTarde,
          patientLabel,
          obraSocialLabel,
          data.motivosConsultaCustom ?? [],
          estadoFor,
        ),
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

function addTurnosPdfPage(doc: jsPDF): void {
  const { pageW, pageH } = pageSize(doc)
  doc.addPage('a4', pageW > pageH ? 'l' : 'p')
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

function medicoSegment(
  medico: AgendaTurnosPdfMedico,
  start: number,
  count: number,
): { segment: AgendaTurnosPdfMedico; next: number } {
  const citas = [...medico.citasManana, ...medico.citasTarde]
  const selected = citas.slice(start, start + count)
  const mananaRemaining = Math.max(0, medico.citasManana.length - start)
  const mananaCount = Math.min(selected.length, mananaRemaining)
  const segment: AgendaTurnosPdfMedico = {
    ...medico,
    libresManana: start === 0 ? medico.libresManana : null,
    libresTarde: start + selected.length > medico.citasManana.length
      ? medico.libresTarde
      : null,
    citasManana: selected.slice(0, mananaCount),
    citasTarde: selected.slice(mananaCount),
  }
  return { segment, next: start + selected.length }
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

function columnTypography(colW: number, singleDoctorMode = false): ColumnTypography {
  const bump = singleDoctorMode ? 1.4 : 0
  const lineBump = singleDoctorMode ? 0.5 : 0
  let base: ColumnTypography
  if (colW >= 100) {
    base = {
      name: 10.5,
      esp: 9.5,
      libres: 8,
      citaWho: 9,
      citaEst: 8.2,
      lineWho: 4,
      lineEst: 3.6,
      sin: 8.5,
    }
  } else if (colW >= 48) {
    base = {
      name: 7.8,
      esp: 7.2,
      libres: 6.2,
      citaWho: 7.2,
      citaEst: 6.5,
      lineWho: 3.3,
      lineEst: 3.0,
      sin: 7,
    }
  } else if (colW >= 40) {
    base = {
      name: 7.4,
      esp: 6.9,
      libres: 6,
      citaWho: 6.9,
      citaEst: 6.3,
      lineWho: 3.2,
      lineEst: 2.9,
      sin: 6.7,
    }
  } else {
    base = {
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
  if (!singleDoctorMode) return base
  return {
    name: base.name + bump,
    esp: base.esp + bump,
    libres: base.libres + bump,
    citaWho: base.citaWho + bump,
    citaEst: base.citaEst + bump,
    lineWho: base.lineWho + lineBump,
    lineEst: base.lineEst + lineBump,
    sin: base.sin + bump,
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
  doc.setDrawColor(225, 232, 242)
  doc.setLineWidth(0.35)
  doc.line(x + COL_PAD, y, x + width - COL_PAD, y)
  doc.setLineWidth(0.15)
  return y + 4.8
}

function drawPatientRowDivider(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
): number {
  doc.setDrawColor(200, 210, 224)
  doc.setLineWidth(0.22)
  doc.line(x, y, x + width, y)
  doc.setLineWidth(0.15)
  // En el PDF de un solo médico las filas llevan divisor en cada turno;
  // mantener este espacio reducido evita que la pastilla crezca demasiado.
  return y + 5.2
}

function drawCitaRow(
  doc: jsPDF,
  cita: AgendaTurnosPdfCita,
  x: number,
  y: number,
  innerW: number,
  type: ColumnTypography,
  options?: {
    dividerAfter?: boolean
    dividerWidth?: number
    statusMaxWidth?: number
  },
): number {
  const inlineEstado = Boolean(options?.dividerAfter)
  let lastEstBaseline = y

  if (inlineEstado) {
    const who = `${cita.hora}  ${cita.paciente}${cita.obraSocial.trim() ? `  -  ${cita.obraSocial.trim()}` : ''}`
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(type.citaWho)
    doc.setTextColor(26, 39, 68)
    doc.text(who, x, y)
    const whoW = doc.getTextWidth(who)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(type.citaEst)
    doc.setTextColor(107, 124, 147)
    const estGap = 2.2
    const estMaxW = Math.max(
      8,
      (options?.statusMaxWidth ?? innerW) - whoW - estGap,
    )
    const estLines = doc.splitTextToSize(cita.estado, estMaxW) as string[]
    if (estLines[0]) {
      doc.text(`- ${estLines[0]}`, x + whoW + estGap, y)
    }
    lastEstBaseline = y
    if (estLines.length > 1 && estLines[1]) {
      y += type.lineEst
      doc.text(estLines[1], x, y)
      lastEstBaseline = y
    }
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(type.citaWho)
    doc.setTextColor(26, 39, 68)
    const whoLines = doc.splitTextToSize(
      formatCitaPacienteLine(cita),
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
      lastEstBaseline = y
      y += type.lineEst
    }
  }

  if (options?.dividerAfter && options.dividerWidth) {
    y = drawPatientRowDivider(
      doc,
      x,
      lastEstBaseline + 0.9,
      options.dividerWidth,
    )
  } else {
    y += 1.2
  }
  return y
}

function drawMedicoColumnContent(
  doc: jsPDF,
  x: number,
  startY: number,
  colW: number,
  medico: AgendaTurnosPdfMedico,
  singleDoctorMode = false,
): number {
  const contentInset = singleDoctorMode ? SINGLE_DOCTOR_CONTENT_INSET : 0
  const headerY = startY + COL_PAD + 3.6
  let y = headerY
  const innerW = colW - COL_PAD * 2 - contentInset
  const contentX = x + COL_PAD + contentInset
  const type = columnTypography(colW, singleDoctorMode)
  const nameLineH = singleDoctorMode ? 3.7 : 3.2
  const espLineH = singleDoctorMode ? 3.5 : 3.1
  const libresStep = singleDoctorMode ? 4.2 : 3.5

  const turnosW = singleDoctorMode
    ? innerW * SINGLE_DOCTOR_TURNOS_SHARE
    : innerW
  const obsGap = singleDoctorMode ? 3 : 0
  const obsX = singleDoctorMode
    ? contentX + innerW * 0.55
    : contentX + turnosW + obsGap
  const dividerW = innerW

  const { name, esp } = splitDoctorLabel(medico.label)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(type.name)
  doc.setTextColor(26, 74, 138)
  y = drawWrappedText(doc, name.toUpperCase(), contentX, y, turnosW, nameLineH)

  if (singleDoctorMode) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(type.name)
    doc.setTextColor(26, 74, 138)
    doc.text('Observaciones', obsX, headerY)
  }

  if (esp && !singleDoctorMode) {
    doc.setFontSize(type.esp)
    y = drawWrappedText(doc, esp.toUpperCase(), contentX, y, turnosW, espLineH)
  }

  y += 0.8

  if (medico.libresManana) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(type.libres)
    doc.setTextColor(29, 107, 74)
    doc.text(medico.libresManana, contentX, y)
    y += libresStep
  }

  const drawLibresTarde = () => {
    if (!medico.libresTarde) return
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(type.libres)
    doc.setTextColor(29, 107, 74)
    doc.text(medico.libresTarde, contentX, y)
    y += libresStep
  }

  const hasManana = Boolean(medico.libresManana || medico.citasManana.length > 0)
  const hasTarde = Boolean(medico.libresTarde || medico.citasTarde.length > 0)

  const drawCitas = (citas: AgendaTurnosPdfCita[]) => {
    for (const cita of citas) {
      y = drawCitaRow(doc, cita, contentX, y, turnosW, type, {
        dividerAfter: singleDoctorMode,
        dividerWidth: dividerW,
        // En modo un médico hay una columna de observaciones vacía en este
        // listado; aprovechamos ese ancho para mantener el estado en una sola línea.
        statusMaxWidth: singleDoctorMode ? innerW : turnosW,
      })
    }
  }

  if (!hasManana && !hasTarde) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(type.sin)
    doc.setTextColor(107, 124, 147)
    doc.text('Sin turnos', contentX, y)
    y += 5
  } else {
    drawCitas(medico.citasManana)
    if (hasManana && hasTarde) {
      y += 0.6
      y = drawFranjaDivider(doc, x + contentInset, y, colW - contentInset)
    }
    drawLibresTarde()
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

function calculateDoctorContentHeight(
  doc: jsPDF,
  colW: number,
  medico: AgendaTurnosPdfMedico,
): number {
  const innerW = colW - COL_PAD * 2
  const type = columnTypography(colW, false)
  const nameLineH = 3.2
  const espLineH = 3.1
  const libresStep = 3.5

  const { name, esp } = splitDoctorLabel(medico.label)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(type.name)
  const nameLines = (
    doc.splitTextToSize(name.toUpperCase(), innerW) as string[]
  ).length
  let h = COL_PAD + 3.6 + nameLines * nameLineH

  if (esp) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(type.esp)
    const espLines = (
      doc.splitTextToSize(esp.toUpperCase(), innerW) as string[]
    ).length
    h += espLines * espLineH
  }
  h += 0.8

  if (medico.libresManana) {
    h += libresStep
  }

  const hasManana = Boolean(
    medico.libresManana || medico.citasManana.length > 0,
  )
  const hasTarde = Boolean(medico.libresTarde || medico.citasTarde.length > 0)

  if (!hasManana && !hasTarde) {
    h += 5
  } else {
    const calcCitasH = (citas: AgendaTurnosPdfCita[]) => {
      let ch = 0
      for (const cita of citas) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(type.citaWho)
        const whoLines = (
          doc.splitTextToSize(formatCitaPacienteLine(cita), innerW) as string[]
        ).slice(0, 2).length
        ch += whoLines * type.lineWho

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(type.citaEst)
        const estLines = (
          doc.splitTextToSize(cita.estado, innerW) as string[]
        ).slice(0, 2).length
        ch += estLines * type.lineEst
        ch += 1.2
      }
      return ch
    }

    h += calcCitasH(medico.citasManana)
    if (hasManana && hasTarde) {
      h += 0.6 + 4.8
    }
    if (medico.libresTarde) {
      h += libresStep
    }
    h += calcCitasH(medico.citasTarde)
  }

  h += COL_PAD
  return h
}

function drawMedicoColumnsRow(
  doc: jsPDF,
  pageH: number,
  startY: number,
  medicos: AgendaTurnosPdfMedico[],
  colWidth: number,
  singleDoctorMode: boolean,
  leftMargin: number,
): number {
  const rowTop = startY
  const maxAvailableH = pageH - rowTop - FOOTER_SPACE

  const colHeights = medicos.map((medico) => {
    return Math.ceil(calculateDoctorContentHeight(doc, colWidth, medico)) + 1
  })

  const minH = 18
  const maxNeeded = Math.max(minH, ...colHeights)
  const actualH = singleDoctorMode
    ? maxAvailableH
    : Math.min(maxAvailableH, maxNeeded)

  let maxBottom = rowTop

  medicos.forEach((medico, index) => {
    const x = leftMargin + index * (colWidth + COL_GAP)
    doc.setFillColor(250, 252, 255)
    doc.setDrawColor(220, 228, 240)
    doc.setLineWidth(0.2)
    doc.roundedRect(x, rowTop, colWidth, actualH, 4, 4, 'FD')
    const bottom = drawMedicoColumnContent(
      doc,
      x,
      rowTop,
      colWidth,
      medico,
      singleDoctorMode,
    )
    maxBottom = Math.max(maxBottom, bottom, rowTop + actualH)
  })

  return maxBottom + 4
}

function drawDayColumns(
  doc: jsPDF,
  startY: number,
  medicos: AgendaTurnosPdfMedico[],
  dayTitle?: string,
  fixedMedicoColumnSlots?: number,
  singleDoctorMode = false,
): number {
  let y = startY
  let pageH = pageSize(doc).pageH
  const leftMargin = singleDoctorMode ? MARGIN + 10 : MARGIN

  // Dividir los médicos en grupos horizontales de hasta 5 por hoja (el 6to pasa a otra hoja)
  const doctorChunks = chunk(medicos, MEDICOS_PER_PAGE)
  let isFirstOverallPage = true

  for (let ci = 0; ci < doctorChunks.length; ci++) {
    const chunkMedicos = doctorChunks[ci]!
    const offsets = new Array(chunkMedicos.length).fill(0)

    const contentWidth = pageSize(doc).pageW - leftMargin - MARGIN
    const defaultCols = medicos.length >= MAX_COLS ? MAX_COLS : chunkMedicos.length
    const layoutCount = fixedMedicoColumnSlots ?? defaultCols
    const { colWidth } = layoutColumns(layoutCount, contentWidth)

    let isFirstChunkPage = true

    while (true) {
      // Tomar hasta 18 citas por columna por hoja
      const pageMedicos: AgendaTurnosPdfMedico[] = []
      let hasAnyRemaining = false

      for (let i = 0; i < chunkMedicos.length; i++) {
        const medico = chunkMedicos[i]!
        const totalCitas = medico.citasManana.length + medico.citasTarde.length
        const currentOffset = offsets[i]!

        if (isFirstChunkPage) {
          const { segment, next } = medicoSegment(
            medico,
            currentOffset,
            MAX_APPOINTMENTS_PER_COLUMN,
          )
          pageMedicos.push(segment)
          offsets[i] = next
          if (next < totalCitas) {
            hasAnyRemaining = true
          }
        } else {
          if (currentOffset < totalCitas) {
            const { segment, next } = medicoSegment(
              medico,
              currentOffset,
              MAX_APPOINTMENTS_PER_COLUMN,
            )
            pageMedicos.push(segment)
            offsets[i] = next
            if (next < totalCitas) {
              hasAnyRemaining = true
            }
          }
        }
      }

      if (pageMedicos.length === 0) {
        break
      }

      if (!isFirstOverallPage) {
        addTurnosPdfPage(doc)
        pageH = pageSize(doc).pageH
        y = MARGIN + 2
        if (dayTitle) {
          y = drawDaySectionTitle(doc, y, dayTitle)
        }
      }

      y = drawMedicoColumnsRow(
        doc,
        pageH,
        y,
        pageMedicos,
        colWidth,
        singleDoctorMode,
        leftMargin,
      )

      isFirstOverallPage = false
      isFirstChunkPage = false

      if (!hasAnyRemaining) {
        break
      }
    }
  }

  return y
}

function fitPdfCellText(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text
  let fitted = text
  while (fitted.length > 1 && doc.getTextWidth(`${fitted}…`) > maxWidth) {
    fitted = fitted.slice(0, -1)
  }
  return `${fitted}…`
}

function formatSingleDoctorFreeTurnLabel(label: string): string {
  const match = label.match(/^Libre\s+(\d+)\s+T\.\s*(Mañana|Tarde)$/i)
  if (!match) return label
  const count = Number(match[1])
  const turno = match[2]!.toLowerCase() === 'mañana' ? 'Mañana' : 'Tarde'
  return `${count} ${count === 1 ? 'turno libre' : 'turnos libres'} en el Turno ${turno}`
}

function drawSingleDoctorTableHeader(
  doc: jsPDF,
  medico: AgendaTurnosPdfMedico,
  startY: number,
  dayTitle?: string,
): number {
  const { pageW } = pageSize(doc)
  const left = MARGIN + SINGLE_DOCTOR_TABLE_SIDE_INSET
  const right = pageW - MARGIN - SINGLE_DOCTOR_TABLE_SIDE_INSET
  let y = startY

  if (dayTitle) {
    y = drawDaySectionTitle(doc, y, dayTitle)
  }

  const { name, esp } = splitDoctorLabel(medico.label)
  const doctorHeading = `${name.toLocaleUpperCase('es')}${esp ? ` - ${esp}` : ''}`
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(26, 74, 138)
  doc.text(fitPdfCellText(doc, doctorHeading, right - left), left, y + 3)

  return y + 7
}

function drawSingleDoctorColumnHeadings(
  doc: jsPDF,
  startY: number,
  left: number,
  right: number,
  width: number,
): number {
  const timeW = width * 0.1
  const patientW = width * 0.33
  const obraW = width * 0.17
  const observationW = width - timeW - patientW - obraW
  const headers = [
    { label: 'HORA', x: left, w: timeW },
    { label: 'PACIENTE', x: left + timeW - 1, w: patientW },
    { label: 'OBRA SOCIAL', x: left + timeW + patientW, w: obraW },
    { label: 'OBSERVACIONES', x: left + timeW + patientW + obraW, w: observationW },
  ]

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(75, 94, 120)
  for (const header of headers) {
    doc.text(header.label, header.x + 1, startY + 2.5, {
      maxWidth: Math.max(1, header.w - 2),
    })
  }
  const lineY = startY + 4.5
  doc.setDrawColor(26, 74, 138)
  doc.setLineWidth(0.4)
  doc.line(left, lineY, right, lineY)
  doc.setLineWidth(0.15)
  return lineY + 1
}

function drawSingleDoctorTablePage(
  doc: jsPDF,
  medico: AgendaTurnosPdfMedico,
  sections: Array<{
    title: string
    citas: AgendaTurnosPdfCita[]
    libres: string | null
  }>,
  start: { section: number; cita: number },
  startY: number,
  dayTitle?: string,
): { section: number; cita: number } {
  const { pageW, pageH } = pageSize(doc)
  const left = MARGIN + SINGLE_DOCTOR_TABLE_SIDE_INSET
  const right = pageW - MARGIN - SINGLE_DOCTOR_TABLE_SIDE_INSET
  const width = right - left
  const timeW = width * 0.1
  const patientW = width * 0.33
  const obraW = width * 0.17
  const obsX = left + timeW + patientW + obraW
  const obsW = right - obsX
  const y = drawSingleDoctorTableHeader(doc, medico, startY, dayTitle)
  let rowY = y
  let sectionIndex = start.section
  let citaIndex = start.cita
  const bottomLimit = pageH - 17

  while (sectionIndex < sections.length) {
    const section = sections[sectionIndex]!
    if (rowY + 5 + SINGLE_DOCTOR_TABLE_ROW_H > bottomLimit) break
    if (sectionIndex > 0 && citaIndex === 0) {
      const sectionHeight =
        9.5 +
        SINGLE_DOCTOR_SHIFT_HEADING_GAP +
        SINGLE_DOCTOR_SHIFT_GAP +
        Math.max(1, section.citas.length) * SINGLE_DOCTOR_TABLE_ROW_H
      const freshPageCapacity =
        bottomLimit -
        (MARGIN +
          2 +
          7 +
          (dayTitle ? 5.5 : 0) +
          9.5 +
          SINGLE_DOCTOR_SHIFT_HEADING_GAP +
          SINGLE_DOCTOR_SHIFT_GAP)
      if (
        sectionHeight <= freshPageCapacity &&
        sectionHeight > bottomLimit - rowY
      ) {
        break
      }
      rowY += SINGLE_DOCTOR_SHIFT_GAP
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(26, 74, 138)
    doc.text(section.title, left + 1, rowY + 3.5)
    if (section.libres) {
      const libresLabel = formatSingleDoctorFreeTurnLabel(section.libres)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(29, 107, 74)
      doc.text(
        libresLabel,
        left + 1 + doc.getTextWidth(section.title) + 3,
        rowY + 3.5,
      )
    }
    rowY += 4 + SINGLE_DOCTOR_SHIFT_HEADING_GAP
    rowY = drawSingleDoctorColumnHeadings(doc, rowY, left, right, width)

    if (section.citas.length === 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(107, 124, 147)
      doc.text('Sin turnos', left + timeW + 1, rowY + 4.8)
      rowY += SINGLE_DOCTOR_TABLE_ROW_H
    }

    while (
      citaIndex < section.citas.length &&
      rowY + SINGLE_DOCTOR_TABLE_ROW_H <= bottomLimit
    ) {
      const cita = section.citas[citaIndex]!
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(26, 39, 68)
      doc.text(cita.hora, left + 1, rowY + 4.8)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(26, 39, 68)
      doc.text(
        fitPdfCellText(doc, cita.paciente, patientW - 3),
        left + timeW,
        rowY + 4.8,
      )

      doc.setTextColor(75, 94, 120)
      doc.text(
        fitPdfCellText(doc, cita.obraSocial.trim() || '—', obraW - 3),
        left + timeW + patientW + 1,
        rowY + 4.8,
      )

      const estadoParts = cita.estado
        .split(/[·—–-]+/)
        .map((part) => part.trim())
        .filter((part) => part && !/^urgencia$/i.test(part))
      const observations = [
        cita.motivoConsulta,
        ...estadoParts,
        ...(/urgencia/i.test(cita.estado) ? ['Urgencia'] : []),
      ]
        .filter(Boolean)
        .join(' - ')
        .replace(/\s+/g, ' ')
        .trim()
      if (observations) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(107, 124, 147)
        doc.text(
          fitPdfCellText(doc, observations, obsW - 3),
          obsX + 1,
          rowY + 4.8,
        )
      }

      rowY += SINGLE_DOCTOR_TABLE_ROW_H
      doc.setDrawColor(225, 232, 242)
      doc.setLineWidth(0.2)
      doc.line(left, rowY, right, rowY)
      citaIndex += 1
    }

    if (citaIndex < section.citas.length) break
    sectionIndex += 1
    citaIndex = 0
  }

  const citas = sections.flatMap((section) => section.citas)
  const urgencyCount = citas.filter((cita) => /urgencia/i.test(cita.estado)).length
  doc.setDrawColor(225, 232, 242)
  doc.setLineWidth(0.25)
  doc.line(left, pageH - 11, right, pageH - 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(107, 124, 147)
  const urgencyLabel = urgencyCount === 1 ? 'urgencia' : 'urgencias'
  doc.text(`${citas.length} turnos · ${urgencyCount} ${urgencyLabel}`, left, pageH - 6)

  return { section: sectionIndex, cita: citaIndex }
}

function drawSingleDoctorTable(
  doc: jsPDF,
  day: AgendaTurnosPdfDay,
  scope: AgendaPdfScope,
  initialY: number,
): void {
  const medico = day.medicos[0]
  if (!medico) return
  const sortCitas = (citas: AgendaTurnosPdfCita[]) =>
    [...citas].sort((a, b) => a.hora.localeCompare(b.hora))
  const sections = [
    {
      title: 'TURNO MAÑANA',
      citas: sortCitas(medico.citasManana),
      libres: medico.libresManana,
    },
    {
      title: 'TURNO TARDE',
      citas: sortCitas(medico.citasTarde),
      libres: medico.libresTarde,
    },
  ].filter((section) => section.citas.length > 0)
  if (sections.length === 0) {
    sections.push({ title: 'TURNO MAÑANA', citas: [], libres: null })
  }
  let next = { section: 0, cita: 0 }
  let firstPage = true

  do {
    if (!firstPage) addTurnosPdfPage(doc)
    next = drawSingleDoctorTablePage(
      doc,
      medico,
      sections,
      next,
      firstPage ? initialY : MARGIN + 2,
      scope === 'day' ? undefined : day.dayTitle,
    )
    firstPage = false
  } while (next.section < sections.length)
}

export function buildAgendaTurnosPdf(params: {
  scope: AgendaPdfScope
  periodLabel: string
  days: AgendaTurnosPdfDay[]
  fileStamp: string
  singleDoctorLabel?: string
  /** Ancho fijo de pastillas (p. ej. 5) aunque haya menos médicos en la fila. */
  fixedMedicoColumnSlots?: number
}): { doc: jsPDF; filename: string } {
  const {
    scope,
    periodLabel,
    days,
    fileStamp,
    singleDoctorLabel,
    fixedMedicoColumnSlots,
  } = params
  const singleDoctor = Boolean(singleDoctorLabel?.trim())
  const doc = new jsPDF({
    orientation: singleDoctor ? 'portrait' : 'landscape',
    unit: 'mm',
    format: 'a4',
  })
  const pageW = pageSize(doc).pageW

  const periodText = periodLabel.replace(/\s*[–—]\s*/g, PDF_TITLE_DASH).trim()
  const headerSubtitle = `Turnos${PDF_TITLE_DASH}${periodText}`

  const headerBottom = drawPdfHeader(doc, pageW, headerSubtitle, {
    secondLine: singleDoctor ? undefined : singleDoctorLabel?.trim(),
    marginX:
      PDF_HEADER_AGENDA_MARGIN +
      (singleDoctor ? SINGLE_DOCTOR_TABLE_SIDE_INSET : 0),
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
      if (singleDoctor) {
        if (di > 0) {
          addTurnosPdfPage(doc)
          cursorY = MARGIN + 2
        }
        drawSingleDoctorTable(doc, day, scope, cursorY)
        continue
      }
      if (scope !== 'day' && di > 0) {
        addTurnosPdfPage(doc)
        cursorY = MARGIN + 2
      }
      if (scope !== 'day') {
        cursorY = drawDaySectionTitle(doc, cursorY, day.dayTitle)
      }
      cursorY = drawDayColumns(
        doc,
        cursorY,
        day.medicos,
        day.dayTitle,
        fixedMedicoColumnSlots,
        singleDoctor,
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
