import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useVirtualSlice } from '../../../hooks/useVirtualSlice'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { PacienteHistorialSection } from '../components/PacienteHistorialSection'
import { ObrasSocialesModal } from '../components/ObrasSocialesModal'
import { LocalidadesModal } from '../components/LocalidadesModal'
import { IconList } from '../../../shared/components/icons'
import { useAppState } from '../../../context/AppStateContext'
import { useAuth } from '../../../context/AuthContext'
import { useConfirm } from '../../../context/ConfirmContext'
import {
  pacientesActivos,
  pacientesSuspendidos,
} from '../../../lib/activo'
import {
  DNI_PAC_LABEL,
  dniPacDuplicadoMsg,
  ultimoDniPacCorto,
} from '../../../lib/dniLabels'
import {
  canExportPacientesListado,
  EXPORT_DENIED_MESSAGE,
} from '../../../lib/exportPermissions'
import { pdfBlobUrl, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { normalizeObraSocial } from '../../../lib/obrasSociales'
import { normalizeLocalidad } from '../../../lib/localidadesMisiones'
import { edadDesdeFechaNacimientoLabel } from '../../../lib/patientAge'
import { preloadPdfHeaderBanner } from '../../../lib/pdfHeaderBanner'
import { afiliadoTieneCuotasImpagas } from '../../../lib/cobertura'
import {
  buildPacientesPdf,
  pacientesPdfPreviewTitle,
} from '../../../lib/pacientesPdf'
import type { CoberturaTipo, Patient } from '../../../types'
import type jsPDF from 'jspdf'
import '../../../shared/styles/pages.css'
import './PacientesModern.css'

const emptyForm: Omit<Patient, 'id'> = {
  nombre: '',
  apellido: '',
  dni: '',
  telefono: '',
  email: '',
  domicilio: '',
  localidad: 'Puerto Piray',
  fechaNacimiento: '',
  obraSocial: '',
  notas: '',
}

function IconPulse({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function IconShieldProtected({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}

function IconUserCard({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function IconFunnel({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

function IconPdf({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function IconEditPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}

function IconPauseAction({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function IconPlayAction({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function IconTrashAction({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

function IconClipboard({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  )
}

export function PacientesPage() {
  const {
    data,
    upsertPatient,
    setPatientActivo,
    deletePatient,
    obrasSocialesOpciones,
    addObraSocialCustom,
    removeObraSocialCustom,
    renameObraSocialCustom,
    localidadesOpciones,
    addLocalidadCustom,
    removeLocalidadCustom,
    renameLocalidadCustom,
  } = useAppState()
  const { confirm } = useConfirm()
  const { role } = useAuth()
  const puedeExportPdf = canExportPacientesListado(role)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [summaryPatientId, setSummaryPatientId] = useState<string | null>(null)
  const [osModalOpen, setOsModalOpen] = useState(false)
  const [locModalOpen, setLocModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [dniMsg, setDniMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [listFilter, setListFilter] = useState<'todos' | 'activos' | 'suspendidos'>('activos')

  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)

  const edadLabel = useMemo(
    () => edadDesdeFechaNacimientoLabel(form.fechaNacimiento),
    [form.fechaNacimiento],
  )

  const countActivos = useMemo(
    () => pacientesActivos(data.patients).length,
    [data.patients],
  )

  const countSuspendidos = useMemo(
    () => pacientesSuspendidos(data.patients).length,
    [data.patients],
  )

  /**
   * Plan de cada paciente que está afiliado, con su estado de pago.
   * El plan es un dato aparte de la obra social: el paciente puede tener las
   * dos. Se calcula una vez por cambio de estado porque la tabla es
   * virtualizada y se recalcular por fila se nota.
   */
  const planPorPaciente = useMemo(() => {
    const hoy = new Date()
    const mapa = new Map<string, { nombre: string; alDia: boolean; motivo: string }>()
    for (const a of data.afiliados ?? []) {
      if (!a.activo || mapa.has(a.patientId)) continue
      const plan = (data.planesAfiliados ?? []).find((p) => p.id === a.planId)
      if (!plan) continue
      const alDia = !afiliadoTieneCuotasImpagas(a, data.cuotasAfiliados ?? [], hoy)
      mapa.set(a.patientId, {
        nombre: plan.nombre,
        alDia,
        motivo: !plan.activo
          ? `El plan "${plan.nombre}" está dado de baja.`
          : alDia
            ? ''
            : 'Tiene cuotas impagas: no puede attenderse por el plan hasta regularizar.',
      })
    }
    return mapa
  }, [data.afiliados, data.planesAfiliados, data.cuotasAfiliados])

  /** Plan del paciente que se está editando (la ficha sólo lo muestra). */
  const planInfo = editingId ? planPorPaciente.get(editingId) ?? null : null

  /** Pacientes activos agrupados por Obra Social (top 6 + Otras). */
  const obraSocialChart = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of pacientesActivos(data.patients)) {
      const os = p.obraSocial?.trim() || 'Particular'
      counts.set(os, (counts.get(os) ?? 0) + 1)
    }
    const all = [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'es'))
    const top = all.slice(0, 6)
    const resto = all.slice(6).reduce((s, x) => s + x.value, 0)
    if (resto > 0) top.push({ label: 'Otras', value: resto })
    const max = top.reduce((m, x) => Math.max(m, x.value), 0)
    return { items: top, max, total: all.length }
  }, [data.patients])

  function openNewModal() {
    setEditingId(null)
    setForm(emptyForm)
    setDniMsg(null)
    setModalOpen(true)
  }

  function openEditModal(p: Patient) {
    setEditingId(p.id)
    setForm({
      nombre: p.nombre,
      apellido: p.apellido,
      dni: p.dni,
      telefono: p.telefono,
      email: p.email,
      domicilio: p.domicilio ?? '',
      localidad: p.localidad ?? 'Puerto Piray',
      fechaNacimiento: p.fechaNacimiento,
      obraSocial: p.obraSocial ?? '',
      notas: p.notas,
      coberturaPreferida: p.coberturaPreferida,
    })
    setDniMsg(null)
    setModalOpen(true)
  }

  function openSummaryModal(p: Patient) {
    setSummaryPatientId(p.id)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setDniMsg(null)
  }

  function closeSummaryModal() {
    setSummaryPatientId(null)
  }

  async function handleSuspend(id: string) {
    const ok = await confirm({
      message:
        '¿Suspender este paciente?\n\nNo aparecerá en la lista activa ni en la agenda para turnos nuevos. Turnos, pagos y pagos cancelados quedan en el historial.',
    })
    if (!ok) return
    setPatientActivo(id, false)
    if (editingId === id) closeModal()
  }

  async function handleReactivate(id: string) {
    setPatientActivo(id, true)
    setListFilter('activos')
    const p = data.patients.find((x) => x.id === id)
    if (p) openEditModal(p)
  }

  async function handleDelete(p: Patient) {
    const turnos = data.appointments.filter((a) => a.patientId === p.id).length
    const pagos = data.payments.filter((pay) => pay.patientId === p.id).length
    const cancelados = data.pagosCancelados.filter(
      (r) => r.payment.patientId === p.id,
    ).length
    const atenciones = data.atencionesSinTurno.reduce(
      (n, list) => n + list.filas.filter((f) => f.patientId === p.id).length,
      0,
    )
    const vinculos: string[] = []
    if (turnos > 0) {
      vinculos.push(`${turnos} turno${turnos === 1 ? '' : 's'}`)
    }
    if (pagos > 0) {
      vinculos.push(`${pagos} pago${pagos === 1 ? '' : 's'}`)
    }
    if (cancelados > 0) {
      vinculos.push(
        `${cancelados} pago${cancelados === 1 ? '' : 's'} cancelado${cancelados === 1 ? '' : 's'}`,
      )
    }
    if (atenciones > 0) {
      vinculos.push(
        `${atenciones} atención${atenciones === 1 ? '' : 'es'} sin turno`,
      )
    }
    const detalleVinculos = vinculos.length
      ? `\n\nTambién se borrarán: ${vinculos.join(', ')}.`
      : ''
    const ok = await confirm({
      title: 'Eliminar paciente',
      message: `¿Eliminar permanentemente a ${p.apellido}, ${p.nombre}?\n\nEsta acción no se puede deshacer.${detalleVinculos}`,
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deletePatient(p.id)
    if (editingId === p.id) closeModal()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim() || !form.apellido.trim()) return
    const dniNorm = String(form.dni ?? '').trim()
    if (dniNorm) {
      const dup = data.patients.find(
        (p) => p.dni?.trim() === dniNorm && p.id !== editingId,
      )
      if (dup) {
        setDniMsg(dniPacDuplicadoMsg(dup.apellido, dup.nombre, true))
        return
      }
    }
    upsertPatient({ ...form, id: editingId ?? undefined })
    closeModal()
  }

  const listScrollRef = useRef<HTMLDivElement>(null)
  const PACIENTE_ROW_HEIGHT = 40

  const listSource = useMemo(() => {
    if (listFilter === 'activos') return pacientesActivos(data.patients)
    if (listFilter === 'suspendidos') return pacientesSuspendidos(data.patients)
    return data.patients
  }, [data.patients, listFilter])

  const sorted = useMemo(
    () =>
      [...listSource].sort((a, b) =>
        `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
          sensitivity: 'base',
        }),
      ),
    [listSource],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((p) => {
      const dni = (p.dni ?? '').toLowerCase()
      const apellido = (p.apellido ?? '').toLowerCase()
      const nombre = (p.nombre ?? '').toLowerCase()
      const obraSocial = (p.obraSocial ?? '').toLowerCase()
      const tel = (p.telefono ?? '').toLowerCase()
      return (
        dni.includes(q) ||
        apellido.includes(q) ||
        nombre.includes(q) ||
        obraSocial.includes(q) ||
        tel.includes(q)
      )
    })
  }, [search, sorted])

  const ultimoDniCorto = useMemo(
    () => ultimoDniPacCorto(data.patients),
    [data.patients],
  )

  const currentEditingPatient = useMemo(
    () => (editingId ? data.patients.find((p) => p.id === editingId) : null),
    [data.patients, editingId],
  )

  const virtualSlice = useVirtualSlice(
    filtered.length,
    listScrollRef,
    PACIENTE_ROW_HEIGHT,
  )
  const visiblePatients = filtered.slice(virtualSlice.start, virtualSlice.end)
  const summaryPatient = useMemo(
    () => (summaryPatientId ? data.patients.find((p) => p.id === summaryPatientId) ?? null : null),
    [data.patients, summaryPatientId],
  )

  useEffect(() => {
    return () => {
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    }
  }, [pdfPreview?.url])

  function closePdfPreview() {
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview(null)
    pdfDocRef.current = null
  }

  async function handlePdfPreview() {
    if (!puedeExportPdf) {
      void confirm({ message: EXPORT_DENIED_MESSAGE })
      return
    }
    try {
      await preloadPdfHeaderBanner()
      const built = buildPacientesPdf(pacientesActivos(data.patients))
      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: pacientesPdfPreviewTitle(sorted.length),
      })
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo generar el PDF. Probá de nuevo.',
      })
    }
  }

  async function handlePdfDownload() {
    const doc = pdfDocRef.current
    const filename = pdfPreview?.filename
    if (!doc || !filename) return
    try {
      await savePdfFile(doc, filename)
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo guardar el PDF.',
      })
    }
  }

  return (
    <div className="page page--pacientes-modern">
      {/* Top Header */}
      <header className="pacientes-modern-header">
        <div className="pacientes-modern-header__left">
          <div className="pacientes-modern-header__icon-badge">
            <IconPulse />
          </div>
          <div className="pacientes-modern-header__titles">
            <p className="pacientes-modern-header__sub">
              CENTRO DE ATENCIÓN · {role === 'admin' ? 'ADMINISTRACIÓN' : 'SECRETARÍA'}
            </p>
            <h1 className="pacientes-modern-header__title">Pacientes</h1>
          </div>
        </div>
        <div className="pacientes-modern-header__right">
          <div className="pacientes-protected-pill">
            <IconShieldProtected />
            <span>Datos protegidos</span>
          </div>
        </div>
      </header>

      {/* Metric Cards Row */}
      <div className="pacientes-metrics-grid">
        {/* Card 1: Registros Activos */}
        <div
          className={`pacientes-metric-card pacientes-metric-card--activos${
            listFilter === 'activos' ? ' pacientes-metric-card--active-filter' : ''
          }`}
          onClick={() => setListFilter('activos')}
          title="Ver pacientes activos"
        >
          <div className="pacientes-metric-card__header">
            <span className="pacientes-metric-card__title">REGISTROS ACTIVOS</span>
            <div className="pacientes-metric-card__icon">
              <IconUserCard />
            </div>
          </div>
          <div className="pacientes-metric-card__body">
            <p className="pacientes-metric-card__number">{countActivos}</p>
            <p className="pacientes-metric-card__subtitle">disponibles para atención</p>
          </div>
        </div>

        {/* Card 2: Suspendidos */}
        <div
          className={`pacientes-metric-card pacientes-metric-card--suspendidos${
            listFilter === 'suspendidos' ? ' pacientes-metric-card--active-filter' : ''
          }`}
          onClick={() => setListFilter('suspendidos')}
          title="Ver pacientes suspendidos"
        >
          <div className="pacientes-metric-card__header">
            <span className="pacientes-metric-card__title">SUSPENDIDOS</span>
            <div className="pacientes-metric-card__icon">
              <IconUserCard />
            </div>
          </div>
          <div className="pacientes-metric-card__body">
            <p className="pacientes-metric-card__number">{countSuspendidos}</p>
            <p className="pacientes-metric-card__subtitle">en pausa</p>
          </div>
        </div>

        {/* Card 3: Gráfico por Obra Social */}
        <div className="pacientes-metric-card pacientes-metric-card--action">
          <div className="pacientes-os-chart">
            <div className="pacientes-os-chart__head">
              <span className="pacientes-os-chart__title">PACIENTES POR OBRA SOCIAL</span>
              <span className="pacientes-os-chart__meta">
                {obraSocialChart.total} obra{obraSocialChart.total === 1 ? '' : 's'} social{obraSocialChart.total === 1 ? '' : 'es'}
              </span>
            </div>
            {obraSocialChart.items.length === 0 ? (
              <div className="pacientes-os-chart__empty">Sin pacientes activos</div>
            ) : (
              <div className="pacientes-os-chart__bars">
                {obraSocialChart.items.map((it) => (
                  <div
                    key={it.label}
                    className="pacientes-os-chart__col"
                    title={`${it.label}: ${it.value} paciente${it.value === 1 ? '' : 's'}`}
                  >
                    <span className="pacientes-os-chart__value">{it.value}</span>
                    <div className="pacientes-os-chart__track">
                      <div
                        className="pacientes-os-chart__bar"
                        style={{
                          height: `${obraSocialChart.max ? Math.max(6, (it.value / obraSocialChart.max) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <span className="pacientes-os-chart__label">{it.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="pacientes-metric-card pacientes-metric-card--new">
          <button
            type="button"
            className="pacientes-btn-new"
            onClick={openNewModal}
          >
            + Nuevo paciente
          </button>
        </div>
      </div>

      {/* Main Directory Card */}
      <div className="pacientes-directory-card">
        {/* Toolbar Top */}
        <div className="pacientes-toolbar-top">
          <div className="pacientes-toolbar-title-wrap">
            <div className="pacientes-toolbar-icon">
              <IconSearch />
            </div>
            <div className="pacientes-toolbar-headings">
              <h2 className="pacientes-toolbar-heading">Buscar paciente</h2>
              <p className="pacientes-toolbar-subheading">
                Encontrá un registro por {DNI_PAC_LABEL} o apellido.
              </p>
            </div>
          </div>

          <div className="pacientes-toolbar-controls">
            <div className="pacientes-search-input-wrap">
              <span className="pacientes-search-icon">
                <IconSearch />
              </span>
              <input
                type="text"
                className="pacientes-search-input"
                placeholder={`Buscar por ${DNI_PAC_LABEL} o apellido...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {Boolean(search.trim()) && (
                <button
                  type="button"
                  className="pacientes-search-clear-btn"
                  onClick={() => setSearch("")}
                  title="Borrar búsqueda"
                  aria-label="Borrar búsqueda"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            <div className="pacientes-segmented-control" role="group" aria-label="Filtrar estado">
              <button
                type="button"
                className={`pacientes-segment-btn${listFilter === 'todos' ? ' is-active' : ''}`}
                onClick={() => setListFilter('todos')}
              >
                Todos
              </button>
              <button
                type="button"
                className={`pacientes-segment-btn${listFilter === 'activos' ? ' is-active' : ''}`}
                onClick={() => setListFilter('activos')}
              >
                Activos
              </button>
              <button
                type="button"
                className={`pacientes-segment-btn${listFilter === 'suspendidos' ? ' is-active' : ''}`}
                onClick={() => setListFilter('suspendidos')}
              >
                Suspendidos
              </button>
            </div>

            {puedeExportPdf && (
              <button
                type="button"
                className="pacientes-btn-pdf"
                onClick={handlePdfPreview}
                title="Vista previa del listado en PDF"
              >
                <IconPdf />
                <span>Vista previa PDF</span>
              </button>
            )}

            <button
              type="button"
              className="pacientes-btn-os"
              onClick={() => setOsModalOpen(true)}
              title="Gestionar obras sociales"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Obra Social</span>
            </button>
          </div>
        </div>

        {/* Reset Filter Button (when active) */}
        {(search.trim() || listFilter !== 'activos') && (
          <div className="pacientes-sub-toolbar">
            <span />
            <button
              type="button"
              className="pacientes-sub-toolbar__btn-reset"
              onClick={() => {
                setSearch('')
                setListFilter('activos')
              }}
            >
              Ver todos
            </button>
          </div>
        )}

        {/* Table */}
        <div className="pacientes-table-wrap">
          {sorted.length === 0 ? (
            <div className="pacientes-empty-state">
              <p>
                {listFilter === 'activos'
                  ? 'Todavía no hay pacientes activos.'
                  : listFilter === 'suspendidos'
                  ? 'No hay pacientes suspendidos.'
                  : 'No hay pacientes registrados.'}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="pacientes-empty-state">
              <p>No hay pacientes que coincidan con la búsqueda.</p>
            </div>
          ) : (
            <div ref={listScrollRef} className="table-list__scroll" style={{ maxHeight: '516px' }}>
              <table className="pacientes-modern-table">
                <thead>
                  <tr>
                    <th>{DNI_PAC_LABEL}</th>
                    <th>APELLIDO</th>
                    <th>NOMBRE</th>
                    <th>OBRA SOCIAL</th>
                    <th>PLAN</th>
                    <th>TELÉFONO</th>
                    <th>ESTADO</th>
                    <th className="th--actions">ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {virtualSlice.paddingTop > 0 && (
                    <tr aria-hidden className="virtual-table-spacer">
                      <td colSpan={8} style={{ height: virtualSlice.paddingTop }} />
                    </tr>
                  )}
                  {visiblePatients.map((p) => {
                    const isActivo = p.activo !== false
                    return (
                      <tr
                        key={p.id}
                        className={summaryPatientId === p.id ? 'is-selected' : ''}
                        onClick={() => openSummaryModal(p)}
                      >
                        <td className="pacientes-td-dni">{p.dni || '—'}</td>
                        <td className="pacientes-td-apellido">{p.apellido || '—'}</td>
                        <td className="pacientes-td-nombre">{p.nombre || '—'}</td>
                        <td className="pacientes-td-obrasocial">{p.obraSocial || 'Particular'}</td>
                        <td className="pacientes-td-plan">
                          {(() => {
                            const info = planPorPaciente.get(p.id)
                            if (!info) return <span className="pacientes-td-plan__none">—</span>
                            return (
                              <span
                                className={`pacientes-plan-pill${info.alDia ? '' : ' is-deuda'}`}
                                title={info.alDia ? 'Plan al día' : info.motivo}
                              >
                                {info.nombre}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="pacientes-td-telefono">{p.telefono || '—'}</td>
                        <td>
                          <span
                            className={`pacientes-status-badge ${
                              isActivo
                                ? 'pacientes-status-badge--activo'
                                : 'pacientes-status-badge--suspendido'
                            }`}
                          >
                            <span className="pacientes-status-badge__dot" />
                            <span>{isActivo ? 'Activo' : 'Suspendido'}</span>
                          </span>
                        </td>
                        <td className="pacientes-td-actions" onClick={(e) => e.stopPropagation()}>
                          <div className="pacientes-row-actions">
                            <button
                              type="button"
                              className="pacientes-action-icon-btn"
                              title="Editar paciente"
                              onClick={() => openEditModal(p)}
                            >
                              <IconEditPencil />
                            </button>
                            {isActivo ? (
                              <button
                                type="button"
                                className="pacientes-action-icon-btn pacientes-action-icon-btn--suspend"
                                title="Suspender paciente"
                                onClick={() => void handleSuspend(p.id)}
                              >
                                <IconPauseAction />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="pacientes-action-icon-btn pacientes-action-icon-btn--restore"
                                title="Reactivar paciente"
                                onClick={() => void handleReactivate(p.id)}
                              >
                                <IconPlayAction />
                              </button>
                            )}
                            <button
                              type="button"
                              className="pacientes-action-icon-btn pacientes-action-icon-btn--delete"
                              title="Eliminar paciente"
                              onClick={() => void handleDelete(p)}
                            >
                              <IconTrashAction />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {virtualSlice.paddingBottom > 0 && (
                    <tr aria-hidden className="virtual-table-spacer">
                      <td colSpan={8} style={{ height: virtualSlice.paddingBottom }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Directory Footer */}
        <div className="pacientes-directory-footer">
          <span>Directorio de pacientes</span>
          <span className="pacientes-directory-footer__right">
            Actualizado al momento &rsaquo;
          </span>
        </div>
      </div>

      {/* Bottom Page Footnote */}
      <div className="pacientes-page-footnote">
        <IconShieldProtected />
        <span>Información protegida · Sistema de gestión de pacientes</span>
      </div>

      {/* Ventana Nuevo / Editar paciente */}
      {modalOpen && (
        <div className="pac-modal-overlay" onClick={closeModal}>
          <div
            className="pac-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pac-modal__header">
              <div className="pac-modal__header-left">
                <div className="pac-modal__icon">
                  <IconClipboard />
                </div>
                <div>
                  <p className="pac-modal__kicker">REGISTRO ADMINISTRATIVO</p>
                  <h2 className="pac-modal__title">
                    {editingId ? `${form.apellido}, ${form.nombre}` : 'Nuevo paciente'}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                className="pac-modal__close"
                onClick={closeModal}
                aria-label="Cerrar"
              >
                &times;
              </button>
            </div>

            <form onSubmit={submit} className="pac-modal__form">
                <div className="pac-modal__body">
                  <div className="pac-modal__section">
                    <span className="pac-modal__pill">
                      <span className="pac-modal__pill-dot" />
                      DATOS PERSONALES
                    </span>
                  </div>

                  {dniMsg && (
                    <div className="paciente-error-banner" role="alert">
                      {dniMsg}
                    </div>
                  )}

                  <div className="pac-grid pac-grid--3">
                    <div className="pac-field">
                      <label htmlFor="p-dni">{DNI_PAC_LABEL}</label>
                      <input
                        id="p-dni"
                        placeholder="Número de documento"
                        value={form.dni}
                        onChange={(e) => {
                          const value = e.target.value
                          setForm((f) => ({ ...f, dni: value }))
                          if (dniMsg) setDniMsg(null)
                        }}
                        onBlur={() => {
                          const dniNorm = String(form.dni ?? '').trim()
                          if (!dniNorm) return
                          const dup = data.patients.find(
                            (p) => p.dni?.trim() === dniNorm && p.id !== editingId,
                          )
                          if (dup) setDniMsg(dniPacDuplicadoMsg(dup.apellido, dup.nombre))
                        }}
                      />
                      <span className="pac-hint">
                        Ej.: 12.345.678
                        {ultimoDniCorto ? ` · último DNI corto: ${ultimoDniCorto}` : ' · revisar DNI corto si aplica'}
                      </span>
                    </div>
                    <div className="pac-field">
                      <label htmlFor="p-nombre">Nombre</label>
                      <input
                        id="p-nombre"
                        placeholder="Nombre"
                        value={form.nombre}
                        onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="pac-field">
                      <label htmlFor="p-apellido">Apellido</label>
                      <input
                        id="p-apellido"
                        placeholder="Apellido"
                        value={form.apellido}
                        onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="pac-grid pac-grid--fn">
                    <div className="pac-field">
                      <label htmlFor="p-fn">F. nacimiento</label>
                      <input
                        id="p-fn"
                        type="date"
                        value={form.fechaNacimiento}
                        onChange={(e) => setForm((f) => ({ ...f, fechaNacimiento: e.target.value }))}
                      />
                    </div>
                    <div className="pac-field">
                      <label htmlFor="p-edad">Edad</label>
                      <input id="p-edad" value={edadLabel} readOnly placeholder="—" />
                    </div>
                    <div className="pac-field">
                      <label htmlFor="p-tel">Teléfono</label>
                      <input
                        id="p-tel"
                        placeholder="Código de área y número"
                        value={form.telefono}
                        onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="pac-modal__section pac-modal__section--contact">
                    <span className="pac-modal__pill">
                      <span className="pac-modal__pill-dot" />
                      CONTACTO
                    </span>
                  </div>

                  <div className="pac-grid pac-grid--2">
                    <div className="pac-field">
                      <label htmlFor="p-mail">Email</label>
                      <input
                        id="p-mail"
                        type="email"
                        placeholder="correo@ejemplo.com"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      />
                    </div>
                    <div className="pac-field">
                      <label htmlFor="p-domicilio">Domicilio</label>
                      <input
                        id="p-domicilio"
                        placeholder="Calle y altura"
                        value={form.domicilio}
                        onChange={(e) => setForm((f) => ({ ...f, domicilio: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="pac-grid pac-grid--2">
                    <div className="pac-field">
                      <label htmlFor="p-loc">Localidad</label>
                      <div className="pac-select-row">
                        <select
                          id="p-loc"
                          value={form.localidad}
                          onChange={(e) => setForm((f) => ({ ...f, localidad: e.target.value }))}
                        >
                          <option value="">Seleccionar localidad</option>
                          {localidadesOpciones.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                          {form.localidad && !localidadesOpciones.includes(form.localidad) && (
                            <option value={form.localidad}>{form.localidad}</option>
                          )}
                        </select>
                        <button
                          type="button"
                          className="pac-btn-list"
                          title="Gestionar localidades"
                          aria-label="Gestionar localidades"
                          onClick={() => setLocModalOpen(true)}
                        >
                          <IconList />
                        </button>
                      </div>
                    </div>
                    <div className="pac-field">
                      <label htmlFor="p-os">Obra Social</label>
                      <div className="pac-select-row">
                        <select
                          id="p-os"
                          value={form.obraSocial}
                          onChange={(e) => setForm((f) => ({ ...f, obraSocial: e.target.value }))}
                        >
                          <option value="">Seleccionar</option>
                          {obrasSocialesOpciones.map((os) => (
                            <option key={os} value={os}>{os}</option>
                          ))}
                          {form.obraSocial && !obrasSocialesOpciones.includes(form.obraSocial) && (
                            <option value={form.obraSocial}>{form.obraSocial}</option>
                          )}
                        </select>
                        <button
                          type="button"
                          className="pac-btn-list"
                          title="Gestionar obras sociales"
                          aria-label="Gestionar obras sociales"
                          onClick={() => setOsModalOpen(true)}
                        >
                          <IconList />
                        </button>
                      </div>
                    </div>

                    {/*
                      El plan no se edita acá: se administra en Afiliados. Acá
                      sólo se informa cuál tiene y con qué cobertura se agendan
                      sus turnos por defecto.
                    */}
                    <div className="pac-field">
                      <label htmlFor="p-cob">Se agenda por</label>
                      <div className="pac-select-row">
                        <select
                          id="p-cob"
                          value={form.coberturaPreferida ?? 'obraSocial'}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              coberturaPreferida: e.target.value as CoberturaTipo,
                            }))
                          }
                        >
                          <option value="obraSocial">
                            {form.obraSocial ? form.obraSocial : 'Obra social'}
                          </option>
                          {planInfo?.nombre && (
                            <option value="plan" disabled={!planInfo.alDia}>
                              {planInfo.nombre} (plan)
                              {planInfo.alDia ? '' : ' — cuotas impagas'}
                            </option>
                          )}
                          <option value="particular">Particular</option>
                        </select>
                      </div>
                      {planInfo ? (
                        <span
                          className={`pac-plan-nota${planInfo.alDia ? '' : ' is-deuda'}`}
                          role="status"
                        >
                          Plan: <strong>{planInfo.nombre}</strong> ·{' '}
                          {planInfo.alDia ? 'al día' : planInfo.motivo}
                        </span>
                      ) : (
                        <span className="pac-plan-nota" role="status">
                          Sin plan asignado.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="pac-field">
                    <label htmlFor="p-notas">Notas</label>
                    <textarea
                      id="p-notas"
                      rows={3}
                      placeholder="Notas administrativas (opcional)"
                      value={form.notas}
                      onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                    />
                  </div>

                </div>

                <div className="pac-modal__footer">
                  <div className="pac-modal__footer-left">
                    {currentEditingPatient ? (
                      <>
                        {currentEditingPatient.activo !== false ? (
                          <button
                            type="button"
                            className="pac-btn pac-btn--gray"
                            onClick={() => void handleSuspend(currentEditingPatient.id)}
                          >
                            Suspender
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="pac-btn pac-btn--gray"
                            onClick={() => void handleReactivate(currentEditingPatient.id)}
                          >
                            Reactivar
                          </button>
                        )}
                        <button
                          type="button"
                          className="pac-btn pac-btn--gray"
                          onClick={() => void handleDelete(currentEditingPatient)}
                        >
                          Eliminar
                        </button>
                        <Link className="pac-btn pac-btn--gray" to="/agenda">Ir a agenda</Link>
                        <Link className="pac-btn pac-btn--gray" to="/pagos">Ir a pagos</Link>
                      </>
                    ) : (
                      <span className="pac-modal__footer-note">
                        Los datos se pueden completar en una sola carga.
                      </span>
                    )}
                  </div>
                  <div className="pac-modal__footer-right">
                    <button type="button" className="pac-btn pac-btn--gray" onClick={closeModal}>
                      Cancelar
                    </button>
                    <button type="submit" className="pac-btn pac-btn--gray pac-btn--strong">
                      {editingId ? 'Guardar cambios' : 'Guardar paciente'}
                    </button>
                  </div>
                </div>
              </form>
          </div>
        </div>
      )}

      {summaryPatient && (
        <div className="pac-modal-overlay" onClick={closeSummaryModal}>
          <div className="pac-modal pac-modal--summary" onClick={(e) => e.stopPropagation()}>
            <div className="pac-modal__header">
              <div className="pac-modal__header-left">
                <div className="pac-modal__icon"><IconClipboard /></div>
                <div>
                  <p className="pac-modal__kicker">REGISTRO ADMINISTRATIVO</p>
                  <h2 className="pac-modal__title">{summaryPatient.apellido}, {summaryPatient.nombre}</h2>
                </div>
              </div>
              <button type="button" className="pac-btn pac-btn--gray" onClick={closeSummaryModal}>
                Cerrar
              </button>
            </div>
            <div className="pac-modal__summary-row">
              <span>DNI <strong>{summaryPatient.dni || '—'}</strong></span>
              <span>Tel <strong>{summaryPatient.telefono || '—'}</strong></span>
              <span>Localidad <strong>{summaryPatient.localidad || '—'}</strong></span>
              <span>Domicilio <strong>{summaryPatient.domicilio || '—'}</strong></span>
              <span>OS <strong>{summaryPatient.obraSocial || 'Particular'}</strong></span>
              <span>Email <strong>{summaryPatient.email || '—'}</strong></span>
            </div>
            <div className="pac-modal__body pac-modal__body--summary">
              <PacienteHistorialSection patientId={summaryPatient.id} compact />
            </div>
          </div>
        </div>
      )}

      {/* Nested Modals */}
      {osModalOpen && (
        <ObrasSocialesModal
          custom={data.obrasSocialesCustom}
          onClose={() => setOsModalOpen(false)}
          onAdd={(nombre) => {
            const res = addObraSocialCustom(nombre)
            if (res.ok) {
              setForm((f) => ({
                ...f,
                obraSocial: normalizeObraSocial(nombre),
              }))
            }
            return res
          }}
          onRemove={removeObraSocialCustom}
          onRename={(anterior, nuevo) => {
            const res = renameObraSocialCustom(anterior, nuevo)
            if (res.ok && form.obraSocial === anterior) {
              setForm((f) => ({ ...f, obraSocial: nuevo.trim() }))
            }
            return res
          }}
        />
      )}

      {locModalOpen && (
        <LocalidadesModal
          custom={data.localidadesCustom}
          onClose={() => setLocModalOpen(false)}
          onAdd={(nombre) => {
            const res = addLocalidadCustom(nombre)
            if (res.ok) {
              setForm((f) => ({
                ...f,
                localidad: normalizeLocalidad(nombre),
              }))
            }
            return res
          }}
          onRemove={removeLocalidadCustom}
          onRename={(anterior, nuevo) => {
            const res = renameLocalidadCustom(anterior, nuevo)
            if (res.ok) {
              setForm((f) => ({
                ...f,
                localidad:
                  normalizeLocalidad(f.localidad) === normalizeLocalidad(anterior)
                    ? normalizeLocalidad(nuevo)
                    : f.localidad,
              }))
            }
            return res
          }}
        />
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
