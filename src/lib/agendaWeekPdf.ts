import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
} from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import { getCurrentUserDisplayName } from './auth'
import autoTable from 'jspdf-autotable'
import {
  PAGOS_DOCTOR_BLOCK_RADIUS,
  stampPdfGeneratedFooterOnAllPages,
  strokePagosTableRoundFrame,
} from './pagosPdfLayout'
import {
  drawPdfHeader,
  PDF_BODY_EXTRA_DOWN_PLAIN,
  PDF_HEADER_AGENDA_MARGIN,
  PDF_TITLE_DASH,
  pdfBodyStartYAfterHeader,
} from './pdfHeader'
import type { Appointment } from '../types'
import { DEFAULT_AGENDA_RANGES } from './weekSlots'

const AGENDA_TABLE_MARGIN = 8
/** Esquinas superiores e inferiores de la tabla en PDF agenda. */
const AGENDA_TABLE_RADIUS = PAGOS_DOCTOR_BLOCK_RADIUS

export type AgendaWeekPdfRow = {
  dia: string
  hora: string
  paciente: string
  medico: string
  obraSocial: string
  monto: string
  estado: string
  obs: string
}

export function collectAgendaWeekRows(params: {
  appointments: Appointment[]
  weekDays: Date[]
  patientLabel: (patientId: string) => string
  doctorLabel: (doctorId: string) => string
  obraSocialLabel: (patientId: string) => string
  montoLabel: (appointment: Appointment) => string
  estadoLabel: (estado: Appointment['estado']) => string
  obsLabel: (appointment: Appointment) => string
}): AgendaWeekPdfRow[] {
  const {
    appointments,
    weekDays,
    patientLabel,
    doctorLabel,
    obraSocialLabel,
    montoLabel,
    estadoLabel,
    obsLabel,
  } = params
  const rows: AgendaWeekPdfRow[] = []

  for (const day of weekDays) {
    const delDia = appointments
      .filter(
        (c) =>
          c.estado !== 'cancelado' && isSameDay(parseISO(c.fechaHora), day),
      )
      .sort(
        (a, b) =>
          parseISO(a.fechaHora).getTime() - parseISO(b.fechaHora).getTime(),
      )

    for (const c of delDia) {
      rows.push({
        dia: format(day, "EEE d/MM", { locale: es }),
        hora: format(parseISO(c.fechaHora), 'HH:mm', { locale: es }),
        paciente: patientLabel(c.patientId),
        medico: doctorLabel(c.doctorId),
        obraSocial: c.obraSocialOverride || obraSocialLabel(c.patientId),
        monto: montoLabel(c),
        estado: estadoLabel(c.estado),
        obs: obsLabel(c),
      })
    }
  }

  return rows
}

/** Turnos de un solo día (el seleccionado en la vista semanal). */
export function collectAgendaDayRows(
  params: Omit<Parameters<typeof collectAgendaWeekRows>[0], 'weekDays'> & {
    day: Date
  },
): AgendaWeekPdfRow[] {
  const { day, ...rest } = params
  return collectAgendaWeekRows({ ...rest, weekDays: [day] })
}

/** Todos los días de un mes (según fecha de referencia). */
export function collectAgendaMonthRows(
  params: Omit<Parameters<typeof collectAgendaWeekRows>[0], 'weekDays'> & {
    monthRef: Date
  },
): AgendaWeekPdfRow[] {
  const { monthRef, ...rest } = params
  const start = startOfMonth(monthRef)
  const end = endOfMonth(monthRef)
  const days = eachDayOfInterval({ start, end })
  return collectAgendaWeekRows({ ...rest, weekDays: days })
}

export type AgendaPdfScope = 'day' | 'week' | 'month'

const SCOPE_PDF: Record<
  AgendaPdfScope,
  {
    header: string
    empty: string
    period: string
    filename: string
    tableWithDay: boolean
  }
> = {
  day: {
    header: 'Agenda del día',
    empty: 'No hay turnos programados en este día.',
    period: 'el día',
    filename: 'agenda-dia',
    tableWithDay: false,
  },
  week: {
    header: 'Agenda semanal de turnos',
    empty: 'No hay turnos programados en esta semana.',
    period: 'la semana',
    filename: 'agenda-semana',
    tableWithDay: true,
  },
  month: {
    header: 'Agenda mensual de turnos',
    empty: 'No hay turnos programados en este mes.',
    period: 'el mes',
    filename: 'agenda-mes',
    tableWithDay: true,
  },
}

