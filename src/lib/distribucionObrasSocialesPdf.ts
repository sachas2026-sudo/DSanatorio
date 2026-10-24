import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { UserOptions } from 'jspdf-autotable'

/** Una fila de la distribución por médico · obras sociales. */
export interface DistribucionObrasSocialesPdfRow {
  /** Fecha del pago, o el rango de fechas del médico en el resumen. */
  fecha: string
  medico: string
  /** Último apellido, nombre del paciente del pago. '' en las filas de motivo
   *  extra del mismo pago, para no repetir el mismo nombre. */
  paciente: string
  motivo: string
  monto: string
  /** Importe por obra social; '' cuando esa obra social no aplica. */
  porObraSocial: string[]
  total: string
}

export type DistribucionPdfObra = {
  nombre: string
  porcentaje: number
}

/* ── Paleta "celeste cielo" ────────────────────────────────────────────────
 * Está junta a propósito: cambiar el tema es editar esta lista y no
 * buscarlos de a uno por el archivo. */
type Rgb = readonly [number, number, number]

const C = {
  texto: [43, 76, 102],           // #2B4C66
  textoSec: [75, 111, 137],       // #4B6F89
  pie: [122, 152, 176],           // #7A98B0
  lineaFila: [227, 239, 248],     // #E3EFF8
  acento: [47, 143, 219],         // #2F8FDB
  bannerDe: [220, 238, 251],      // #DCEEFB
  bannerA: [198, 228, 250],       // #C6E4FA
  bannerBorde: [185, 218, 243],   // #B9DAF3
  headDe: [198, 228, 250],        // #C6E4FA
  headMedio: [181, 219, 247],     // #B5DBF7
  headA: [163, 208, 243],         // #A3D0F3
  headTexto: [47, 106, 155],      // #2F6A9B
  headLinea: [158, 203, 238],     // #9ECBEE
  filaPar: [246, 251, 254],       // #F6FBFE
  totalTexto: [47, 106, 155],     // #2F6A9B
  footFondo: [220, 237, 250],     // #DCEDFA
  footTotal: [198, 228, 250],     // #C6E4FA
  tarjetaBorde: [211, 232, 248],  // #D3E8F8
  blanco: [255, 255, 255],
} satisfies Record<string, Rgb>

/** Márgenes y medidas de la hoja, en mm. */
const MARGEN = 10
/** Alto del banner. A 26 mm la tabla con 12 médicos se caía en una segunda
 *  hoja por un solo renglón; medido de punta a punta, a 21 mm entran 14. */
const BANNER_H = 21
/** Radio del banner. A 6 mm las esquinas quedaban de "pastilla"; a 2 mm el
 *  redondeo sólo insinúa la curva sin comerse la esquina. */
const BANNER_R = 2
/** Radio de las esquinas redondeadas de la tarjeta de la tabla. */
const TARJETA_R = 2

/**
 * Anchos de columna, en % del ancho de la tabla.
 *
 * Los nombres largos de médico y paciente se parten en dos líneas dentro de la
 * celda en vez de ensanchar la columna: si el médico empujara el ancho, las
 * columnas de importe —las que hay que comparar de un vistazo— quedarían
 * desiguales y la tabla dejaría de leerse como una grilla.
 *
 * PCT_OS es también el ancho mínimo legible de una obra social: por debajo
 * (~19,6 mm sobre los 276 mm útiles de la hoja) un importe como "$ 1.050" no
 * entra y el nombre del encabezado se parte en tres líneas.
 */
const PCT_FECHA = 7.4
const PCT_MEDICO = 14.6
const PCT_PACIENTE = 12.4
const PCT_MOTIVO = 7.2
const PCT_MONTO = 7.5
const PCT_OS = 7.1
const PCT_TOTAL_MEDICO = 8.3

/** Las cinco columnas que se repiten en cada hoja de la lista partida. */
const PCT_FIJAS = PCT_FECHA + PCT_MEDICO + PCT_PACIENTE + PCT_MOTIVO + PCT_MONTO

/**
 * Ancho mínimo legible de una columna de obra social (mm).
 *
 * Es lo que necesita un importe corto como "$ 1.050" a 9 pt más el padding
 * lateral de la celda. Por debajo el número se parte o se pisa con el vecino.
 */
const ANCHO_MIN_OS_MM = 14

/** Reparto de porcentajes de las columnas, según el ancho de la hoja. */
type PctsColumna = {
  fecha: number
  medico: number
  paciente: number
  motivo: number
  monto: number
  total: number
}

/**
 * Porcentajes de las columnas de texto y importe.
 *
 * Los de arriba están calculados para la hoja apaisada (276 mm útiles). En
 * vertical el ancho útil cae a 189 mm y con el mismo reparto la fecha se
 * partía en dos renglones ("11-05-2 / 6") y "Consulta médica" en tres.
 *
 * El reparto vertical le da más a las columnas de texto y menos a las de
 * importe: un nombre largo partido en dos renglones todavía se lee, un importe
 * partido no. Las obras sociales se llevan lo que sobra, vía `pctOs`.
 */
