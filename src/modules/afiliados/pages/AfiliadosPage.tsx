import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useAppState } from '../../../context/AppStateContext'
import { useAuth } from '../../../context/AuthContext'
import { useConfirm } from '../../../context/ConfirmContext'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { pdfBlobUrl, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { buildAfiliadosPagosPdf } from '../../../lib/afiliadosPagosPdf'
import { buildAfiliadoComprobantePdf } from '../../../lib/afiliadoComprobantePdf'
import { buildAfiliadosListadoPdf } from '../../../lib/afiliadosListadoPdf'
import { buildOrdenesEmitidasListadoPdf } from '../../../lib/ordenesEmitidasListadoPdf'
import { preloadPdfHeaderBanner } from '../../../lib/pdfHeaderBanner'
import { preloadPdfLogo } from '../../../lib/pdfLogo'
import { preloadReciboLogo } from '../../../lib/reciboPdf'
import { NuevaOrdenMedicaModal } from '../components/NuevaOrdenMedicaModal'
import {
  CambiarCoberturaModal,
  DarDeBajaContratanteModal,
  SuspenderContratanteModal,
} from '../components/AccionesContratanteModals'
import { TitularCombobox } from '../components/TitularCombobox'
import type jsPDF from 'jspdf'
import { pacientesActivos } from '../../../lib/activo'
import { afiliadoTieneCuotasImpagas, consumoPlanDelMes } from '../../../lib/cobertura'
import { calcularConsumoAfiliadoMes } from '../../../lib/consumoAfiliados'
import {
  esContratanteDadoDeBaja,
  esContratanteSuspendido,
  formatearFechaLatina,
} from '../../../lib/contratantesMovimientos'
import { createId } from '../../../lib/id'
import { registrarContratanteConPacienteNuevoBackend } from '../../../lib/afiliadoPacienteNuevo'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Afiliado, PlanAfiliado, CuotaMensual, Patient, TipoPlanAfiliado, RelacionTitular } from '../../../types'
import { IconPrinter, IconTrash, IconWhatsApp } from '../../../shared/components/icons'
import { DetalleContratanteCuotas } from '../components/DetalleContratanteCuotas'
import type { AdherenteDetalleItem } from '../components/useDetalleContratante'
import '../../../shared/styles/pages.css'
import './AfiliadosModern.css'

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

const PLANES_DEFAULT: Omit<PlanAfiliado, 'id'>[] = [
  { nombre: 'Plan Individual', tipo: 'individual', precio: 0, descripcion: '', activo: true, cupoConsultas: 2, prestacionesPorMes: 2, maxAdherentes: 0 },
  { nombre: 'Plan Familiar',   tipo: 'familiar',   precio: 0, descripcion: '', activo: true, cupoConsultas: 2, prestacionesPorMes: 2, maxAdherentes: 0 },
]

export type AdherenteDraft = {
  id: string
  dni: string
  fechaNacimiento: string
  apellido: string
  nombre: string
  relacion: RelacionTitular
  pacienteExistenteId?: string
  pacienteExistenteNombre?: string
}

function estadoColor(estado: CuotaMensual['estado']): string {
  if (estado === 'pagado')   return '#16a34a'
  return '#d97706'
}
function estadoLabel(estado: CuotaMensual['estado']): string {
  if (estado === 'pagado')  return 'Pagado'
  return 'Pendiente'
}