function agendaTableHead(
  withDay: boolean,
  singleDoctor: boolean,
): string[][] {
  if (withDay) {
    const cols = ['Día', 'Hora', 'Paciente']
    if (!singleDoctor) cols.push('Médico')
    cols.push('Obra Social', 'Monto', 'Estado', 'Obs')
    return [cols]
  }
  const cols = ['Hora', 'Paciente']
  if (!singleDoctor) cols.push('Médico')
  cols.push('Obra Social', 'Monto', 'Estado', 'Obs')
  return [cols]
}

function agendaTableBody(
  rows: AgendaWeekPdfRow[],
  withDay: boolean,
  singleDoctor: boolean,
): string[][] {
  return rows.map((r) => {
    if (withDay) {
      const row = [r.dia, r.hora, r.paciente]
      if (!singleDoctor) row.push(r.medico)
      row.push(r.obraSocial, r.monto, r.estado, r.obs)
      return row
    }
    const row = [r.hora, r.paciente]
    if (!singleDoctor) row.push(r.medico)
    row.push(r.obraSocial, r.monto, r.estado, r.obs)
    return row
  })
}

type AgendaColumnStyle = {
  cellWidth: number
  fontStyle?: 'bold'
  textColor?: [number, number, number]
  halign?: 'left' | 'center' | 'right'
  fontSize?: number
}

function agendaColumnStyles(
  withDay: boolean,
  singleDoctor: boolean,
  scope: AgendaPdfScope,
): Record<number, AgendaColumnStyle> {
  const estadoFont = scope === 'month' ? 7 : 7.5
  if (withDay) {
    if (singleDoctor) {
      return {
        0: { cellWidth: 22, fontStyle: 'bold', textColor: [26, 74, 138] },
        1: { cellWidth: 16, halign: 'center' },
        2: { cellWidth: 48 },
        3: { cellWidth: 25 },
        4: { cellWidth: 19, halign: 'right' },
        5: { cellWidth: 18, fontSize: estadoFont },
        6: { cellWidth: 46 },
      }
    }
    return {
      0: { cellWidth: 22, fontStyle: 'bold', textColor: [26, 74, 138] },
      1: { cellWidth: 15, halign: 'center' },
      2: { cellWidth: 24 },
      3: { cellWidth: 35 },
      4: { cellWidth: 19 },
      5: { cellWidth: 21, halign: 'right' },
      6: { cellWidth: 20, fontSize: estadoFont },
      7: { cellWidth: 31 },
    }
  }
  if (singleDoctor) {
    return {
      0: { cellWidth: 17, halign: 'center' },
      1: { cellWidth: 48 },
      2: { cellWidth: 25 },
      3: { cellWidth: 19, halign: 'right' },
      4: { cellWidth: 18, fontSize: estadoFont },
      5: { cellWidth: 46 },
    }
  }
  return {
    0: { cellWidth: 18, halign: 'center' },
    1: { cellWidth: 38 },
    2: { cellWidth: 36 },
    3: { cellWidth: 23 },
    4: { cellWidth: 20, halign: 'right' },
    5: { cellWidth: 20, fontSize: estadoFont },
    6: { cellWidth: 24 },
  }
}

function agendaEstadoColumnIndex(
  withDay: boolean,
  singleDoctor: boolean,
): number {
  if (withDay) return singleDoctor ? 5 : 6
  return singleDoctor ? 4 : 5
}

/** Reparte el ancho total entre columnas (proporcional a los pesos base). */
function scaleAgendaColumnStyles(
  base: Record<number, AgendaColumnStyle>,
  tableWidth: number,
): Record<number, AgendaColumnStyle> {
  const indices = Object.keys(base)
    .map(Number)
    .sort((a, b) => a - b)
  if (indices.length === 0) return base

  const weights = indices.map((i) => base[i]!.cellWidth)
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (weightSum <= 0) return base

  const scaled: Record<number, AgendaColumnStyle> = {}
  let used = 0
  indices.forEach((col, idx) => {
    const isLast = idx === indices.length - 1
    const w = isLast
      ? Math.round((tableWidth - used) * 100) / 100
      : Math.round((weights[idx]! / weightSum) * tableWidth * 100) / 100
    used += w
    scaled[col] = { ...base[col], cellWidth: w }
  })
  return scaled
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map((x) => Number(x))
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN
  return h * 60 + m
}