function pctsDeColumna(pageW: number): PctsColumna {
  if (pageW < 230) {
    return { fecha: 8.5, medico: 16, paciente: 14, motivo: 12, monto: 10, total: 9.5 }
  }
  return {
    fecha: PCT_FECHA,
    medico: PCT_MEDICO,
    paciente: PCT_PACIENTE,
    motivo: PCT_MOTIVO,
    monto: PCT_MONTO,
    total: PCT_TOTAL_MEDICO,
  }
}

/**
 * Cuántas columnas de obra social entran en una hoja sin quedar ilegibles.
 *
 * El ancho de las columnas viene de porcentajes fijos, así que con más obras de
 * las que entran la tabla se iba más allá del borde derecho de la hoja y las
 * últimas columnas quedaban directamente afuera: con 11 obras se perdían cuatro
 * sin dejar rastro. En vez de angostar todo hasta hacerlo ilegible, la lista se
 * parte en varias hojas y cada una repite las columnas fijas.
 *
 * El cálculo va en milímetros porque lo que manda es el espacio que sobra
 * después de las columnas fijas y de Total Médico, no el porcentaje.
 */
function obrasPorHoja(pageW: number): number {
  const pc = pctsDeColumna(pageW)
  const anchoUtil = pageW - MARGEN * 2 - 1
  const ocupado = pc.fecha + pc.medico + pc.paciente + pc.motivo + pc.monto + pc.total
  return Math.max(1, Math.floor((anchoUtil * (100 - ocupado)) / 100 / ANCHO_MIN_OS_MM))
}

/** Los tres totales del banner. */
export type DistribucionTotales = {
  facturado: number
  medico: number
  cuidar: number
}

/**
 * PDF de la distribución por médico · obras sociales.
 *
 * Lleva dos bloques en el mismo documento: el RESUMEN (una fila por médico) y
 * desde la página siguiente el detalle por consulta. Las columnas se generan
 * dinámicamente a partir de las obras sociales presentes en el filtro actual.
 *
 * Los anchos de columna salen de porcentajes fijos, así que no dan para
 * columnas ilimitadas: con más obras de las que entran en una hoja la lista se
 * parte en varias, cada una repitiendo las columnas fijas (Fecha, Médico,
 * Paciente, Especialidad, Motivo y Monto) para que cada importe siga teniendo a
 * la vista de quién es. Total Médico va sólo en la última hoja, porque suma
 * todas las obras y no las de esa hoja.
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
  const { desde, hasta, filterLabel, obras, rows, rowsCompletas, footerLabel } = params

  const doc = new jsPDF({ format: 'a4', orientation: 'portrait', unit: 'mm' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  const fmtDiaLargo = (d: string) => format(parseISO(`${d}T12:00:00`), 'dd/MM/yyyy')
  const periodText =
    desde === hasta ? fmtDiaLargo(desde) : `${fmtDiaLargo(desde)} – ${fmtDiaLargo(hasta)}`

  const title = 'Distribución por Médico · Obras Sociales'
  const ctx = {
    periodText,
    footerLabel,
    medicosResumen: countDistinct(rows),
  }

  // La primera hoja va en blanco: el celeste queda sólo en las de continuación,
  // donde el corte de tabla delega la lectura del reporte. Acá el color lo
  // aportan el banner, la banda del encabezado y la tarjeta de la tabla.

  const bannerBottom = drawBanner({
    doc,
    pageW,
    periodText,
    filterLabel,
    totales: totalesDe(rows, obras),
  })

  // Las obras se reparten en hojas de a `obrasPorHoja(pageW)` columnas. Con la
  // lista corta (7 o menos) hay un solo grupo y el PDF sale igual que siempre.
  const capacidad = obrasPorHoja(pageW)
  const grupos: number[][] = []
  for (let i = 0; i < obras.length; i += capacidad) {
    grupos.push(Array.from({ length: Math.min(capacidad, obras.length - i) }, (_, k) => i + k))
  }
  if (grupos.length === 0) grupos.push([])

  /** Toma de cada fila sólo las obras de este grupo, para que la tabla de la
   *  hoja muestre los importes de sus columnas y no los de las otras hojas. */
  const recortar = (
    filas: DistribucionObrasSocialesPdfRow[],
    indices: number[],
  ): DistribucionObrasSocialesPdfRow[] =>
    filas.map((r) => ({
      ...r,
      porObraSocial: indices.map((i) => r.porObraSocial[i] ?? ''),
    }))

  grupos.forEach((indices, nGrupo) => {
    if (nGrupo > 0) doc.addPage()

    autoTable(
      doc,
      tablaDistribucion({
        doc,
        pageW,
        obras: indices.map((i) => obras[i]!),
        filas: recortar(rows, indices),
        titulo: nGrupo === 0 ? undefined : `CONTINUACIÓN · ${nGrupo + 1} de ${grupos.length}`,
        startY: nGrupo === 0 ? bannerBottom + 3 : MARGEN + 4,
      }),
    )
  })

  // El detalle arranca en una página nueva: así la primera hoja es siempre el
  // resumen y no queda cortado por la tabla larga.
  if (rowsCompletas && rowsCompletas.length > 0) {
    grupos.forEach((indices, nGrupo) => {
      doc.addPage()
      autoTable(
        doc,
        tablaDistribucion({
          doc,
          pageW,
          obras: indices.map((i) => obras[i]!),
          filas: recortar(rowsCompletas, indices),
          titulo:
            nGrupo === 0
              ? 'COMPLETO · detalle por consulta'
              : `COMPLETO · detalle · continuación ${nGrupo + 1} de ${grupos.length}`,
          startY: MARGEN + 4,
        }),
      )
    })
  }

  // El pie se dibuja recién cuando todas las tablas están generadas: dentro de
  // `didDrawPage` la hoja siguiente todavía no existe, así que `getNumberOfPages`
  // daba 1 y el "Página x de y" no aparecía en ninguna hoja.
  const totalPaginas = doc.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i)
    pieDeHoja(doc, pageW, pageH, i, totalPaginas, ctx)
  }

  return {
    doc,
    filename: `Fac Obras Sociales-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`,
    title,
  }
}