/** Chevron de la fila expandible (SVG en línea para no depender del set de iconos). */
function Caret({ abierto }: { abierto: boolean }) {
  return (
    <svg
      className={`af-caret${abierto ? ' af-caret--open' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

function Lupa() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  )
}

type ModalAbierto = 'plan' | 'afiliar' | 'ordenMedica' | null

export function AfiliadosPage() {
  const {
    data,
    upsertPlanAfiliado,
    deletePlanAfiliado,
    upsertAfiliado,
    deleteAfiliado,
    afiliarConSincronizacion,
    registrarContratanteConPacienteNuevoState,
    quitarAdherente,
    cambiarCoberturaContratante,
    cancelarCambioProgramadoContratante,
    suspenderContratante,
    reactivarContratante,
    darDeBajaContratante,
    upsertCuotaMensual,
  } = useAppState()
  const { session } = useAuth()
  const { confirm } = useConfirm()

  const usuarioActualNombre = session?.displayName || session?.username || 'Administración'

  const hoy = new Date()

  // ── Estado de presentación (nuevo diseño) ──────────────────────────
  const [modal, setModal] = useState<ModalAbierto>(null)      // qué formulario está abierto
  const [planFiltro, setPlanFiltro] = useState<string | null>(null) // plan activo del filtro
  const [expandidoId, setExpandidoId] = useState<string | null>(null) // fila desplegada
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null) // afiliado seleccionado en la tabla para orden médica
  const [reportesMenuOpen, setReportesMenuOpen] = useState(false)
  const menuReportesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!reportesMenuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuReportesRef.current && !menuReportesRef.current.contains(e.target as Node)) {
        setReportesMenuOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setReportesMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [reportesMenuOpen])

  const [search, setSearch] = useState('')
  const [cuotaAnio, setCuotaAnio] = useState(hoy.getFullYear())
  const [pagoDrafts, setPagoDrafts] = useState<Record<string, { formaPago: NonNullable<CuotaMensual['formaPago']>; comprobante: boolean }>>({})
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
    hidePrint?: boolean
  } | null>(null)

  useEffect(() => {
    void preloadPdfLogo()
    void preloadReciboLogo()
  }, [])

  // Planes
  const [planForm, setPlanForm] = useState<{
    id?: string
    nombre: string
    tipo: TipoPlanAfiliado
    precio: number
    descripcion: string
    activo: boolean
    cupoConsultas: number
    prestacionesPorMes: number
    maxAdherentes: number
  }>({
    nombre: 'Plan Individual',
    tipo: 'individual',
    precio: 0,
    descripcion: '',
    activo: true,
    cupoConsultas: 2,
    prestacionesPorMes: 2,
    maxAdherentes: 0,
  })

  // Afiliado form
  const [afilForm, setAfilForm] = useState<{
    patientId: string
    planId: string
    fechaInicio: string
    adherentes: AdherenteDraft[]
  }>({
    patientId: '',
    planId: '',
    fechaInicio: format(hoy, 'yyyy-MM-dd'),
    adherentes: [],
  })
  const [afilMsg, setAfilMsg] = useState<string | null>(null)

  // Estados para nuevo paciente en Registrar contratante
  const [nuevoDni, setNuevoDni] = useState('')
  const [nuevoFechaNacimiento, setNuevoFechaNacimiento] = useState('')
  const [nuevoApellido, setNuevoApellido] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{
    dni?: string
    fechaNacimiento?: string
    apellido?: string
    nombre?: string
    fechaInicio?: string
    planId?: string
  }>({})
  const [exitoMsg, setExitoMsg] = useState<string | null>(null)
  const [guardandoNuevo, setGuardandoNuevo] = useState(false)
  const dniInputRef = useRef<HTMLInputElement>(null)

  // Estados para acciones sobre contratante (Cambiar cobertura, Suspender, Dar de baja, Ver dados de baja, Toast)
  const [verDadosDeBaja, setVerDadosDeBaja] = useState(false)
  const [accionModal, setAccionModal] = useState<{
    tipo: 'cambiarCobertura' | 'suspender' | 'baja'
    afiliadoId: string
  } | null>(null)
  const [toastAviso, setToastAviso] = useState<string | null>(null)

  useEffect(() => {
    if (!toastAviso) return
    const timer = window.setTimeout(() => setToastAviso(null), 7000)
    return () => window.clearTimeout(timer)
  }, [toastAviso])

  function limpiarModalAfiliar() {
    setAfilMsg(null)
    setNuevoDni('')
    setNuevoFechaNacimiento('')
    setNuevoApellido('')
    setNuevoNombre('')
    setFieldErrors({})
    setAfilForm({
      patientId: '',
      planId: (data.planesAfiliados?.filter(p => p.activo) ?? [])[0]?.id ?? '',
      fechaInicio: format(hoy, 'yyyy-MM-dd'),
      adherentes: [],
    })
  }

  function abrirModalAfiliar() {
    limpiarModalAfiliar()
    setModal('afiliar')
  }

  function cerrarModalAfiliar() {
    setModal(null)
    limpiarModalAfiliar()
  }

  // Todos los planes (incluidos inactivos) para poder administrarlos
  const todosLosPlanes = useMemo(() => data.planesAfiliados ?? [], [data.planesAfiliados])
  const planes = useMemo(() => todosLosPlanes.filter(p => p.activo), [todosLosPlanes])
  const afiliados = useMemo(() => data.afiliados ?? [], [data.afiliados])
  const cuotas = useMemo(() => data.cuotasAfiliados ?? [], [data.cuotasAfiliados])
  const pacientes = useMemo(() => pacientesActivos(data.patients), [data.patients])

  // Todos los pacientes que ya forman parte de un plan activo (titulares o adherentes)
  const todosLosAfiliadosPatientIds = useMemo(() => {
    const s = new Set<string>()
    for (const a of afiliados) {
      if (esContratanteDadoDeBaja(a)) continue
      s.add(a.patientId)
      if (Array.isArray(a.adherentes)) {
        for (const adh of a.adherentes) {
          s.add(adh.patientId)
        }
      }
    }
    return s
  }, [afiliados])

  const motivosNoElegibleTitular = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of afiliados) {
      if (esContratanteDadoDeBaja(a)) continue
      const planNombre = todosLosPlanes.find(p => p.id === a.planId)?.nombre ?? 'Plan activo'
      m.set(a.patientId, `Ya es titular (${planNombre})`)
      if (Array.isArray(a.adherentes)) {
        for (const adh of a.adherentes) {
          if (!m.has(adh.patientId)) {
            m.set(adh.patientId, `Ya es adherente (${planNombre})`)
          }
        }
      }
    }
    return m
  }, [afiliados, todosLosPlanes])

  // Cuántos afiliados tiene cada plan (para las tarjetas): titulares + adherentes
  const conteoPorPlan = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of afiliados) {
      if (esContratanteDadoDeBaja(a)) continue
      const nAdh = Array.isArray(a.adherentes) ? a.adherentes.length : 0
      m.set(a.planId, (m.get(a.planId) ?? 0) + 1 + nAdh)
    }
    return m
  }, [afiliados])

  // Total global de afiliados (titulares + adherentes)
  const totalAfiliadosCount = useMemo(() => {
    return afiliados.reduce((sum, a) => {
      if (esContratanteDadoDeBaja(a)) return sum
      return sum + 1 + (a.adherentes?.length ?? 0)
    }, 0)
  }, [afiliados])

  const dadosDeBajaCount = useMemo(() => {
    return afiliados.filter(a => esContratanteDadoDeBaja(a)).length
  }, [afiliados])

  // ──.selected: la fila desplegada ───────────────────────────────────
  const selectedAfiliado = afiliados.find(a => a.id === expandidoId) ?? null
  const selectedPaciente: Patient | null = selectedAfiliado ? (pacientes.find(p => p.id === selectedAfiliado.patientId) ?? null) : null
  const selectedPlan: PlanAfiliado | null = selectedAfiliado ? (todosLosPlanes.find(p => p.id === selectedAfiliado.planId) ?? null) : null

  const selectedPacienteOrden = useMemo(() => {
    if (!selectedPatientId) return null
    return (data.patients ?? []).find(p => p.id === selectedPatientId) ?? null
  }, [selectedPatientId, data.patients])

  const selectedAfiliadoParaOrden = useMemo(() => {
    if (!selectedPatientId) return null
    return (
      (data.afiliados ?? []).find(a => a.patientId === selectedPatientId && !esContratanteDadoDeBaja(a)) ??
      (data.afiliados ?? []).find(a => a.patientId === selectedPatientId) ??
      null
    )
  }, [selectedPatientId, data.afiliados])

  const selectedPlanParaOrden = useMemo(() => {
    if (!selectedAfiliadoParaOrden) return null
    return todosLosPlanes.find(p => p.id === selectedAfiliadoParaOrden.planId) ?? null
  }, [selectedAfiliadoParaOrden, todosLosPlanes])

  const selectedEsDadoDeBaja = useMemo(() => {
    return selectedAfiliadoParaOrden ? esContratanteDadoDeBaja(selectedAfiliadoParaOrden) : false
  }, [selectedAfiliadoParaOrden])

  const selectedEsSuspendido = useMemo(() => {
    return selectedAfiliadoParaOrden ? esContratanteSuspendido(selectedAfiliadoParaOrden) : false
  }, [selectedAfiliadoParaOrden])

  const adherentesNombres = useMemo(() => {
    if (!selectedAfiliadoParaOrden?.adherentes || selectedAfiliadoParaOrden.adherentes.length === 0) {
      return []
    }
    const patientsMap = new Map((data.patients ?? []).map(p => [p.id, p]))
    return selectedAfiliadoParaOrden.adherentes
      .map(adh => {
        const p = patientsMap.get(adh.patientId)
        if (!p) return null
        const ap = p.apellido?.trim() || ''
        const nom = p.nombre?.trim() || ''
        if (ap && nom) return `${ap.toUpperCase()}, ${nom.toUpperCase()}`
        return (ap || nom).toUpperCase()
      })
      .filter((n): n is string => Boolean(n))
  }, [selectedAfiliadoParaOrden, data.patients])

  useEffect(() => () => {
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
  }, [pdfPreview?.url])

  function closePdfPreview() {
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview(null)
    pdfDocRef.current = null
  }

  // ══════════════════════════════════════════════════════════════════
  //  PDF  (lógica sin cambios respecto de la versión anterior)
  // ══════════════════════════════════════════════════════════════════
  async function handlePdfPreview(scope: 'selected' | 'all') {
    if (scope === 'selected' && !selectedAfiliado) return
    await preloadPdfHeaderBanner()
    const afiliadosParaPdf = scope === 'selected' && selectedAfiliado ? [selectedAfiliado] : afiliados
    const pacienteNombre = selectedPaciente ? `${selectedPaciente.apellido}, ${selectedPaciente.nombre}` : ''
    const pacienteDni = selectedPaciente?.dni ? ` - DNI ${selectedPaciente.dni}` : ''
    const mesArchivo = format(hoy, 'MMMM', { locale: es })
    const periodoArchivo = `${mesArchivo.charAt(0).toUpperCase()}${mesArchivo.slice(1)} ${cuotaAnio}`
    const nombreArchivoAfiliado = selectedPaciente
      ? `${selectedPaciente.apellido} ${selectedPaciente.nombre} ${periodoArchivo}.pdf`
      : `pagos-contratante-${cuotaAnio}.pdf`
    const cuotasParaPdf = cuotas.map(cuota => {
      if (cuota.estado !== 'pagado' || cuota.anio !== cuotaAnio) return cuota
      const draft = pagoDrafts[`${cuota.afiliadoId}:${cuota.anio}:${cuota.mes}`]
      return draft
        ? { ...cuota, formaPago: draft.formaPago, comprobante: draft.comprobante }
        : cuota
    })
    const built = buildAfiliadosPagosPdf({
      patients: data.patients,
      afiliados: afiliadosParaPdf,
      planes: data.planesAfiliados ?? [],
      cuotas: cuotasParaPdf,
      anio: cuotaAnio,
      titulo: 'CENTRO MEDICO - COBERTURA DE SALUD',
      encabezadoSecundario: scope === 'selected'
        ? `${pacienteNombre}${pacienteDni}`
        : `Todos los contratantes - ${afiliadosParaPdf.length} pacientes`,
      filename: scope === 'selected'
        ? nombreArchivoAfiliado
        : `lista-contratantes-pagos-${cuotaAnio}.pdf`,
    })
    pdfDocRef.current = built.doc
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: scope === 'selected'
        ? `Pagos del contratante ${cuotaAnio}`
        : `Contratantes y pagos ${cuotaAnio} (${built.count})`,
    })
  }

  async function handlePdfDownload() {
    if (!pdfDocRef.current || !pdfPreview?.filename) return
    await savePdfFile(pdfDocRef.current, pdfPreview.filename)
  }

  async function handleComprobantePago(cuota: CuotaMensual, nombreMes: string) {
    if (!selectedPaciente || !selectedAfiliado) return
    await preloadReciboLogo()
    const built = buildAfiliadoComprobantePdf({
      patient: selectedPaciente,
      plan: selectedPlan ?? undefined,
      cuota,
      nombreMes,
    })
    pdfDocRef.current = built.doc
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: `Comprobante de pago - ${nombreMes} ${cuota.anio}`,
    })
  }

  async function handleWhatsAppComprobante(cuota: CuotaMensual, nombreMes: string) {
    if (!selectedPaciente || !selectedAfiliado) return
    const nombre = `${selectedPaciente.nombre} ${selectedPaciente.apellido}`.trim()
    const importe = cuota.monto.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    const mensaje = `Hola ${nombre}, te enviamos el comprobante de pago de la cuota de ${nombreMes} ${cuota.anio}. Importe: ${importe}.`
    try {
      const { openWhatsAppUrl } = await import('../../../lib/whatsapp')
      await openWhatsAppUrl(selectedPaciente.telefono, mensaje)
    } catch {
      window.alert('El paciente no tiene un número de teléfono válido para WhatsApp.')
    }
  }

  async function handleImprimirComprobante(cuota: CuotaMensual, nombreMes: string) {
    if (!selectedPaciente || !selectedAfiliado) return
    await preloadReciboLogo()
    const built = buildAfiliadoComprobantePdf({
      patient: selectedPaciente,
      plan: selectedPlan ?? undefined,
      cuota,
      nombreMes,
    })
    const url = pdfBlobUrl(built.doc)
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.border = '0'
    frame.style.opacity = '0'
    frame.src = url
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      window.setTimeout(() => {
        frame.remove()
        URL.revokeObjectURL(url)
      }, 60_000)
    }
    document.body.appendChild(frame)
  }

  async function handlePdfDeudores() {
    await preloadPdfHeaderBanner()
    const deudores = afiliados.filter(a => isDeudor(a.id))
    const built = buildAfiliadosPagosPdf({
      patients: data.patients,
      afiliados: deudores,
      planes: data.planesAfiliados ?? [],
      cuotas,
      anio: cuotaAnio,
      titulo: 'CENTRO MEDICO - COBERTURA DE SALUD',
      encabezadoSecundario: `Contratantes con deuda - ${deudores.length} paciente${deudores.length !== 1 ? 's' : ''}`,
      filename: `contratantes-deudores-${cuotaAnio}.pdf`,
      showSinglePatientDetails: false,
    })
    pdfDocRef.current = built.doc
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: `Deudores ${cuotaAnio} (${deudores.length})`,
    })
  }

  async function handlePdfAlDia() {
    await preloadPdfHeaderBanner()
    const alDia = afiliados.filter(a => !isDeudor(a.id))
    const built = buildAfiliadosPagosPdf({
      patients: data.patients,
      afiliados: alDia,
      planes: data.planesAfiliados ?? [],
      cuotas,
      anio: cuotaAnio,
      titulo: 'CENTRO MEDICO - COBERTURA DE SALUD',
      encabezadoSecundario: `Contratantes al día - ${alDia.length} paciente${alDia.length !== 1 ? 's' : ''}`,
      filename: `contratantes-al-dia-${cuotaAnio}.pdf`,
      showSinglePatientDetails: false,
    })
    pdfDocRef.current = built.doc
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: `Al día ${cuotaAnio} (${alDia.length})`,
    })
  }

  async function handlePdfListado() {
    await preloadPdfLogo()
    const built = buildAfiliadosListadoPdf({
      afiliados: data.afiliados ?? [],
      planes: todosLosPlanes,
      patients: data.patients ?? [],
      planFiltroId: planFiltro,
    })

    if (built.totalPersonas === 0) {
      window.alert('No hay contratantes para listar')
      return
    }

    pdfDocRef.current = built.doc
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: `Listado de contratantes y adherentes (${built.totalPersonas} personas)`,
    })
    await savePdfFile(built.doc, built.filename)
  }

  async function handlePdfOrdenesEmitidas() {
    await preloadPdfLogo()
    const built = buildOrdenesEmitidasListadoPdf({
      ordenes: data.ordenesMedicas ?? [],
      patients: data.patients ?? [],
      centroNombre: 'SANATORIO',
    })

    pdfDocRef.current = built.doc
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: `Listado de Órdenes Médicas Emitidas (${built.totalOrdenes} órdenes)`,
    })
  }

  // ══════════════════════════════════════════════════════════════════
  //  Filtrado de la tabla (búsqueda + plan + dados de baja)
  // ══════════════════════════════════════════════════════════════════
  const filteredAfiliados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return afiliados.filter(a => {
      const dadoDeBaja = esContratanteDadoDeBaja(a)
      if (!verDadosDeBaja && dadoDeBaja && a.id !== expandidoId) return false
      if (planFiltro && a.planId !== planFiltro) return false
      const p = pacientes.find(x => x.id === a.patientId) ?? data.patients.find(x => x.id === a.patientId)
      if (!p) return false
      if (!q) return true
      if (
        p.nombre.toLowerCase().includes(q) ||
        p.apellido.toLowerCase().includes(q) ||
        p.dni.toLowerCase().includes(q)
      ) {
        return true
      }
      // Buscar también por nombre o DNI de adherentes
      if (Array.isArray(a.adherentes)) {
        return a.adherentes.some(adh => {
          const adhPac = data.patients.find(x => x.id === adh.patientId)
          if (!adhPac) return false
          return (
            adhPac.nombre.toLowerCase().includes(q) ||
            adhPac.apellido.toLowerCase().includes(q) ||
            adhPac.dni.toLowerCase().includes(q)
          )
        })
      }
      return false
    })
  }, [afiliados, pacientes, data.patients, search, planFiltro, verDadosDeBaja, expandidoId])

  // ── Año inicial según cuándo se afilió ────────────────────────────
  const fechaInicioPeriodo = useMemo(() => {
    if (!selectedAfiliado || !selectedAfiliado.fechaInicio) return null
    const parts = selectedAfiliado.fechaInicio.split('-')
    const y = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    return isNaN(y) || isNaN(m) || m < 1 || m > 12 ? null : { anio: y, mes: m }
  }, [selectedAfiliado])

  const startYear = fechaInicioPeriodo?.anio ?? null

  function mesEstaEnVigencia(mes: number): boolean {
    if (!fechaInicioPeriodo) return true
    return cuotaAnio > fechaInicioPeriodo.anio
      || (cuotaAnio === fechaInicioPeriodo.anio && mes >= fechaInicioPeriodo.mes)
  }

  useEffect(() => {
    if (startYear !== null && cuotaAnio < startYear) {
      setCuotaAnio(startYear)
    }
  }, [startYear, cuotaAnio])

  const cuotasDelAnio = useMemo(() => {
    if (!selectedAfiliado) return []
    return cuotas.filter(c => c.afiliadoId === selectedAfiliado.id && c.anio === cuotaAnio)
  }, [cuotas, selectedAfiliado, cuotaAnio])

  const cuotasVisiblesDelAnio = useMemo(
    () => cuotasDelAnio.filter((cuota) => mesEstaEnVigencia(cuota.mes)),
    [cuotasDelAnio, cuotaAnio, fechaInicioPeriodo],
  )

  function getCuotaMes(mes: number): CuotaMensual | undefined {
    return cuotasDelAnio.find(c => c.mes === mes)
  }

  function pagoDraftKey(mes: number): string {
    return `${selectedAfiliado?.id ?? ''}:${cuotaAnio}:${mes}`
  }

  // La regla de "al día" vive en src/lib/cobertura.ts: la Agenda usa el mismo
  // criterio para habilitar o no el plan de un paciente.
  function isDeudor(afiliadoId: string): boolean {
    return afiliadoTieneCuotasImpagas(afiliados.find((a) => a.id === afiliadoId), cuotas, hoy)
  }

  function pagoDraft(mes: number, cuota?: CuotaMensual): { formaPago: NonNullable<CuotaMensual['formaPago']>; comprobante: boolean } {
    return pagoDrafts[pagoDraftKey(mes)] ?? {
      formaPago: cuota?.formaPago ?? 'efectivo',
      comprobante: cuota?.comprobante ?? false,
    }
  }

  function actualizarPagoDraft(mes: number, cambios: Partial<{ formaPago: NonNullable<CuotaMensual['formaPago']>; comprobante: boolean }>, cuota?: CuotaMensual) {
    const draft = { ...pagoDraft(mes, cuota), ...cambios }
    setPagoDrafts(prev => ({ ...prev, [pagoDraftKey(mes)]: draft }))
    if (cuota?.id && cuota.estado === 'pagado') {
      upsertCuotaMensual({
        ...cuota,
        formaPago: draft.formaPago,
        comprobante: draft.comprobante,
      })
    }
  }

  function actualizarFechaPago(cuota: CuotaMensual, fechaPago: string) {
    upsertCuotaMensual({ ...cuota, fechaPago: fechaPago || null })
  }

  // Una cuota existente conserva el importe con el que fue generada.
  function handleRegistrarPago(mes: number) {
    if (!selectedAfiliado || !selectedPlan) return
    const existing = getCuotaMes(mes)
    const draft = pagoDraft(mes, existing)
    const monto = existing?.monto ?? selectedPlan.precio
    const nuevaCuota: Omit<CuotaMensual, 'id' | 'usos'> & { id?: string; usos?: number } = {
      id: existing?.id,
      afiliadoId: selectedAfiliado.id,
      mes,
      anio: cuotaAnio,
      monto,
      estado: 'pagado',
      fechaPago: format(hoy, 'yyyy-MM-dd'),
      formaPago: draft.formaPago,
      comprobante: draft.comprobante,
      notas: '',
    }
    upsertCuotaMensual(nuevaCuota)
  }

  function handleMarcarPendiente(mes: number) {
    if (!selectedAfiliado) return
    const existing = getCuotaMes(mes)
    const monto = existing?.monto ?? selectedPlan?.precio ?? 0
    const nuevaCuota: Omit<CuotaMensual, 'id' | 'usos'> & { id?: string; usos?: number } = {
      id: existing?.id,
      afiliadoId: selectedAfiliado.id,
      mes,
      anio: cuotaAnio,
      monto,
      estado: 'pendiente',
      fechaPago: null,
      formaPago: null,
      comprobante: false,
      notas: '',
    }
    upsertCuotaMensual(nuevaCuota)
    setPagoDrafts(prev => ({ ...prev, [pagoDraftKey(mes)]: { formaPago: 'efectivo', comprobante: false } }))
  }

  // Genera las cuotas faltantes del año visible
  function handleGenerarCuotas() {
    if (!selectedAfiliado || !selectedPlan) return
    for (let mes = 1; mes <= 12; mes++) {
      if (!mesEstaEnVigencia(mes)) continue
      if (!getCuotaMes(mes)) {
        upsertCuotaMensual({
          afiliadoId: selectedAfiliado.id,
          mes,
          anio: cuotaAnio,
          monto: selectedPlan.precio,
          estado: 'pendiente',
          fechaPago: null,
          formaPago: null,
          comprobante: false,
          notas: '',
        })
      }
    }
  }

  useEffect(() => {
    if (!selectedAfiliado || !selectedPlan) return
    handleGenerarCuotas()
  }, [selectedAfiliado?.id, selectedPlan?.id, cuotaAnio, cuotasDelAnio.length])

  // Plan actualmente seleccionado en el modal de afiliación
  const selectedPlanEnAlta = useMemo(() => {
    return todosLosPlanes.find((p) => p.id === afilForm.planId) ?? null
  }, [todosLosPlanes, afilForm.planId])

  // ── Acciones de alta ──────────────────────────────────────────────
  function handleTipoPlanChange(nuevoTipo: TipoPlanAfiliado) {
    setPlanForm((prev) => {
      const nombreActual = prev.nombre.trim()
      let nuevoNombre = prev.nombre
      if (
        !nombreActual ||
        nombreActual === 'Plan Individual' ||
        nombreActual === 'Plan Familiar'
      ) {
        nuevoNombre = nuevoTipo === 'familiar' ? 'Plan Familiar' : 'Plan Individual'
      }
      return {
        ...prev,
        tipo: nuevoTipo,
        nombre: nuevoNombre,
      }
    })
  }

  function handleAdherenteFieldChange(id: string, field: keyof AdherenteDraft, value: string) {
    setAfilForm((prev) => ({
      ...prev,
      adherentes: prev.adherentes.map((adh) => {
        if (adh.id !== id) return adh
        return { ...adh, [field]: value }
      }),
    }))
  }

  function handleAdherenteDniChange(id: string, newDni: string) {
    const cleanDni = newDni.replace(/\D/g, '').slice(0, 8)
    setAfilForm((prev) => ({
      ...prev,
      adherentes: prev.adherentes.map((adh) => {
        if (adh.id !== id) return adh
        return {
          ...adh,
          dni: cleanDni,
          pacienteExistenteId: undefined,
          pacienteExistenteNombre: undefined,
        }
      }),
    }))
  }

  function handleQuitarAdherenteDraft(id: string) {
    setAfilForm((prev) => ({
      ...prev,
      adherentes: prev.adherentes.filter((adh) => adh.id !== id),
    }))
  }

  async function handleAfiliarPaciente() {
    setAfilMsg(null)
    setFieldErrors({})

    // Flujo para paciente nuevo
    if (afilForm.patientId === '__nuevo__') {
      const errs: typeof fieldErrors = {}

      if (!afilForm.planId || !selectedPlanEnAlta) {
        errs.planId = 'Seleccioná una cobertura.'
      }

      if (!afilForm.fechaInicio) {
        errs.fechaInicio = 'La fecha de inicio es requerida.'
      }

      const dniClean = nuevoDni.trim()
      if (!dniClean) {
        errs.dni = 'El DNI es obligatorio.'
      } else if (!/^\d{1,8}$/.test(dniClean)) {
        errs.dni = 'El DNI debe contener solo números (hasta 8 dígitos).'
      } else {
        const dup = data.patients.find(
          p => p.dni && p.dni.trim() === dniClean && p.activo !== false,
        )
        if (dup) {
          errs.dni = `Ese DNI ya está cargado: ${dup.apellido.trim().toUpperCase()}, ${dup.nombre.trim().toUpperCase()}`
        }
      }

      const fnClean = nuevoFechaNacimiento.trim()
      const hoyStr = format(hoy, 'yyyy-MM-dd')
      if (!fnClean) {
        errs.fechaNacimiento = 'La fecha de nacimiento es requerida.'
      } else if (fnClean < '1900-01-01' || fnClean > hoyStr) {
        errs.fechaNacimiento = 'La fecha de nacimiento no puede ser futura ni anterior a 1900.'
      }

      const apClean = nuevoApellido.trim()
      if (!apClean) {
        errs.apellido = 'El apellido es requerido.'
      }

      const nomClean = nuevoNombre.trim()
      if (!nomClean) {
        errs.nombre = 'El nombre es requerido.'
      }

      if (Object.keys(errs).length > 0) {
        setFieldErrors(errs)
        return
      }

      // Validaciones de adherentes si es Plan Familiar
      if (selectedPlanEnAlta?.tipo === 'familiar') {
        const maxAdh = selectedPlanEnAlta.maxAdherentes ?? 0
        if (maxAdh > 0 && afilForm.adherentes.length > maxAdh) {
          setAfilMsg(`La cobertura permite como máximo ${maxAdh} adherentes.`)
          return
        }

        const seenDnis = new Set<string>()
        if (dniClean) seenDnis.add(dniClean)

        for (let i = 0; i < afilForm.adherentes.length; i++) {
          const adh = afilForm.adherentes[i]!
          const num = i + 1
          const dni = adh.dni.trim()
          const apellido = adh.apellido.trim()
          const nombre = adh.nombre.trim()
          const fechaNac = adh.fechaNacimiento.trim()
          const relacion = adh.relacion.trim()

          if (!dni) { setAfilMsg(`El adherente #${num} no tiene DNI.`); return }
          if (!apellido) { setAfilMsg(`El adherente #${num} no tiene apellido.`); return }
          if (!nombre) { setAfilMsg(`El adherente #${num} no tiene nombre.`); return }
          if (!fechaNac) { setAfilMsg(`El adherente #${num} no tiene fecha de nacimiento.`); return }
          if (!relacion) { setAfilMsg(`El adherente #${num} no tiene relación seleccionada.`); return }

          if (dniClean && dni === dniClean) {
            setAfilMsg(`El titular no puede ser adherente de sí mismo (DNI ${dni}).`)
            return
          }

          if (seenDnis.has(dni)) {
            setAfilMsg(`DNI repetido dentro de la familia: ${dni}.`)
            return
          }
          seenDnis.add(dni)

          if (adh.pacienteExistenteId && todosLosAfiliadosPatientIds.has(adh.pacienteExistenteId)) {
            setAfilMsg(`El paciente ${apellido}, ${nombre} (DNI ${dni}) ya tiene una cobertura activa en el sistema.`)
            return
          }
          const pacPorDni = data.patients.find((p) => p.dni && p.dni.trim() === dni)
          if (pacPorDni && todosLosAfiliadosPatientIds.has(pacPorDni.id)) {
            setAfilMsg(`El paciente ${apellido}, ${nombre} (DNI ${dni}) ya tiene una cobertura activa en el sistema.`)
            return
          }
        }
      }

      const apNorm = apClean.toUpperCase()
      const nomNorm = nomClean.toUpperCase()
      const newPatientId = createId()
      const planNombre = selectedPlanEnAlta?.nombre ?? 'Cobertura'

      try {
        setGuardandoNuevo(true)
        const res = await registrarContratanteConPacienteNuevoBackend({
          patientId: newPatientId,
          dni: dniClean,
          fechaNacimiento: fnClean,
          apellido: apNorm,
          nombre: nomNorm,
          planId: afilForm.planId,
          planNombre: planNombre,
          fechaInicio: afilForm.fechaInicio,
          afiliadoId: `afil_${newPatientId}`,
        })

        if (!res.ok) {
          if (res.error?.includes('Ese DNI ya está cargado')) {
            setFieldErrors({ dni: res.error })
          } else {
            setAfilMsg(res.error ?? 'Error al registrar el contratante')
          }
          return
        }

        registrarContratanteConPacienteNuevoState({
          patient: res.patient,
          afiliado: res.afiliado,
          adherentes: selectedPlanEnAlta?.tipo === 'familiar'
            ? afilForm.adherentes.map((adh) => ({
                pacienteExistenteId: adh.pacienteExistenteId,
                dni: adh.dni.trim(),
                apellido: adh.apellido.trim().toUpperCase(),
                nombre: adh.nombre.trim().toUpperCase(),
                fechaNacimiento: adh.fechaNacimiento.trim(),
                relacion: adh.relacion,
              }))
            : undefined,
          usuario: usuarioActualNombre,
        })

        cerrarModalAfiliar()
        setExitoMsg(`Contratante registrado. ${apNorm}, ${nomNorm} se creó en Pacientes con cobertura ${planNombre}.`)
        setToastAviso(`Contratante registrado: ${apNorm}, ${nomNorm} (${planNombre}).`)
      } catch (err: any) {
        setAfilMsg(err?.message || 'Error inesperado al registrar el contratante.')
      } finally {
        setGuardandoNuevo(false)
      }
      return
    }

    if (!afilForm.patientId) {
      setAfilMsg(selectedPlanEnAlta?.tipo === 'familiar' ? 'Seleccioná el contratante titular de la familia.' : 'Seleccioná un contratante o paciente.')
      return
    }
    if (!afilForm.planId || !selectedPlanEnAlta) {
      setAfilMsg('Seleccioná una cobertura.')
      return
    }
    if (todosLosAfiliadosPatientIds.has(afilForm.patientId)) {
      setAfilMsg('Este paciente ya tiene una cobertura activa.')
      return
    }

    const titularPaciente = pacientes.find((p) => p.id === afilForm.patientId)
    const titularDni = titularPaciente?.dni?.trim()

    // Validaciones para Plan Familiar
    if (selectedPlanEnAlta.tipo === 'familiar') {
      const maxAdh = selectedPlanEnAlta.maxAdherentes ?? 0
      if (maxAdh > 0 && afilForm.adherentes.length > maxAdh) {
        setAfilMsg(`La cobertura permite como máximo ${maxAdh} adherentes.`)
        return
      }

      const seenDnis = new Set<string>()
      if (titularDni) seenDnis.add(titularDni)

      for (let i = 0; i < afilForm.adherentes.length; i++) {
        const adh = afilForm.adherentes[i]!
        const num = i + 1
        const dni = adh.dni.trim()
        const apellido = adh.apellido.trim()
        const nombre = adh.nombre.trim()
        const fechaNac = adh.fechaNacimiento.trim()
        const relacion = adh.relacion.trim()

        if (!dni) { setAfilMsg(`El adherente #${num} no tiene DNI.`); return }
        if (!apellido) { setAfilMsg(`El adherente #${num} no tiene apellido.`); return }
        if (!nombre) { setAfilMsg(`El adherente #${num} no tiene nombre.`); return }
        if (!fechaNac) { setAfilMsg(`El adherente #${num} no tiene fecha de nacimiento.`); return }
        if (!relacion) { setAfilMsg(`El adherente #${num} no tiene relación seleccionada.`); return }

        if (titularDni && dni === titularDni) {
          setAfilMsg(`El titular no puede ser adherente de sí mismo (DNI ${dni}).`)
          return
        }

        if (seenDnis.has(dni)) {
          setAfilMsg(`DNI repetido dentro de la familia: ${dni}.`)
          return
        }
        seenDnis.add(dni)

        if (adh.pacienteExistenteId && todosLosAfiliadosPatientIds.has(adh.pacienteExistenteId)) {
          setAfilMsg(`El paciente ${apellido}, ${nombre} (DNI ${dni}) ya tiene una cobertura activa en el sistema.`)
          return
        }
        const pacPorDni = data.patients.find((p) => p.dni && p.dni.trim() === dni)
        if (pacPorDni && todosLosAfiliadosPatientIds.has(pacPorDni.id)) {
          setAfilMsg(`El paciente ${apellido}, ${nombre} (DNI ${dni}) ya tiene una cobertura activa en el sistema.`)
          return
        }
      }
    }

    afiliarConSincronizacion({
      titularId: afilForm.patientId,
      planId: afilForm.planId,
      fechaInicio: afilForm.fechaInicio,
      adherentes: selectedPlanEnAlta.tipo === 'familiar'
        ? afilForm.adherentes.map((adh) => ({
            pacienteExistenteId: adh.pacienteExistenteId,
            dni: adh.dni.trim(),
            apellido: adh.apellido.trim(),
            nombre: adh.nombre.trim(),
            fechaNacimiento: adh.fechaNacimiento.trim(),
            relacion: adh.relacion,
          }))
        : undefined,
      usuario: usuarioActualNombre,
    })

    setAfilForm({ patientId: '', planId: '', fechaInicio: format(hoy, 'yyyy-MM-dd'), adherentes: [] })
    setModal(null)
    if (titularPaciente) {
      setToastAviso(
        `Contratante registrado: ${titularPaciente.apellido}, ${titularPaciente.nombre} (${selectedPlanEnAlta.nombre}).`,
      )
    }
  }

  async function handleEliminarAfiliado(id: string) {
    const ok = await confirm({
      titleLogo: true,
      message: '¿Querés eliminar este contratante y sus cuotas asociadas?',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
    })
    if (!ok) return
    deleteAfiliado(id)
    if (expandidoId === id) setExpandidoId(null)
  }

  function abrirPlanNuevo() {
    setPlanForm({
      nombre: 'Plan Individual',
      tipo: 'individual',
      precio: 0,
      descripcion: '',
      activo: true,
      cupoConsultas: 2,
      prestacionesPorMes: 2,
      maxAdherentes: 0,
    })
    setModal('plan')
  }

  function abrirPlanEdicion(p: PlanAfiliado) {
    setPlanForm({
      id: p.id,
      nombre: p.nombre,
      tipo: p.tipo ?? 'individual',
      precio: p.precio,
      descripcion: p.descripcion,
      activo: p.activo,
      cupoConsultas: p.cupoConsultas ?? 0,
      prestacionesPorMes: p.prestacionesPorMes ?? 0,
      maxAdherentes: p.maxAdherentes ?? 0,
    })
    setModal('plan')
  }

  function handleSavePlan() {
    if (!planForm.nombre.trim()) return
    upsertPlanAfiliado({
      ...planForm,
      cupoConsultas: planForm.cupoConsultas ?? 0,
      prestacionesPorMes: planForm.prestacionesPorMes ?? 0,
      maxAdherentes: planForm.tipo === 'familiar' ? (planForm.maxAdherentes ?? 0) : 0,
    })
    setModal(null)
  }

  function initPlanes() {
    if (todosLosPlanes.length === 0) {
      PLANES_DEFAULT.forEach(p => upsertPlanAfiliado({ ...p, id: createId() } as PlanAfiliado))
    }
  }

  function toggleFila(id: string) {
    setExpandidoId(prev => (prev === id ? null : id))
  }

  function handleReactivarContratante(afiliado: Afiliado) {
    const pac = data.patients.find(p => p.id === afiliado.patientId)
    const nombreCompleto = pac
      ? `${pac.apellido.toUpperCase()}, ${pac.nombre.toUpperCase()}`
      : 'El contratante'
    reactivarContratante({
      afiliadoId: afiliado.id,
      usuario: usuarioActualNombre,
    })
    setToastAviso(`${nombreCompleto} fue reactivado.`)
  }

  function handleCancelarCambioProgramado(afiliado: Afiliado) {
    const pac = data.patients.find(p => p.id === afiliado.patientId)
    const nombreCompleto = pac
      ? `${pac.apellido.toUpperCase()}, ${pac.nombre.toUpperCase()}`
      : 'El contratante'
    cancelarCambioProgramadoContratante(afiliado.id, usuarioActualNombre)
    setToastAviso(`Se canceló el cambio de cobertura programado de ${nombreCompleto}.`)
  }

  function renderBotonesAccionContratante(afiliado: Afiliado, stopPropagation = false) {
    if (esContratanteDadoDeBaja(afiliado)) return null
    const suspendido = esContratanteSuspendido(afiliado)
    return (
      <>
        <button
          type="button"
          className="af-btn"
          onClick={e => {
            if (stopPropagation) e.stopPropagation()
            setAccionModal({ tipo: 'cambiarCobertura', afiliadoId: afiliado.id })
          }}
        >
          Cambiar cobertura
        </button>
        {suspendido ? (
          <button
            type="button"
            className="af-btn af-btn--soft"
            onClick={e => {
              if (stopPropagation) e.stopPropagation()
              handleReactivarContratante(afiliado)
            }}
          >
            Reactivar
          </button>
        ) : (
          <button
            type="button"
            className="af-btn"
            onClick={e => {
              if (stopPropagation) e.stopPropagation()
              setAccionModal({ tipo: 'suspender', afiliadoId: afiliado.id })
            }}
          >
            Suspender
          </button>
        )}
        <button
          type="button"
          className="af-btn af-btn--danger-ghost"
          onClick={e => {
            if (stopPropagation) e.stopPropagation()
            setAccionModal({ tipo: 'baja', afiliadoId: afiliado.id })
          }}
        >
          Dar de baja
        </button>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════════════════════════════
  const pagadas = cuotasVisiblesDelAnio.filter(c => c.estado === 'pagado').length
  const pendientes = cuotasVisiblesDelAnio.filter(c => c.estado === 'pendiente').length
  const totalCobrado = cuotasVisiblesDelAnio.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const totalAdeudado = cuotasVisiblesDelAnio.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
  // Atenciones ya registradas en la cuota del mes en curso. Es el contador que
  // después se compara con el cupo del plan; hoy no bloquea nada.
  const usosDelMes =
    cuotasVisiblesDelAnio.find(c => c.mes === new Date().getMonth() + 1 && c.anio === new Date().getFullYear())?.usos ?? 0

  return (
    <div className="page af-page">
      {/* ── Encabezado ── */}
      <div className="af-head">
        <h1>Contratantes</h1>
      </div>

      {/* ── PLANES ARRIBA ── */}
      <section className="af-card">
        <div className="af-card__title af-card__title--bar">
          <span>Coberturas</span>
          <span className="af-count">{planes.length} activas</span>
        </div>

        {planes.length === 0 ? (
          <>
            <p className="af-hint" style={{ marginBottom: '0.7rem' }}>
              Todavía no hay coberturas. Creá la primera para poder asociar contratantes.
            </p>
            <button className="af-btn af-btn--primary" onClick={initPlanes}>Crear coberturas por defecto</button>
          </>
        ) : (
          <div className="af-planes-row">
            <div className="af-planes">
                            {/* Pastilla Todas */}
              <button
                type="button"
                className={`af-plan af-plan--todas${planFiltro === null ? ' af-plan--active' : ''}`}
                onClick={() => setPlanFiltro(null)}
                aria-pressed={planFiltro === null}
                title="Mostrar todos los contratantes"
              >
                <span className="af-plan-todas__title">Todas</span>
                <span className="af-plan-todas__count">({totalAfiliadosCount})</span>
              </button>

              {planes.map(p => {
              const activo = planFiltro === p.id
              const n = conteoPorPlan.get(p.id) ?? 0
              return (
                <div
                  key={p.id}
                  className={`af-plan${activo ? ' af-plan--active' : ''}`}
                  onClick={() => setPlanFiltro(activo ? null : p.id)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={activo}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setPlanFiltro(activo ? null : p.id)
                    }
                  }}
                >
                  <div className="af-plan__top">
                    <span className="af-plan__name" title={p.nombre}>{p.nombre}</span>
                    {p.tipo === 'familiar' && (
                      <span
                        style={{
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          padding: '0.1rem 0.35rem',
                          borderRadius: '4px',
                          background: '#eff6ff',
                          color: '#2563eb',
                          border: '1px solid #bfdbfe',
                          marginLeft: 'auto',
                        }}
                      >
                        Familiar
                      </span>
                    )}
                  </div>
                  <div className="af-plan__price">
                    ${p.precio.toLocaleString('es-AR')}<small> /mes</small>
                  </div>
                  {/* La línea de descripción sólo aparece si hay texto: si no,
                      ocupa height para nada y estira la tarjeta. */}
                  {p.descripcion.trim() && (
                    <div className="af-plan__desc" title={p.descripcion}>{p.descripcion}</div>
                  )}
                  <div className="af-plan__foot">
                    <span className="af-plan__count">{n} {n === 1 ? 'contratante' : 'contratantes'}</span>
                    {/* El cupo se muestra en la tarjeta para no abrir el plan
                        sólo por eso. 0 = sin límite, no se rotula nada. */}
                    {((p.cupoConsultas ?? 0) > 0 || (p.prestacionesPorMes ?? 0) > 0) && (
                      <span
                        className="af-plan__cupo"
                        title={`${p.cupoConsultas || 0} consultas y ${p.prestacionesPorMes || 0} prestaciones gratuitas por mes`}
                      >
                        {p.cupoConsultas || 0} cons. / {p.prestacionesPorMes || 0} prest.
                      </span>
                    )}
                    <button
                      className="af-btn af-btn--icon"
                      title="Editar cobertura"
                      aria-label={`Editar cobertura ${p.nombre}`}
                      onClick={e => { e.stopPropagation(); abrirPlanEdicion(p) }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    </button>
                    <button
                      className="af-btn af-btn--icon af-btn--danger"
                      title="Eliminar cobertura"
                      aria-label={`Eliminar cobertura ${p.nombre}`}
                      onClick={e => { e.stopPropagation(); deletePlanAfiliado(p.id) }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Alta de plan */}
            <button type="button" className="af-plan af-plan--new" onClick={abrirPlanNuevo}>
              <span style={{ fontSize: '1.3rem', lineHeight: 1 }} aria-hidden="true">+</span>
              Nueva cobertura
            </button>

            </div>

            {/* ── Toolbar de acciones y filtros (Modelo A: una sola fila) ── */}
            <div className="afil-toolbar">
              {/* Grupo izquierdo: filtros con gap 8px */}

              {/* Grupo derecho: Reportes PDF, Orden Médica, Nuevo Afiliado (gap 10px) */}
              <div className="afil-toolbar-actions">
                <div className="afil-toolbar-menu-wrapper" ref={menuReportesRef}>
                  <button
                    type="button"
                    className="afil-toolbar-btn-pdf"
                    aria-haspopup="menu"
                    aria-expanded={reportesMenuOpen}
                    onClick={() => setReportesMenuOpen(v => !v)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span>Reportes PDF</span>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {reportesMenuOpen && (
                    <div
                      className="afil-toolbar-dropdown"
                      role="menu"
                      aria-label="Reportes PDF"
                      onKeyDown={(e) => {
                        const items = menuReportesRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
                        if (!items || items.length === 0) return
                        const currentIdx = Array.from(items).indexOf(document.activeElement as HTMLButtonElement)
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          const nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0
                          items[nextIdx]?.focus()
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          const prevIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1
                          items[prevIdx]?.focus()
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="afil-toolbar-item"
                        role="menuitem"
                        onClick={() => {
                          setReportesMenuOpen(false)
                          void handlePdfDeudores()
                        }}
                      >
                        PDF deudores
                      </button>
                      <button
                        type="button"
                        className="afil-toolbar-item"
                        role="menuitem"
                        onClick={() => {
                          setReportesMenuOpen(false)
                          void handlePdfAlDia()
                        }}
                      >
                        PDF al día
                      </button>
                      <button
                        type="button"
                        className="afil-toolbar-item"
                        role="menuitem"
                        onClick={() => {
                          setReportesMenuOpen(false)
                          void handlePdfPreview('all')
                        }}
                      >
                        PDF todos
                      </button>
                      <button
                        type="button"
                        className="afil-toolbar-item"
                        role="menuitem"
                        onClick={() => {
                          setReportesMenuOpen(false)
                          void handlePdfListado()
                        }}
                      >
                        PDF listado
                      </button>
                      <div className="afil-toolbar-divider" />
                      <button
                        type="button"
                        className="afil-toolbar-item"
                        role="menuitem"
                        onClick={() => {
                          setReportesMenuOpen(false)
                          void handlePdfOrdenesEmitidas()
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        Órdenes emitidas
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className={`af-btn af-btn--orden-medica${selectedPatientId && !selectedEsSuspendido && !selectedEsDadoDeBaja ? ' af-btn--orden-medica-highlight' : ''}`}
                  disabled={Boolean(selectedPatientId && (selectedEsSuspendido || selectedEsDadoDeBaja))}
                  title={
                    selectedEsDadoDeBaja
                      ? 'Contratante dado de baja'
                      : selectedEsSuspendido
                        ? 'Contratante suspendido'
                        : 'Emitir orden médica'
                  }
                  onClick={() => {
                    if (selectedEsSuspendido || selectedEsDadoDeBaja) return
                    setModal('ordenMedica')
                  }}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  {selectedEsDadoDeBaja
                    ? 'Orden Médica (Contratante dado de baja)'
                    : selectedEsSuspendido
                      ? 'Orden Médica (Contratante suspendido)'
                      : 'Orden Médica'}
                </button>
                <button className="af-btn af-btn--primary" onClick={abrirModalAfiliar}>
                  + Contratante
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── AFILIADOS (filas expandibles) ── */}
      <section className="af-card af-card--list">
        {exitoMsg && (
          <div className="af-success-banner">
            <span>✓ {exitoMsg}</span>
            <button
              type="button"
              className="af-btn"
              style={{ padding: '0.15rem 0.4rem', border: 'none', background: 'none', cursor: 'pointer' }}
              onClick={() => setExitoMsg(null)}
            >
              ✕
            </button>
          </div>
        )}
        {/* Con un afiliado desplegado se oculta el encabezado del listado
            (buscador y contador): en pantalla sólo queda su detalle. */}
        {!expandidoId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
          <h2 className="af-card__title" style={{ margin: 0 }}>Contratantes</h2>
          <span className="af-count">{filteredAfiliados.length}</span>
          <div className="af-search">
            <Lupa />
            <label className="af-sr" htmlFor="af-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Buscar por nombre o DNI
            </label>
            <input
              id="af-search"
              className="af-input"
              type="search"
              placeholder="Buscar contratante por nombre o DNI…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={`af-chip${verDadosDeBaja ? ' af-chip--on' : ''}`}
            aria-pressed={verDadosDeBaja}
            onClick={() => setVerDadosDeBaja(v => !v)}
          >
            Ver dados de baja ({dadosDeBajaCount})
          </button>
        </div>
        )}

        {selectedPacienteOrden && (
          <div className="af-selected-banner">
            <div className="af-selected-banner__text">
              <span>Seleccionado:</span>
              <strong>{selectedPacienteOrden.apellido.toUpperCase()}, {selectedPacienteOrden.nombre.toUpperCase()}</strong>
              {selectedPlanParaOrden && (
                <span>· {selectedPlanParaOrden.nombre}</span>
              )}
              {adherentesNombres.length > 0 && (
                <span className="af-selected-banner__adherentes">
                  · Adherentes: <strong>{adherentesNombres.join(', ')}</strong>
                </span>
              )}
              {selectedEsDadoDeBaja ? (
                <span className="af-badge af-badge--gray">Contratante dado de baja</span>
              ) : selectedEsSuspendido ? (
                <span className="af-badge af-badge--violet">Contratante suspendido</span>
              ) : (
                <span className="af-selected-banner__action">· tocá Orden Médica</span>
              )}
            </div>
            <div className="af-selected-banner__actions">
              {selectedAfiliadoParaOrden && renderBotonesAccionContratante(selectedAfiliadoParaOrden)}
              <button
                type="button"
                className="af-selected-banner__btn-clear"
                title="Deseleccionar"
                aria-label="Quitar selección"
                onClick={() => setSelectedPatientId(null)}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <div className={`af-table-wrap${expandidoId ? ' af-table-wrap--solo' : ''}`}>
          <table className="af-table">
            <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Lista de contratantes; desplegá una fila para ver sus cuotas del año.
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 34 }}><span className="af-sr">Desplegar</span></th>
                <th scope="col">Contratante / Paciente</th>
                <th scope="col">Cobertura</th>
                <th scope="col">Desde</th>
                <th scope="col">Estado</th>
                <th scope="col" style={{ textAlign: 'left' }}>Total Atención</th>
                <th scope="col" className="af-num">Adeudado</th>
              </tr>
            </thead>
            <tbody>
              {filteredAfiliados.length === 0 && (
                <tr><td colSpan={7} className="af-empty">No hay contratantes para este filtro.</td></tr>
              )}

              {filteredAfiliados.map(a => {
                const p = pacientes.find(x => x.id === a.patientId) ?? data.patients.find(x => x.id === a.patientId)
                const plan = todosLosPlanes.find(x => x.id === a.planId)
                const abierto = a.id === expandidoId
                const isSelected = selectedPatientId === a.patientId
                const deudor = isDeudor(a.id)
                const esBaja = esContratanteDadoDeBaja(a)
                const esSuspendido = esContratanteSuspendido(a)
                const delAnio = cuotas.filter(c => c.afiliadoId === a.id && c.anio === cuotaAnio)
                const adeudado = delAnio.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
                return (
                  <React.Fragment key={a.id}>
                    <tr
                      className={`af-row${abierto ? ' af-row--open' : ''}${isSelected ? ' af-row--selected' : ''}`}
                      onClick={() => setSelectedPatientId(prev => prev === a.patientId ? null : a.patientId)}
                      tabIndex={0}
                      role="button"
                      aria-selected={isSelected}
                      aria-expanded={abierto}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedPatientId(prev => prev === a.patientId ? null : a.patientId)
                        }
                      }}
                    >
                      <td
                        onClick={e => {
                          e.stopPropagation()
                          toggleFila(a.id)
                        }}
                      >
                        <button
                          type="button"
                          className="af-btn-caret"
                          aria-label={abierto ? 'Cerrar cuotas' : 'Desplegar cuotas'}
                          title={abierto ? 'Cerrar cuotas' : 'Desplegar cuotas'}
                          aria-expanded={abierto}
                          onClick={e => {
                            e.stopPropagation()
                            toggleFila(a.id)
                          }}
                        >
                          <Caret abierto={abierto} />
                        </button>
                      </td>
                      <td>
                        {/* Nombre y DNI en una sola línea: antes ocupaban dos
                            renglones y la fila quedaba más alta de lo necesario. */}
                        <span className="af-cell-paciente">
                          <span className="af-row__name">
                            {p?.apellido}, {p?.nombre}
                          </span>
                          <span className="af-row__sub">DNI {p?.dni || '—'}</span>
                          {plan?.tipo === 'familiar' && (
                            <span
                              className="af-badge af-badge--info"
                              style={{
                                fontSize: '0.66rem',
                                padding: '0.08rem 0.35rem',
                                fontWeight: 600,
                                flex: 'none',
                              }}
                              title={
                                a.adherentes && a.adherentes.length > 0
                                  ? `Titular de ${a.adherentes.length} adherente${a.adherentes.length !== 1 ? 's' : ''}`
                                  : 'Titular (sin adherentes cargados)'
                              }
                            >
                              Titular {a.adherentes && a.adherentes.length > 0 ? `(${a.adherentes.length} adh.)` : ''}
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <div>{plan?.nombre ?? '—'}</div>
                        {a.cambioCoberturaProgramado && !esBaja && (
                          <div
                            className="af-cambio-prog-pill"
                            onClick={e => e.stopPropagation()}
                          >
                            <span>
                              Pasa a {a.cambioCoberturaProgramado.planNuevoNombre} el{' '}
                              {formatearFechaLatina(a.cambioCoberturaProgramado.fechaVigencia)}
                            </span>
                            <button
                              type="button"
                              className="af-cambio-prog-pill__cancel"
                              title="Cancelar cambio de cobertura programado"
                              onClick={e => {
                                e.stopPropagation()
                                handleCancelarCambioProgramado(a)
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="af-row__sub">{a.fechaInicio}</td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                          {esBaja ? (
                            <>
                              <span className="af-badge af-badge--gray">Baja</span>
                              {deudor && <span className="af-badge af-badge--warn">Deudor</span>}
                            </>
                          ) : esSuspendido ? (
                            <>
                              <span className="af-badge af-badge--violet">Suspendido</span>
                              {deudor && <span className="af-badge af-badge--warn">Deudor</span>}
                            </>
                          ) : deudor ? (
                            <span className="af-badge af-badge--warn">Deudor</span>
                          ) : (
                            <span className="af-badge af-badge--ok">Al día</span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {(() => {
                          if (!plan) return <span className="af-atencion af-atencion--libre">—</span>
                          const cTitular = calcularConsumoAfiliadoMes({
                            patientId: a.patientId,
                            anio: hoy.getFullYear(),
                            mes: hoy.getMonth() + 1,
                            plan,
                            appointments: data.appointments ?? [],
                            ordenesMedicas: data.ordenesMedicas ?? [],
                          })

                          const ordsDelAfiliado = (data.ordenesMedicas ?? []).filter((ord) => {
                            if (ord.afiliadoId && ord.afiliadoId === a.id) return true
                            if (ord.patientId === a.patientId) return true
                            if (a.adherentes && a.adherentes.some((adh) => adh.patientId === ord.patientId)) return true
                            return false
                          })

                          const ordsDelMes = ordsDelAfiliado.filter((ord) => {
                            try {
                              const fechaClean = (ord.fecha ?? '').split('T')[0].trim()
                              const slash = fechaClean.split('/')
                              const dash = fechaClean.split('-')
                              const parts = slash.length >= 3 ? slash : dash
                              if (parts.length >= 3) {
                                let y = parseInt(parts[0], 10)
                                let m = parseInt(parts[1], 10)
                                if (parts[2].length === 4) {
                                  y = parseInt(parts[2], 10)
                                  m = parseInt(parts[1], 10)
                                } else if (parts[2].length === 2 && parts[0].length <= 2) {
                                  y = 2000 + parseInt(parts[2], 10)
                                  m = parseInt(parts[1], 10)
                                }
                                return y === hoy.getFullYear() && m === hoy.getMonth() + 1
                              }
                              const d = parseISO(ord.fecha)
                              return d.getFullYear() === hoy.getFullYear() && d.getMonth() + 1 === hoy.getMonth() + 1
                            } catch {
                              return false
                            }
                          })

                          return (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'flex-start',
                                gap: '6px',
                                fontSize: '0.76rem',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                className={`af-atencion${cTitular.consultasAgotadas ? ' af-atencion--lleno' : ''}`}
                                title={
                                  cTitular.consultasAgotadas
                                    ? 'Tope de consultas agotado este mes.'
                                    : `Consultas este mes: ${cTitular.consultasUsadas}/${cTitular.consultasCupo || 'sin límite'}`
                                }
                              >
                                <strong>{cTitular.consultasUsadas}</strong>/{cTitular.consultasCupo || '∞'} cons.
                              </span>
                              {(plan.prestacionesPorMes ?? 0) > 0 && (
                                <span
                                  className={`af-atencion${cTitular.prestacionesAgotadas ? ' af-atencion--lleno' : ''}`}
                                  title={
                                    cTitular.prestacionesAgotadas
                                      ? 'Tope de prestaciones agotado este mes.'
                                      : `Prestaciones este mes: ${cTitular.prestacionesUsadas}/${cTitular.prestacionesCupo || 'sin límite'}`
                                  }
                                >
                                  <strong>{cTitular.prestacionesUsadas}</strong>/{cTitular.prestacionesCupo} prest.
                                </span>
                              )}
                              <span
                                className="af-atencion"
                                style={{
                                  color: ordsDelMes.length > 0 ? '#0284c7' : '#64748b',
                                  fontWeight: ordsDelMes.length > 0 ? 700 : 500,
                                }}
                                title={`Órdenes médicas este mes: ${ordsDelMes.length} (Total acumulado: ${ordsDelAfiliado.length})`}
                              >
                                <strong>{ordsDelMes.length}</strong>{' '}{ordsDelMes.length === 1 ? 'orden' : 'órdenes'}
                              </span>
                            </div>
                          )
                        })()}
                      </td>
                      <td className="af-num">
                        {adeudado > 0
                          ? <span style={{ color: '#d97706', fontWeight: 700 }}>${adeudado.toLocaleString('es-AR')}</span>
                          : <span style={{ color: '#6b7c93' }}>—</span>}
                      </td>
                    </tr>

                    {/* ── Detalle expandido: pestañas ── */}
                    {abierto && (() => {
                      const cuotasAfiliado = cuotas.filter(c => c.afiliadoId === a.id)
                      const adherentesDetalle: AdherenteDetalleItem[] = (a.adherentes || []).map((adh) => {
                        const adhPac = data.patients.find((x) => x.id === adh.patientId)
                        const cAdh = plan
                          ? calcularConsumoAfiliadoMes({ patientId: adh.patientId, anio: hoy.getFullYear(), mes: hoy.getMonth() + 1, plan, appointments: data.appointments ?? [], ordenesMedicas: data.ordenesMedicas ?? [] })
                          : { consultasUsadas: 0, prestacionesUsadas: 0, consultasAgotadas: false, prestacionesAgotadas: false }
                        const ordsCount = (data.ordenesMedicas ?? []).filter((ord) => ord.patientId === adh.patientId).length
                        return { adherente: adh, paciente: adhPac, consultasUsadas: cAdh.consultasUsadas, cupoConsultas: plan?.cupoConsultas || 3, prestacionesUsadas: cAdh.prestacionesUsadas, cupoPrestaciones: plan?.prestacionesPorMes || 3, ordenesCount: ordsCount }
                      })
                      return (
                        <tr className="af-detail">
                          <td colSpan={7} style={{ padding: '0.85rem 1rem 1.25rem', background: '#eef0f8' }}>
                            <DetalleContratanteCuotas
                              afiliado={a}
                              paciente={p}
                              plan={plan ?? undefined}
                              cuotas={cuotasAfiliado}
                              adherentesDetalle={adherentesDetalle}
                              onVolver={() => setExpandidoId(null)}
                              onCobrarCuota={async (c) => { upsertCuotaMensual(c) }}
                              onAnularCuota={async (c) => { upsertCuotaMensual(c) }}
                              onChangeMedioPago={async (c, medio) => { upsertCuotaMensual({ ...c, formaPago: medio }) }}
                              onSuspenderReactivar={async (af) => {
                                if (esContratanteSuspendido(af)) {
                                  handleReactivarContratante(af)
                                } else {
                                  setAccionModal({ tipo: 'suspender', afiliadoId: af.id })
                                }
                              }}
                              onDarDeBaja={async () => { setAccionModal({ tipo: 'baja', afiliadoId: a.id }) }}
                              onQuitarAdherente={async (adhPatientId) => { quitarAdherente(a.id, adhPatientId) }}
                              onCambiarCobertura={() => { setAccionModal({ tipo: 'cambiarCobertura', afiliadoId: a.id }) }}
                              onPdfContratante={() => { void handlePdfPreview('selected') }}
                              onPdfComprobante={(c, nombreMes) => { void handleComprobantePago(c, nombreMes) }}
                              onImprimirComprobante={(c, nombreMes) => { void handleImprimirComprobante(c, nombreMes) }}
                              onWhatsAppComprobante={(c, nombreMes) => { void handleWhatsAppComprobante(c, nombreMes) }}
                            />
                          </td>
                        </tr>
                      )
                    })()}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── MODAL: cobertura (alta / edición) ── */}
      {modal === 'plan' && (
        <div className="af-backdrop" onClick={() => setModal(null)}>
          <div
            className="af-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="af-modal-plan"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="af-modal__title" id="af-modal-plan">
              {planForm.id ? 'Editar cobertura' : 'Nueva cobertura'}
            </h3>

            {/* Selector Tipo de cobertura */}
            <div className="af-field">
              <label htmlFor="af-plan-tipo">Tipo de cobertura</label>
              <select
                id="af-plan-tipo"
                className="af-select"
                value={planForm.tipo}
                onChange={e => handleTipoPlanChange(e.target.value as TipoPlanAfiliado)}
              >
                <option value="individual">Individual (1 persona)</option>
                <option value="familiar">Familiar (titular y adherentes)</option>
              </select>
            </div>

            <div className="af-field">
              <label htmlFor="af-plan-nombre">Nombre de la cobertura</label>
              <input
                id="af-plan-nombre"
                className="af-input"
                value={planForm.nombre}
                onChange={e => setPlanForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder={planForm.tipo === 'familiar' ? 'Ej: Cobertura Familiar' : 'Ej: Cobertura Individual'}
              />
            </div>
            <div className="af-field">
              <label htmlFor="af-plan-precio">Precio mensual ($)</label>
              <input
                id="af-plan-precio"
                className="af-input"
                type="text"
                inputMode="numeric"
                value={planForm.precio === 0 ? '' : planForm.precio}
                placeholder="0"
                onChange={e => setPlanForm(f => ({ ...f, precio: parseFloat(e.target.value) || 0 }))}
              />
              {planForm.id && (
                <span className="af-hint" style={{ color: '#0369a1', marginTop: '0.25rem', display: 'block', lineHeight: 1.35 }}>
                  ℹ El nuevo precio se aplicará <strong>hacia adelante</strong> a las cuotas pendientes del mes actual y meses futuros de todos los contratantes. Las cuotas ya pagadas o de meses anteriores mantienen su importe histórico.
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="af-field">
                <label htmlFor="af-plan-cupo">Consultas por mes</label>
                <input
                  id="af-plan-cupo"
                  className="af-input"
                  type="text"
                  inputMode="numeric"
                  value={planForm.cupoConsultas === 0 ? '' : planForm.cupoConsultas}
                  placeholder="Sin cupo"
                  onChange={e => {
                    const n = parseInt(e.target.value, 10)
                    setPlanForm(f => ({ ...f, cupoConsultas: Number.isNaN(n) ? 0 : Math.max(0, n) }))
                  }}
                />
                <span className="af-hint">0 = sin límite.</span>
              </div>
              <div className="af-field">
                <label htmlFor="af-plan-prest">Prestaciones por mes</label>
                <input
                  id="af-plan-prest"
                  className="af-input"
                  type="text"
                  inputMode="numeric"
                  value={planForm.prestacionesPorMes === 0 ? '' : planForm.prestacionesPorMes}
                  placeholder="Sin cupo"
                  onChange={e => {
                    const n = parseInt(e.target.value, 10)
                    setPlanForm(f => ({ ...f, prestacionesPorMes: Number.isNaN(n) ? 0 : Math.max(0, n) }))
                  }}
                />
                <span className="af-hint">0 = sin límite.</span>
              </div>
            </div>

            {planForm.tipo === 'familiar' && (
              <div style={{ fontSize: '0.78rem', color: '#0369a1', background: '#f0f9ff', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #bae6fd', marginBottom: '0.2rem' }}>
                En la Cobertura Familiar, cada adherente cuenta individualmente con las mismas cantidades de consultas y prestaciones por mes que el titular.
              </div>
            )}

            {planForm.tipo === 'familiar' && (
              <div className="af-field">
                <label htmlFor="af-plan-max-adh">Máximo de adherentes</label>
                <input
                  id="af-plan-max-adh"
                  className="af-input"
                  type="text"
                  inputMode="numeric"
                  value={planForm.maxAdherentes === 0 ? '' : planForm.maxAdherentes}
                  placeholder="Sin límite"
                  onChange={e => {
                    const n = parseInt(e.target.value, 10)
                    setPlanForm(f => ({ ...f, maxAdherentes: Number.isNaN(n) ? 0 : Math.max(0, n) }))
                  }}
                />
                <span className="af-hint">Adherentes además del titular. 0 = sin límite.</span>
              </div>
            )}

            <div className="af-field">
              <label htmlFor="af-plan-desc">Descripción (opcional)</label>
              <input
                id="af-plan-desc"
                className="af-input"
                value={planForm.descripcion}
                onChange={e => setPlanForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Qué incluye esta cobertura…"
              />
            </div>
            <div className="af-modal__foot">
              <button className="af-btn af-btn--primary" onClick={handleSavePlan}>Guardar</button>
              <button className="af-btn" onClick={() => setModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: afiliar contratante ── */}
      {modal === 'afiliar' && (
        <div className="af-backdrop" onClick={cerrarModalAfiliar}>
          <div
            className={`af-modal${selectedPlanEnAlta?.tipo === 'familiar' ? ' af-modal--wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="af-modal-afiliar"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="af-modal__title" id="af-modal-afiliar">
              {selectedPlanEnAlta?.tipo === 'familiar' ? 'Registrar grupo familiar' : 'Registrar contratante'}
            </h3>
            {planes.length === 0 ? (
              <p className="af-hint">Primero creá una cobertura para poder asociar contratantes.</p>
            ) : (
              <>
                {/* 1. Selección de Cobertura */}
                <div className="af-field">
                  <label htmlFor="af-fil-plan">Cobertura *</label>
                  <select
                    id="af-fil-plan"
                    className="af-select"
                    value={afilForm.planId}
                    onChange={e => {
                      const newPlanId = e.target.value
                      setAfilForm(f => ({ ...f, planId: newPlanId }))
                      setAfilMsg(null)
                      if (fieldErrors.planId) setFieldErrors(prev => ({ ...prev, planId: undefined }))
                    }}
                  >
                    <option value="">— Seleccionar cobertura —</option>
                    {planes.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} {p.tipo === 'familiar' ? '(Familiar)' : '(Individual)'} — ${p.precio.toLocaleString('es-AR')}/mes
                      </option>
                    ))}
                  </select>
                  {fieldErrors.planId && <span className="af-field-error">{fieldErrors.planId}</span>}
                </div>

                {/* 2. Titular o Contratante */}
                <div className="af-field">
                  <label htmlFor="af-fil-paciente">
                    {selectedPlanEnAlta?.tipo === 'familiar' ? 'Contratante Titular' : 'Contratante / Paciente'}
                  </label>
                  <TitularCombobox
                    id="af-fil-paciente"
                    pacientesDisponibles={[...pacientes].sort((a, b) => {
                      const inelA = todosLosAfiliadosPatientIds.has(a.id) ? 1 : 0
                      const inelB = todosLosAfiliadosPatientIds.has(b.id) ? 1 : 0
                      if (inelA !== inelB) return inelA - inelB
                      return a.apellido.localeCompare(b.apellido, 'es')
                    })}
                    motivosNoElegible={motivosNoElegibleTitular}
                    selectedPatientId={afilForm.patientId}
                    onSelectPatient={(val) => {
                      setAfilForm(f => ({ ...f, patientId: val }))
                      setFieldErrors(prev => ({
                        ...prev,
                        dni: undefined,
                        fechaNacimiento: undefined,
                        apellido: undefined,
                        nombre: undefined,
                      }))
                    }}
                    onSelectNuevoPaciente={(prefill) => {
                      setAfilForm(f => ({ ...f, patientId: '__nuevo__' }))
                      if (prefill.dni) setNuevoDni(prefill.dni)
                      if (prefill.apellido) setNuevoApellido(prefill.apellido)
                      if (prefill.nombre) setNuevoNombre(prefill.nombre)
                      setTimeout(() => dniInputRef.current?.focus(), 50)
                    }}
                  />

                  {/* Bloque Paciente Nuevo */}
                  {afilForm.patientId === '__nuevo__' && (
                    <div className="af-nuevo-paciente-box">
                      <div className="af-nuevo-paciente-box__title">Datos del paciente nuevo</div>
                      <div className="af-nuevo-paciente-box__subtitle">Al aceptar se crea en Pacientes con la cobertura elegida.</div>
                      <div className="af-nuevo-paciente-grid">
                        <div>
                          <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                            DNI Pac *
                          </label>
                          <input
                            ref={dniInputRef}
                            className="af-input"
                            style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                            placeholder="DNI (solo números)"
                            value={nuevoDni}
                            maxLength={8}
                            onChange={e => {
                              const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
                              setNuevoDni(digits)
                              if (fieldErrors.dni) setFieldErrors(prev => ({ ...prev, dni: undefined }))
                            }}
                          />
                          {fieldErrors.dni && <span className="af-field-error">{fieldErrors.dni}</span>}
                        </div>

                        <div>
                          <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                            F. nacimiento *
                          </label>
                          <input
                            className="af-input"
                            type="date"
                            style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                            value={nuevoFechaNacimiento}
                            max={format(hoy, 'yyyy-MM-dd')}
                            min="1900-01-01"
                            onChange={e => {
                              setNuevoFechaNacimiento(e.target.value)
                              if (fieldErrors.fechaNacimiento) setFieldErrors(prev => ({ ...prev, fechaNacimiento: undefined }))
                            }}
                          />
                          {fieldErrors.fechaNacimiento && <span className="af-field-error">{fieldErrors.fechaNacimiento}</span>}
                        </div>

                        <div>
                          <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                            Apellido *
                          </label>
                          <input
                            className="af-input"
                            style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                            placeholder="Apellido"
                            value={nuevoApellido}
                            onChange={e => {
                              setNuevoApellido(e.target.value)
                              if (fieldErrors.apellido) setFieldErrors(prev => ({ ...prev, apellido: undefined }))
                            }}
                          />
                          {fieldErrors.apellido && <span className="af-field-error">{fieldErrors.apellido}</span>}
                        </div>

                        <div>
                          <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                            Nombre *
                          </label>
                          <input
                            className="af-input"
                            style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                            placeholder="Nombre"
                            value={nuevoNombre}
                            onChange={e => {
                              setNuevoNombre(e.target.value)
                              if (fieldErrors.nombre) setFieldErrors(prev => ({ ...prev, nombre: undefined }))
                            }}
                          />
                          {fieldErrors.nombre && <span className="af-field-error">{fieldErrors.nombre}</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Fecha de inicio */}
                <div className="af-field">
                  <label htmlFor="af-fil-fecha">Fecha de inicio *</label>
                  <input
                    id="af-fil-fecha"
                    className="af-input"
                    type="date"
                    value={afilForm.fechaInicio}
                    onChange={e => {
                      setAfilForm(f => ({ ...f, fechaInicio: e.target.value }))
                      if (fieldErrors.fechaInicio) setFieldErrors(prev => ({ ...prev, fechaInicio: undefined }))
                    }}
                  />
                  {fieldErrors.fechaInicio && <span className="af-field-error">{fieldErrors.fechaInicio}</span>}
                </div>

                {/* 4. Sección Adherentes (solo si es Familiar) */}
                {selectedPlanEnAlta?.tipo === 'familiar' && (
                  <div style={{ marginTop: '1rem', marginBottom: '0.85rem', borderTop: '1px solid var(--border)', paddingTop: '0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--heading)' }}>
                        Adherentes ({afilForm.adherentes.length}
                        {selectedPlanEnAlta.maxAdherentes && selectedPlanEnAlta.maxAdherentes > 0 ? ` de ${selectedPlanEnAlta.maxAdherentes}` : ''})
                      </span>
                    </div>

                    {/* Lista de adherentes */}
                    {afilForm.adherentes.map((adh, idx) => {
                      return (
                        <div
                          key={adh.id}
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            padding: '0.75rem',
                            marginBottom: '0.65rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#334155' }}>
                              Adherente #{idx + 1}
                            </span>
                            <button
                              type="button"
                              className="af-btn af-btn--icon af-btn--danger"
                              style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem' }}
                              title="Quitar este adherente"
                              onClick={() => handleQuitarAdherenteDraft(adh.id)}
                            >
                              ✕ Quitar
                            </button>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
                            <div>
                              <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                                DNI *
                              </label>
                              <input
                                className="af-input"
                                style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                                placeholder="DNI"
                                value={adh.dni}
                                onChange={e => handleAdherenteDniChange(adh.id, e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                                Fecha nac. *
                              </label>
                              <input
                                className="af-input"
                                type="date"
                                style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                                value={adh.fechaNacimiento}
                                onChange={e => handleAdherenteFieldChange(adh.id, 'fechaNacimiento', e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                                Apellido *
                              </label>
                              <input
                                className="af-input"
                                style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                                placeholder="Apellido"
                                value={adh.apellido}
                                onChange={e => handleAdherenteFieldChange(adh.id, 'apellido', e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                                Nombre *
                              </label>
                              <input
                                className="af-input"
                                style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                                placeholder="Nombre"
                                value={adh.nombre}
                                onChange={e => handleAdherenteFieldChange(adh.id, 'nombre', e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.15rem' }}>
                                Relación *
                              </label>
                              <select
                                className="af-select"
                                style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.84rem' }}
                                value={adh.relacion}
                                onChange={e => handleAdherenteFieldChange(adh.id, 'relacion', e.target.value)}
                              >
                                <option value="Hijo/a">Hijo/a</option>
                                <option value="Cónyuge">Cónyuge</option>
                                <option value="Otro">Otro</option>
                              </select>
                            </div>
                          </div>

                          {adh.pacienteExistenteId && (
                            <div style={{ marginTop: '0.4rem', fontSize: '0.76rem', color: '#16a34a', fontWeight: 600 }}>
                              ✓ DNI encontrado en Pacientes: {adh.pacienteExistenteNombre}. Se asociará este paciente existente a la cobertura.
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Botón Agregar adherente o aviso de máximo */}
                    {selectedPlanEnAlta.maxAdherentes && selectedPlanEnAlta.maxAdherentes > 0 && afilForm.adherentes.length >= selectedPlanEnAlta.maxAdherentes ? (
                      <div style={{ padding: '0.45rem 0.75rem', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '0.8rem', color: '#b45309', fontWeight: 600 }}>
                        Cupo máximo de adherentes alcanzado ({selectedPlanEnAlta.maxAdherentes}).
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="af-btn"
                        style={{ marginTop: '0.2rem', width: '100%', justifyContent: 'center' }}
                        onClick={() => {
                          setAfilForm(f => ({
                            ...f,
                            adherentes: [
                              ...f.adherentes,
                              {
                                id: createId(),
                                dni: '',
                                fechaNacimiento: '',
                                apellido: '',
                                nombre: '',
                                relacion: 'Hijo/a',
                              },
                            ],
                          }))
                        }}
                      >
                        + Agregar adherente
                      </button>
                    )}
                  </div>
                )}

                {afilMsg && (
                  <p className="af-msg" style={{ marginTop: '0.65rem', color: '#dc2626', fontWeight: 600 }}>
                    {afilMsg}
                  </p>
                )}
                <div className="af-modal__foot">
                  <button
                    className="af-btn af-btn--primary"
                    disabled={guardandoNuevo}
                    onClick={handleAfiliarPaciente}
                  >
                    {guardandoNuevo
                      ? 'Registrando...'
                      : selectedPlanEnAlta?.tipo === 'familiar'
                      ? 'Registrar familia'
                      : 'Registrar contratante'}
                  </button>
                  <button className="af-btn" disabled={guardandoNuevo} onClick={cerrarModalAfiliar}>
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {modal === 'ordenMedica' && (
        <NuevaOrdenMedicaModal
          afiliadoSeleccionadoId={selectedPatientId}
          onClose={() => setModal(null)}
          onPreviewPdf={({ url, filename, title, doc, hidePrint }) => {
            pdfDocRef.current = doc
            setPdfPreview({ url, filename, title, hidePrint })
          }}
        />
      )}

      {pdfPreview && (
        <PdfPreviewModal
          title={pdfPreview.title}
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          hidePrint={pdfPreview.hidePrint}
          onClose={closePdfPreview}
          onDownload={() => void handlePdfDownload()}
        />
      )}

      {accionModal?.tipo === 'cambiarCobertura' && (() => {
        const afil = afiliados.find((a) => a.id === accionModal.afiliadoId)
        const tit = afil ? (pacientes.find((p) => p.id === afil.patientId) ?? data.patients.find((p) => p.id === afil.patientId)) : undefined
        if (!afil || !tit) return null
        const planAct = todosLosPlanes.find((pl) => pl.id === afil.planId)
        const consumoTitularMes = planAct
          ? calcularConsumoAfiliadoMes({
              patientId: afil.patientId,
              anio: hoy.getFullYear(),
              mes: hoy.getMonth() + 1,
              plan: planAct,
              appointments: data.appointments ?? [],
              ordenesMedicas: data.ordenesMedicas ?? [],
            })
          : null
        return (
          <CambiarCoberturaModal
            afiliado={afil}
            titular={tit}
            planActual={planAct}
            planes={planes}
            patients={data.patients ?? []}
            tieneDeuda={isDeudor(afil.id)}
            consumoTitularMes={consumoTitularMes}
            onClose={() => setAccionModal(null)}
            onConfirm={(payload) => {
              const res = cambiarCoberturaContratante({
                afiliadoId: afil.id,
                planNuevoId: payload.planNuevoId,
                fechaVigencia: payload.fechaVigencia,
                programado: payload.programado,
                opcionAdherentes: payload.opcionAdherentes,
                nuevosAdherentes: payload.nuevosAdherentes,
                usuario: usuarioActualNombre,
              })
              setAccionModal(null)
              const reutilizadosTxt =
                res.pacientesReutilizados.length > 0
                  ? ` Se asoció paciente existente: ${res.pacientesReutilizados.join(', ')}.`
                  : ''
              if (payload.programado) {
                setToastAviso(
                  `Cambio a ${payload.planNuevoNombre} programado para el ${formatearFechaLatina(payload.fechaVigencia)}.${reutilizadosTxt}`,
                )
              } else {
                setToastAviso(
                  `Cobertura de ${tit.apellido}, ${tit.nombre} cambiada a ${payload.planNuevoNombre} desde hoy.${reutilizadosTxt}`,
                )
              }
            }}
          />
        )
      })()}

      {accionModal?.tipo === 'suspender' && (() => {
        const afil = afiliados.find((a) => a.id === accionModal.afiliadoId)
        const tit = afil ? (pacientes.find((p) => p.id === afil.patientId) ?? data.patients.find((p) => p.id === afil.patientId)) : undefined
        if (!afil || !tit) return null
        return (
          <SuspenderContratanteModal
            afiliado={afil}
            titular={tit}
            onClose={() => setAccionModal(null)}
            onConfirm={(params) => {
              suspenderContratante({
                afiliadoId: afil.id,
                motivo: params.motivo,
                desde: params.desde,
                hasta: params.hasta,
                observaciones: params.observaciones,
                usuario: usuarioActualNombre,
              })
              setAccionModal(null)
              setToastAviso(
                `Contratante ${tit.apellido}, ${tit.nombre} suspendido (${params.motivo}).`,
              )
            }}
          />
        )
      })()}

      {accionModal?.tipo === 'baja' && (() => {
        const afil = afiliados.find((a) => a.id === accionModal.afiliadoId)
        const tit = afil ? (pacientes.find((p) => p.id === afil.patientId) ?? data.patients.find((p) => p.id === afil.patientId)) : undefined
        if (!afil || !tit) return null
        return (
          <DarDeBajaContratanteModal
            afiliado={afil}
            titular={tit}
            onClose={() => setAccionModal(null)}
            onConfirm={(params) => {
              darDeBajaContratante({
                afiliadoId: afil.id,
                motivo: params.motivo,
                fechaBaja: params.fechaBaja,
                usuario: usuarioActualNombre,
              })
              setAccionModal(null)
              if (selectedPatientId === afil.patientId) {
                setSelectedPatientId(null)
              }
              setToastAviso(
                `Contratante ${tit.apellido}, ${tit.nombre} dado de baja. Se restauró la obra social anterior.`,
              )
            }}
          />
        )
      })()}

      {toastAviso && (
        <div className="af-toast" role="status" aria-live="polite">
          <span>✓ {toastAviso}</span>
          <button
            type="button"
            className="af-toast__close"
            onClick={() => setToastAviso(null)}
            title="Cerrar aviso"
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