function splitDayRowsByFranja(rows: AgendaWeekPdfRow[]): {
  manana: AgendaWeekPdfRow[]
  tarde: AgendaWeekPdfRow[]
} {
  const mananaRange = DEFAULT_AGENDA_RANGES[0]!
  const tardeRange = DEFAULT_AGENDA_RANGES[1]!
  const manana: AgendaWeekPdfRow[] = []
  const tarde: AgendaWeekPdfRow[] = []

  for (const row of rows) {
    const m = hmToMinutes(row.hora)
    if (Number.isNaN(m)) {
      tarde.push(row)
      continue
    }
    if (m >= mananaRange[0] && m <= mananaRange[1]) {
      manana.push(row)
    } else if (m >= tardeRange[0] && m <= tardeRange[1]) {
      tarde.push(row)
    } else if (m < tardeRange[0]) {
      manana.push(row)
    } else {
      tarde.push(row)
    }
  }

  return { manana, tarde }
}

function turnosCountLabel(count: number): string {
  return `${count} turno${count === 1 ? '' : 's'}`
}

function drawAgendaSectionTitle(
  doc: jsPDF,
  y: number,
  title: string,
  marginX = AGENDA_TABLE_MARGIN,
): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(26, 74, 138)
  doc.text(title, marginX, y)
  return y + 5.5
}

type DrawAgendaTableParams = {
  doc: jsPDF
  startY: number
  rows: AgendaWeekPdfRow[]
  pageW: number
  withDay: boolean
  singleDoctor: boolean
  scope: AgendaPdfScope
}

