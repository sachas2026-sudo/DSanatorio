import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualSlice } from '../hooks/useVirtualSlice'
import { EspecialidadesModal } from '../components/EspecialidadesModal'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
import { normalizeEspecialidad } from '../lib/especialidades'
import { pdfBlobUrl, savePdfFile } from '../lib/doctorPaymentsPdf'
import { preloadPdfHeaderBanner } from '../lib/pdfHeaderBanner'
import { ObrasSocialesModal } from '../components/ObrasSocialesModal'
import { normalizeObraSocial } from '../lib/obrasSociales'
import {
  buildMedicosPdf,
  medicosPdfPreviewTitle,
} from '../lib/medicosPdf'
import { IconActionButton, IconEdit, IconList, IconPause, IconRestoreDay, IconTrash } from '../components/icons'
import { useAppState } from '../context/AppStateContext'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../context/ConfirmContext'
import {
  medicosActivos,
  medicosSuspendidos,
} from '../lib/activo'
import { DNI_MED_LABEL, dniMedDuplicadoMsg } from '../lib/dniLabels'
import {
  canExportMedicosListado,
  canViewDoctorPorcentaje,
  EXPORT_DENIED_MESSAGE,
} from '../lib/exportPermissions'
import type { Doctor } from '../types'
import type jsPDF from 'jspdf'
import './pages.css'
import { LocalidadesModal } from '../components/LocalidadesModal'
import { normalizeLocalidad } from '../lib/localidadesMisiones'
import {
  formatPorcentajeInput,
  formatPorcentajeLabel,
  parsePorcentajeInput,
  sanitizePorcentajeInput,
} from '../lib/porcentajeInput'

