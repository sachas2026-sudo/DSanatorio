import { useEffect, useMemo, useRef, useState } from 'react'
import { differenceInYears, parseISO } from 'date-fns'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
import { PacienteHistorialSection } from '../components/PacienteHistorialSection'
import { ObrasSocialesModal } from '../components/ObrasSocialesModal'
import { LocalidadesModal } from '../components/LocalidadesModal'
import { IconActionButton, IconEdit, IconList, IconTrash } from '../components/icons'
import { useAppState } from '../context/AppStateContext'
import { useConfirm } from '../context/ConfirmContext'
import { pdfBlobUrl, savePdfFile } from '../lib/doctorPaymentsPdf'
import { normalizeObraSocial } from '../lib/obrasSociales'
import { normalizeLocalidad } from '../lib/localidadesMisiones'
import { preloadPdfHeaderBanner } from '../lib/pdfHeaderBanner'
import {
  buildPacientesPdf,
  pacientesPdfPreviewTitle,
} from '../lib/pacientesPdf'
import type { Patient } from '../types'
import type jsPDF from 'jspdf'
import './pages.css'

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

export function PacientesPage() {
  const {
    data,
    upsertPatient,
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [osModalOpen, setOsModalOpen] = useState(false)
  const [locModalOpen, setLocModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [dniMsg, setDniMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const formPanelRef = useRef<HTMLElement>(null)
  const dniRef = useRef<HTMLInputElement>(null)
  const didAutoSelect = useRef(false)
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)

  const edadLabel = useMemo(() => {
    const raw = form.fechaNacimiento?.trim() ?? ''
    if (!raw) return ''
    try {
      const birth = parseISO(raw)
      const years = differenceInYears(new Date(), birth)
      return Number.isFinite(years) && years >= 0 ? String(years) : ''
    } catch {
      return ''
    }
  }, [form.fechaNacimiento])

  function startNew() {
    setEditingId(null)
    setForm(emptyForm)
    setDniMsg(null)
  }

  function startEdit(p: Patient, scrollToForm = false) {
    setEditingId(p.id)
    setForm({
      nombre: p.nombre,
      apellido: p.apellido,
      dni: p.dni,
      telefono: p.telefono,
      email: p.email,
      domicilio: p.domicilio ?? '',
      localidad: p.localidad ?? '',
      fechaNacimiento: p.fechaNacimiento,
      obraSocial: p.obraSocial ?? '',
      notas: p.notas,
    })
    if (scrollToForm) {
      requestAnimationFrame(() => {
        formPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  async function handleDelete(id: string) {
    const citas = data.appointments.filter((a) => a.patientId === id).length
    const pagos = data.payments.filter((p) => p.patientId === id).length
    const extra =
      citas > 0 || pagos > 0
        ? `\n\nTambién se eliminarán ${citas} turno${citas === 1 ? '' : 's'} y ${pagos} pago${pagos === 1 ? '' : 's'} vinculados.`
        : ''
    const ok = await confirm({
      message: `¿Eliminar este paciente?${extra}`,
    })
    if (!ok) return
    deletePatient(id)
    if (editingId === id) startNew()
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
        setDniMsg(
          `Ese DNI ya está cargado: ${dup.apellido}, ${dup.nombre}. Revisá antes de guardar.`,
        )
        dniRef.current?.focus()
        return
      }
    }
    upsertPatient({ ...form, id: editingId ?? undefined })
    startNew()
  }

  const sorted = [...data.patients].sort((a, b) =>
    `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
      sensitivity: 'base',
    }),
  )

  const filtered = (() => {
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((p) => {
      const dni = (p.dni ?? '').toLowerCase()
      const apellido = (p.apellido ?? '').toLowerCase()
      return dni.includes(q) || apellido.includes(q)
    })
  })()

  function cancelNew() {
    setDniMsg(null)
    if (sorted.length > 0) {
      startEdit(sorted[0]!, true)
      return
    }
    startNew()
  }

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
    try {
      await preloadPdfHeaderBanner()
      const built = buildPacientesPdf(data.patients)
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

  useEffect(() => {
    if (sorted.length === 0 || didAutoSelect.current) return
    didAutoSelect.current = true
    startEdit(sorted[0]!)
  }, [sorted.length, sorted[0]?.id])

  useEffect(() => {
    if (editingId !== null) return
    requestAnimationFrame(() => dniRef.current?.focus())
  }, [editingId])

  return (
    <div className="page page--pacientes">
      <header className="page-header">
        <h1>Pacientes</h1>
      </header>

      <section className="panel" ref={formPanelRef}>
        <h2>
          {editingId
            ? `Paciente - ${form.apellido}, ${form.nombre}`
            : 'Nuevo paciente'}
        </h2>
        <form onSubmit={submit}>
          {dniMsg && <div className="msg msg-error">{dniMsg}</div>}
          <div className="form-grid form-grid--paciente-top">
            <div className="field field--dni">
              <label htmlFor="p-dni">DNI</label>
              <input
                id="p-dni"
                ref={dniRef}
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
                  if (dup) {
                    setDniMsg(
                      `Ese DNI ya está cargado: ${dup.apellido}, ${dup.nombre}.`,
                    )
                  }
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="p-nombre">Nombre</label>
              <input
                id="p-nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="p-apellido">Apellido</label>
              <input
                id="p-apellido"
                value={form.apellido}
                onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))}
                required
              />
            </div>
            <div className="field field--fecha-nac">
              <label htmlFor="p-fn">F. nacimiento</label>
              <input
                id="p-fn"
                type="date"
                value={form.fechaNacimiento}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fechaNacimiento: e.target.value }))
                }
              />
            </div>
            <div className="field field--edad">
              <label htmlFor="p-edad">Edad</label>
              <input id="p-edad" value={edadLabel} readOnly placeholder="—" />
            </div>
            <div className="field field--tel">
              <label htmlFor="p-tel">Teléfono</label>
              <input
                id="p-tel"
                value={form.telefono}
                onChange={(e) =>
                  setForm((f) => ({ ...f, telefono: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="form-grid form-grid--paciente-contact">
            <div className="field field--email">
              <label htmlFor="p-mail">Email</label>
              <input
                id="p-mail"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </div>
            <div className="field field--domicilio">
              <label htmlFor="p-domicilio">Domicilio</label>
              <input
                id="p-domicilio"
                value={form.domicilio}
                onChange={(e) =>
                  setForm((f) => ({ ...f, domicilio: e.target.value }))
                }
              />
            </div>
            <div className="field field--pill field--os-abm">
              <label htmlFor="p-loc">Localidad</label>
              <div className="esp-select-row">
                <div className="pill-select">
                  <select
                    id="p-loc"
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
            <div className="field field--pill field--obra-social field--os-abm">
              <label htmlFor="p-os">Obra Social</label>
              <div className="esp-select-row">
                <div className="pill-select">
                  <select
                    id="p-os"
                    value={form.obraSocial}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, obraSocial: e.target.value }))
                    }
                  >
                    <option value="">— Seleccionar —</option>
                    {obrasSocialesOpciones.map((os) => (
                      <option key={os} value={os}>
                        {os}
                      </option>
                    ))}
                    {form.obraSocial &&
                      !obrasSocialesOpciones.includes(form.obraSocial) && (
                        <option value={form.obraSocial}>
                          {form.obraSocial}
                        </option>
                      )}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-abm btn-abm--inline"
                  aria-label="Gestionar obras sociales"
                  title="Gestionar obras sociales"
                  onClick={() => setOsModalOpen(true)}
                >
                  <IconList />
                </button>
              </div>
            </div>
          </div>
          <div className="form-grid__paciente-bottom">
            <div className="field field--notas-full">
              <label htmlFor="p-notas">Notas</label>
              <textarea
                id="p-notas"
                rows={1}
                value={form.notas}
                onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Guardar cambios' : 'Guardar paciente'}
            </button>
            {!editingId && sorted.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={cancelNew}>
                Cancelar
              </button>
            )}
            {editingId && (
              <button type="button" className="btn btn-ghost" onClick={startNew}>
                Nuevo paciente
              </button>
            )}
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
            <div className="field field--pill field--search">
              <label className="sr-only" htmlFor="p-search">
                Buscar paciente
              </label>
              <div className="pill-input">
                <input
                  id="p-search"
                  placeholder="Buscar por DNI o apellido…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
        </form>
      </section>

      <div className="table-wrap table-wrap--scroll">
        {sorted.length === 0 ? (
          <p className="empty-hint">Todavía no hay pacientes cargados.</p>
        ) : filtered.length === 0 ? (
          <p className="empty-hint">No hay pacientes que coincidan con la búsqueda.</p>
        ) : (
          <div className="table-list__scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>DNI</th>
                  <th>Apellido</th>
                  <th>Obra Social</th>
                  <th>Teléfono</th>
                  <th>Email</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className={`data-row--clickable${editingId === p.id ? ' data-row--active' : ''}`}
                    onClick={() => startEdit(p, true)}
                  >
                    <td>{p.dni || '—'}</td>
                    <td>{p.apellido || '—'}</td>
                    <td>
                      {p.obraSocial ? (
                        <span className="obra-pill">{p.obraSocial}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{p.telefono || '—'}</td>
                    <td>{p.email || '—'}</td>
                    <td>
                      <div
                        className="row-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IconActionButton
                          variant="edit"
                          label="Editar paciente"
                          onClick={() => startEdit(p, true)}
                        >
                          <IconEdit />
                        </IconActionButton>
                        <IconActionButton
                          variant="delete"
                          label="Eliminar paciente"
                          onClick={() => handleDelete(p.id)}
                        >
                          <IconTrash />
                        </IconActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingId && (
        <section className="panel panel--paciente-historial">
          <PacienteHistorialSection patientId={editingId} />
        </section>
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