function drawAgendaTable(params: DrawAgendaTableParams): number {
  const {
    doc,
    startY,
    rows,
    pageW,
    withDay,
    singleDoctor,
    scope,
  } = params

  const tableHead = agendaTableHead(withDay, singleDoctor)
  const tableBody = agendaTableBody(rows, withDay, singleDoctor)
  const estadoCol = agendaEstadoColumnIndex(withDay, singleDoctor)
  const tableWidth = pageW - 2 * AGENDA_TABLE_MARGIN
  const columnStyles = scaleAgendaColumnStyles(
    agendaColumnStyles(withDay, singleDoctor, scope),
    tableWidth,
  )

  let tableSegmentTopY = startY

  autoTable(doc, {
    startY,
    head: tableHead,
    body: tableBody,
    theme: 'plain',
    tableLineWidth: 0,
    tableWidth,
    styles: {
      fontSize: scope === 'month' ? 7.5 : 7.6,
      cellPadding: scope === 'month' ? 1.45 : 1.55,
      textColor: [61, 74, 92],
      overflow: 'linebreak',
      lineWidth: 0,
    },
    headStyles: {
      fillColor: [122, 163, 176],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles,
    alternateRowStyles: { fillColor: [248, 251, 255] },
    margin: { left: AGENDA_TABLE_MARGIN, right: AGENDA_TABLE_MARGIN },
    willDrawPage: (data) => {
      tableSegmentTopY = data.cursor?.y ?? startY
    },
    didDrawPage: (data) => {
      if (!data.cursor) return
      const margin = data.table.settings.margin
      const left =
        typeof margin === 'number' ? margin : (margin.left ?? AGENDA_TABLE_MARGIN)
      const h = data.cursor.y - tableSegmentTopY
      if (h > 1) {
        strokePagosTableRoundFrame(
          data.doc,
          left,
          tableSegmentTopY,
          tableWidth,
          h,
          AGENDA_TABLE_RADIUS,
        )
      }
    },
    didParseCell: (data) => {
      if (data.column.index === estadoCol) {
        data.cell.styles.fontSize = scope === 'month' ? 7 : 7.5
      }
      if (!withDay) return
      if (data.section === 'body' && data.column.index === 0) {
        const prev = rows[data.row.index - 1]
        const cur = rows[data.row.index]
        if (prev && prev.dia === cur.dia) {
          data.cell.text = ['']
        }
      }
    },
  })

  return (
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
    startY
  )
}

export function buildAgendaWeekPdf(params: {
  weekLabel: string
  rows: AgendaWeekPdfRow[]
  fileStamp: string
  scope?: AgendaPdfScope
  /** Si hay un médico filtrado: línea bajo el encabezado y sin columna Médico. */
  singleDoctorLabel?: string
  /** @deprecated Usar scope: 'day' */
  singleDay?: boolean
}): { doc: jsPDF; filename: string } {
  const { weekLabel, rows, fileStamp } = params
  const scope: AgendaPdfScope =
    params.scope ?? (params.singleDay ? 'day' : 'week')
  const cfg = SCOPE_PDF[scope]
  const inferredDoctorLabels = [
    ...new Set(
      rows
        .map((row) => row.medico.trim())
        .filter((label) => label.length > 0),
    ),
  ]
  const singleDoctorText =
    params.singleDoctorLabel?.trim() ??
    (inferredDoctorLabels.length === 1 ? inferredDoctorLabels[0] : undefined)
  const singleDoctor = Boolean(singleDoctorText)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const generatedAt = format(new Date(), 'dd-MM-yyyy HH:mm', { locale: es })
  const periodText = weekLabel.replace(/\s*[–—]\s*/g, PDF_TITLE_DASH).trim()
  const headerSubtitle = periodText
    ? `${cfg.header}${PDF_TITLE_DASH}${periodText}`
    : cfg.header

  const headerBottom = drawPdfHeader(doc, pageW, headerSubtitle, {
    secondLine: singleDoctor ? singleDoctorText : undefined,
    marginX: PDF_HEADER_AGENDA_MARGIN,
  })
  const tableStartY = pdfBodyStartYAfterHeader(
    headerBottom,
    PDF_BODY_EXTRA_DOWN_PLAIN,
  )

  if (rows.length === 0) {
    doc.setTextColor(107, 124, 147)
    doc.setFontSize(10)
    doc.text(cfg.empty, 14, tableStartY)
  } else if (scope === 'day') {
    const { manana, tarde } = splitDayRowsByFranja(rows)
    let cursorY = tableStartY

    if (manana.length > 0) {
      cursorY = drawAgendaSectionTitle(
        doc,
        cursorY,
        `TURNO MAÑANA — ${turnosCountLabel(manana.length)}`,
      )
      cursorY =
        drawAgendaTable({
          doc,
          startY: cursorY,
          rows: manana,
          pageW,
          withDay: cfg.tableWithDay,
          singleDoctor,
          scope,
        }) + 8
    }

    if (tarde.length > 0) {
      if (manana.length > 0) {
        // Si la mañana ocupa casi toda la hoja o ya generó una página adicional,
        // iniciar la tarde en una hoja nueva para que no quede apretada debajo.
        const afternoonNeedsNewPage =
          doc.getNumberOfPages() > 1 ||
          cursorY > doc.internal.pageSize.getHeight() - 55
        if (afternoonNeedsNewPage) {
          doc.addPage('a4', 'p')
          const newHeaderBottom = drawPdfHeader(doc, pageW, headerSubtitle, {
            secondLine: singleDoctor ? singleDoctorText : undefined,
            marginX: PDF_HEADER_AGENDA_MARGIN,
          })
          cursorY = pdfBodyStartYAfterHeader(
            newHeaderBottom,
            PDF_BODY_EXTRA_DOWN_PLAIN,
          )
        }
      }

      cursorY = drawAgendaSectionTitle(
        doc,
        cursorY,
        `TURNO TARDE — ${turnosCountLabel(tarde.length)}`,
      )
      drawAgendaTable({
        doc,
        startY: cursorY,
        rows: tarde,
        pageW,
        withDay: cfg.tableWithDay,
        singleDoctor,
        scope,
      })
    }
  } else {
    const finalY = drawAgendaTable({
      doc,
      startY: tableStartY,
      rows,
      pageW,
      withDay: cfg.tableWithDay,
      singleDoctor,
      scope,
    })

    doc.setFontSize(8)
    doc.setTextColor(107, 124, 147)
    doc.text(
      `${rows.length} turno${rows.length === 1 ? '' : 's'} en ${cfg.period}`,
      14,
      finalY + 8,
    )
  }

  stampPdfGeneratedFooterOnAllPages(doc, {
    bold: true,
  })

  const filename = `${cfg.filename}-${fileStamp}.pdf`
  return { doc, filename }
}
