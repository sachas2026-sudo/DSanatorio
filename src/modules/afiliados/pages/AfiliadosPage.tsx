import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useAppState } from '../../../context/AppStateContext'
import { useConfirm } from '../../../context/ConfirmContext'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { pdfBlobUrl, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { buildAfiliadosPagosPdf } from '../../../lib/afiliadosPagosPdf'
import { buildAfiliadoComprobantePdf } from '../../../lib/afiliadoComprobantePdf'
import { preloadPdfHeaderBanner } from '../../../lib/pdfHeaderBanner'
import type jsPDF from 'jspdf'
import { pacientesActivos } from '../../../lib/activo'
import { afiliadoTieneCuotasImpagas, consumoPlanDelMes } from '../../../lib/cobertura'
import { createId } from '../../../lib/id'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { PlanAfiliado, CuotaMensual, Patient } from '../../../types'
import { IconPrinter, IconTrash, IconWhatsApp } from '../../../shared/components/icons'
import '../../../shared/styles/pages.css'
import './AfiliadosModern.css'

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

const PLANES_DEFAULT: Omit<PlanAfiliado, 'id'>[] = [
  { nombre: 'Plan Estándar', precio: 0, descripcion: '', activo: true, cupoConsultas: 0 },
  { nombre: 'Plan Plus',     precio: 0, descripcion: '', activo: true, cupoConsultas: 0 },
  { nombre: 'Plan Ultra',    precio: 0, descripcion: '', activo: true, cupoConsultas: 0 },
]

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

type ModalAbierto = 'plan' | 'afiliar' | null

export function AfiliadosPage() {
  const {
    data,
    upsertPlanAfiliado,
    deletePlanAfiliado,
    upsertAfiliado,
    deleteAfiliado,
    upsertCuotaMensual,
  } = useAppState()
  const { confirm } = useConfirm()

  const hoy = new Date()

  // ── Estado de presentación (nuevo diseño) ──────────────────────────
  const [modal, setModal] = useState<ModalAbierto>(null)      // qué formulario está abierto
  const [planFiltro, setPlanFiltro] = useState<string | null>(null) // plan activo del filtro
  const [expandidoId, setExpandidoId] = useState<string | null>(null) // fila desplegada

  const [search, setSearch] = useState('')
  const [cuotaAnio, setCuotaAnio] = useState(hoy.getFullYear())
  const [pagoDrafts, setPagoDrafts] = useState<Record<string, { formaPago: NonNullable<CuotaMensual['formaPago']>; comprobante: boolean }>>({})
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string; title: string } | null>(null)

  // Planes
  // `cupoConsultas` es opcional en el formulario: vacío significa 0 (sin cupo).
  const [planForm, setPlanForm] = useState<Omit<PlanAfiliado, 'id' | 'cupoConsultas'> & { id?: string; cupoConsultas?: number }>({ nombre: '', precio: 0, descripcion: '', activo: true, cupoConsultas: 0 })

  // Afiliado form
  const [afilForm, setAfilForm] = useState<{ patientId: string; planId: string; fechaInicio: string }>({ patientId: '', planId: '', fechaInicio: format(hoy, 'yyyy-MM-dd') })
  const [afilMsg, setAfilMsg] = useState<string | null>(null)

  // Todos los planes (incluidos inactivos) para poder administrationlos
  const todosLosPlanes = useMemo(() => data.planesAfiliados ?? [], [data.planesAfiliados])
  const planes = useMemo(() => todosLosPlanes.filter(p => p.activo), [todosLosPlanes])
  const afiliados = useMemo(() => data.afiliados ?? [], [data.afiliados])
  const cuotas = useMemo(() => data.cuotasAfiliados ?? [], [data.cuotasAfiliados])
  const pacientes = useMemo(() => pacientesActivos(data.patients), [data.patients])

  // Pacientes no afiliados aún
  const afiliadosPatientIds = useMemo(() => new Set(afiliados.filter(a => a.activo).map(a => a.patientId)), [afiliados])

  // Cuántos afiliados tiene cada plan (para las tarjetas)
  const conteoPorPlan = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of afiliados) m.set(a.planId, (m.get(a.planId) ?? 0) + 1)
    return m
  }, [afiliados])

  // ──.selected: la fila desplegada ───────────────────────────────────
  const selectedAfiliado = afiliados.find(a => a.id === expandidoId) ?? null
  const selectedPaciente: Patient | null = selectedAfiliado ? (pacientes.find(p => p.id === selectedAfiliado.patientId) ?? null) : null
  const selectedPlan: PlanAfiliado | null = selectedAfiliado ? (todosLosPlanes.find(p => p.id === selectedAfiliado.planId) ?? null) : null

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
      : `pagos-afiliado-${cuotaAnio}.pdf`
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
      titulo: 'CENTRO MEDICO - PLAN DE SALUD',
      encabezadoSecundario: scope === 'selected'
        ? `${pacienteNombre}${pacienteDni}`
        : `Todos los afiliados - ${afiliadosParaPdf.length} pacientes`,
      filename: scope === 'selected'
        ? nombreArchivoAfiliado
        : `lista-pacientes-pagos-${cuotaAnio}.pdf`,
    })
    pdfDocRef.current = built.doc
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: scope === 'selected'
        ? `Pagos del afiliado ${cuotaAnio}`
        : `Pacientes y pagos ${cuotaAnio} (${built.count})`,
    })
  }

  async function handlePdfDownload() {
    if (!pdfDocRef.current || !pdfPreview?.filename) return
    await savePdfFile(pdfDocRef.current, pdfPreview.filename)
  }

  async function handleComprobantePago(cuota: CuotaMensual, nombreMes: string) {
    if (!selectedPaciente || !selectedAfiliado) return
    await preloadPdfHeaderBanner()
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
    await preloadPdfHeaderBanner()
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
      titulo: 'CENTRO MEDICO - PLAN DE SALUD',
      encabezadoSecundario: `Afiliados con deuda - ${deudores.length} paciente${deudores.length !== 1 ? 's' : ''}`,
      filename: `afiliados-deudores-${cuotaAnio}.pdf`,
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
      titulo: 'CENTRO MEDICO - PLAN DE SALUD',
      encabezadoSecundario: `Afiliados al día - ${alDia.length} paciente${alDia.length !== 1 ? 's' : ''}`,
      filename: `afiliados-al-dia-${cuotaAnio}.pdf`,
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

  // ══════════════════════════════════════════════════════════════════
  //  Filtrado de la tabla (búsqueda + plan)
  // ══════════════════════════════════════════════════════════════════
  const filteredAfiliados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return afiliados.filter(a => {
      if (planFiltro && a.planId !== planFiltro) return false
      const p = pacientes.find(x => x.id === a.patientId)
      if (!p) return false
      if (!q) return true
      return (
        p.nombre.toLowerCase().includes(q) ||
        p.apellido.toLowerCase().includes(q) ||
        p.dni.toLowerCase().includes(q)
      )
    })
  }, [afiliados, pacientes, search, planFiltro])

  // ── Año inicial según cuándo se afilió ────────────────────────────
  const startYear = useMemo(() => {
    if (!selectedAfiliado || !selectedAfiliado.fechaInicio) return null
    const parts = selectedAfiliado.fechaInicio.split('-')
    const y = parseInt(parts[0], 10)
    return isNaN(y) ? null : y
  }, [selectedAfiliado])

  useEffect(() => {
    if (startYear !== null && cuotaAnio < startYear) {
      setCuotaAnio(startYear)
    }
  }, [startYear, cuotaAnio])

  const cuotasDelAnio = useMemo(() => {
    if (!selectedAfiliado) return []
    return cuotas.filter(c => c.afiliadoId === selectedAfiliado.id && c.anio === cuotaAnio)
  }, [cuotas, selectedAfiliado, cuotaAnio])

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

  // ── Acciones de alta ──────────────────────────────────────────────
  function handleAfiliarPaciente() {
    setAfilMsg(null)
    if (!afilForm.patientId) { setAfilMsg('Seleccioná un paciente.'); return }
    if (!afilForm.planId) { setAfilMsg('Seleccioná un plan.'); return }
    if (afiliadosPatientIds.has(afilForm.patientId)) { setAfilMsg('Este paciente ya está afiliado.'); return }
    upsertAfiliado({ patientId: afilForm.patientId, planId: afilForm.planId, fechaInicio: afilForm.fechaInicio, activo: true })
    setAfilForm({ patientId: '', planId: '', fechaInicio: format(hoy, 'yyyy-MM-dd') })
    setModal(null)
  }

  async function handleEliminarAfiliado(id: string) {
    const ok = await confirm({
      titleLogo: true,
      message: '¿Querés eliminar este afiliado y sus cuotas asociadas?',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
    })
    if (!ok) return
    deleteAfiliado(id)
    if (expandidoId === id) setExpandidoId(null)
  }

  function abrirPlanNuevo() {
    setPlanForm({ nombre: '', precio: 0, descripcion: '', activo: true, cupoConsultas: 0 })
    setModal('plan')
  }

  function abrirPlanEdicion(p: PlanAfiliado) {
    setPlanForm({
      id: p.id,
      nombre: p.nombre,
      precio: p.precio,
      descripcion: p.descripcion,
      activo: p.activo,
      // Los planes guardados antes de existir el cupo vienen como 0 (sin cupo).
      cupoConsultas: p.cupoConsultas ?? 0,
    })
    setModal('plan')
  }

  function handleSavePlan() {
    if (!planForm.nombre.trim()) return
    // El campo vacío del formulario es 0 (sin cupo), no undefined.
    upsertPlanAfiliado({ ...planForm, cupoConsultas: planForm.cupoConsultas ?? 0 })
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

  // ══════════════════════════════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════════════════════════════
  const pagadas = cuotasDelAnio.filter(c => c.estado === 'pagado').length
  const pendientes = cuotasDelAnio.filter(c => c.estado === 'pendiente').length
  const totalCobrado = cuotasDelAnio.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const totalAdeudado = cuotasDelAnio.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
  // Atenciones ya registradas en la cuota del mes en curso. Es el contador que
  // después se compara con el cupo del plan; hoy no bloquea nada.
  const usosDelMes =
    cuotasDelAnio.find(c => c.mes === new Date().getMonth() + 1 && c.anio === new Date().getFullYear())?.usos ?? 0

  return (
    <div className="page af-page">
      {/* ── Encabezado ── */}
      <div className="af-head">
        <h1>Afiliados</h1>
      </div>

      {/* ── PLANES ARRIBA ── */}
      <section className="af-card">
        <div className="af-card__title af-card__title--bar">
          <span>Planes</span>
          <span className="af-count">{planes.length} activos</span>
          {/* Las acciones de la página viven en la barra de Planes, arriba a la
              derecha, para que el encabezado quede sólo con el título. */}
          <div className="af-card__actions">
            <button className="af-btn" onClick={() => void handlePdfDeudores()}>PDF deudores</button>
            <button className="af-btn" onClick={() => void handlePdfAlDia()}>PDF al día</button>
            <button className="af-btn" onClick={() => void handlePdfPreview('all')}>PDF todos</button>
            <button className="af-btn af-btn--primary" onClick={() => { setAfilMsg(null); setModal('afiliar') }}>
              Nuevo Afiliado
            </button>
          </div>
        </div>

        {planes.length === 0 ? (
          <>
            <p className="af-hint" style={{ marginBottom: '0.7rem' }}>
              Todavía no hay planes. Creá el primero para poder afiliar pacientes.
            </p>
            <button className="af-btn af-btn--primary" onClick={initPlanes}>Crear planes por defecto</button>
          </>
        ) : (
          <div className="af-planes-row">
            <div className="af-planes">
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
                    <span className="af-plan__count">{n} {n === 1 ? 'afiliado' : 'afiliados'}</span>
                    {/* El cupo se muestra en la tarjeta para no abrir el plan
                        sólo por eso. 0 = sin límite, no se rotula nada. */}
                    {(p.cupoConsultas ?? 0) > 0 && (
                      <span
                        className="af-plan__cupo"
                        title={`${p.cupoConsultas} consultas gratuitas por mes`}
                      >
                        {p.cupoConsultas} consul./mes
                      </span>
                    )}
                    <button
                      className="af-btn af-btn--icon"
                      title="Editar plan"
                      aria-label={`Editar plan ${p.nombre}`}
                      onClick={e => { e.stopPropagation(); abrirPlanEdicion(p) }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    </button>
                    <button
                      className="af-btn af-btn--icon af-btn--danger"
                      title="Eliminar plan"
                      aria-label={`Eliminar plan ${p.nombre}`}
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
              Nuevo plan
            </button>

            </div>

            {/* ── Filtro por plan: a la derecha, en la misma fila que las tarjetas ── */}
            <div className="af-filter">
              <button
                type="button"
                className={`af-chip${planFiltro === null ? ' af-chip--on' : ''}`}
                aria-pressed={planFiltro === null}
                onClick={() => setPlanFiltro(null)}
              >
                Todas ({afiliados.length})
              </button>
              {planes.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`af-chip${planFiltro === p.id ? ' af-chip--on' : ''}`}
                  aria-pressed={planFiltro === p.id}
                  onClick={() => setPlanFiltro(planFiltro === p.id ? null : p.id)}
                >
                  {p.nombre} ({conteoPorPlan.get(p.id) ?? 0})
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── AFILIADOS (filas expandibles) ── */}
      <section className="af-card af-card--list">
        {/* Con un afiliado desplegado se oculta el encabezado del listado
            (buscador y contador): en pantalla sólo queda su detalle. */}
        {!expandidoId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
          <h2 className="af-card__title" style={{ margin: 0 }}>Afiliados</h2>
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
              placeholder="Buscar por nombre o DNI…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        )}

        <div className={`af-table-wrap${expandidoId ? ' af-table-wrap--solo' : ''}`}>
          <table className="af-table">
            <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Lista de afiliados; desplegá una fila para ver sus cuotas del año.
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 34 }}><span className="af-sr">Desplegar</span></th>
                <th scope="col">Paciente</th>
                <th scope="col">Plan</th>
                <th scope="col">Desde</th>
                <th scope="col">Estado</th>
                <th scope="col" className="af-num">Total Atención</th>
                <th scope="col" className="af-num">Adeudado</th>
              </tr>
            </thead>
            <tbody>
              {filteredAfiliados.length === 0 && (
                <tr><td colSpan={7} className="af-empty">No hay afiliados para este filtro.</td></tr>
              )}

              {filteredAfiliados.map(a => {
                const p = pacientes.find(x => x.id === a.patientId)
                const plan = todosLosPlanes.find(x => x.id === a.planId)
                const abierto = a.id === expandidoId
                const deudor = isDeudor(a.id)
                const delAnio = cuotas.filter(c => c.afiliadoId === a.id && c.anio === cuotaAnio)
                const adeudado = delAnio.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
                return (
                  <React.Fragment key={a.id}>
                    <tr
                      className={`af-row${abierto ? ' af-row--open' : ''}`}
                      onClick={() => toggleFila(a.id)}
                      tabIndex={0}
                      aria-expanded={abierto}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleFila(a.id)
                        }
                      }}
                    >
                      <td><Caret abierto={abierto} /></td>
                      <td>
                        {/* Nombre y DNI en una sola línea: antes ocupaban dos
                            renglones y la fila quedaba más alta de lo necesario. */}
                        <span className="af-cell-paciente">
                          <span className="af-row__name">{p?.apellido}, {p?.nombre}</span>
                          <span className="af-row__sub">DNI {p?.dni || '—'}</span>
                        </span>
                      </td>
                      <td>{plan?.nombre ?? '—'}</td>
                      <td className="af-row__sub">{a.fechaInicio}</td>
                      <td>
                        {deudor
                          ? <span className="af-badge af-badge--warn">Deudor</span>
                          : <span className="af-badge af-badge--ok">Al día</span>}
                      </td>
                      <td className="af-num">
                        {(() => {
                          const { usos, cupo, agotado } = consumoPlanDelMes(a, plan, cuotas, hoy)
                          if (cupo <= 0) {
                            return (
                              <span className="af-atencion af-atencion--libre" title="Este plan no tiene cupo de consultas">
                                {usos}
                              </span>
                            )
                          }
                          return (
                            <span
                              className={`af-atencion${agotado ? ' af-atencion--lleno' : ''}`}
                              title={
                                agotado
                                  ? 'Cupo agotado: no puede atender por el plan hasta el mes que viene.'
                                  : `Le quedan ${cupo - usos} consultas este mes.`
                              }
                            >
                              <strong>{usos}</strong>/{cupo}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="af-num">
                        {adeudado > 0
                          ? <span style={{ color: '#d97706', fontWeight: 700 }}>${adeudado.toLocaleString('es-AR')}</span>
                          : <span style={{ color: '#6b7c93' }}>—</span>}
                      </td>
                    </tr>

                    {/* ── Detalle expandido: 12 cuotas ── */}
                    {abierto && (
                      <tr className="af-detail">
                        <td colSpan={7} style={{ padding: '0.5rem 0.85rem 0.9rem' }}>
                          <div className="af-detail__head">
                            <span className="af-detail__title">
                              Cuotas {cuotaAnio} — {p?.apellido}, {p?.nombre}
                            </span>
                            <span className="af-badge af-badge--info af-badge--plan">
                              {plan?.nombre ?? '—'} · ${(selectedPlan?.precio ?? 0).toLocaleString('es-AR')}/mes
                            </span>
                            {/* Al drill-down el resto de la lista queda oculto:
                                este botón es la única forma de volver atrás. Va
                                después del plan para no cortar el título de la
                                izquierda. */}
                            <button
                              type="button"
                              className="af-btn af-btn--volver"
                              aria-label="Volver al listado de afiliados"
                              onClick={() => setExpandidoId(null)}
                            >
                              <span aria-hidden="true">←</span> Volver
                            </button>

                            <div className="af-year" style={{ marginLeft: 'auto' }}>
                              <button
                                type="button"
                                className="af-year__btn"
                                disabled={startYear !== null && cuotaAnio <= startYear}
                                aria-label="Año anterior"
                                onClick={() => setCuotaAnio(y => y - 1)}
                              >
                                ◀
                              </button>
                              <span className="af-year__val">{cuotaAnio}</span>
                              <button
                                type="button"
                                className="af-year__btn"
                                aria-label="Año siguiente"
                                onClick={() => setCuotaAnio(y => y + 1)}
                              >
                                ▶
                              </button>
                            </div>

                            <button
                              className="af-btn"
                              onClick={() => void handlePdfPreview('selected')}
                              title="Generar PDF de este afiliado"
                            >
                              PDF afiliado
                            </button>
                            <button
                              className="af-btn af-btn--icon af-btn--danger"
                              aria-label="Eliminar afiliado"
                              title="Eliminar afiliado"
                              onClick={() => void handleEliminarAfiliado(a.id)}
                            >
                              <IconTrash />
                            </button>
                          </div>

                          <div className="af-table-wrap" style={{ border: '1px solid var(--border)' }}>
                            <table className="af-cuotas">
                              <thead>
                                <tr>
                                  <th scope="col">Mes</th>
                                  <th scope="col" className="af-num">Monto</th>
                                  <th scope="col">Estado</th>
                                  <th scope="col">Fecha pago</th>
                                  <th scope="col">Forma de pago</th>
                                  <th scope="col">Comprobante</th>
                                  <th scope="col">Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {MESES.map((nombreMes, i) => {
                                  const mes = i + 1
                                  const cuota = getCuotaMes(mes)
                                  return (
                                    <tr key={mes} style={{ height: '38px' }}>
                                      <td>{nombreMes}</td>
                                      <td className="af-num">${(cuota ? cuota.monto : (selectedPlan?.precio ?? 0)).toLocaleString('es-AR')}</td>
                                      <td>
                                        {cuota ? (
                                          <span
                                            className={`af-badge ${cuota.estado === 'pagado' ? 'af-badge--ok' : 'af-badge--warn'}`}
                                            style={{ color: estadoColor(cuota.estado) }}
                                          >
                                            {estadoLabel(cuota.estado)}
                                          </span>
                                        ) : (
                                          <span className="af-badge af-badge--muted">Sin cuota</span>
                                        )}
                                      </td>
                                      <td>
                                        {cuota?.estado === 'pagado' ? (
                                          /* Sólo el input nativo: antes se dibujaba
                                             además un texto con la fecha, lo que
                                             duplicaba el dato y ensanchaba la columna. */
                                          <input
                                            className="af-date-input"
                                            type="date"
                                            aria-label={`Cambiar fecha de pago de ${nombreMes}`}
                                            title={cuota.fechaPago ?? undefined}
                                            value={cuota.fechaPago ?? ''}
                                            onChange={e => actualizarFechaPago(cuota, e.target.value)}
                                          />
                                        ) : '—'}
                                      </td>
                                      <td>
                                        <select
                                          aria-label={`Forma de pago de ${nombreMes}`}
                                          value={pagoDraft(mes, cuota).formaPago}
                                          onChange={e => actualizarPagoDraft(mes, { formaPago: e.target.value as NonNullable<CuotaMensual['formaPago']> }, cuota)}
                                        >
                                          <option value="efectivo">Efectivo</option>
                                          <option value="transferencia">Transferencia</option>
                                          <option value="deposito">Depósito</option>
                                          <option value="mercadopago">Mercado Pago</option>
                                        </select>
                                      </td>
                                      <td>
                                        <select
                                          aria-label={`Comprobante de ${nombreMes}`}
                                          value={pagoDraft(mes, cuota).comprobante ? 'si' : 'no'}
                                          onChange={e => actualizarPagoDraft(mes, { comprobante: e.target.value === 'si' }, cuota)}
                                        >
                                          <option value="si">Sí</option>
                                          <option value="no">No</option>
                                        </select>
                                      </td>
                                      <td>
                                        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                          {cuota?.estado === 'pagado' ? (
                                            <>
                                              <button
                                                className="af-btn"
                                                style={{ background: '#fef3c7', borderColor: '#f6dfa8', color: '#b45309', padding: '0.2rem 0.55rem', fontSize: '0.76rem' }}
                                                onClick={() => handleMarcarPendiente(mes)}
                                              >
                                                Anular
                                              </button>
                                              <button
                                                className="af-btn"
                                                style={{ background: '#dbeafe', borderColor: '#bfdbfe', color: '#1d4ed8', padding: '0.2rem 0.55rem', fontSize: '0.76rem' }}
                                                onClick={() => void handleComprobantePago(cuota, nombreMes)}
                                              >
                                                PDF
                                              </button>
                                              <button
                                                type="button"
                                                className="af-btn af-btn--icon"
                                                style={{ background: '#e0f2fe', borderColor: '#bae6fd', color: '#0369a1' }}
                                                aria-label="Imprimir comprobante"
                                                title="Imprimir comprobante"
                                                onClick={() => void handleImprimirComprobante(cuota, nombreMes)}
                                              >
                                                <IconPrinter />
                                              </button>
                                              <button
                                                type="button"
                                                className="af-btn af-btn--icon"
                                                style={{ background: '#dcfce7', borderColor: '#bbf7d0', color: '#16a34a' }}
                                                aria-label="Enviar comprobante por WhatsApp"
                                                title="Enviar comprobante por WhatsApp"
                                                onClick={() => void handleWhatsAppComprobante(cuota, nombreMes)}
                                              >
                                                <IconWhatsApp />
                                              </button>
                                            </>
                                          ) : (
                                            <button
                                              className="af-btn"
                                              style={{ background: '#dcfce7', borderColor: '#bbf7d0', color: '#16a34a', padding: '0.2rem 0.55rem', fontSize: '0.76rem' }}
                                              onClick={() => handleRegistrarPago(mes)}
                                            >
                                              Registrar pago
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Totales del año visible */}
                          <div className="af-resumen">
                            <span><strong>{pagadas}</strong> pagadas</span>
                            <span><strong>{pendientes}</strong> pendientes</span>
                            {/* Cuota consumida del mes visible contra el cupo del
                                plan. Todavía no bloquea el agendamiento. */}
                            <span
                              className="af-resumen__usos"
                              title="Consultas cubiertas por el plan este mes"
                            >
                              <strong>{usosDelMes}</strong>
                              {(selectedPlan?.cupoConsultas ?? 0) > 0
                                ? ` de ${selectedPlan?.cupoConsultas} consultas`
                                : ' consultas'}
                            </span>
                            <span className="af-resumen__total" style={{ color: '#d97706' }}>
                              Total adeudado: ${totalAdeudado.toLocaleString('es-AR')}
                            </span>
                            <span className="af-resumen__total" style={{ color: '#16a34a', marginLeft: 0 }}>
                              Total cobrado: ${totalCobrado.toLocaleString('es-AR')}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── MODAL: plan (alta / edición) ── */}
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
              {planForm.id ? 'Editar plan' : 'Nuevo plan'}
            </h3>
            <div className="af-field">
              <label htmlFor="af-plan-nombre">Nombre del plan</label>
              <input
                id="af-plan-nombre"
                className="af-input"
                value={planForm.nombre}
                onChange={e => setPlanForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Plan Estándar"
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
            </div>
            <div className="af-field">
              <label htmlFor="af-plan-cupo">Cantidad de Consultas</label>
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
              <span className="af-hint">Consultas gratuitas por mes. 0 = sin límite.</span>
            </div>
            <div className="af-field">
              <label htmlFor="af-plan-desc">Descripción (opcional)</label>
              <input
                id="af-plan-desc"
                className="af-input"
                value={planForm.descripcion}
                onChange={e => setPlanForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Qué incluye este plan…"
              />
            </div>
            <div className="af-modal__foot">
              <button className="af-btn af-btn--primary" onClick={handleSavePlan}>Guardar</button>
              <button className="af-btn" onClick={() => setModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: afiliar paciente ── */}
      {modal === 'afiliar' && (
        <div className="af-backdrop" onClick={() => setModal(null)}>
          <div
            className="af-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="af-modal-afiliar"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="af-modal__title" id="af-modal-afiliar">Afiliar paciente</h3>
            {planes.length === 0 ? (
              <p className="af-hint">Primero creá un plan para poder afiliar pacientes.</p>
            ) : (
              <>
                <div className="af-field">
                  <label htmlFor="af-fil-paciente">Paciente</label>
                  <select
                    id="af-fil-paciente"
                    className="af-select"
                    value={afilForm.patientId}
                    onChange={e => setAfilForm(f => ({ ...f, patientId: e.target.value }))}
                  >
                    <option value="">— Seleccionar —</option>
                    {pacientes
                      .filter(p => !afiliadosPatientIds.has(p.id))
                      .sort((a, b) => a.apellido.localeCompare(b.apellido, 'es'))
                      .map(p => (
                        <option key={p.id} value={p.id}>{p.apellido}, {p.nombre}</option>
                      ))}
                  </select>
                </div>
                <div className="af-field">
                  <label htmlFor="af-fil-plan">Plan</label>
                  <select
                    id="af-fil-plan"
                    className="af-select"
                    value={afilForm.planId}
                    onChange={e => setAfilForm(f => ({ ...f, planId: e.target.value }))}
                  >
                    <option value="">— Seleccionar plan —</option>
                    {planes.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} — ${p.precio.toLocaleString('es-AR')}/mes
                      </option>
                    ))}
                  </select>
                </div>
                <div className="af-field">
                  <label htmlFor="af-fil-fecha">Fecha de inicio</label>
                  <input
                    id="af-fil-fecha"
                    className="af-input"
                    type="date"
                    value={afilForm.fechaInicio}
                    onChange={e => setAfilForm(f => ({ ...f, fechaInicio: e.target.value }))}
                  />
                </div>
                {afilMsg && <p className="af-msg">{afilMsg}</p>}
                <div className="af-modal__foot">
                  <button className="af-btn af-btn--primary" onClick={handleAfiliarPaciente}>Afiliar paciente</button>
                  <button className="af-btn" onClick={() => setModal(null)}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pdfPreview && (
        <PdfPreviewModal
          title={pdfPreview.title}
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          onClose={closePdfPreview}
          onDownload={() => void handlePdfDownload()}
        />
      )}
    </div>
  )
}