/* ── Cálculo ─────────────────────────────────────────────────────────────── */

/**
 * Los tres totales del banner.
 *
 * Salen de las mismas celdas que imprime el pie de la tabla, así que el número
 * del PDF y el de la pantalla no pueden diferir. Total Cuidar es la suma de las
 * columnas de obra social, que equivale a Facturado − Médico: el invariante se
 * cumple por construcción y no hace falta calcularlo de otra forma.
 */
export function totalesDe(
  filas: DistribucionObrasSocialesPdfRow[],
  obras: DistribucionPdfObra[],
): DistribucionTotales {
  const facturado = filas.reduce((s, r) => s + parseMoney(r.monto), 0)
  const medico = filas.reduce((s, r) => s + parseMoney(r.total), 0)
  const cuidar = obras.reduce(
    (acc, _, i) => acc + filas.reduce((s, r) => s + parseMoney(r.porObraSocial[i] ?? ''), 0),
    0,
  )
  return { facturado, medico, cuidar }
}

function countDistinct(filas: DistribucionObrasSocialesPdfRow[]): number {
  return new Set(filas.map((r) => r.medico)).size
}

/* ── Primitivas de dibujo ────────────────────────────────────────────────── */

/** Interpola entre dos colores. `t` va de 0 a 1. */
function mezcla(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}



/**
 * Igual que `degradadoH`, pero con las esquinas superiores redondeadas.
 *
 * La banda del encabezado tiene que compartir el radio de la tarjeta que la
 * contiene: si se pinta como un rectángulo de esquinas vivas, el degradé
 * sobresale por las cuatro puntas y el redondeo de la tarjeta queda tapado justo
 * donde más se nota.
 *
 * El paso NO es uniforme. En el centro hace falta fino para que el degradé no
 * bandee, pero un paso uniforme sobre 277 mm (w/240 ≈ 1,15 mm) deja el arco de
 * un radio de 4 mm resuelto con menos de 4 tiras y se ve escalonado, con un
 * escalón blanco en cada esquina. Así que el radio va con 24 pasos propios y el
 * resto de la tira con pasos finos.
 */
function degradadoHArribaRedondeado(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  desde: Rgb,
  hasta: Rgb,
): void {
  const cortes = cortesConArcos(x, w, r, 24, 480)

  const centroXizq = x + r
  const centroXder = x + w - r

  for (let i = 0; i < cortes.length - 1; i++) {
    const xi = cortes[i]!
    const xf = cortes[i + 1]!
    const c = mezcla(desde, hasta, w === 0 ? 0 : (xi - x) / w)
    doc.setFillColor(c[0], c[1], c[2])

    // Alto útil de la banda en esta franja: recortada si toca un arco.
    let y0 = y
    if (xi < centroXizq) {
      const dy = Math.sqrt(Math.max(0, r * r - (centroXizq - xi) ** 2))
      y0 = y + r - dy
    } else if (xf > centroXder) {
      const dy = Math.sqrt(Math.max(0, r * r - (xf - centroXder) ** 2))
      y0 = y + r - dy
    }

    // El +0.04 solapa las tiras: si no, quedan líneas blancas entre ellas.
    doc.rect(xi, y0, xf - xi + 0.04, y + h - y0, 'F')
  }
}

/**
 * Repinta de blanco el rincón que queda fuera del redondeo en las esquinas
 * inferiores de la tarjeta.
 *
 * Las celdas de autoTable se pintan como rectángulos de esquinas vivas y llegan
 * hasta el borde, así que tapan el arco del `roundedRect` de la tarjeta: abajo
 * la punta queda cuadrada aunque el borde esté redondeado. Como el papel es
 * blanco, volver a pintar ese rincón devuelve el redondeo. Las esquinas
 * superiores no necesitan esto: ahí el degradé del encabezado ya viene recortado.
 *
 * jsPDF no rellena arcos, así que el contorno se aproxima con 24 segmentos: la
 * diferencia contra el círculo es menor a 0.01 mm y no se ve.
 */
function taparEsquinasInferiores(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const segmentos = 24
  const yBot = y + h
  doc.setFillColor(C.blanco[0], C.blanco[1], C.blanco[2])

  for (const lado of [-1, 1] as const) {
    // Centro del arco de la esquina y su vértice exterior.
    const cx = lado < 0 ? x + r : x + w - r
    const cy = yBot - r
    const xExt = lado < 0 ? x : x + w

    // Recorrido: por el borde exterior hacia abajo, siguiendo el arco de vuelta
    // hasta el borde inferior.
    const puntos: [number, number][] = []
    for (let i = 0; i <= segmentos; i++) {
      const t = i / segmentos
      const ang = (Math.PI / 2) * (1 - t)
      puntos.push([cx + lado * r * Math.cos(ang), cy + r * Math.sin(ang)])
    }
    puntos.push([xExt, cy])
    puntos.push([xExt, yBot])

    // `lines` toma un array de deltas [[dx, dy], ...] relativos al arranque.
    const deltas: [number, number][] = []
    for (let i = 1; i < puntos.length; i++) {
      deltas.push([puntos[i]![0] - puntos[i - 1]![0], puntos[i]![1] - puntos[i - 1]![1]])
    }
    doc.lines(deltas, puntos[0]![0], puntos[0]![1], [1, 1], 'F', true)
  }
}

