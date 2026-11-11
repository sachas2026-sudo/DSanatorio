import jsPDF from 'jspdf'
import { format } from 'date-fns'
import type { Afiliado, Patient, PlanAfiliado } from '../types'
import { getPdfLogo } from './pdfLogo'

export interface BuildAfiliadosListadoPdfParams {
  afiliados: Afiliado[]
  planes: PlanAfiliado[]
  patients: Patient[]
  planFiltroId?: string | null
  fechaGeneracion?: Date
  centroNombre?: string
}

export interface BuildAfiliadosListadoPdfResult {
  doc: jsPDF
  filename: string
  totalPersonas: number
  totalFamilias: number
  totalPlanes: number
}

function formatFechaAr(fechaStr?: string | null): string {
  if (!fechaStr) return '—'
  const clean = fechaStr.split('T')[0].trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean)
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`
  }
  return clean || '—'
}

interface ItemFila {
  esTitular: boolean
  apellido: string
  nombre: string
  nombreCompleto: string
  dni: string
  fechaNacimiento: string
  relacion: string
  desde: string
}

interface GrupoFamilia {
  afiliado: Afiliado
  titular: ItemFila
  adherentes: ItemFila[]
  totalIntegrantes: number
}

interface SeccionPlan {
  plan: PlanAfiliado
  familias: GrupoFamilia[]
  totalPersonas: number
}

export function buildAfiliadosListadoPdf({
  afiliados,
  planes,
  patients,
  planFiltroId,
  fechaGeneracion = new Date(),
  centroNombre = 'SANATORIO',
}: BuildAfiliadosListadoPdfParams): BuildAfiliadosListadoPdfResult {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210
  const pageH = 297
  const margin = 14
  const contentW = pageW - margin * 2
  const maxPageY = pageH - 18 // Espacio antes del pie
  const logoCache = getPdfLogo()

  const patientsMap = new Map<string, Patient>()
  patients.forEach((p) => patientsMap.set(p.id, p))

  // 1. Filtrar afiliados activos según el filtro de plan seleccionado
  const afiliadosActivos = afiliados.filter((a) => {
    if (!a.activo) return false
    if (planFiltroId && a.planId !== planFiltroId) return false
    return true
  })

  // 2. Agrupar por plan respetando el orden de la pantalla
  const planesMap = new Map<string, PlanAfiliado>()
  planes.forEach((p) => planesMap.set(p.id, p))

  // Identificar los planes a listar
  const planesAProcesar = planes.filter((p) => {
    if (planFiltroId && p.id !== planFiltroId) return false
    return true
  })

  const secciones: SeccionPlan[] = []
  let globalTotalPersonas = 0
  let globalTotalFamilias = 0

  for (const plan of planesAProcesar) {
    const afilsDelPlan = afiliadosActivos.filter((a) => a.planId === plan.id)
    if (afilsDelPlan.length === 0) continue

    const familias: GrupoFamilia[] = []

    for (const a of afilsDelPlan) {
      const titularPac = patientsMap.get(a.patientId)
      const apellidoTitular = (titularPac?.apellido || '—').trim()
      const nombreTitular = (titularPac?.nombre || '—').trim()
      const nombreCompletoTitular = titularPac
        ? `${apellidoTitular}, ${nombreTitular}`
        : 'Contratante Titular'

      const titularFila: ItemFila = {
        esTitular: true,
        apellido: apellidoTitular,
        nombre: nombreTitular,
        nombreCompleto: nombreCompletoTitular,
        dni: titularPac?.dni ? titularPac.dni.trim() : '—',
        fechaNacimiento: formatFechaAr(titularPac?.fechaNacimiento),
        relacion: 'Titular',
        desde: formatFechaAr(a.fechaInicio),
      }

      const adherentesFilas: ItemFila[] = []
      if (Array.isArray(a.adherentes)) {
        for (const adh of a.adherentes) {
          const adhPac = patientsMap.get(adh.patientId)
          const apellidoAdh = (adhPac?.apellido || '—').trim()
          const nombreAdh = (adhPac?.nombre || '—').trim()
          const nombreCompletoAdh = adhPac
            ? `${apellidoAdh}, ${nombreAdh}`
            : 'Adherente'

          adherentesFilas.push({
            esTitular: false,
            apellido: apellidoAdh,
            nombre: nombreAdh,
            nombreCompleto: nombreCompletoAdh,
            dni: adhPac?.dni ? adhPac.dni.trim() : '—',
            fechaNacimiento: formatFechaAr(adhPac?.fechaNacimiento),
            relacion: adh.relacion || 'Adherente',
            desde: '—',
          })
        }
      }

      // Ordenar adherentes por apellido y nombre
      adherentesFilas.sort((x, y) =>
        x.nombreCompleto.localeCompare(y.nombreCompleto, 'es', { sensitivity: 'base' }),
      )

      familias.push({
        afiliado: a,
        titular: titularFila,
        adherentes: adherentesFilas,
        totalIntegrantes: 1 + adherentesFilas.length,
      })
    }

    // Ordenar familias dentro del plan por apellido y nombre del titular
    familias.sort((x, y) =>
      x.titular.nombreCompleto.localeCompare(y.titular.nombreCompleto, 'es', {
        sensitivity: 'base',
      }),
    )

    const personasEnPlan = familias.reduce((sum, f) => sum + f.totalIntegrantes, 0)
    secciones.push({
      plan,
      familias,
      totalPersonas: personasEnPlan,
    })

    globalTotalPersonas += personasEnPlan
    globalTotalFamilias += familias.length
  }

  // ── Layout de columnas ──
  // contentW = 182 mm
  const colW = {
    nombre: 66,
    dni: 24,
    nacimiento: 28,
    relacion: 28,
    desde: 36,
  }
  const colX = {
    nombre: margin,
    dni: margin + colW.nombre,
    nacimiento: margin + colW.nombre + colW.dni,
    relacion: margin + colW.nombre + colW.dni + colW.nacimiento,
    desde: margin + colW.nombre + colW.dni + colW.nacimiento + colW.relacion,
  }

  let curY = margin

  function dibujarEncabezadoPrincipal() {
    curY = margin

    // 1. Logo
    if (logoCache?.dataUrl) {
      const imgH = 14
      const imgW = imgH * (logoCache.aspect || 1.3)
      try {
        doc.addImage(logoCache.dataUrl, logoCache.format, margin, curY, imgW, imgH)
      } catch {
        // Fallback sin logo
      }
    }

    // 2. Nombre del Centro
    doc.setTextColor(15, 23, 42) // slate-900
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12.5)
    doc.text(centroNombre, margin + 22, curY + 5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139) // slate-500
    doc.text('Cobertura de Salud · Sistema de Contratantes', margin + 22, curY + 9.5)

    // 3. Info a la derecha (Fecha y Total)
    const fechaStrHeader = format(fechaGeneracion, 'dd/MM/yyyy')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)
    doc.text(fechaStrHeader, pageW - margin, curY + 5, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(14, 116, 144) // cyan-700
    const personasTxt = `${globalTotalPersonas} persona${globalTotalPersonas === 1 ? '' : 's'}`
    doc.text(personasTxt, pageW - margin, curY + 10, { align: 'right' })

    // 4. Título grande
    curY += 17
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(15, 23, 42)
    doc.text('Contratantes y adherentes', margin, curY)

    // 5. Línea fina que cierra el encabezado
    curY += 3.5
    doc.setDrawColor(51, 65, 85) // slate-700
    doc.setLineWidth(0.4)
    doc.line(margin, curY, pageW - margin, curY)
    curY += 2
  }

  function dibujarTitulosColumnas() {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139) // slate-500

    const textY = curY + 3.8
    doc.text('APELLIDO Y NOMBRE', colX.nombre, textY)
    doc.text('DNI', colX.dni, textY)
    doc.text('F. NACIMIENTO', colX.nacimiento, textY)
    doc.text('RELACIÓN', colX.relacion, textY)
    doc.text('DESDE', colX.desde, textY)

    curY += 5.5
    doc.setDrawColor(203, 213, 225) // slate-300
    doc.setLineWidth(0.2)
    doc.line(margin, curY, pageW - margin, curY)
    curY += 2
  }

  function nuevaPagina() {
    doc.addPage()
    dibujarEncabezadoPrincipal()
    dibujarTitulosColumnas()
  }

  // Medir altura de una fila
  function calcularAlturaFila(item: ItemFila, indent: number): number {
    const maxWidth = colW.nombre - indent - 2
    const lines = doc.splitTextToSize(item.nombreCompleto, maxWidth)
    return lines.length > 1 ? 9.5 : 6.8
  }

  function dibujarFila(item: ItemFila, indent: number): number {
    const filaH = calcularAlturaFila(item, indent)
    const textY = curY + 4.2

    // Nombre y Apellido
    const maxWidth = colW.nombre - indent - 2
    const lines = doc.splitTextToSize(item.nombreCompleto, maxWidth)

    doc.setFont('helvetica', item.esTitular ? 'bold' : 'normal')
    doc.setFontSize(item.esTitular ? 8.2 : 8)
    doc.setTextColor(item.esTitular ? 15 : 51, item.esTitular ? 23 : 65, item.esTitular ? 42 : 85)

    if (lines.length > 1) {
      doc.text(lines[0], colX.nombre + indent, textY - 1)
      doc.text(lines[1], colX.nombre + indent, textY + 2.8)
    } else {
      doc.text(item.nombreCompleto, colX.nombre + indent, textY)
    }

    // DNI
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(30, 41, 59)
    doc.text(item.dni, colX.dni, textY)

    // F. Nacimiento
    doc.text(item.fechaNacimiento, colX.nacimiento, textY)

    // Relación
    if (item.esTitular) {
      doc.setTextColor(100, 116, 139) // slate-500
      doc.setFont('helvetica', 'normal')
    } else {
      doc.setTextColor(14, 116, 144) // cyan-700
      doc.setFont('helvetica', 'normal')
    }
    doc.text(item.relacion, colX.relacion, textY)

    // Desde
    doc.setTextColor(71, 85, 105)
    doc.setFont('helvetica', 'normal')
    doc.text(item.desde, colX.desde, textY)

    curY += filaH

    // Línea fina gris separadora
    doc.setDrawColor(241, 245, 249) // slate-100 / slate-200 muy suave
    doc.setLineWidth(0.12)
    doc.line(margin + indent, curY, pageW - margin, curY)
    curY += 1

    return filaH
  }

  // Iniciar primera página
  dibujarEncabezadoPrincipal()
  dibujarTitulosColumnas()

  // 3. Imprimir secciones
  for (const sec of secciones) {
    const esFamiliar = sec.plan.tipo === 'familiar'
    const tituloPlan = sec.plan.nombre.toUpperCase()

    // Conteo del plan
    let conteoTexto = ''
    if (esFamiliar) {
      const cantFam = sec.familias.length
      const cantPers = sec.totalPersonas
      conteoTexto = `${cantFam} familia${cantFam !== 1 ? 's' : ''} · ${cantPers} persona${cantPers !== 1 ? 's' : ''}`
    } else {
      conteoTexto = `${sec.totalPersonas} contratante${sec.totalPersonas !== 1 ? 's' : ''}`
    }

    // Espacio necesario para la cabecera del plan + al menos una familia
    const minEspacio = 18
    if (curY + minEspacio > maxPageY) {
      nuevaPagina()
    }

    // Cabecera de la sección del plan
    curY += 3
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(8, 145, 178) // cyan-600
    doc.text(tituloPlan, margin, curY + 3.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    doc.text(conteoTexto, pageW - margin, curY + 3.5, { align: 'right' })

    curY += 5
    doc.setDrawColor(186, 230, 253) // sky-200
    doc.setLineWidth(0.3)
    doc.line(margin, curY, pageW - margin, curY)
    curY += 2

    // Imprimir familias
    for (const fam of sec.familias) {
      // Calcular altura total de la familia (titular + adherentes)
      const hTitular = calcularAlturaFila(fam.titular, 0)
      const hAdherentes = fam.adherentes.reduce(
        (sum, adh) => sum + calcularAlturaFila(adh, 5),
        0,
      )
      const alturaFamilia = hTitular + hAdherentes + (fam.totalIntegrantes * 1)

      // Si la familia completa cabe en una página limpia pero no en el espacio actual, saltar de página
      if (curY + alturaFamilia > maxPageY && alturaFamilia < (maxPageY - 50)) {
        nuevaPagina()
      }

      // Dibujar Titular
      if (curY + hTitular > maxPageY) {
        nuevaPagina()
      }
      dibujarFila(fam.titular, 0)

      // Dibujar Adherentes (sangrados 5 mm)
      for (const adh of fam.adherentes) {
        const hAdh = calcularAlturaFila(adh, 5)
        if (curY + hAdh > maxPageY) {
          nuevaPagina()
        }
        dibujarFila(adh, 5)
      }
    }

    curY += 3 // Separación entre planes
  }

  // 4. Pie de página en todas las hojas (segunda pasada)
  const totalPages = doc.getNumberOfPages()
  const fechaPie = format(fechaGeneracion, 'dd-MM-yyyy')

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)

    // Línea fina sobre el pie
    doc.setDrawColor(226, 232, 240) // slate-200
    doc.setLineWidth(0.2)
    doc.line(margin, pageH - 12, pageW - margin, pageH - 12)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(148, 163, 184) // slate-400

    // Izquierda
    doc.text('Sanatorio — Listado de contratantes y adherentes', margin, pageH - 7.5)

    // Derecha
    const pagTxt = `Generado el ${fechaPie} · Página ${p} de ${totalPages}`
    doc.text(pagTxt, pageW - margin, pageH - 7.5, { align: 'right' })
  }

  const fechaFile = format(fechaGeneracion, 'yyyy-MM-dd')
  const filename = `listado_afiliados_${fechaFile}.pdf`

  return {
    doc,
    filename,
    totalPersonas: globalTotalPersonas,
    totalFamilias: globalTotalFamilias,
    totalPlanes: secciones.length,
  }
}

