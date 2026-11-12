import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualSlice } from '../../../hooks/useVirtualSlice'
import { EspecialidadesModal } from '../components/EspecialidadesModal'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { normalizeEspecialidad } from '../../../lib/especialidades'
import { pdfBlobUrl, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { preloadPdfHeaderBanner } from '../../../lib/pdfHeaderBanner'
import { ObrasSocialesModal } from '../../pacientes/components/ObrasSocialesModal'
import { normalizeObraSocial } from '../../../lib/obrasSociales'
import {
  buildMedicosPdf,
  medicosPdfPreviewTitle,
} from '../../../lib/medicosPdf'
import {
  buildEspecialidadesExcel,
  especialidadesExcelFilename,
  saveEspecialidadesExcelFile,
} from '../../../lib/especialidadesExcel'
import { IconActionButton, IconEdit, IconList, IconPause, IconRestoreDay, IconTileMedicos, IconTrash } from '../../../shared/components/icons'
import { useAppState } from '../../../context/AppStateContext'
import { useAuth } from '../../../context/AuthContext'
import { useConfirm } from '../../../context/ConfirmContext'
import {
  medicosActivos,
  medicosSuspendidos,
} from '../../../lib/activo'
import { DNI_MED_LABEL, dniMedDuplicadoMsg } from '../../../lib/dniLabels'
import {
  canExportMedicosListado,
  canViewDoctorPorcentaje,
  EXPORT_DENIED_MESSAGE,
} from '../../../lib/exportPermissions'
import type { Doctor, DoctorObraSocial } from '../../../types'
import type jsPDF from 'jspdf'
import '../../../shared/styles/pages.css'
import '../../pacientes/pages/PacientesModern.css'
import './MedicosModern.css'
import { LocalidadesModal } from '../../pacientes/components/LocalidadesModal'
import { normalizeLocalidad } from '../../../lib/localidadesMisiones'
import {
  formatPorcentajeInput,
  formatPorcentajeLabel,
  parsePorcentajeInput,
  sanitizePorcentajeInput,
} from '../../../lib/porcentajeInput'
import {
  formatMoneyDisplay,
  parseMoneyInput,
  sanitizeMoneyTyping,
} from '../../../lib/moneyFormat'
import {
  calculateTotalParticular,
  formatTotalParticularDisplay,
  formatThousands,
  parseThousands,
  validateDoctorForm,
  getDoctorInitials,
  hasFormChanges,
} from '../lib/registroProfesionalLogic'

export interface MedicoObraSocialFormItem {
  nombre: string
  porcentaje: string
  monto: string
}

type MedicoFormState = Omit<
  Doctor,
  'id' | 'porcentaje' | 'valor' | 'particular' | 'cuidar' | 'obrasSociales'
> & {
  porcentaje: string
  valor: string
  particular: string
  cuidar: string
  obrasSociales: MedicoObraSocialFormItem[]
}

const emptyForm: MedicoFormState = {
  nombre: '',
  apellido: '',
  dni: '',
  matricula: '',
  especialidad: '',
  obraSocial: '',
  obrasSociales: [],
  telefono: '',
  localidad: '',
  email: '',
  alias: '',
  porcentaje: '',
  valor: '',
  particular: '',
  cuidar: '',
}

export function MedicosPage() {
  const {
    data,
    upsertDoctor,
    setDoctorActivo,
    deleteDoctor,
    especialidadesOpciones,
    addEspecialidadCustom,
    removeEspecialidadCustom,
    renameEspecialidadCustom,
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
  const puedeVerPorcentaje = canViewDoctorPorcentaje(role)
  const puedeExportPdf = canExportMedicosListado(role)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [initialForm, setInitialForm] = useState(emptyForm)
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean | undefined>>({})
  const [validationMsg, setValidationMsg] = useState<string | null>(null)
  const [espModalOpen, setEspModalOpen] = useState(false)
  const [osModalOpen, setOsModalOpen] = useState(false)
  const [locModalOpen, setLocModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dniMsg, setDniMsg] = useState<string | null>(null)
  const [listFilter, setListFilter] = useState<'activos' | 'suspendidos'>('activos')
  const [formOpen, setFormOpen] = useState(false)
  const apellidoRef = useRef<HTMLInputElement>(null)
  // (no auto-select)
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)
  const [exportingExcel, setExportingExcel] = useState(false)

  const hasChanges = useMemo(() => {
    return hasFormChanges(initialForm, form)
  }, [initialForm, form])

  function startNew() {
    setEditingId(null)
    setForm(emptyForm)
    setInitialForm(emptyForm)
    setValidationErrors({})
    setValidationMsg(null)
    setDniMsg(null)
    setFormOpen(true)
    requestAnimationFrame(() => apellidoRef.current?.focus())
  }

  function startEdit(d: Doctor) {
    setEditingId(d.id)
    setFormOpen(true)
    const obrasSociales: MedicoObraSocialFormItem[] = (
      d.obrasSociales ??
      (d.obraSocial
        ? [{ nombre: d.obraSocial, porcentaje: 0, monto: 0 }]
        : [])
    ).map((os) => ({
      nombre: typeof os === 'string' ? os : os.nombre,
      porcentaje:
        typeof os === 'object' && os.porcentaje != null
          ? String(Math.round(os.porcentaje))
          : '0',
      monto:
        typeof os === 'object' && os.monto != null && os.monto > 0
          ? formatThousands(os.monto)
          : '',
    }))

    const initialData: MedicoFormState = {
      nombre: d.nombre,
      apellido: d.apellido,
      dni: d.dni ?? '',
      matricula: d.matricula,
      especialidad: d.especialidad,
      obraSocial: '',
      obrasSociales,
      telefono: d.telefono,
      localidad: d.localidad ?? '',
      email: d.email,
      alias: d.alias ?? '',
      porcentaje: formatPorcentajeInput(d.porcentaje),
      valor: d.valor != null ? formatMoneyDisplay(d.valor) : '',
      particular: d.particular != null ? formatMoneyDisplay(d.particular) : '',
      cuidar: d.cuidar != null ? formatMoneyDisplay(d.cuidar) : '',
    }

    setForm(initialData)
    setInitialForm(initialData)
    setValidationErrors({})
    setValidationMsg(null)
    setDniMsg(null)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(emptyForm)
    setInitialForm(emptyForm)
    setValidationErrors({})
    setValidationMsg(null)
    setDniMsg(null)
  }

  async function handleSuspend(id: string) {
    const ok = await confirm({
      message:
        '¿Suspender este médico?\n\nNo aparecerá en Médicos ni en la agenda para turnos nuevos. Agenda, cobros y pagos cancelados quedan en el historial.',
    })
    if (!ok) return
    setDoctorActivo(id, false)
    if (editingId === id) closeForm()
  }

  async function handleDelete(d: Doctor) {
    const turnos = data.appointments.filter((a) => a.doctorId === d.id).length
    const pagos = data.payments.filter((pay) => pay.doctorId === d.id).length
    const cancelados = data.pagosCancelados.filter(
      (r) => r.payment.doctorId === d.id,
    ).length
    const horarios = data.horarios.filter((h) => h.doctorId === d.id).length
    const atenciones = data.atencionesSinTurno.filter(
      (list) => list.doctorId === d.id,
    ).length
    const vinculos: string[] = []
    if (horarios > 0) {
      vinculos.push(
        `${horarios} horario${horarios === 1 ? '' : 's'}`,
      )
    }
    if (turnos > 0) {
      vinculos.push(
        `${turnos} turno${turnos === 1 ? '' : 's'}`,
      )
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
        `${atenciones} listado${atenciones === 1 ? '' : 's'} de atención sin turno`,
      )
    }
    const detalleVinculos = vinculos.length
      ? `\n\nTambién se borrarán: ${vinculos.join(', ')}.`
      : ''
    const ok = await confirm({
      title: 'Eliminar médico',
      message: `¿Eliminar permanentemente a ${d.apellido}, ${d.nombre}?\n\nEsta acción no se puede deshacer.${detalleVinculos}`,
      confirmLabel: 'Eliminar',
    })
    if (!ok) return
    deleteDoctor(d.id)
    if (editingId === d.id) closeForm()
  }

  function handleReactivate(id: string) {
    setDoctorActivo(id, true)
    setListFilter('activos')
    const d = data.doctors.find((x) => x.id === id)
    if (d) startEdit(d)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()

    const valResult = validateDoctorForm({
      apellido: form.apellido,
      nombre: form.nombre,
      dni: form.dni,
      especialidad: form.especialidad,
      telefono: form.telefono,
      email: form.email,
    })

    if (!valResult.isValid) {
      setValidationErrors(valResult.errors)
      setValidationMsg(valResult.summaryMessage || 'Revisá los campos marcados en rojo')
      return
    }

    const dniNorm = String(form.dni ?? '').trim()
    if (dniNorm) {
      const dup = data.doctors.find(
        (d) => (d.dni ?? '').trim() === dniNorm && d.id !== editingId,
      )
      if (dup) {
        setValidationErrors((prev) => ({ ...prev, dni: true }))
        setDniMsg(
          dniMedDuplicadoMsg(dup.apellido, dup.nombre, true),
        )
        setValidationMsg('Revisá los campos marcados en rojo')
        return
      }
    }
    setDniMsg(null)
    setValidationErrors({})
    setValidationMsg(null)
    const porcentaje = puedeVerPorcentaje
      ? parsePorcentajeInput(form.porcentaje)
      : editingId
        ? data.doctors.find((d) => d.id === editingId)?.porcentaje
        : undefined
    const deduplicatedOs: DoctorObraSocial[] = []
    const seenOs = new Set<string>()
    for (const item of form.obrasSociales ?? []) {
      const nombre = item.nombre.trim()
      if (!nombre) continue
      const k = nombre.toLowerCase()
      if (seenOs.has(k)) continue
      seenOs.add(k)
      const pct = parseThousands(item.porcentaje)
      const monto = parseThousands(item.monto)
      deduplicatedOs.push({
        nombre,
        porcentaje: pct,
        monto,
      })
    }

    upsertDoctor({
      ...form,
      alias: form.alias?.trim() ?? '',
      obrasSociales: deduplicatedOs,
      porcentaje,
      valor: form.valor.trim() ? parseMoneyInput(form.valor) : null,
      particular: form.particular.trim()
        ? parseMoneyInput(form.particular)
        : null,
      cuidar: form.cuidar.trim() ? parseMoneyInput(form.cuidar) : null,
      id: editingId ?? undefined,
    })
    closeForm()
  }

  const listScrollRef = useRef<HTMLDivElement>(null)
  const MEDICO_ROW_HEIGHT = 40
  const colSpan = puedeVerPorcentaje ? 8 : 7

  const listSource = useMemo(
    () =>
      listFilter === 'activos'
        ? medicosActivos(data.doctors)
        : medicosSuspendidos(data.doctors),
    [data.doctors, listFilter],
  )

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
    return sorted.filter((d) => {
      const apellido = (d.apellido ?? '').toLowerCase()
      const matricula = (d.matricula ?? '').toLowerCase()
      const dni = (d.dni ?? '').toLowerCase()
      return apellido.includes(q) || matricula.includes(q) || dni.includes(q)
    })
  }, [search, sorted])

  const virtualSlice = useVirtualSlice(
    filtered.length,
    listScrollRef,
    MEDICO_ROW_HEIGHT,
  )
  const visibleDoctors = filtered.slice(virtualSlice.start, virtualSlice.end)
  const countActivos = medicosActivos(data.doctors).length
  const countSuspendidos = medicosSuspendidos(data.doctors).length
  const currentEditingDoctor = editingId
    ? data.doctors.find((doctor) => doctor.id === editingId) ?? null
    : null

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
      const built = buildMedicosPdf(medicosActivos(data.doctors), {
        includePorcentaje: puedeVerPorcentaje,
      })
      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: medicosPdfPreviewTitle(sorted.length),
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

  async function handleExcelExport() {
    if (!puedeExportPdf) {
      void confirm({ message: EXPORT_DENIED_MESSAGE })
      return
    }
    try {
      setExportingExcel(true)
      const wb = buildEspecialidadesExcel({ doctors: data.doctors })
      const filename = especialidadesExcelFilename()
      await saveEspecialidadesExcelFile(wb, filename)
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo generar el Excel. Probá de nuevo.',
      })
    } finally {
      setExportingExcel(false)
    }
  }

  // Nota: no auto-seleccionamos un médico al entrar; debe quedar "Nuevo médico"
  // hasta que el usuario elija uno.

  return (
    <div className="page page--pacientes-modern page--medicos-modern">
      <header className="pacientes-modern-header">
        <div className="pacientes-modern-header__left">
          <div className="pacientes-modern-header__icon-badge">
            <IconTileMedicos />
          </div>
          <div className="pacientes-modern-header__titles">
            <p className="pacientes-modern-header__sub">CENTRO DE ATENCIÓN · ADMINISTRACIÓN</p>
            <h1 className="pacientes-modern-header__title">Médicos</h1>
          </div>
        </div>
      </header>

      <div className="pacientes-metrics-grid">
        <button
          type="button"
          className={`pacientes-metric-card pacientes-metric-card--activos${listFilter === 'activos' ? ' pacientes-metric-card--active-filter' : ''}`}
          aria-pressed={listFilter === 'activos'}
          onClick={() => setListFilter('activos')}
          title="Ver médicos activos"
        >
          <div className="pacientes-metric-card__header">
            <span className="pacientes-metric-card__title">MÉDICOS ACTIVOS</span>
            <div className="pacientes-metric-card__icon"><IconTileMedicos /></div>
          </div>
          <div className="pacientes-metric-card__body">
            <p className="pacientes-metric-card__number">{countActivos}</p>
            <p className="pacientes-metric-card__subtitle">disponibles para atención</p>
          </div>
        </button>
        <button
          type="button"
          className={`pacientes-metric-card pacientes-metric-card--suspendidos${listFilter === 'suspendidos' ? ' pacientes-metric-card--active-filter' : ''}`}
          aria-pressed={listFilter === 'suspendidos'}
          onClick={() => setListFilter('suspendidos')}
          title="Ver médicos suspendidos"
        >
          <div className="pacientes-metric-card__header">
            <span className="pacientes-metric-card__title">SUSPENDIDOS</span>
            <div className="pacientes-metric-card__icon"><IconTileMedicos /></div>
          </div>
          <div className="pacientes-metric-card__body">
            <p className="pacientes-metric-card__number">{countSuspendidos}</p>
            <p className="pacientes-metric-card__subtitle">en pausa</p>
          </div>
        </button>
        <div className="pacientes-metric-card pacientes-metric-card--new">
          <button type="button" className="pacientes-btn-new" onClick={startNew}>
            + Nuevo médico
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="pac-modal-overlay" onClick={closeForm}>
          <div
            className="pac-modal pac-modal--doctor"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Encabezado */}
            <div className="pac-modal__header">
              <div className="pac-modal__header-left">
                <div className="doctor-avatar-initials">
                  {getDoctorInitials(form.apellido, form.nombre)}
                </div>
                <div>
                  <p className="pac-modal__kicker">REGISTRO PROFESIONAL</p>
                  <div className="doctor-header-title-row">
                    <h2 className="pac-modal__title">
                      {form.apellido.trim() || form.nombre.trim()
                        ? `${form.apellido}, ${form.nombre}`.toUpperCase()
                        : (editingId ? 'MÉDICO' : 'NUEVO MÉDICO')}
                    </h2>
                    {currentEditingDoctor?.activo === false && (
                      <span className="doctor-badge doctor-badge--suspendido">
                        Suspendido
                      </span>
                    )}
                    {hasChanges && (
                      <span className="doctor-badge doctor-badge--dirty">
                        ● Cambios sin guardar
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="pac-modal__close"
                onClick={closeForm}
                aria-label="Cerrar"
              >
                &times;
              </button>
            </div>

            <form onSubmit={submit} noValidate className="pac-modal__form">
              <div className="pac-modal__body doctor-modal-body">
                {(validationMsg || dniMsg) && (
                  <div className="msg msg-error">
                    {dniMsg || validationMsg}
                  </div>
                )}

                {/* 1. DATOS PERSONALES */}
                <div className="doctor-card doctor-card--datos">
                  <h3 className="doctor-card__title">DATOS PERSONALES</h3>
                  <div className="doctor-card__grid">
                    <div className="doctor-field">
                      <label htmlFor="m-apellido">Apellido</label>
                      <input
                        id="m-apellido"
                        ref={apellidoRef}
                        value={form.apellido}
                        className={validationErrors.apellido ? 'is-invalid' : ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, apellido: e.target.value }))
                          if (validationErrors.apellido) {
                            setValidationErrors((prev) => ({ ...prev, apellido: false }))
                          }
                        }}
                      />
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-nombre">Nombre</label>
                      <input
                        id="m-nombre"
                        value={form.nombre}
                        className={validationErrors.nombre ? 'is-invalid' : ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, nombre: e.target.value }))
                          if (validationErrors.nombre) {
                            setValidationErrors((prev) => ({ ...prev, nombre: false }))
                          }
                        }}
                      />
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-dni">{DNI_MED_LABEL}</label>
                      <input
                        id="m-dni"
                        value={form.dni}
                        className={validationErrors.dni ? 'is-invalid' : ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, dni: e.target.value }))
                          if (validationErrors.dni) {
                            setValidationErrors((prev) => ({ ...prev, dni: false }))
                          }
                          if (dniMsg) setDniMsg(null)
                        }}
                        onBlur={() => {
                          const dniNorm = String(form.dni ?? '').trim()
                          if (!dniNorm) return
                          const dup = data.doctors.find(
                            (d) => (d.dni ?? '').trim() === dniNorm && d.id !== editingId,
                          )
                          if (dup) {
                            setDniMsg(dniMedDuplicadoMsg(dup.apellido, dup.nombre))
                            setValidationErrors((prev) => ({ ...prev, dni: true }))
                          }
                        }}
                      />
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-mat">Matrícula</label>
                      <input
                        id="m-mat"
                        value={form.matricula}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, matricula: e.target.value }))
                        }
                      />
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-esp">Especialidad</label>
                      <div className="doctor-input-with-button">
                        <select
                          id="m-esp"
                          value={form.especialidad}
                          className={validationErrors.especialidad ? 'is-invalid' : ''}
                          onChange={(e) => {
                            setForm((f) => ({ ...f, especialidad: e.target.value }))
                            if (validationErrors.especialidad) {
                              setValidationErrors((prev) => ({ ...prev, especialidad: false }))
                            }
                          }}
                        >
                          <option value="">— Seleccionar —</option>
                          {especialidadesOpciones.map((esp) => (
                            <option key={esp} value={esp}>
                              {esp}
                            </option>
                          ))}
                          {form.especialidad &&
                            !especialidadesOpciones.includes(form.especialidad) && (
                              <option value={form.especialidad}>
                                {form.especialidad}
                              </option>
                            )}
                        </select>
                        <button
                          type="button"
                          className="btn-list-square"
                          aria-label="Gestionar especialidades"
                          title="Gestionar especialidades"
                          onClick={() => setEspModalOpen(true)}
                        >
                          <IconList />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. CONTACTO */}
                <div className="doctor-card doctor-card--contacto">
                  <h3 className="doctor-card__title">CONTACTO</h3>
                  <div className="doctor-card__grid">
                    <div className="doctor-field">
                      <label htmlFor="m-loc">Localidad</label>
                      <div className="doctor-input-with-button">
                        <select
                          id="m-loc"
                          value={form.localidad}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, localidad: e.target.value }))
                          }
                        >
                          <option value="">— Seleccionar —</option>
                          {localidadesOpciones.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                          {form.localidad &&
                            !localidadesOpciones.includes(form.localidad) && (
                              <option value={form.localidad}>
                                {form.localidad}
                              </option>
                            )}
                        </select>
                        <button
                          type="button"
                          className="btn-list-square"
                          aria-label="Gestionar localidades"
                          title="Gestionar localidades"
                          onClick={() => setLocModalOpen(true)}
                        >
                          <IconList />
                        </button>
                      </div>
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-mail">Email</label>
                      <input
                        id="m-mail"
                        type="email"
                        value={form.email}
                        className={validationErrors.email ? 'is-invalid' : ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, email: e.target.value }))
                          if (validationErrors.email) {
                            setValidationErrors((prev) => ({ ...prev, email: false }))
                          }
                        }}
                      />
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-tel">Teléfono</label>
                      <input
                        id="m-tel"
                        value={form.telefono}
                        className={validationErrors.telefono ? 'is-invalid' : ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, telefono: e.target.value }))
                          if (validationErrors.telefono) {
                            setValidationErrors((prev) => ({ ...prev, telefono: false }))
                          }
                        }}
                      />
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-alias">Alias</label>
                      <input
                        id="m-alias"
                        value={form.alias ?? ''}
                        placeholder="Opcional"
                        maxLength={24}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, alias: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* 3. HONORARIOS */}
                <div className="doctor-card doctor-card--honorarios">
                  <h3 className="doctor-card__title">HONORARIOS</h3>
                  <div className="doctor-card__grid">
                    {puedeVerPorcentaje && (
                      <div className="doctor-field">
                        <label htmlFor="m-pct">Porcentaje</label>
                        <div className="doctor-affix-input-wrap">
                          <input
                            id="m-pct"
                            type="text"
                            inputMode="decimal"
                            maxLength={6}
                            placeholder="0"
                            className="doctor-input-pct"
                            value={form.porcentaje}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                porcentaje: sanitizePorcentajeInput(e.target.value),
                              }))
                            }
                          />
                          <span className="doctor-affix-symbol">%</span>
                        </div>
                      </div>
                    )}
                    <div className="doctor-field">
                      <label htmlFor="m-valor">Monto Diario</label>
                      <div className="doctor-affix-input-wrap doctor-affix--blue">
                        <span className="doctor-affix-symbol-left">$</span>
                        <input
                          id="m-valor"
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          className="doctor-input-money-blue"
                          value={form.valor ? form.valor.replace(/^\$\s*/, '') : ''}
                          onChange={(e) => {
                            const clean = sanitizeMoneyTyping(e.target.value)
                            setForm((f) => ({
                              ...f,
                              valor: clean ? formatMoneyDisplay(clean) : '',
                            }))
                          }}
                        />
                      </div>
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-particular">Particular</label>
                      <div className="doctor-affix-input-wrap doctor-affix--blue">
                        <span className="doctor-affix-symbol-left">$</span>
                        <input
                          id="m-particular"
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          className="doctor-input-money-blue"
                          value={form.particular ? form.particular.replace(/^\$\s*/, '') : ''}
                          onChange={(e) => {
                            const clean = sanitizeMoneyTyping(e.target.value)
                            setForm((f) => ({
                              ...f,
                              particular: clean ? formatMoneyDisplay(clean) : '',
                            }))
                          }}
                        />
                      </div>
                    </div>
                    <div className="doctor-field">
                      <label htmlFor="m-cuidar">Cuidar</label>
                      <div className="doctor-affix-input-wrap doctor-affix--blue">
                        <span className="doctor-affix-symbol-left">$</span>
                        <input
                          id="m-cuidar"
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          className="doctor-input-money-blue"
                          value={form.cuidar ? form.cuidar.replace(/^\$\s*/, '') : ''}
                          onChange={(e) => {
                            const clean = sanitizeMoneyTyping(e.target.value)
                            setForm((f) => ({
                              ...f,
                              cuidar: clean ? formatMoneyDisplay(clean) : '',
                            }))
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="doctor-honorarios-total">
                    Total consulta particular:{' '}
                    <strong>{formatTotalParticularDisplay(form.particular, form.cuidar)}</strong>
                  </div>
                </div>

                {/* 4. OBRAS SOCIALES */}
                <div className="doctor-card doctor-card--os">
                  <h3 className="doctor-card__title">OBRAS SOCIALES</h3>
                  <div className="doctor-os-top-row">
                    <select
                      id="m-obra"
                      value={form.obraSocial ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          obraSocial: normalizeObraSocial(e.target.value),
                        }))
                      }
                    >
                      <option value="">— Seleccionar —</option>
                      {obrasSocialesOpciones.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                      {form.obraSocial &&
                        !obrasSocialesOpciones.includes(form.obraSocial) && (
                          <option value={form.obraSocial}>{form.obraSocial}</option>
                        )}
                    </select>
                    <button
                      type="button"
                      className="pac-btn pac-btn--gray btn-os-add"
                      disabled={!form.obraSocial}
                      onClick={() => {
                        const v = normalizeObraSocial(form.obraSocial ?? '')
                        if (!v) return
                        const exists = (form.obrasSociales ?? []).some(
                          (os) => os.nombre.trim().toLowerCase() === v.trim().toLowerCase(),
                        )
                        if (!exists) {
                          setForm((f) => ({
                            ...f,
                            obrasSociales: [
                              ...(f.obrasSociales ?? []),
                              { nombre: v, porcentaje: '0', monto: '' },
                            ],
                            obraSocial: '',
                          }))
                        } else {
                          setForm((f) => ({ ...f, obraSocial: '' }))
                        }
                      }}
                    >
                      Agregar
                    </button>
                    <button
                      type="button"
                      className="btn-list-square"
                      aria-label="Gestionar obras sociales"
                      title="Gestionar obras sociales"
                      onClick={() => setOsModalOpen(true)}
                    >
                      <IconList />
                    </button>
                  </div>

                  {form.obrasSociales && form.obrasSociales.length > 0 ? (
                    <div className="doctor-os-table-container">
                      <div className="doctor-os-table-header">
                        <div>OBRA SOCIAL</div>
                        <div style={{ textAlign: 'right' }}>%</div>
                        <div style={{ textAlign: 'right' }}>MONTO</div>
                        <div />
                      </div>
                      <div className="doctor-os-table-scroll">
                        {form.obrasSociales.map((os, idx) => (
                          <div key={os.nombre} className="doctor-os-table-row">
                            <div>
                              <span className="medico-os-chip">{os.nombre}</span>
                            </div>
                            <div>
                              <input
                                type="text"
                                inputMode="numeric"
                                className="doctor-os-input-pct"
                                placeholder="0"
                                aria-label={`Porcentaje para ${os.nombre}`}
                                value={os.porcentaje}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/\D/g, '')
                                  setForm((f) => {
                                    const next = [...f.obrasSociales]
                                    next[idx] = { ...next[idx], porcentaje: val }
                                    return { ...f, obrasSociales: next }
                                  })
                                }}
                              />
                            </div>
                            <div>
                              <div className="doctor-affix-input-wrap doctor-affix-table-monto">
                                <span className="doctor-affix-symbol-left">$</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="doctor-os-input-monto"
                                  placeholder="0"
                                  aria-label={`Monto para ${os.nombre}`}
                                  value={os.monto}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) => {
                                    const val = formatThousands(e.target.value)
                                    setForm((f) => {
                                      const next = [...f.obrasSociales]
                                      next[idx] = { ...next[idx], monto: val }
                                      return { ...f, obrasSociales: next }
                                    })
                                  }}
                                />
                              </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <button
                                type="button"
                                className="medico-os-remove-btn"
                                title={`Quitar ${os.nombre}`}
                                aria-label={`Quitar ${os.nombre}`}
                                onClick={() => {
                                  setForm((f) => ({
                                    ...f,
                                    obrasSociales: f.obrasSociales.filter((_, i) => i !== idx),
                                  }))
                                }}
                              >
                                &times;
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="doctor-os-empty">
                      Todavía no hay obras sociales asignadas
                    </div>
                  )}
                </div>
              </div>

              {/* Pie del modal */}
              <div className="pac-modal__footer">
                <div className="pac-modal__footer-left">
                  {currentEditingDoctor && (
                    <>
                      <button
                        type="button"
                        className="pac-btn pac-btn--gray pac-btn--danger"
                        onClick={() => void handleDelete(currentEditingDoctor)}
                      >
                        Eliminar médico
                      </button>
                      {currentEditingDoctor.activo !== false ? (
                        <button
                          type="button"
                          className="pac-btn pac-btn--gray"
                          onClick={() => void handleSuspend(currentEditingDoctor.id)}
                        >
                          Suspender médico
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="pac-btn pac-btn--gray"
                          onClick={() => handleReactivate(currentEditingDoctor.id)}
                        >
                          Reactivar médico
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="pac-modal__footer-right">
                  <button
                    type="button"
                    className="pac-btn pac-btn--gray"
                    onClick={closeForm}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="pac-btn pac-btn--primary"
                    disabled={!hasChanges}
                  >
                    {editingId ? 'Guardar cambios' : 'Registrar médico'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="pacientes-directory-card">
        <div className="pacientes-toolbar-top">
          <div className="pacientes-toolbar-title-wrap">
            <div className="pacientes-toolbar-icon"><IconTileMedicos /></div>
            <div className="pacientes-toolbar-headings">
              <h2 className="pacientes-toolbar-heading">Directorio de médicos</h2>
              <p className="pacientes-toolbar-subheading">Buscá por DNI, matrícula o apellido.</p>
            </div>
          </div>
          <div className="pacientes-toolbar-controls">
            <div className="pacientes-search-input-wrap">
              <input
                id="m-search"
                className="pacientes-search-input"
                aria-label="Buscar médico"
                placeholder={`Buscar por ${DNI_MED_LABEL}, matrícula o apellido...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="pacientes-segmented-control" role="group" aria-label="Filtrar por estado">
              <button type="button" className={`pacientes-segment-btn${listFilter === 'activos' ? ' is-active' : ''}`} aria-pressed={listFilter === 'activos'} onClick={() => setListFilter('activos')}>
                Activos ({countActivos})
              </button>
              <button type="button" className={`pacientes-segment-btn${listFilter === 'suspendidos' ? ' is-active' : ''}`} aria-pressed={listFilter === 'suspendidos'} onClick={() => setListFilter('suspendidos')}>
                Suspendidos ({countSuspendidos})
              </button>
            </div>
            {puedeExportPdf && (
              <>
                <button type="button" className="pacientes-btn-pdf" title="Vista previa del listado en PDF" onClick={handlePdfPreview}>
                  <span className="btn-pdf__icon" aria-hidden>PDF</span>
                  Vista previa
                </button>
                <button type="button" className="pacientes-btn-pdf" title="Exportar lista de médicos y especialidades a Excel" onClick={() => void handleExcelExport()} disabled={exportingExcel}>
                  {exportingExcel ? 'Generando...' : 'Excel'}
                </button>
              </>
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
        <div className="pacientes-table-wrap">
        {sorted.length === 0 ? (
          <div className="pacientes-empty-state"><p>
            {listFilter === 'activos'
              ? data.doctors.length === 0
                ? 'Cargando médicos de ejemplo…'
                : 'No hay médicos activos.'
              : 'No hay médicos suspendidos.'}
          </p></div>
        ) : filtered.length === 0 ? (
          <div className="pacientes-empty-state"><p>No hay médicos que coincidan con la búsqueda.</p></div>
        ) : (
          <div ref={listScrollRef} className="table-list__scroll" style={{ maxHeight: '596px' }}>
          <table className="pacientes-modern-table medicos-modern-table">
            <thead>
              <tr>
                <th>MÉDICO</th>
                <th>{DNI_MED_LABEL}</th>
                <th>MATRÍCULA</th>
                <th>ESPECIALIDAD</th>
                <th>CONTACTO</th>
                {puedeVerPorcentaje && <th>PORCENTAJE</th>}
                <th>ESTADO</th>
                <th className="th--actions">ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {virtualSlice.paddingTop > 0 && (
                <tr aria-hidden className="virtual-table-spacer">
                    <td colSpan={colSpan} style={{ height: virtualSlice.paddingTop }} />
                </tr>
              )}
              {visibleDoctors.map((d) => (
                <tr
                  key={d.id}
                  className={editingId === d.id ? 'is-selected' : ''}
                  onClick={() => startEdit(d)}
                >
                  <td className="pacientes-td-apellido">
                    {d.apellido}, {d.nombre}
                  </td>
                  <td className="pacientes-td-dni">{d.dni?.trim() || '—'}</td>
                  <td>{d.matricula || '—'}</td>
                  <td>{d.especialidad || '—'}</td>
                  <td className="medicos-td-contact">
                    {d.telefono || '—'}
                    {d.email ? ` · ${d.email}` : ''}
                  </td>
                  {puedeVerPorcentaje && (
                    <td>{d.porcentaje != null ? `${formatPorcentajeLabel(d.porcentaje)}%` : '—'}</td>
                  )}
                  <td>
                    <span className={`pacientes-status-badge ${d.activo !== false ? 'pacientes-status-badge--activo' : 'pacientes-status-badge--suspendido'}`}>
                      <span className="pacientes-status-badge__dot" />
                      {d.activo !== false ? 'Activo' : 'Suspendido'}
                    </span>
                  </td>
                  <td className="pacientes-td-actions" onClick={(event) => event.stopPropagation()}>
                    <div
                      className="medicos-row-actions"
                    >
                      <IconActionButton
                        variant="edit"
                        label="Editar médico"
                        onClick={() => startEdit(d)}
                      >
                        <IconEdit />
                      </IconActionButton>
                      {d.activo !== false ? (
                        <IconActionButton
                          variant="suspend"
                          label="Suspender médico"
                          onClick={() => void handleSuspend(d.id)}
                        >
                          <IconPause />
                        </IconActionButton>
                      ) : (
                        <IconActionButton
                          variant="restore"
                          label="Reactivar médico"
                          onClick={() => handleReactivate(d.id)}
                        >
                          <IconRestoreDay />
                        </IconActionButton>
                      )}
                      <IconActionButton
                        variant="delete"
                        label="Eliminar médico"
                        onClick={() => void handleDelete(d)}
                      >
                        <IconTrash />
                      </IconActionButton>
                    </div>
                  </td>
                </tr>
              ))}
              {virtualSlice.paddingBottom > 0 && (
                <tr aria-hidden className="virtual-table-spacer">
                  <td colSpan={colSpan} style={{ height: virtualSlice.paddingBottom }} />
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
      </div>

      {pdfPreview && (
        <PdfPreviewModal
          title={pdfPreview.title}
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          onClose={closePdfPreview}
          onDownload={() => void handlePdfDownload()}
        />
      )}

      {espModalOpen && (
        <EspecialidadesModal
          custom={data.especialidadesCustom}
          onClose={() => setEspModalOpen(false)}
          onAdd={(nombre) => {
            const res = addEspecialidadCustom(nombre)
            if (res.ok) {
              setForm((f) => ({
                ...f,
                especialidad: normalizeEspecialidad(nombre),
              }))
            }
            return res
          }}
          onRemove={removeEspecialidadCustom}
          onRename={(anterior, nuevo) => {
            const res = renameEspecialidadCustom(anterior, nuevo)
            if (res.ok && form.especialidad === anterior) {
              setForm((f) => ({ ...f, especialidad: nuevo.trim() }))
            }
            return res
          }}
        />
      )}

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
    </div>
  )
}