/**
 * Cortes verticales para pintar un degradé a franjas con arcos redondeados.
 *
 * El paso NO es uniforme. En el centro hace falta fino para que el degradé no
 * bandee, pero un paso uniforme deja el arco de una esquina resuelto con muy
 * pocas franjas y se ve escalonado, con mordidas del color del papel en el
 * redondeo. Así que dentro de los arcos van pasos propios y el resto, finos.
 *
 * Devuelve los bordes (en mm) de cada franja, ya en cantidad par + 1 para poder
 * iterar de a pares. El degradé se pinta como rectángulos verticales entre
 * cortes consecutivos, recortados según el arco en los extremos.
 */
function cortesConArcos(
  x: number,
  w: number,
  r: number,
  pasosEsquina: number,
  pasosCentro: number,
): number[] {
  const pasoFino = w / pasosCentro
  const finCentro = x + w - r
  const cortes: number[] = [x]
  for (let i = 1; i <= pasosEsquina; i++) cortes.push(x + (r * i) / pasosEsquina)
  for (let xi = x + r + pasoFino; xi < finCentro; xi += pasoFino) cortes.push(xi)
  cortes.push(finCentro)
  for (let i = 1; i < pasosEsquina; i++) cortes.push(finCentro + (r * i) / pasosEsquina)
  cortes.push(x + w)
  return cortes
}

/**
 * Degradé horizontal con tiras verticales.
 *
 * jsPDF no tiene relleno degradado, así que se simula con N tiras del color ya
 * interpolado. Con 60 tiras sobre 277 mm la diferencia entre dos tiras
 * contiguas es menor a un punto de color: el bandeado no se ve.
 */
function degradadoH(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  desde: Rgb,
  hasta: Rgb,
  pasos = 60,
): void {
  const pasoW = w / pasos
  for (let i = 0; i < pasos; i++) {
    const t = pasos === 1 ? 0 : i / (pasos - 1)
    const c = mezcla(desde, hasta, t)
    doc.setFillColor(c[0], c[1], c[2])
    // El +0.04 solapa las tiras: si no, quedan líneas blancas del ancho de un
    // píxel entre ellas.
    doc.rect(x + i * pasoW, y, pasoW + 0.04, h, 'F')
  }
}

/**
 * Rectángulo de esquinas redondeadas con degradé horizontal.
 *
 * El degradé se arma franja por franja, y cada franja se recorta a la altura
 * que tiene el rectángulo redondeado en esa x: en el centro va de borde a
 * borde y en las esquinas se acorta siguiendo el arco.
 *
 * La primera versión pintaba las franjas completas y después tapaba las
 * esquinas con círculos del color de la página. El error era dónde se ponían
 * esos círculos: jsPDF rellena el disco ENTERO, así que al centrarlos en el
 * centro del arco —que cae dentro del banner— se comían un manchón del
 * interior y quedaban unas medias lunas blancas en los bordes. Con este
 * recorte no hay círculos que tapar.
 */
function rectRedondeadoConDegradé(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  desde: Rgb,
  hasta: Rgb,
  borde: Rgb,
): void {
  // Paso fino en el centro para el degradé y 24 pasos propios dentro de cada
  // arco: con paso uniforme un radio de 6 mm quedaba en ~5 franjas y el
  // redondeado salía escalonado, con mordidas del papel en la curva.
  const cortes = cortesConArcos(x, w, r, 24, 480)
  const centroXizq = x + r
  const centroXder = x + w - r

  for (let i = 0; i < cortes.length - 1; i++) {
    const xi = cortes[i]!
    const xf = cortes[i + 1]!
    const t = w === 0 ? 0 : (xi - x) / w
    const c = mezcla(desde, hasta, t)
    doc.setFillColor(c[0], c[1], c[2])

    // Alto útil de la banda redondeada en esta franja.
    let y0 = y
    let y1 = y + h
    if (xi < centroXizq) {
      const dy = Math.sqrt(Math.max(0, r * r - (centroXizq - xi) ** 2))
      y0 = y + r - dy
      y1 = y + h - r + dy
    } else if (xf > centroXder) {
      const dy = Math.sqrt(Math.max(0, r * r - (xf - centroXder) ** 2))
      y0 = y + r - dy
      y1 = y + h - r + dy
    }

    // El +0.04 solapa las franjas: si no quedan líneas blancas entre ellas.
    doc.rect(xi, y0, xf - xi + 0.04, y1 - y0, 'F')
  }

  doc.setDrawColor(borde[0], borde[1], borde[2])
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, w, h, r, r, 'S')
}

/* ── Banner ──────────────────────────────────────────────────────────────── */

