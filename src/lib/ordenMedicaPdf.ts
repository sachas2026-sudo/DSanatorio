import jsPDF from 'jspdf'
import type { OrdenMedica, Patient } from '../types'
import { getPdfLogo } from './pdfLogo'

export interface ConsumoOrdenMedica {
  consultasUsadas: number
  consultasCupo: number
  prestacionesUsadas: number
  prestacionesCupo: number
}

export interface BuildOrdenMedicaPdfParams {
  orden: OrdenMedica
  patient: Patient
  centroNombre?: string
  consumo?: ConsumoOrdenMedica
}

function formatFechaAr(fechaIsoOrYmd: string): string {
  if (!fechaIsoOrYmd) return '—'
  const clean = fechaIsoOrYmd.split('T')[0]
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean)
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`
  }
  return clean
}

export function buildOrdenMedicaPdf({
  orden,
  patient,
  centroNombre = 'SANATORIO',
  consumo,
}: BuildOrdenMedicaPdfParams): { doc: jsPDF; filename: string } {
  // A4 vertical: 210 x 297 mm
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210
  const margin = 10
  const contentW = pageW - margin * 2 // 190 mm
  const copyH = 135 // Alto de cada recuadro (entra perfectamente en 297 mm)

  const logoCache = getPdfLogo()

  function drawCopy(startY: number, copiaTitulo: 'COPIA OFICINA' | 'COPIA PACIENTE') {
    // ── 0. Recuadro exterior de la copia (#1F2A44, fino) ──
    doc.setDrawColor(31, 42, 68) // #1F2A44
    doc.setLineWidth(0.35)
    doc.roundedRect(margin, startY, contentW, copyH, 1.5, 1.5, 'S')

    // ── 1. Encabezado en tres celdas (alto 21 mm) ──
    const headH = 21
    const col1W = 72
    const col2W = 60
    const col3W = contentW - col1W - col2W // 58 mm

    const c1X = margin
    const c2X = c1X + col1W
    const c3X = c2X + col2W

    // Líneas verticales separadoras del encabezado
    doc.setDrawColor(31, 42, 68)
    doc.setLineWidth(0.25)
    doc.line(c2X, startY, c2X, startY + headH)
    doc.line(c3X, startY, c3X, startY + headH)
    // Línea que cierra el encabezado
    doc.line(margin, startY + headH, margin + contentW, startY + headH)

    // Celda 1: Logo + Nombre Sanatorio (sin texto 'Plan de Salud')
    let textLeftX = c1X + 4
    if (logoCache?.dataUrl) {
      const imgH = 13
      const imgW = imgH * (logoCache.aspect || 1.3)
      try {
        doc.addImage(logoCache.dataUrl, logoCache.format, c1X + 3, startY + 4, imgW, imgH)
        textLeftX = c1X + 3 + imgW + 3
      } catch {
        // Fallback
      }
    }
    doc.setTextColor(31, 42, 68) // #1F2A44
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(centroNombre, textLeftX, startY + 11.5)

    // Celda 2: ORDEN MÉDICA + Etiqueta COPIA OFICINA / COPIA PACIENTE (sin pastilla)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(31, 42, 68)
    doc.text('ORDEN MÉDICA', c2X + col2W / 2, startY + 8.5, { align: 'center' })

    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    if (copiaTitulo === 'COPIA OFICINA') {
      doc.setTextColor(30, 64, 175) // #1E40AF
      doc.text('COPIA OFICINA', c2X + col2W / 2, startY + 15, { align: 'center' })
    } else {
      doc.setTextColor(13, 148, 136) // #0D9488
      doc.text('COPIA PACIENTE', c2X + col2W / 2, startY + 15, { align: 'center' })
    }

    // Celda 3: Nº de Orden + Emisión
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(28, 127, 150) // #1C7F96
    doc.text(orden.numero, c3X + col3W / 2, startY + 9, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(71, 85, 105)
    doc.text(`Emisión: ${formatFechaAr(orden.fecha)}`, c3X + col3W / 2, startY + 14.5, {
      align: 'center',
    })

    // ── 2 y 3. Bloque AFILIADO + TIPO DE ORDEN (alto 24 mm, sin línea horizontal entre filas) ──
    const blockStartY = startY + headH
    const blockH = 24

    // Grilla 3 columnas: 60% / 17% / resto (23%)
    const gCol1W = contentW * 0.6 // 114 mm
    const gCol2W = contentW * 0.17 // 32.3 mm
    const gCol3W = contentW - gCol1W - gCol2W // 43.7 mm

    const g1X = margin
    const g2X = g1X + gCol1W
    const g3X = g2X + gCol2W

    // Líneas verticales de la grilla que van de startY + headH a startY + headH + blockH
    doc.setDrawColor(203, 213, 225) // slate-300
    doc.setLineWidth(0.2)
    doc.line(g2X, blockStartY, g2X, blockStartY + blockH)
    doc.line(g3X, blockStartY, g3X, blockStartY + blockH)

    // Línea que cierra este bloque inferior
    doc.line(margin, blockStartY + blockH, margin + contentW, blockStartY + blockH)

    // ── FILA 2 (y: blockStartY + 2 a blockStartY + 12) ──
    // Col 1: CONTRATANTE / PACIENTE
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(62, 76, 89) // #3E4C59
    doc.text('CONTRATANTE / PACIENTE', g1X + 4, blockStartY + 4.5)

    const pacienteNombre = `${patient.apellido}, ${patient.nombre}`.toUpperCase()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(31, 42, 68) // #1F2A44
    // Si el nombre es muy largo, recortar o ajustar tamaño
    const maxNomW = gCol1W - 8
    if (doc.getTextWidth(pacienteNombre) > maxNomW) {
      doc.setFontSize(8)
    }
    doc.text(pacienteNombre, g1X + 4, blockStartY + 9.5, { maxWidth: maxNomW })

    // Col 2: DNI
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(62, 76, 89)
    doc.text('DNI', g2X + 3, blockStartY + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(31, 42, 68)
    doc.text(patient.dni || '—', g2X + 3, blockStartY + 9.5)

    // Col 3: COBERTURA (en lugar de PLAN)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(62, 76, 89)
    doc.text('COBERTURA', g3X + 3, blockStartY + 4.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(28, 127, 150) // teal
    const rawPlan = (orden.planNombre || 'Afiliado').trim()
    const cleanPlan = rawPlan.replace(/^plan\s+/i, '').trim() || rawPlan
    doc.text(cleanPlan.toUpperCase(), g3X + 3, blockStartY + 9.5, { maxWidth: gCol3W - 6 })

    // ── FILA 3 (y: blockStartY + 12 a blockStartY + 24) ──
    // SIN línea horizontal entre fila 2 y fila 3
    const fila3Y = blockStartY + 12

    // Col 1: TIPO DE ORDEN con casillas y contadores
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(62, 76, 89)
    doc.text('TIPO DE ORDEN', g1X + 4, fila3Y + 3.5)

    // Casilla Consulta
    const isConsulta = orden.tipo === 'consulta'
    const boxSize = 3.2
    const box1X = g1X + 4
    const box1Y = fila3Y + 5.5

    doc.setDrawColor(123, 135, 148) // #7B8794
    doc.setLineWidth(0.3)
    doc.rect(box1X, box1Y, boxSize, boxSize)
    if (isConsulta) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(31, 42, 68)
      doc.text('X', box1X + 0.8, box1Y + 2.6)
    }

    doc.setFont('helvetica', isConsulta ? 'bold' : 'normal')
    doc.setFontSize(8)
    doc.setTextColor(31, 42, 68)
    doc.text('Consulta', box1X + boxSize + 2, box1Y + 2.6)

    // Contador Consulta N-M
    let nextOptionX = box1X + boxSize + 20
    if (consumo) {
      const pill1W = 12
      const pill1H = 4.2
      const pill1X = box1X + boxSize + 16
      const pill1Y = box1Y - 0.6
      if (isConsulta) {
        doc.setFillColor(225, 242, 246) // #E1F2F6
        doc.setDrawColor(180, 220, 230)
        doc.roundedRect(pill1X, pill1Y, pill1W, pill1H, 1, 1, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.setTextColor(28, 127, 150) // #1C7F96
      } else {
        doc.setFillColor(238, 241, 245) // #EEF1F5
        doc.setDrawColor(215, 220, 226)
        doc.roundedRect(pill1X, pill1Y, pill1W, pill1H, 1, 1, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.setTextColor(107, 119, 133) // #6B7785
      }
      const cStr = `${consumo.consultasUsadas}-${consumo.consultasCupo}`
      doc.text(cStr, pill1X + pill1W / 2, pill1Y + 3.1, { align: 'center' })
      nextOptionX = pill1X + pill1W + 6
    }

    // Casilla Prestación
    const isPrestacion = orden.tipo === 'prestacion'
    const box2X = nextOptionX
    const box2Y = box1Y

    doc.setDrawColor(123, 135, 148)
    doc.setLineWidth(0.3)
    doc.rect(box2X, box2Y, boxSize, boxSize)
    if (isPrestacion) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(31, 42, 68)
      doc.text('X', box2X + 0.8, box2Y + 2.6)
    }

    doc.setFont('helvetica', isPrestacion ? 'bold' : 'normal')
    doc.setFontSize(8)
    doc.setTextColor(31, 42, 68)
    doc.text('Prestación', box2X + boxSize + 2, box2Y + 2.6)

    // Contador Prestación N-M
    if (consumo) {
      const pill2W = 12
      const pill2H = 4.2
      const pill2X = box2X + boxSize + 18
      const pill2Y = box2Y - 0.6
      if (isPrestacion) {
        doc.setFillColor(225, 242, 246)
        doc.setDrawColor(180, 220, 230)
        doc.roundedRect(pill2X, pill2Y, pill2W, pill2H, 1, 1, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.setTextColor(28, 127, 150)
      } else {
        doc.setFillColor(238, 241, 245)
        doc.setDrawColor(215, 220, 226)
        doc.roundedRect(pill2X, pill2Y, pill2W, pill2H, 1, 1, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.setTextColor(107, 119, 133)
      }
      const pStr = `${consumo.prestacionesUsadas}-${consumo.prestacionesCupo}`
      doc.text(pStr, pill2X + pill2W / 2, pill2Y + 3.1, { align: 'center' })
    }

    // Col 2: FECHA DE EMISIÓN (Alineada con la columna DNI)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(62, 76, 89)
    doc.text('FECHA DE EMISIÓN', g2X + 3, fila3Y + 3.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(31, 42, 68)
    doc.text(formatFechaAr(orden.fecha), g2X + 3, fila3Y + 9)

    // Col 3: Estado de Cobertura
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(62, 76, 89)
    doc.text('ESTADO', g3X + 3, fila3Y + 3.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)
    doc.text('Vigente · Activo', g3X + 3, fila3Y + 9)

    // ── 4. Bloque PRESTACIÓN (alto 21 mm) ──
    const prestacionStartY = blockStartY + blockH
    const prestacionH = 21

    doc.line(margin, prestacionStartY + prestacionH, margin + contentW, prestacionStartY + prestacionH)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(62, 76, 89)
    doc.text('PRESTACIÓN', margin + 4, prestacionStartY + 4.5)

    const tituloPrestacion =
      orden.tipo === 'consulta'
        ? 'CONSULTA MÉDICA EN CONSULTORIO'
        : (orden.prestacionNombre || 'PRESTACIÓN MÉDICA').toUpperCase()

    // Ajuste dinámico de tamaño para nombres largos
    let fSizePrestacion = 11
    if (tituloPrestacion.length > 55) {
      fSizePrestacion = 8.5
    } else if (tituloPrestacion.length > 38) {
      fSizePrestacion = 9.5
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(fSizePrestacion)
    doc.setTextColor(28, 127, 150) // #1C7F96
    doc.text(tituloPrestacion, margin + 4, prestacionStartY + 10.5, {
      maxWidth: contentW - 8,
    })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(62, 76, 89)
    const textoMedico = orden.medicoNombre
      ? `Pedido del médico: ${orden.medicoNombre}`
      : 'Pedido del médico: No especificado'
    doc.text(textoMedico, margin + 4, prestacionStartY + 16.5, {
      maxWidth: contentW - 8,
    })

    // ── 5. Bloque OBSERVACIONES / DIAGNÓSTICO PRESUNTIVO (alto 17 mm) ──
    const obsStartY = prestacionStartY + prestacionH
    const obsH = 17

    doc.line(margin, obsStartY + obsH, margin + contentW, obsStartY + obsH)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(62, 76, 89)
    doc.text('OBSERVACIONES / DIAGNÓSTICO PRESUNTIVO', margin + 4, obsStartY + 4.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(31, 42, 68)
    const textoObs = orden.observaciones?.trim() || 'Sin observaciones registradas.'
    const lineasObs = doc.splitTextToSize(textoObs, contentW - 8)
    doc.text(lineasObs.slice(0, 2), margin + 4, obsStartY + 9.5)

    // ── 6. Zona de firmas ALTA (alto 52 mm, hasta el final de la copia) ──
    const firmasStartY = obsStartY + obsH
    const firmasH = copyH - (firmasStartY - startY) // ~52 mm

    // Línea vertical que divide las firmas a la mitad
    const firmaMidX = margin + contentW / 2
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.2)
    doc.line(firmaMidX, firmasStartY, firmaMidX, startY + copyH)

    // Líneas de firma en gris claro (#CBD5E1)
    const lineaFirmaY = firmasStartY + 34
    const firmaW = 60

    // Mitad izquierda
    const f1X = margin + (contentW / 2 - firmaW) / 2
    doc.setDrawColor(203, 213, 225) // gris-lila claro
    doc.setLineWidth(0.3)
    doc.line(f1X, lineaFirmaY, f1X + firmaW, lineaFirmaY)

    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(62, 76, 89)
    if (copiaTitulo === 'COPIA OFICINA') {
      doc.text('Firma del Contratante', f1X + firmaW / 2, lineaFirmaY + 4.5, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      doc.text('Conformidad de atención', f1X + firmaW / 2, lineaFirmaY + 8.5, { align: 'center' })
    } else {
      doc.text('Sello del centro', f1X + firmaW / 2, lineaFirmaY + 4.5, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      doc.text('Recepción y control', f1X + firmaW / 2, lineaFirmaY + 8.5, { align: 'center' })
    }

    // Mitad derecha
    const f2X = firmaMidX + (contentW / 2 - firmaW) / 2
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.3)
    doc.line(f2X, lineaFirmaY, f2X + firmaW, lineaFirmaY)

    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(62, 76, 89)
    doc.text('Firma y Sello del Profesional', f2X + firmaW / 2, lineaFirmaY + 4.5, {
      align: 'center',
    })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text('Aclaración / Matrícula', f2X + firmaW / 2, lineaFirmaY + 8.5, { align: 'center' })
  }

  // ── DIBUJAR COPIA 1: ARRIBA (COPIA OFICINA) ──
  drawCopy(10, 'COPIA OFICINA')

  // ── LÍNEA DE CORTE EN EL MEDIO (SIN NINGÚN TEXTO NI TIJERAS) ──
  const midY = 148.5
  doc.setDrawColor(179, 186, 196) // #B3BAC4
  doc.setLineWidth(0.4) // 1.5 px
  doc.setLineDashPattern([2, 2], 0)
  doc.line(margin, midY, pageW - margin, midY)
  doc.setLineDashPattern([], 0) // reset trazo punteado

  // ── DIBUJAR COPIA 2: ABAJO (COPIA PACIENTE) ──
  drawCopy(152, 'COPIA PACIENTE')

  const filename = `orden-medica-${orden.numero}-${patient.apellido || 'paciente'}.pdf`
    .toLowerCase()
    .replace(/\s+/g, '-')

  return { doc, filename }
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Genera el documento HTML imprimible en formato A4 para impresión directa
 * a la impresora predeterminada del sistema, sin abrir ventana ni visor PDF.
 */
export function buildOrdenMedicaHtml({
  orden,
  patient,
  centroNombre = 'SANATORIO',
  consumo,
}: BuildOrdenMedicaPdfParams): string {
  const logoCache = getPdfLogo()

  function renderCopyHtml(copiaTitulo: 'COPIA OFICINA' | 'COPIA PACIENTE') {
    const isCopiaOficina = copiaTitulo === 'COPIA OFICINA'
    const isConsulta = orden.tipo === 'consulta'
    const isPrestacion = orden.tipo === 'prestacion'
    const pacienteNombre = `${patient.apellido}, ${patient.nombre}`.toUpperCase()
    const dni = patient.dni || '—'
    const rawPlan = (orden.planNombre || 'Afiliado').trim()
    const cleanPlan = (rawPlan.replace(/^plan\s+/i, '').trim() || rawPlan).toUpperCase()
    const fechaStr = formatFechaAr(orden.fecha)

    const tituloPrestacion = isConsulta
      ? 'CONSULTA MÉDICA EN CONSULTORIO'
      : (orden.prestacionNombre || 'PRESTACIÓN MÉDICA').toUpperCase()

    const medicoStr = orden.medicoNombre
      ? `Pedido del médico: ${orden.medicoNombre}`
      : 'Pedido del médico: No especificado'

    const obsStr = orden.observaciones?.trim() || 'Sin observaciones registradas.'

    const logoData = logoCache?.dataUrl
    const logoTag = logoData
      ? `<img src="${logoData}" style="height: 13mm; max-width: 22mm; object-fit: contain;" alt="Logo" />`
      : ''

    return `
      <div class="copy-box">
        <!-- Encabezado -->
        <div class="head">
          <div class="head-col1">
            ${logoTag}
            <div>
              <div style="font-size: 11pt; font-weight: 700; color: #1F2A44; line-height: 1.1;">${escapeHtml(centroNombre)}</div>
            </div>
          </div>
          <div class="head-col2">
            <div style="font-size: 12pt; font-weight: 700; color: #1F2A44; letter-spacing: 0.5px;">ORDEN MÉDICA</div>
            <div style="font-size: 8pt; font-weight: 700; color: ${isCopiaOficina ? '#1E40AF' : '#0D9488'}; margin-top: 2px;">${copiaTitulo}</div>
          </div>
          <div class="head-col3">
            <div style="font-size: 11pt; font-weight: 700; color: #1C7F96;">${escapeHtml(orden.numero)}</div>
            <div style="font-size: 7.5pt; color: #475569; margin-top: 2px;">Emisión: ${fechaStr}</div>
          </div>
        </div>

        <!-- Grilla 3 columnas -->
        <div class="grid-block">
          <div class="grid-col1">
            <div>
              <div class="lbl">CONTRATANTE / PACIENTE</div>
              <div class="val" style="margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(pacienteNombre)}</div>
            </div>
            <div>
              <div class="lbl">TIPO DE ORDEN</div>
              <div style="display: flex; align-items: center; gap: 14px; margin-top: 2px; font-size: 8pt;">
                <span style="display: inline-flex; align-items: center; gap: 4px; font-weight: ${isConsulta ? '700' : '400'};">
                  <span style="display: inline-block; width: 12px; height: 12px; border: 1px solid #7B8794; text-align: center; line-height: 12px; font-size: 8pt; font-weight: 700;">${isConsulta ? 'X' : ''}</span>
                  Consulta
                  ${consumo ? `<span class="pill ${isConsulta ? 'pill-active' : 'pill-inactive'}">${consumo.consultasUsadas}-${consumo.consultasCupo}</span>` : ''}
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px; font-weight: ${isPrestacion ? '700' : '400'};">
                  <span style="display: inline-block; width: 12px; height: 12px; border: 1px solid #7B8794; text-align: center; line-height: 12px; font-size: 8pt; font-weight: 700;">${isPrestacion ? 'X' : ''}</span>
                  Prestación
                  ${consumo ? `<span class="pill ${isPrestacion ? 'pill-active' : 'pill-inactive'}">${consumo.prestacionesUsadas}-${consumo.prestacionesCupo}</span>` : ''}
                </span>
              </div>
            </div>
          </div>

          <div class="grid-col2">
            <div>
              <div class="lbl">DNI</div>
              <div class="val" style="margin-top: 1px;">${escapeHtml(dni)}</div>
            </div>
            <div>
              <div class="lbl">FECHA DE EMISIÓN</div>
              <div class="val" style="margin-top: 1px; font-size: 8.5pt;">${fechaStr}</div>
            </div>
          </div>

          <div class="grid-col3">
            <div>
              <div class="lbl">COBERTURA</div>
              <div class="val" style="margin-top: 1px; color: #1C7F96; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(cleanPlan)}</div>
            </div>
            <div>
              <div class="lbl">ESTADO</div>
              <div style="font-size: 8pt; color: #475569; margin-top: 1px;">Vigente · Activo</div>
            </div>
          </div>
        </div>

        <!-- Prestación -->
        <div class="prestacion-block">
          <div>
            <div class="lbl">PRESTACIÓN</div>
            <div style="font-size: ${tituloPrestacion.length > 55 ? '8.5pt' : tituloPrestacion.length > 38 ? '9.5pt' : '11pt'}; font-weight: 700; color: #1C7F96; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(tituloPrestacion)}</div>
          </div>
          <div style="font-size: 8pt; color: #3E4C59;">${escapeHtml(medicoStr)}</div>
        </div>

        <!-- Observaciones -->
        <div class="obs-block">
          <div class="lbl">OBSERVACIONES / DIAGNÓSTICO PRESUNTIVO</div>
          <div style="font-size: 7.5pt; color: #1F2A44; line-height: 1.3; margin-top: 1px; max-height: 8mm; overflow: hidden;">${escapeHtml(obsStr)}</div>
        </div>

        <!-- Firmas -->
        <div class="firmas-block">
          <div class="firma-col">
            <div style="width: 60mm; border-top: 1px solid #CBD5E1; text-align: center; padding-top: 4px;">
              <div style="font-size: 8pt; font-weight: 700; color: #3E4C59;">${isCopiaOficina ? 'Firma del Contratante' : 'Sello del centro'}</div>
              <div style="font-size: 7pt; color: #64748B;">${isCopiaOficina ? 'Conformidad de atención' : 'Recepción y control'}</div>
            </div>
          </div>
          <div class="firma-col">
            <div style="width: 60mm; border-top: 1px solid #CBD5E1; text-align: center; padding-top: 4px;">
              <div style="font-size: 8pt; font-weight: 700; color: #3E4C59;">Firma y Sello del Profesional</div>
              <div style="font-size: 7pt; color: #64748B;">Aclaración / Matrícula</div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Orden Médica ${orden.numero}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      width: 190mm;
      margin: 0 auto;
    }
    .sheet {
      width: 190mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 278mm;
    }
    .copy-box {
      border: 1.2px solid #1F2A44;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 134mm;
      background: #ffffff;
    }
    .head {
      display: flex;
      height: 21mm;
      border-bottom: 1.2px solid #1F2A44;
    }
    .head-col1 {
      width: 72mm;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
    }
    .head-col2 {
      width: 60mm;
      border-left: 1px solid #1F2A44;
      border-right: 1px solid #1F2A44;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .head-col3 {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .grid-block {
      display: flex;
      height: 24mm;
      border-bottom: 1px solid #1F2A44;
    }
    .grid-col1 {
      width: 60%;
      padding: 4px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-right: 1px solid #CBD5E1;
    }
    .grid-col2 {
      width: 17%;
      padding: 4px 8px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-right: 1px solid #CBD5E1;
    }
    .grid-col3 {
      width: 23%;
      padding: 4px 8px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
    }
    .prestacion-block {
      height: 21mm;
      padding: 4px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-bottom: 1px solid #1F2A44;
    }
    .obs-block {
      height: 17mm;
      padding: 4px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-bottom: 1px solid #1F2A44;
    }
    .firmas-block {
      flex: 1;
      display: flex;
    }
    .firma-col {
      width: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      padding-bottom: 10px;
    }
    .firma-col:first-child {
      border-right: 1px solid #CBD5E1;
    }
    .cut-line {
      border-top: 1.5px dashed #B3BAC4;
      width: 190mm;
      margin: 4mm 0;
    }
    .lbl {
      font-size: 7.5pt;
      font-weight: 700;
      color: #3E4C59;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .val {
      font-size: 9.5pt;
      font-weight: 700;
      color: #1F2A44;
    }
    .pill {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 7pt;
      font-weight: 700;
    }
    .pill-active {
      background: #E1F2F6;
      border: 1px solid #B4DCE6;
      color: #1C7F96;
    }
    .pill-inactive {
      background: #EEF1F5;
      border: 1px solid #D7DCE2;
      color: #6B7785;
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${renderCopyHtml('COPIA OFICINA')}
    <div class="cut-line"></div>
    ${renderCopyHtml('COPIA PACIENTE')}
  </div>
</body>
</html>`
}
