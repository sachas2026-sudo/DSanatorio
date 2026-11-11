import { format, parseISO } from 'date-fns'
import jsPDF from 'jspdf'

/** Una fila de la distribución por médico · obras sociales. */
export interface DistribucionObrasSocialesPdfRow {
  /** Fecha del pago, o el rango de fechas del médico en el resumen. */
  fecha: string
  medico: string
  /** Último apellido, nombre del paciente del pago. '' en las filas de motivo
   *  extra del mismo pago, para no repetir el mismo nombre. */
  paciente: string
  /** Especialidad del médico. Opcional: si no viene, la celda queda vacía. */
  especialidad?: string
  motivo: string
  prestacion?: string
  /** Plus (antes "Monto"). */
  monto: string
  /** Arancel de la obra social del pago, ya formateado. Opcional. */
  arancel?: string
  /** Importe por obra social; '' cuando esa obra social no aplica. */
  porObraSocial: string[]
  impBanco?: string
  impFactura?: string
  gastosAdm?: string
  totalCuidar?: string
  total: string
  /** Motivos que aporta la fila (para "TOTALES · N motivos"). Si no viene, 1. */
  cantidadMotivos?: number
}

export type DistribucionPdfObra = {
  nombre: string
  porcentaje: number
  esCantidad?: boolean
}

/** Los tres totales de la tarjeta de encabezado. */
export type DistribucionTotales = {
  facturado: number
  medico: number
  cuidar: number
}

/* ── Paleta y medidas (pt) ───────────────────────────────────────────────── */
type Rgb = readonly [number, number, number]

const C = {
  texto: [31, 41, 55],          // #1f2937
  gris: [107, 114, 128],        // #6b7280
  azul: [63, 95, 154],          // #3f5f9a
  banda: [225, 229, 234],       // #e1e5ea
  headTabla: [211, 216, 224],   // #d3d8e0
  filaAlterna: [243, 245, 248], // #f3f5f8
  bordeTarjeta: [207, 213, 221], // #cfd5dd
  fondoTarjeta: [236, 239, 243], // #eceff3
  blanco: [255, 255, 255],
} satisfies Record<string, Rgb>

const MARGEN = 34
const TARJETA_H = 74
const TARJETA_R = 14
const HEAD_H = 38
const FILA_MIN_H = 20
const TOTALES_H = 26
const TOTALES_LINEA_H = 3
const GAP_W = 14
const PAD = 6
const NOTA_H = 16

/** Ancho de las columnas de texto (pt). Siempre fijo. */
const W_FECHA = 58
const W_MEDICO = 84
const W_PACIENTE = 96
const W_MOTIVO = 52
const W_PRESTACION = 56

/** Pesos para repartir el ancho que sobra entre las columnas de montos. */
const PESO_PLUS = 64
const PESO_ARANCEL = 50
const PESO_OBRA = 42
const PESO_TOTAL = 52

const NOTA_PORCENTAJES = 'Los porcentajes de cada columna se calculan sobre el Arancel.'

type ColKind = 'text' | 'money' | 'gap'
type Col = {
  id: string
  kind: ColKind
  label: string
  /** Porcentaje que va dentro del título (obras sociales). */
  pct?: string
  /** Peso para repartir el ancho (sólo montos). */
  peso: number
  /** Ancho fijo (columnas de texto y espacio). */
  wFijo?: number
  bold?: boolean
  azul?: boolean
  w: number
}

function setColor(doc: jsPDF, c: Rgb, kind: 'text' | 'fill' | 'draw' = 'text'): void {
  if (kind === 'text') doc.setTextColor(c[0], c[1], c[2])
  else if (kind === 'fill') doc.setFillColor(c[0], c[1], c[2])
  else doc.setDrawColor(c[0], c[1], c[2])
}

/* ── Función principal ───────────────────────────────────────────────────── */

/**
 * PDF de la distribución por médico · obras sociales.
 *
 * A4 apaisado. Primera hoja: tarjeta con los tres totales y el RESUMEN (una fila
 * por médico). Si viene `rowsCompletas`, el detalle por consulta arranca en una
 * hoja nueva con la misma tabla. Las hojas de continuación repiten el
 * encabezado de la tabla y TOTALES va siempre al final de cada bloque.
 *
 * Es sólo formato: los importes llegan ya calculados y formateados.
 */