/**
 * Banner superior: título y período a la izquierda, los tres totales a la
 * derecha, separados por líneas verticales.
 *
 * Devuelve el borde inferior, que es de donde arranca la tabla.
 */
function drawBanner(p: {
  doc: jsPDF
  pageW: number
  periodText: string
  filterLabel: string
  totales: DistribucionTotales
}): number {
  const { doc, pageW, periodText, filterLabel, totales } = p
  const x = MARGEN
  const w = pageW - MARGEN * 2
  const y = MARGEN
  const h = BANNER_H

  rectRedondeadoConDegradé(
    doc,
    x, y, w, h, BANNER_R,
    C.bannerDe, C.bannerA, C.bannerBorde,
  )

  // ── Izquierda: título y período ──
  // En A4 vertical el banner mide 190 mm de ancho en vez de 277: con los tres
  // totales a 42 mm se comen 142 y el título no tiene lugar. Todo el bloque
  // izquierdo y el ancho de cada total se ajustan al espacio que sobra.
  const padL = 6
  const gap = 8
  // Se reserva el ancho del bloque izquierdo (título) y se reparte el resto.
  const anchoTitulo = Math.min(96, w * 0.36)
  const colW = Math.max(24, (w - padL * 2 - anchoTitulo - gap * 2) / 3)
  const tituloSize = w < 230 ? 15 : 20
  const subSize = w < 230 ? 8 : 9.5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(tituloSize)
  doc.setTextColor(C.texto[0], C.texto[1], C.texto[2])
  doc.text('Distribución por médico', x + padL, y + 8.5, {
    maxWidth: anchoTitulo,
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(subSize)
  doc.setTextColor(C.textoSec[0], C.textoSec[1], C.textoSec[2])
  doc.text(`Obras sociales · período ${periodText}`, x + padL, y + 14.5, {
    maxWidth: anchoTitulo,
  })

  if (filterLabel) {
    doc.setFontSize(Math.min(8, subSize))
    doc.text(`Filtro: ${filterLabel}`, x + padL, y + 18.5, { maxWidth: anchoTitulo })
  }

  // ── Derecha: los tres totales ──
  const cifras: { etiqueta: string; valor: number; color?: Rgb }[] = [
    { etiqueta: 'TOTAL FACTURADO', valor: totales.facturado },
    { etiqueta: 'TOTAL MÉDICO', valor: totales.medico, color: C.acento },
    { etiqueta: 'TOTAL CUIDAR', valor: totales.cuidar },
  ]
  const totalW = cifras.length * colW + (cifras.length - 1) * gap
  let cx = x + w - padL - totalW

  cifras.forEach((c, i) => {
    if (i > 0) {
      doc.setDrawColor(C.headLinea[0], C.headLinea[1], C.headLinea[2])
      doc.setLineWidth(0.25)
      doc.line(cx - gap / 2, y + 4, cx - gap / 2, y + h - 4)
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(Math.min(7, subSize))
    doc.setTextColor(C.textoSec[0], C.textoSec[1], C.textoSec[2])
    doc.text(c.etiqueta, cx + colW / 2, y + 6.5, {
      align: 'center',
      maxWidth: colW,
    })

    // La cifra se ajusta al ancho de la columna. Con la hoja vertical la
    // columna queda en ~31 mm y "$ 150.450" a 21 pt mide ~38 mm: jsPDF lo partía
    // en dos renglones y el segundo caía fuera del banner, encima de la tabla.
    doc.setFont('helvetica', 'bold')
    const texto = formatMoney(c.valor)
    let size = w < 230 ? 17 : 21
    doc.setFontSize(size)
    // getTextWidth devuelve el ancho en las unidades del documento (mm) y usa
    // el fontSize vigente, así que hay que ir bajando el tamaño y volver a medir.
    while (size > 9 && doc.getTextWidth(texto) > colW - 1) {
      size -= 1
      doc.setFontSize(size)
    }
    const col = c.color ?? C.texto
    doc.setTextColor(col[0], col[1], col[2])
    doc.text(texto, cx + colW / 2, y + 16, {
      align: 'center',
      maxWidth: colW,
    })

    cx += colW + gap
  })

  return y + h
}

/* ── Encabezado de la tabla ──────────────────────────────────────────────── */

/** Tamaño y métricas del encabezado, medidos antes de dibujar nada. */
type MedidasEncabezado = {
  alto: number
  lineasFijas: string[][]
  lineasObras: string[][]
  yFilaRotulos: number
  yFilaNombres: number
}

const HEAD_FONT = 9
const HEAD_LINE_H = 4.1
const HEAD_PAD_Y = 1.6
const ROTULOS_FIJOS = ['Fecha', 'Médico', 'Paciente', 'Motivo de la Consulta', 'Monto']

/**
 * Mide el encabezado de dos filas (rótulos de % arriba, nombres de columna abajo).
 *
 * Se mide aparte del dibujo porque la banda depende de cuántas obras sociales
 * tenga el filtro, y hay que conocer su alto antes de llamar a autoTable: el
 * degradé y los rótulos se dibujan a mano ANTES de que la tabla escriba nada.
 * Si se dibujaran después taparían el texto — que es lo que se veía roto, con
 * la banda del encabezado en blanco y sin un solo título.
 */
function medirEncabezado(
  doc: jsPDF,
  obras: DistribucionPdfObra[],
  anchos: number[],
): MedidasEncabezado {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(HEAD_FONT)

  const partir = (texto: string, w: number) =>
    doc.splitTextToSize(texto, w - 2.4) as string[]

  const lineasFijas = ROTULOS_FIJOS.map((t, i) => partir(t, anchos[i]!))
  const lineasObras = obras.map((o, i) => partir(o.nombre, anchos[5 + i]!))

  const altoFilaRotulos = HEAD_LINE_H + HEAD_PAD_Y * 2
  const maxLineas = Math.max(
    1,
    ...[...lineasFijas, ...lineasObras].map((l) => l.length),
  )
  const altoFilaNombres = maxLineas * HEAD_LINE_H + HEAD_PAD_Y * 2

  return {
    alto: altoFilaRotulos + altoFilaNombres,
    lineasFijas,
    lineasObras,
    yFilaRotulos: HEAD_PAD_Y + HEAD_LINE_H * 0.78,
    yFilaNombres: altoFilaRotulos + HEAD_PAD_Y + HEAD_LINE_H * 0.78,
  }
}

/**
 * Dibuja la banda del encabezado: degradé de fondo y los rótulos encima.
 *
 * La primera fila lleva "% Cuidar" sobre las columnas fijas y el porcentaje de
 * cada obra social pegado a su propia columna, para que el número se lea
 * junto a la columna que gobierna.
 */
function dibujarEncabezado(
  doc: jsPDF,
  p: {
    x: number
    y: number
    w: number
    obras: DistribucionPdfObra[]
    anchos: number[]
    m: MedidasEncabezado
  },
): void {
  const { x, y, w, obras, anchos, m } = p

  degradadoEncabezado(doc, x, y, w, m.alto)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(HEAD_FONT)
  doc.setTextColor(C.headTexto[0], C.headTexto[1], C.headTexto[2])

  const anchoFijos = anchos.slice(0, 5).reduce((s, v) => s + v, 0)

  // Fila 1 · "% Cuidar" y el % de cada obra social.
  doc.text('% Cuidar', x + 1.2, y + m.yFilaRotulos)
  obras.forEach((o, i) => {
    const previo = anchos.slice(5, 5 + i).reduce((s, v) => s + v, 0)
    doc.text(`${o.porcentaje}%`, x + anchoFijos + previo + anchos[5 + i]! - 1.2, y + m.yFilaRotulos, {
      align: 'right',
    })
  })

  // Fila 2 · rótulos de columna.
  let cx = x
  const escribir = (lineas: string[], ancho: number, align: 'left' | 'right') => {
    lineas.forEach((linea, i) => {
      const yBase = y + m.yFilaNombres + i * HEAD_LINE_H
      if (align === 'right') doc.text(linea, cx + ancho - 1.2, yBase, { align: 'right' })
      else doc.text(linea, cx + 1.2, yBase)
    })
    cx += ancho
  }

  m.lineasFijas.forEach((lineas, i) => escribir(lineas, anchos[i]!, i === 4 ? 'right' : 'left'))
  m.lineasObras.forEach((lineas, i) => escribir(lineas, anchos[5 + i]!, 'right'))
  escribir(
    doc.splitTextToSize('Total Médico', anchos[anchos.length - 1]! - 2.4) as string[],
    anchos[anchos.length - 1]!,
    'right',
  )

  // Línea inferior del encabezado.
  doc.setDrawColor(C.headLinea[0], C.headLinea[1], C.headLinea[2])
  doc.setLineWidth(0.5)
  doc.line(x, y + m.alto, x + w, y + m.alto)
}

/* ── Tabla ───────────────────────────────────────────────────────────────── */

/** Arma una tabla de la distribución (resumen o detalle). */
function tablaDistribucion(p: {
  doc: jsPDF
  pageW: number
  /** Sólo las obras de esta hoja; el resto va en las siguientes. */
  obras: DistribucionPdfObra[]
  filas: DistribucionObrasSocialesPdfRow[]
  titulo?: string
  startY: number
}): UserOptions {
  const { doc, pageW, obras, filas, titulo, startY } = p

  const PCT_COL_0 = 5
  const nObras = obras.length
  // Índice de la columna Total Médico: va en todas las hojas.
  const totalCol = PCT_COL_0 + nObras

  // Anchos en mm a partir de los porcentajes. Los porcentajes suman 100
  // exacto y se les deja el 1 % de holgura: con el ancho completo la última
  // columna se caía del área imprimible ("29 units width could not fit page").
  const tableW = pageW - MARGEN * 2
  // Los porcentajes suman 100 exacto, así que hay que dejarle 1 mm de holgura:
  // con el ancho completo la última columna se caía del área imprimible ("29
  // units width could not fit page"). Antes la holgura era del 1 % (2,8 mm) y
  // por eso el degradé del encabezado y las celdas quedaban desalineados.
  const anchoUtil = tableW - 1
  const pc = pctsDeColumna(pageW)
  const ocupado = pc.fecha + pc.medico + pc.paciente + pc.motivo + pc.monto + pc.total
  // La suma da 100 sólo cuando caben todas las obras en una hoja. Si la lista
  // se partió, cada hoja lleva su grupo y las columnas se reparten el ancho
  // sobrante, con el mínimo legible como piso.
  const disponible = 100 - ocupado
  // Reparto del espacio sobrante entre las obras de la hoja. Con el piso de
  // PCT_OS: como `nObras` nunca supera `obrasPorHoja()`, el reparto da igual o
  // más que ese piso, así que la suma siempre cierra en 100 y la tabla no se
  // sale de la hoja.
  const pctOs = nObras > 0 ? Math.max(disponible / nObras, PCT_OS) : 0
  const pcts = [
    pc.fecha, pc.medico, pc.paciente, pc.motivo, pc.monto,
    ...obras.map(() => pctOs),
    pc.total,
  ]
  const anchos = pcts.map((pct) => (anchoUtil * pct) / 100)

  // Encabezado medido y dibujado antes de la tabla, para que autoTable escriba
  // las filas de datos debajo y no encima.
  const headM = medirEncabezado(doc, obras, anchos)
  let cardTop = startY
  let headY = startY
  if (titulo) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(C.headTexto[0], C.headTexto[1], C.headTexto[2])
    doc.text(titulo, MARGEN, startY - 2)
    cardTop = startY - 6
    headY = startY + 1
  }
  // El degradé del encabezado mide `anchoUtil`, el mismo ancho que las celdas, y
  // no `tableW`: con el degradé al 100 % y las celdas al 99 % la última columna
  // (Total Médico) quedaba cortada ~2,7 mm antes del borde y su separador se
  // veía terminar en el aire. Alineados, ambos terminan en el mismo x.
  dibujarEncabezado(doc, { x: MARGEN, y: headY, w: anchoUtil, obras, anchos, m: headM })

  // El nombre del médico va en mayúsculas. En COMPLETO el paciente viene vacío
  // cuando ya lo trajo la fila anterior del mismo médico.
  const body = filas.map((r) => [
    r.fecha,
    r.medico.toUpperCase(),
    r.paciente,
    r.motivo,
    r.monto,
    ...r.porObraSocial,
    r.total,
  ])

  const sumMonto = filas.reduce((s, r) => s + parseMoney(r.monto), 0)
  const sumTotal = filas.reduce((s, r) => s + parseMoney(r.total), 0)
  const totalesRow = [
    'TOTALES',
    '', '', '',
    sumMonto > 0 ? formatMoney(sumMonto) : '',
    ...obras.map((_, i) => {
      const s = filas.reduce((acc, r) => acc + parseMoney(r.porObraSocial[i] ?? ''), 0)
      return s > 0 ? formatMoney(s) : ''
    }),
    sumTotal > 0 ? formatMoney(sumTotal) : '',
  ]

  const columnStyles: Record<number, Record<string, unknown>> = {}
  anchos.forEach((cw, i) => {
    columnStyles[i] = {
      cellWidth: cw,
      // Monto, obras sociales y total van a la derecha; el resto a la izquierda.
      halign: i >= 4 ? 'right' : 'left',
    }
  })

  return {
    // Ancho explícito en mm, no 'wrap': con 'wrap' y un cellWidth por columna
    // jsPDF-autoTableava el ancho pedido y la última se caía del área
    // imprimible ("29 units width could not fit page").
    tableWidth: anchoUtil,
    // La tabla arranca debajo de la banda de encabezado ya dibujada a mano.
    startY: headY + headM.alto + 1.5,
    margin: { left: MARGEN, right: MARGEN, bottom: 9 },
    // Sin encabezado propio: el de "% Cuidar" + nombres se dibuja a mano para
    // que el degradé no tape los rótulos, y se redibuja en cada hoja de
    // continuación desde `willDrawPage`.
    head: [],
    body: body.length
      ? body
      : [['Sin datos en el filtro actual', ...Array.from({ length: 4 + nObras + 1 }, () => '')]],
    foot: [totalesRow],
    theme: 'plain',
    styles: {
      font: 'helvetica',
      // A 10,5 pt la fecha "11-05-26" no entra en su columna de 14 mm y se partía en
      // dos renglones; en vertical el ancho útil bajó de 276 a 189 mm y todo se
      // aprieta. 9 pt entra en las seis columnas fijas.
      fontSize: tableW < 230 ? 9 : 10.5,
      // Padding justo: cada 0,5 mm por lado son ~14 mm de alto en una tabla de
      // 14 médicos, y eso es justo lo que separa "entra en una hoja" de "se
      // cae el último renglón solo a la página siguiente".
      cellPadding: { top: 1.1, bottom: 1.1, left: 1.4, right: 1.4 },
      textColor: [...C.texto],
      lineColor: [...C.lineaFila],
      lineWidth: 0.15,
      valign: 'middle',
      fillColor: [...C.blanco],
      // El texto largo se parte en varias líneas dentro de la celda en vez de
      // desbordar: la fila crece y nada se solapa. No se recorta con altura
      // máxima porque eso escondería parte del nombre, que es lo que sirve
      // para ubicar la fila.
      overflow: 'linebreak',
    },
    footStyles: {
      fillColor: [...C.footFondo],
      textColor: [...C.headTexto],
      fontStyle: 'bold',
      // En vertical la columna de Fecha queda en 16 mm y "TOTALES" a 9,5 pt
      // mide ~17 mm: se partía en "TOTALE / S". A 8 pt entra en una línea.
      fontSize: tableW < 230 ? 8 : 9.5,
      lineColor: [...C.headLinea],
      cellPadding: { top: 2, bottom: 2, left: 1.2, right: 1.2 },
    },
    columnStyles,
    didParseCell: (data) => {
      const { section, column, row } = data
      const i = column.index
      const par = row.index % 2 === 1

      if (section === 'foot') {
        if (i >= 4) data.cell.styles.halign = 'right'
        data.cell.styles.fillColor =
          i === totalCol ? [...C.footTotal] : [...C.footFondo]
        data.cell.styles.lineWidth = { top: 0.7 }
        if (i === totalCol) data.cell.styles.textColor = [...C.totalTexto]
        return
      }

      // Cuerpo.
      // Ni las columnas de obra social ni la de Total Médico llevan fondo
      // celeste: se leen por las líneas separadoras de cada registro. Antes se
      // pintaban con `sobre(base, C.osTinte, 22/38 %)` y `C.totalFondo`.
      const base: Rgb = par ? C.filaPar : C.blanco
      data.cell.styles.fillColor = [...base]
      if (i === totalCol) {
        // El importe va en negrita y con color para que se distinga al recorrer
        // la fila, pero sin relleno.
        data.cell.styles.textColor = [...C.totalTexto]
        data.cell.styles.fontStyle = 'bold'
      }
      if (i === 1) {
        // El médico es el único texto en semibold: es la columna que se lee
        // de arriba abajo para ubicar la fila.
        data.cell.styles.fontStyle = 'bold'
      }
    },
    willDrawPage: (data) => {
      // Hoja nueva: encabezado repetido, siempre antes de que la tabla escriba
      // la primera celda. Sin esto, al partirse la tabla las hojas 2..n quedan
      // sin títulos y sin los % de cada obra social.
      if (data.pageNumber > 1) {
        dibujarEncabezado(doc, { x: MARGEN, y: headY, w: anchoUtil, obras, anchos, m: headM })
      }
    },
    didDrawPage: (data) => {
      const cursor = (data as unknown as { cursor?: { y: number } }).cursor
      const bottom = cursor?.y ?? headY + headM.alto

      const cardH = Math.max(8, bottom - cardTop)

      // Tarjeta: sólo el borde, y del mismo ancho que las celdas y el degradé
      // (`anchoUtil`), para que la columna Total Médico llegue hasta el borde y
      // no quede un margen blanco a la derecha dentro de la tabla.
      doc.setDrawColor(C.tarjetaBorde[0], C.tarjetaBorde[1], C.tarjetaBorde[2])
      doc.setLineWidth(0.3)
      doc.roundedRect(MARGEN, cardTop, anchoUtil, cardH, TARJETA_R, TARJETA_R, 'S')

      // Y recién después, el blanco de las esquinas inferiores: las celdas del
      // pie llegan viva hasta el borde y tapan el arco del borde.
      taparEsquinasInferiores(doc, MARGEN, cardTop, anchoUtil, cardH, TARJETA_R)
    },
  }
}

/**
 * Degradé del encabezado: #C6E4FA → #B5DBF7 → #A3D0F3, en tres tramos.
 *
 * Sólo el fondo: los rótulos los dibuja `dibujarEncabezado` encima. Pintar el
 * degradé después de la tabla lo dejaba opaco sobre los títulos y los % y por
 * eso el encabezado salía vacío.
 */
function degradadoEncabezado(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  const t = h / 3
  // Los tres tramos van con el mismo paso fino. Con 40 tiras sobre 277 mm cada
  // franja mide ~7 mm y el degradé se ve escalonado: se leen bandas verticales
  // de un tono al lado del otro, sobre todo al pasar de un tramo al siguiente,
  // que es donde el salto de color es mayor.
  const pasos = 480
  // Sólo el tramo de arriba lleva el radio: es el único que toca las esquinas
  // superiores de la tarjeta. Los otros dos son franjas rectas en el medio.
  degradadoHArribaRedondeado(doc, x, y, w, t, TARJETA_R, C.headDe, C.headMedio)
  degradadoH(doc, x, y + t, w, t, C.headMedio, mezcla(C.headMedio, C.headA, 0.5), pasos)
  degradadoH(doc, x, y + 2 * t, w, t, mezcla(C.headMedio, C.headA, 0.5), C.headA, pasos)

  doc.setDrawColor(C.headLinea[0], C.headLinea[1], C.headLinea[2])
  doc.setLineWidth(0.5)
  doc.line(x, y + h, x + w, y + h)
}

/**
 * Pie: período y médicos a la izquierda, "Página x de y" al centro y la fecha
 * de generación a la derecha.
 */
function pieDeHoja(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  pagina: number,
  total: number,
  ctx: { periodText: string; medicosResumen: number; footerLabel?: string },
): void {
  const y = pageH - 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(C.pie[0], C.pie[1], C.pie[2])

  const partes = [`Período ${ctx.periodText}`, `${ctx.medicosResumen} médicos`]
  if (ctx.footerLabel) partes.push(ctx.footerLabel)
  doc.text(partes.join(' · '), MARGEN, y)

  if (total > 1) {
    doc.text(`Página ${pagina} de ${total}`, pageW / 2, y, { align: 'center' })
  }

  doc.text(
    `Generado el ${format(new Date(), 'dd/MM/yyyy', { locale: es })}`,
    pageW - MARGEN,
    y,
    { align: 'right' },
  )
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