type MedicoFormState = Omit<Doctor, 'id' | 'porcentaje'> & {
  porcentaje: string
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
  const [espModalOpen, setEspModalOpen] = useState(false)
  const [osModalOpen, setOsModalOpen] = useState(false)
  const [locModalOpen, setLocModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dniMsg, setDniMsg] = useState<string | null>(null)
  const [listFilter, setListFilter] = useState<'activos' | 'suspendidos'>('activos')
  const formPanelRef = useRef<HTMLElement>(null)
  const apellidoRef = useRef<HTMLInputElement>(null)
  // (no auto-select)
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)

  function startNew() {
    setEditingId(null)
    setForm(emptyForm)
    setDniMsg(null)
    requestAnimationFrame(() => apellidoRef.current?.focus())
  }

  function startEdit(d: Doctor, scrollToForm = false) {
    setEditingId(d.id)
    setForm({
      nombre: d.nombre,
      apellido: d.apellido,
      dni: d.dni ?? '',
      matricula: d.matricula,
      especialidad: d.especialidad,
      obraSocial: '',
      obrasSociales:
        d.obrasSociales ?? (d.obraSocial ? [d.obraSocial] : []),
      telefono: d.telefono,
      localidad: d.localidad ?? '',
      email: d.email,
      alias: d.alias ?? '',
      porcentaje: formatPorcentajeInput(d.porcentaje),
    })
    if (scrollToForm) {
      requestAnimationFrame(() => {
        formPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  async function handleSuspend(id: string) {
    const ok = await confirm({
      message:
        '¿Suspender este médico?\n\nNo aparecerá en Médicos ni en la agenda para turnos nuevos. Agenda, cobros y pagos cancelados quedan en el historial.',
    })
    if (!ok) return
    setDoctorActivo(id, false)
    if (editingId === id) startNew()
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
    if (editingId === d.id) startNew()
  }

  function handleReactivate(id: string) {
    setDoctorActivo(id, true)
    setListFilter('activos')
    const d = data.doctors.find((x) => x.id === id)
    if (d) startEdit(d, true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim() || !form.apellido.trim()) return
    const dniNorm = String(form.dni ?? '').trim()
    if (dniNorm) {
      const dup = data.doctors.find(
        (d) => (d.dni ?? '').trim() === dniNorm && d.id !== editingId,
      )
      if (dup) {
        setDniMsg(
          dniMedDuplicadoMsg(dup.apellido, dup.nombre, true),
        )
        return
      }
    }
    setDniMsg(null)
    const porcentaje = puedeVerPorcentaje
      ? parsePorcentajeInput(form.porcentaje)
      : editingId
        ? data.doctors.find((d) => d.id === editingId)?.porcentaje
        : undefined
    upsertDoctor({
      ...form,
      alias: form.alias?.trim() || undefined,
      obrasSociales: (form.obrasSociales ?? []).map((x) => x.trim()).filter(Boolean),
      porcentaje,
      id: editingId ?? undefined,
    })
    startNew()
  }

  const listScrollRef = useRef<HTMLDivElement>(null)
  const MEDICO_ROW_HEIGHT = 48
  const colSpan = puedeVerPorcentaje ? 7 : 6

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

  // Nota: no auto-seleccionamos un médico al entrar; debe quedar "Nuevo médico"
  // hasta que el usuario elija uno.

  return (
    <div className={`page page--medicos${editingId ? ' page--editing' : ''}`}>
      <header className="page-header">
        <h1>Médicos</h1>
      </header>

      <section className="panel" ref={formPanelRef}>
        <h2>
          {editingId
            ? `Médico - ${form.apellido}, ${form.nombre}`
            : 'Nuevo médico'}
        </h2>
        <form onSubmit={submit}>
          {dniMsg && <div className="msg msg-error">{dniMsg}</div>}
          <div className="form-grid form-grid--medico-top">
            <div className="field">
              <label htmlFor="m-apellido">Apellido</label>
              <input
                id="m-apellido"
                ref={apellidoRef}
                value={form.apellido}
                onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="m-nombre">Nombre</label>
              <input
                id="m-nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
              />
            </div>
            <div className="field field--pill field--medico-dni">
              <label htmlFor="m-dni">{DNI_MED_LABEL}</label>
              <div className="pill-input">
                <input
                  id="m-dni"
                  value={form.dni}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, dni: e.target.value }))
                    if (dniMsg) setDniMsg(null)
                  }}
                  onBlur={() => {
                    const dniNorm = String(form.dni ?? '').trim()
                    if (!dniNorm) return
                    const dup = data.doctors.find(
                      (d) => (d.dni ?? '').trim() === dniNorm && d.id !== editingId,
                    )
                    if (dup) {
                      setDniMsg(
                        dniMedDuplicadoMsg(dup.apellido, dup.nombre),
                      )
                    }
                  }}
                />
              </div>
            </div>
            <div className="field field--matricula">
              <label htmlFor="m-mat">Matrícula</label>
              <input
                id="m-mat"
                value={form.matricula}
                onChange={(e) => setForm((f) => ({ ...f, matricula: e.target.value }))}
              />
            </div>
            <div className="field field--pill field--esp-abm">
              <label htmlFor="m-esp">Especialidad</label>
              <div className="esp-select-row">
                <div className="pill-select">
                  <select
                    id="m-esp"
                    value={form.especialidad}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, especialidad: e.target.value }))
                    }
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
                </div>
                <button
                  type="button"
                  className="btn-abm btn-abm--inline"
                  aria-label="Gestionar especialidades"
                  title="Gestionar especialidades"
                  onClick={() => setEspModalOpen(true)}
                >
                  <IconList />
                </button>
              </div>
            </div>
            {/* chips se muestran dentro de "Obras sociales" debajo de Teléfono */}
          </div>
          <div className="form-grid form-grid--medico-contact">
            <div className="field field--pill field--obra-medico">
              <label htmlFor="m-obra">Obras sociales</label>
              <div className="esp-select-row obras-sociales-row">
                <div className="pill-select">
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
                    <option value="">—</option>
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
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!form.obraSocial}
                  onClick={() => {
                    const v = normalizeObraSocial(form.obraSocial ?? '')
                    if (!v) return
                    setForm((f) => ({
                      ...f,
                      obrasSociales: f.obrasSociales?.includes(v)
                        ? f.obrasSociales
                        : [...(f.obrasSociales ?? []), v],
                      obraSocial: '',
                    }))
                  }}
                  title="Agregar a la lista"
                >
                  Agregar
                </button>
                <div className="obras-sociales-row__tail">
                  <button
                    type="button"
                    className="btn-abm btn-abm--inline"
                    aria-label="Gestionar obras sociales"
                    title="Gestionar obras sociales"
                    onClick={() => setOsModalOpen(true)}
                  >
                    <IconList />
                  </button>
                  {form.obrasSociales && form.obrasSociales.length > 0 && (
                    <div className="chip-row chip-row--inline">
                      {form.obrasSociales.map((o) => (
                        <button
                          key={o}
                          type="button"
                          className="chip"
                          title="Quitar"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              obrasSociales: (f.obrasSociales ?? []).filter((x) => x !== o),
                            }))
                          }
                        >
                          {o} <span aria-hidden>×</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="field field--pill field--os-abm">
              <label htmlFor="m-loc">Localidad</label>
              <div className="esp-select-row">
                <div className="pill-select">
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
                        <option value={form.localidad}>{form.localidad}</option>
                      )}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-abm btn-abm--inline"
                  aria-label="Gestionar localidades"
                  title="Gestionar localidades"
                  onClick={() => setLocModalOpen(true)}
                >
                  <IconList />
                </button>
              </div>
            </div>
            <div className="field field--medico-email">
              <label htmlFor="m-mail">Email</label>
              <input
                id="m-mail"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="field field--medico-tel">
              <label htmlFor="m-tel">Teléfono</label>
              <input
                id="m-tel"
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
              />
            </div>
            <div className="field field--medico-alias">
              <label htmlFor="m-alias">Alias</label>
              <input
                id="m-alias"
                value={form.alias ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, alias: e.target.value }))
                }
                placeholder="Opcional"
                maxLength={24}
              />
            </div>
            {puedeVerPorcentaje && (
            <div className="field field--medico-porcentaje">
              <label htmlFor="m-pct">Porcentaje</label>
              <input
                id="m-pct"
                type="text"
                inputMode="decimal"
                maxLength={6}
                placeholder="0"
                value={form.porcentaje}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    porcentaje: sanitizePorcentajeInput(e.target.value),
                  }))
                }
              />
            </div>
            )}
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Guardar cambios' : 'Guardar médico'}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn btn-ghost btn-ghost--verde"
                onClick={startNew}
              >
                Nuevo médico
              </button>
            )}
            {puedeExportPdf && (
            <button
              type="button"
              className="btn btn-pdf"
              title="Vista previa del listado en PDF (orden alfabético)"
              onClick={handlePdfPreview}
            >
              <span className="btn-pdf__icon" aria-hidden>
                PDF
              </span>
              Vista Previa
            </button>
            )}
            <div className="field field--pill field--search">
              <label className="sr-only" htmlFor="m-search">
                Buscar médico
              </label>
              <div className="pill-input">
                <input
                  id="m-search"
                  placeholder={`Buscar por ${DNI_MED_LABEL}, matrícula o apellido…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="abm-list-filter" role="group" aria-label="Filtrar listado">
              <button
                type="button"
                className={`abm-filter-pill${listFilter === 'activos' ? ' abm-filter-pill--active' : ''}`}
                aria-pressed={listFilter === 'activos'}
                aria-label={`Activos, ${medicosActivos(data.doctors).length}`}
                onClick={() => setListFilter('activos')}
              >
                <span className="abm-filter-pill__badge" aria-hidden>
                  {medicosActivos(data.doctors).length}
                </span>
                Activos
              </button>
              <button
                type="button"
                className={`abm-filter-pill${listFilter === 'suspendidos' ? ' abm-filter-pill--active' : ''}`}
                aria-pressed={listFilter === 'suspendidos'}
                aria-label={`Suspendidos, ${medicosSuspendidos(data.doctors).length}`}
                onClick={() => setListFilter('suspendidos')}
              >
                <span className="abm-filter-pill__badge" aria-hidden>
                  {medicosSuspendidos(data.doctors).length}
                </span>
                Suspendidos
              </button>
            </div>
          </div>
        </form>
      </section>

      <div className="table-wrap table-wrap--scroll">
        {sorted.length === 0 ? (
          <p className="empty-hint">
            {listFilter === 'activos'
              ? data.doctors.length === 0
                ? 'Cargando médicos de ejemplo…'
                : 'No hay médicos activos.'
              : 'No hay médicos suspendidos.'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="empty-hint">No hay médicos que coincidan con la búsqueda.</p>
        ) : (
          <div ref={listScrollRef} className="table-list__scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Médico</th>
                <th>{DNI_MED_LABEL}</th>
                <th>Matrícula</th>
                <th>Especialidad</th>
                <th>Contacto</th>
                {puedeVerPorcentaje && <th>%</th>}
                <th></th>
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
                  className={`data-row--clickable${editingId === d.id ? ' data-row--active' : ''}`}
                  onClick={() => startEdit(d, true)}
                >
                  <td>
                    {d.apellido}, {d.nombre}
                  </td>
                  <td>{d.dni?.trim() || '—'}</td>
                  <td>{d.matricula || '—'}</td>
                  <td>{d.especialidad || '—'}</td>
                  <td>
                    {d.telefono || '—'}
                    {d.email ? ` · ${d.email}` : ''}
                  </td>
                  {puedeVerPorcentaje && (
                    <td>{d.porcentaje != null ? `${formatPorcentajeLabel(d.porcentaje)}%` : '—'}</td>
                  )}
                  <td>
                    <div
                      className="row-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconActionButton
                        variant="edit"
                        label="Editar médico"
                        onClick={() => startEdit(d, true)}
                      >
                        <IconEdit />
                      </IconActionButton>
                      {listFilter === 'activos' ? (
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