export function buildDistribucionObrasSocialesPdf(params: {
  desde: string
  hasta: string
  filterLabel: string
  obras: DistribucionPdfObra[]
  /** Primera hoja: una fila por médico. */
  rows: DistribucionObrasSocialesPdfRow[]
  /** Desde la segunda: el detalle. Si no viene, el PDF es sólo el resumen. */
  rowsCompletas?: DistribucionObrasSocialesPdfRow[]
  footerLabel?: string
}): { doc: jsPDF; filename: string; title: string } {
  const { desde, hasta, filterLabel, obras, rows, rowsCompletas } = params

  const doc = new jsPDF({ format: 'a4', orientation: 'landscape', unit: 'pt' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - MARGEN * 2
  const limiteY = pageH - 38

  const fmtDia = (d: string) => format(parseISO(`${d}T12:00:00`), 'dd/MM/yyyy')
  const periodText = desde === hasta ? fmtDia(desde) : `${fmtDia(desde)} – ${fmtDia(hasta)}`
  const title = 'Distribución por Médico · Obras Sociales'

  drawTarjeta(doc, {
    x: MARGEN,
    y: MARGEN,
    w: contentW,
    periodText,
    filterLabel,
    totales: totalesDe(rows, obras),
  })

  const bloques: { filas: DistribucionObrasSocialesPdfRow[]; etiqueta?: string }[] = [
    { filas: rows },
  ]
  if (rowsCompletas && rowsCompletas.length > 0) {
    bloques.push({ filas: rowsCompletas, etiqueta: 'COMPLETO · detalle por consulta' })
  }

  bloques.forEach((bloque, i) => {
    if (i > 0) doc.addPage()
    dibujarTabla(doc, {
      obras,
      filas: bloque.filas,
      etiqueta: bloque.etiqueta,
      startY: i === 0 ? MARGEN + TARJETA_H + 18 : MARGEN,
      x: MARGEN,
      w: contentW,
      limiteY,
    })
  })

  // El pie se dibuja al final, cuando ya se sabe el total de hojas.
  const totalPaginas = doc.getNumberOfPages()
  const generado = format(new Date(), 'dd-MM-yyyy')
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    setColor(doc, C.gris)
    const y = pageH - 20
    doc.text('Centro Médico — Distribución por médico · Obras sociales', MARGEN, y)
    doc.text(`Generado el ${generado} · Página ${p} de ${totalPaginas}`, pageW - MARGEN, y, {
      align: 'right',
    })
  }

  return {
    doc,
    filename: `Fac Obras Sociales-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`,
    title,
  }
}

/* ── Cálculo ─────────────────────────────────────────────────────────────── */

/**
 * Los tres totales de la tarjeta.
 *
 * Salen de las mismas celdas que imprime TOTALES, así que el número del PDF y
 * el de la pantalla no pueden diferir. Total Cuidar es la suma de las columnas
 * de obra social.
 */
export function totalesDe(
  filas: DistribucionObrasSocialesPdfRow[],
  obras: DistribucionPdfObra[],
): DistribucionTotales {
  const facturado = filas.reduce((s, r) => s + parseMoney(r.monto), 0)
  const medico = filas.reduce((s, r) => s + parseMoney(r.total), 0)
  const cuidar = filas.reduce(
    (acc, r) => acc + (parseMoney(r.totalCuidar || '') || cuidarDeFila(r, obras)),
    0,
  )
  return { facturado, medico, cuidar }
}

/** Total Cuidar de una fila: suma de sus celdas de obra social (excluyendo columnas de cantidad). */
function cuidarDeFila(
  r: DistribucionObrasSocialesPdfRow,
  obras?: DistribucionPdfObra[],
): number {
  return r.porObraSocial.reduce((s, v, i) => {
    if (obras && obras[i]?.esCantidad) return s
    const limpio = (v ?? '').trim()
    if (!limpio || /^\d+$/.test(limpio)) return s
    return s + parseMoney(limpio)
  }, 0)
}

/* ── Tarjeta de encabezado ───────────────────────────────────────────────── */

function drawTarjeta(
  doc: jsPDF,
  p: {
    x: number
    y: number
    w: number
    periodText: string
    filterLabel: string
    totales: DistribucionTotales
  },
): void {
  const { x, y, w, totales } = p
  setColor(doc, C.fondoTarjeta, 'fill')
  setColor(doc, C.bordeTarjeta, 'draw')
  doc.setLineWidth(0.8)
  doc.roundedRect(x, y, w, TARJETA_H, TARJETA_R, TARJETA_R, 'FD')

  // Indicadores a la derecha: tres bloques iguales separados por líneas finas.
  const bloqueW = 130
  const indicadores: { label: string; valor: string; azul?: boolean }[] = [
    { label: 'TOTAL FACTURADO', valor: fmtTotal(totales.facturado) },
    { label: 'TOTAL MÉDICO', valor: fmtTotal(totales.medico), azul: true },
    { label: 'TOTAL CUIDAR', valor: fmtTotal(totales.cuidar) },
  ]
  const xInd = x + w - bloqueW * indicadores.length - 10

  // Izquierda: título y subtítulo.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  setColor(doc, C.texto)
  doc.text('Distribución por médico', x + 20, y + 36)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  setColor(doc, C.gris)
  const sub = `Obras sociales · período ${p.periodText}${p.filterLabel ? ` · ${p.filterLabel}` : ''}`
  const subW = xInd - (x + 20) - 12
  doc.text(recortar(doc, sub, subW), x + 20, y + 54)

  setColor(doc, C.bordeTarjeta, 'draw')
  doc.setLineWidth(0.6)
  indicadores.forEach((ind, i) => {
    const bx = xInd + i * bloqueW
    if (i > 0) doc.line(bx, y + 14, bx, y + TARJETA_H - 14)
    const cx = bx + bloqueW / 2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.2)
    setColor(doc, C.gris)
    doc.text(ind.label, cx, y + 28, { align: 'center' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(19)
    setColor(doc, ind.azul ? C.azul : C.texto)
    doc.text(ind.valor, cx, y + 54, { align: 'center' })
  })
}

function fmtTotal(n: number): string {
  return formatMoney(n)
}

/** Recorta con "…" para que el texto entre en `ancho` con la fuente actual. */
function recortar(doc: jsPDF, texto: string, ancho: number): string {
  if (doc.getTextWidth(texto) <= ancho) return texto
  let t = texto
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > ancho) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/* ── Tabla ───────────────────────────────────────────────────────────────── */

type Medidas = {
  fsBody: number
  fsHead: number
  fsPct: number
}

function armarColumnas(obras: DistribucionPdfObra[]): Col[] {
  const pctTxt = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`
  return [
    { id: 'fecha', kind: 'text', label: 'Fecha', peso: 0, wFijo: W_FECHA, w: 0 },
    { id: 'medico', kind: 'text', label: 'Médico', peso: 0, wFijo: W_MEDICO, bold: true, w: 0 },
    { id: 'paciente', kind: 'text', label: 'Paciente', peso: 0, wFijo: W_PACIENTE, w: 0 },
    { id: 'motivo', kind: 'text', label: 'Motivo', peso: 0, wFijo: W_MOTIVO, w: 0 },
    { id: 'prestacion', kind: 'text', label: 'Prestación', peso: 0, wFijo: W_PRESTACION, w: 0 },
    { id: 'plus', kind: 'money', label: 'Plus', peso: PESO_PLUS, w: 0 },
    { id: 'arancel', kind: 'money', label: 'Arancel', peso: PESO_ARANCEL, w: 0 },
    ...obras.map<Col>((o, i) => ({
      id: `os${i}`,
      kind: 'money',
      label: o.nombre,
      pct: o.esCantidad ? 'Cant.' : pctTxt(o.porcentaje),
      peso: PESO_OBRA,
      azul: true,
      w: 0,
    })),
    { id: 'impBanco', kind: 'money', label: 'Imp. Banco', pct: '2,5%', peso: 38, azul: true, w: 0 },
    { id: 'impFactura', kind: 'money', label: 'Imp. Fact.', pct: '3,3%', peso: 38, azul: true, w: 0 },
    { id: 'gastosAdm', kind: 'money', label: 'Gastos Adm.', pct: '5%', peso: 40, azul: true, w: 0 },
    { id: 'cuidar', kind: 'money', label: 'Total Cuidar', peso: PESO_TOTAL, bold: true, w: 0 },
    { id: 'total', kind: 'money', label: 'Total médico', peso: PESO_TOTAL, bold: true, azul: false, w: 0 },
  ]
}

/** Texto de cada columna para una fila. */
function celdasDe(
  r: DistribucionObrasSocialesPdfRow,
  cols: Col[],
): string[] {
  const cuidar = cuidarDeFila(r)
  return cols.map((c) => {
    switch (c.id) {
      case 'fecha': return r.fecha
      case 'medico': return r.medico
      case 'paciente': return r.paciente
      case 'especialidad': return r.especialidad ?? ''
      case 'motivo': return r.motivo
      case 'prestacion': return r.prestacion ?? ''
      case 'plus': return r.monto
      case 'arancel': return r.arancel ?? ''
      case 'impBanco': return r.impBanco ?? ''
      case 'impFactura': return r.impFactura ?? ''
      case 'gastosAdm': return r.gastosAdm ?? ''
      case 'cuidar': return r.totalCuidar || (cuidar > 0 ? formatMoney(cuidar) : '')
      case 'total': return r.total
      case 'gap': return ''
      default: {
        const i = Number(c.id.slice(2))
        return r.porObraSocial[i] ?? ''
      }
    }
  })
}

/** Texto de TOTALES para cada columna de montos. */
function totalesPorColumna(
  filas: DistribucionObrasSocialesPdfRow[],
  cols: Col[],
  obras?: DistribucionPdfObra[],
): string[] {
  const suma = (f: (r: DistribucionObrasSocialesPdfRow) => number) =>
    filas.reduce((s, r) => s + f(r), 0)
  const fmt = (n: number) => formatMoney(n)
  return cols.map((c) => {
    switch (c.id) {
      case 'plus': return fmt(suma((r) => parseMoney(r.monto)))
      case 'arancel': return fmt(suma((r) => parseMoney(r.arancel ?? '')))
      case 'impBanco': return fmt(suma((r) => parseMoney(r.impBanco ?? '')))
      case 'impFactura': return fmt(suma((r) => parseMoney(r.impFactura ?? '')))
      case 'gastosAdm': return fmt(suma((r) => parseMoney(r.gastosAdm ?? '')))
      case 'cuidar': return fmt(suma((r) => parseMoney(r.totalCuidar || '') || cuidarDeFila(r, obras)))
      case 'total': return fmt(suma((r) => parseMoney(r.total)))
      default: {
        if (c.id.startsWith('os')) {
          const i = Number(c.id.slice(2))
          if (obras?.[i]?.esCantidad) {
            const totalCant = filas.reduce(
              (s, r) => s + (parseInt(r.porObraSocial[i] ?? '0', 10) || 0),
              0,
            )
            return String(totalCant)
          }
          return fmt(suma((r) => parseMoney(r.porObraSocial[i] ?? '')))
        }
        return ''
      }
    }
  })
}

/** Reparte `avail` entre columnas según su peso, respetando el mínimo de cada una. */
function repartir(avail: number, items: { peso: number; min: number }[]): number[] {
  const n = items.length
  const fijo: boolean[] = new Array(n).fill(false)
  const w: number[] = new Array(n).fill(0)
  for (let vuelta = 0; vuelta <= n; vuelta++) {
    const usado = items.reduce((s, it, i) => s + (fijo[i] ? it.min : 0), 0)
    const pesoLibre = items.reduce((s, it, i) => s + (fijo[i] ? 0 : it.peso), 0)
    let hubo = false
    for (let i = 0; i < n; i++) {
      if (fijo[i]) {
        w[i] = items[i]!.min
        continue
      }
      w[i] = pesoLibre > 0 ? ((avail - usado) * items[i]!.peso) / pesoLibre : 0
      if (w[i]! < items[i]!.min) {
        fijo[i] = true
        w[i] = items[i]!.min
        hubo = true
      }
    }
    if (!hubo) break
  }
  return w
}

/**
 * Calcula el ancho de cada columna.
 *
 * Texto y espacio: ancho fijo. Montos: se reparten el resto según su peso, con
 * el ancho que necesita el texto real más largo de la columna como piso, para
 * que ningún importe se parta. Si no entran, baja la letra de a 0,2 pt hasta
 * 6,5 pt.
 */
function calcularAnchos(
  doc: jsPDF,
  cols: Col[],
  filasTodas: DistribucionObrasSocialesPdfRow[],
  totales: string[],
  anchoTotal: number,
): Medidas {
  const med: Medidas = { fsBody: 7.4, fsHead: 7.6, fsPct: 7.4 }
  const fijos = cols.reduce((s, c) => s + (c.wFijo ?? 0), 0)
  const avail = anchoTotal - fijos
  const matriz = filasTodas.map((r) => celdasDe(r, cols))

  const minimos = (): number[] =>
    cols.map((c, ci) => {
      if (c.kind !== 'money') return c.wFijo ?? 0
      let max = 0
      doc.setFont('helvetica', c.bold ? 'bold' : 'normal')
      doc.setFontSize(med.fsBody)
      for (const fila of matriz) max = Math.max(max, doc.getTextWidth(fila[ci] ?? ''))
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(med.fsHead)
      max = Math.max(max, doc.getTextWidth(totales[ci] ?? ''))
      let minimo = max + PAD * 2
      // Encabezado: la palabra más larga no se parte.
      const palabra = c.label.split(/\s+/).reduce((m, p) => Math.max(m, doc.getTextWidth(p)), 0)
      minimo = Math.max(minimo, palabra + 8)
      if (c.pct) {
        doc.setFontSize(med.fsPct)
        minimo = Math.max(minimo, doc.getTextWidth(c.pct) + 8)
      }
      return Math.ceil(minimo)
    })

  let mins = minimos()
  const sumaMinMontos = () =>
    cols.reduce((s, c, i) => s + (c.kind === 'money' ? mins[i]! : 0), 0)
  while (sumaMinMontos() > avail && med.fsBody > 6.0 + 1e-6) {
    med.fsBody = Math.max(6.0, +(med.fsBody - 0.2).toFixed(2))
    med.fsHead = Math.max(6.0, +(med.fsHead - 0.2).toFixed(2))
    med.fsPct = Math.max(6.0, +(med.fsPct - 0.2).toFixed(2))
    mins = minimos()
  }

  const idxMontos = cols.map((c, i) => (c.kind === 'money' ? i : -1)).filter((i) => i >= 0)
  if (sumaMinMontos() > avail) {
    // Último recurso: no se cortan montos; se angostan las columnas de texto respetando su piso mínimo.
    let faltante = sumaMinMontos() - avail
    const minFloor: Record<string, number> = {
      fecha: 54,
      motivo: 48,
      prestacion: 52,
      medico: 64,
      paciente: 70,
    }
    const textos = cols.map((c, i) => (c.kind === 'text' ? i : -1)).filter((i) => i >= 0)
    for (const i of textos) {
      cols[i]!.w = cols[i]!.wFijo ?? 0
    }
    // Reducir primero de médico y paciente que aceptan 2 líneas
    for (const id of ['paciente', 'medico']) {
      const idx = cols.findIndex((c) => c.id === id)
      if (idx >= 0 && faltante > 0) {
        const floor = minFloor[id] ?? 60
        const reduccion = Math.min(faltante, Math.max(0, cols[idx]!.w - floor))
        cols[idx]!.w -= reduccion
        faltante -= reduccion
      }
    }
    // Si aún falta, repartir el restante proporcionalmente sin perforar los mínimos
    if (faltante > 0) {
      for (const i of textos) {
        const c = cols[i]!
        const floor = minFloor[c.id] ?? 40
        const reduccion = Math.min(faltante, Math.max(0, c.w - floor))
        c.w -= reduccion
        faltante -= reduccion
        if (faltante <= 0) break
      }
    }
    idxMontos.forEach((i) => (cols[i]!.w = mins[i]!))
    cols.forEach((c) => {
      if (c.kind === 'gap') c.w = c.wFijo ?? GAP_W
    })
    return med
  }

  const anchos = repartir(
    avail,
    idxMontos.map((i) => ({ peso: cols[i]!.peso, min: mins[i]! })),
  )
  cols.forEach((c) => {
    if (c.kind !== 'money') c.w = c.wFijo ?? 0
  })
  idxMontos.forEach((i, k) => (cols[i]!.w = anchos[k]!))
  return med
}

/** Parte un texto en como máximo 2 líneas; si sobra, la segunda termina en "…". */
function dosLineas(doc: jsPDF, texto: string, ancho: number): string[] {
  if (!texto) return ['']
  const lineas = doc.splitTextToSize(texto, ancho) as string[]
  if (lineas.length <= 2) return lineas
  let resto = lineas.slice(1).join(' ')
  while (resto.length > 1 && doc.getTextWidth(`${resto}…`) > ancho) resto = resto.slice(0, -1)
  return [lineas[0]!, `${resto.trimEnd()}…`]
}

function dibujarTabla(
  doc: jsPDF,
  p: {
    obras: DistribucionPdfObra[]
    filas: DistribucionObrasSocialesPdfRow[]
    etiqueta?: string
    startY: number
    x: number
    w: number
    limiteY: number
  },
): void {
  const { obras, filas, etiqueta, x, w, limiteY } = p
  const cols = armarColumnas(obras)
  const totales = totalesPorColumna(filas, cols, obras)
  const med = calcularAnchos(doc, cols, filas, totales, w)

  // Posición x de cada columna.
  const xs: number[] = []
  let acc = x
  for (const c of cols) {
    xs.push(acc)
    acc += c.w
  }
  const wTabla = acc - x

  const lh = med.fsBody * 1.25

  // Altura de cada fila según el texto que más líneas ocupe.
  const celdas = filas.map((r) => celdasDe(r, cols))
  const lineasDe = celdas.map((fila) =>
    fila.map((t, ci) => {
      const c = cols[ci]!
      if (c.kind !== 'text') return [t]
      doc.setFont('helvetica', c.bold ? 'bold' : 'normal')
      doc.setFontSize(med.fsBody)
      return dosLineas(doc, t, c.w - PAD * 2)
    }),
  )
  const alturas = lineasDe.map((fila) => {
    const maxL = Math.max(1, ...fila.map((l) => l.length))
    return Math.max(FILA_MIN_H, maxL * lh + 5)
  })

  // Encabezado de la tabla: nombres arriba y % en una línea común abajo.
  const dibujarEncabezado = (y: number) => {
    setColor(doc, C.headTabla, 'fill')
    doc.rect(x, y, wTabla, HEAD_H, 'F')
    doc.setFont('helvetica', 'bold')
    setColor(doc, C.texto)
    cols.forEach((c, ci) => {
      if (c.kind === 'gap') return
      const cx = xs[ci]!
      const tieneOS = !!c.pct
      doc.setFontSize(med.fsHead)
      // 8 pt de holgura, igual que el mínimo de ancho: la palabra más larga no se parte.
      const lineas = dosLineas(doc, c.label, c.w - 8)
      const hl = med.fsHead * 1.2
      let y0: number
      if (tieneOS) {
        // Nombre en una o dos líneas, sobre una línea de % fija.
        y0 = lineas.length === 1 ? y + 17 : y + 14
      } else {
        y0 = y + (HEAD_H - (lineas.length - 1) * hl) / 2 + med.fsHead * 0.35
      }
      lineas.forEach((l, k) => {
        if (tieneOS) doc.text(l, cx + c.w / 2, y0 + k * hl, { align: 'center' })
        else if (c.kind === 'money') doc.text(l, cx + c.w - PAD, y0 + k * hl, { align: 'right' })
        else doc.text(l, cx + PAD, y0 + k * hl)
      })
      if (c.pct) {
        doc.setFontSize(med.fsPct)
        setColor(doc, C.azul)
        doc.text(c.pct, cx + c.w / 2, y + HEAD_H - 7, { align: 'center' })
        setColor(doc, C.texto)
      }
    })
  }

  let y = p.startY
  if (etiqueta) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    setColor(doc, C.azul)
    doc.text(etiqueta, x, y + 8)
    y += 14
  }
  let topPagina = y
  dibujarEncabezado(y)
  y += HEAD_H

  if (filas.length === 0) {
    setColor(doc, C.filaAlterna, 'fill')
    doc.rect(x, y, wTabla, FILA_MIN_H, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(med.fsBody)
    setColor(doc, C.gris)
    doc.text('Sin datos en el filtro actual', x + PAD, y + FILA_MIN_H / 2 + med.fsBody * 0.35)
    y += FILA_MIN_H
  }

  filas.forEach((_, ri) => {
    const h = alturas[ri]!
    const esUltima = ri === filas.length - 1
    // La última fila reserva lugar para TOTALES y la nota: TOTALES no queda sola.
    const reserva = esUltima ? TOTALES_LINEA_H + TOTALES_H + NOTA_H : 0
    if (y + h + reserva > limiteY && y > topPagina + HEAD_H) {
      doc.addPage()
      y = MARGEN
      topPagina = y
      dibujarEncabezado(y)
      y += HEAD_H
    }
    setColor(doc, ri % 2 === 0 ? C.filaAlterna : C.blanco, 'fill')
    doc.rect(x, y, wTabla, h, 'F')

    cols.forEach((c, ci) => {
      if (c.kind === 'gap') return
      const lineas = lineasDe[ri]![ci]!
      if (lineas.length === 1 && !lineas[0]) return
      doc.setFont('helvetica', c.bold ? 'bold' : 'normal')
      doc.setFontSize(med.fsBody)
      setColor(doc, c.azul ? C.azul : C.texto)
      const y0 = y + (h - (lineas.length - 1) * lh) / 2 + med.fsBody * 0.35
      lineas.forEach((l, k) => {
        if (c.kind === 'money') doc.text(l, xs[ci]! + c.w - PAD, y0 + k * lh, { align: 'right' })
        else doc.text(l, xs[ci]! + PAD, y0 + k * lh)
      })
    })
    y += h
  })

  // TOTALES: línea de 3 pt y fila de 26 pt, de punta a punta.
  setColor(doc, C.headTabla, 'fill')
  doc.rect(x, y, wTabla, TOTALES_LINEA_H, 'F')
  y += TOTALES_LINEA_H
  setColor(doc, C.banda, 'fill')
  doc.rect(x, y, wTabla, TOTALES_H, 'F')
  const nMotivos = filas.reduce((s, r) => s + (r.cantidadMotivos ?? 1), 0)
  const yt = y + TOTALES_H / 2 + med.fsHead * 0.35
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(med.fsHead)
  setColor(doc, C.texto)
  doc.text(`TOTALES · ${nMotivos} motivo${nMotivos !== 1 ? 's' : ''}`, x + PAD, yt)
  cols.forEach((c, ci) => {
    const t = totales[ci]
    if (!t) return
    setColor(doc, c.id === 'total' ? C.azul : C.texto)
    doc.text(t, xs[ci]! + c.w - PAD, yt, { align: 'right' })
  })
  y += TOTALES_H

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  setColor(doc, C.gris)
  doc.text(NOTA_PORCENTAJES, x, y + 11)
}

/* ── Formato ─────────────────────────────────────────────────────────────── */

/**
 * "$ 1.234,50" -> 1234.5
 *
 * Se lee con punto de miles y coma decimal (formato argentino) y se devuelve
 * como número plano para que las sumas no arrastren error de redondeo.
 */
export function parseMoney(v: string): number {
  if (!v) return 0
  const n = Number(
    v
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.'),
  )
  return isFinite(n) ? n : 0
}

/**
 * Importe en formato argentino: "$ 1.350.000".
 *
 * Los centavos se muestran sólo si existen. En un PDF de totales, que en su
 * mayoría son redondeados, una columna con decimales agrega ruido y hace más
 * difícil comparar las cifras de un vistazo.
 */
export function formatMoney(n: number): string {
  const conCentavos = Math.abs(n % 1) > 0.004
  return `$ ${n.toLocaleString('es-AR', {
    minimumFractionDigits: conCentavos ? 2 : 0,
    maximumFractionDigits: conCentavos ? 2 : 0,
  })}`
}
