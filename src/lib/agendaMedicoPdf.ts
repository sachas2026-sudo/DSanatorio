import { format, isSameDay, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import { turnosLibresMedicoDia } from './weekSlots'
import type { AppData, Doctor } from '../types'

type DayBlock = {
  day: Date
  hours: string[]
  part: number
  totalParts: number
}

export function buildAgendaMedicoLibresPdf(params: {
  data: AppData
  doctor: Doctor
  weekDays: Date[]
  weekLabel: string
}): { doc: jsPDF; filename: string; title: string } {
  const { data, doctor, weekDays, weekLabel } = params
  const title = 'Agenda Médico — Horarios libres'
  const doctorLabel = `${doctor.apellido}, ${doctor.nombre}`
  const fileStamp = format(new Date(), 'yyyyMMdd-HHmm')
  const filename = `AgendaMedico-Libres-${doctor.apellido}-${doctor.nombre}-${fileStamp}.pdf`
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 36
  const marginY = 34
  const top = marginY + 34
  const bottom = pageH - 30
  const gap = 8
  const rowGap = 12
  const colsPerRow = weekDays.length > 4 ? 3 : Math.max(1, weekDays.length)
  const usableW = pageW - marginX * 2 - gap * (colsPerRow - 1)
  const colW = usableW / colsPerRow
  const rowCount = Math.ceil(Math.min(6, weekDays.length) / colsPerRow)
  const colH = (bottom - top - rowGap * (rowCount - 1)) / rowCount
  const rowH = 18
  const startOffset = 60
  const maxRows = Math.max(1, Math.floor((colH - startOffset - 14) / rowH))

  const blocks: DayBlock[] = []
  for (const day of weekDays.slice(0, 6)) {
    const libres = turnosLibresMedicoDia(doctor.id, day, data)
    const ocupadas = new Set(
      data.appointments
        .filter(
          (c) =>
            c.doctorId === doctor.id &&
            c.estado !== 'cancelado' &&
            isSameDay(parseISO(c.fechaHora), day),
        )
        .map((c) => format(parseISO(c.fechaHora), 'HH:mm', { locale: es })),
    )
    const hours = libres
      ? [...libres.manana.horas, ...libres.tarde.horas].filter(
          (hm) => !ocupadas.has(hm),
        )
      : []
    const parts = hours.length > 0 ? Math.ceil(hours.length / maxRows) : 1
    for (let part = 0; part < parts; part++) {
      blocks.push({
        day,
        hours: hours.slice(part * maxRows, (part + 1) * maxRows),
        part: part + 1,
        totalParts: parts,
      })
    }
  }

  const drawPageHeader = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(15, 23, 42)
    doc.text(title, marginX, marginY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(doctorLabel, marginX, marginY + 16)
    doc.setFont('helvetica', 'bold')
    doc.text(`SEMANA ${weekLabel}`, pageW - marginX, marginY + 16, {
      align: 'right',
    })
  }

  const drawBlock = (block: DayBlock, index: number) => {
    const row = Math.floor(index / colsPerRow)
    const col = index % colsPerRow
    const x = marginX + col * (colW + gap)
    const y = top + row * (colH + rowGap)
    const libres = turnosLibresMedicoDia(doctor.id, block.day, data)

    doc.setDrawColor(205, 216, 227)
    doc.setLineWidth(0.75)
    doc.roundedRect(x, y, colW, colH, 10, 10)
    doc.setFillColor(250, 252, 254)
    doc.roundedRect(x, y, colW, 44, 10, 10, 'F')
    doc.setDrawColor(238, 242, 247)
    doc.line(x, y + 44, x + colW, y + 44)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(26, 74, 138)
    doc.text(String(format(block.day, 'd')), x + 18, y + 28)
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(10)
    doc.text(format(block.day, 'EEE', { locale: es }).toUpperCase(), x + 44, y + 20)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(100, 116, 139)
    const month = format(block.day, 'MMM yyyy', { locale: es }).toUpperCase()
    doc.text(
      block.totalParts > 1
        ? `${month} · CONT. ${block.part}/${block.totalParts}`
        : month,
      x + 44,
      y + 34,
    )

    const cy0 = y + startOffset
    if (!libres) {
      doc.text('Sin atención', x + colW / 2, cy0, { align: 'center' })
      return
    }
    if (block.hours.length === 0) {
      doc.text('Sin horarios libres', x + colW / 2, cy0, { align: 'center' })
      return
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(15, 23, 42)
    block.hours.forEach((hm, i) => {
      doc.text(hm, x + colW / 2, cy0 + i * rowH, { align: 'center' })
    })
  }

  if (blocks.length === 0) {
    drawPageHeader()
  } else {
    const blocksPerPage = colsPerRow * rowCount
    for (let offset = 0; offset < blocks.length; offset += blocksPerPage) {
      if (offset > 0) doc.addPage()
      drawPageHeader()
      blocks.slice(offset, offset + blocksPerPage).forEach(drawBlock)
    }
  }

  return { doc, filename, title: `${title} — ${doctorLabel}` }
}
