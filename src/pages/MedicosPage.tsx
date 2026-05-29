import { useEffect, useRef, useState } from 'react'
import { EspecialidadesModal } from '../components/EspecialidadesModal'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
import { normalizeEspecialidad } from '../lib/especialidades'
import { pdfBlobUrl, savePdfFile } from '../lib/doctorPaymentsPdf'
import { preloadPdfHeaderBanner } from '../lib/pdfHeaderBanner'
import {
  buildMedicosPdf,
  medicosPdfPreviewTitle,
} from '../lib/medicosPdf'
import { IconActionButton, IconEdit, IconList, IconTrash } from '../components/icons'
import { useAppState } from '../context/AppStateContext'
import { useConfirm } from '../context/ConfirmContext'
import type { Doctor } from '../types'
import type jsPDF from 'jspdf'
import './pages.css'
import { LocalidadesModal } from '../components/LocalidadesModal'
import { normalizeLocalidad } from '../lib/localidadesMisiones'

type MedicoFormState = Omit<Doctor, 'id' | 'porcentaje'> & {
  porcentaje: string
}

const emptyForm: MedicoFormState = {
  nombre: '',
  apellido: '',
  matricula: '',
  especialidad: '',
  telefono: '',
  localidad: '',
  email: '',
  porcentaje: '',
}

function formatPorcentajeInput(n?: number): string {
  if (n == null || !Number.isFinite(n)) return ''
  return String(Math.min(999, Math.max(0, Math.round(n))))
}

function parsePorcentajeInput(value: string): number | undefined {
  const digits = value.replace(/\D/g, '')
  if (!digits) return undefined
  const n = Number(digits)
  if (!Number.isFinite(n)) return undefined
  return Math.min(999, Math.max(0, Math.round(n)))
}

export function MedicosPage() {
  const {
    data,
    upsertDoctor,
    deleteDoctor,
    ensureDemoDoctors,
    especialidadesOpciones,
    addEspecialidadCustom,
    removeEspecialidadCustom,
    renameEspecialidadCustom,
    localidadesOpciones,
    addLocalidadCustom,
    removeLocalidadCustom,
    renameLocalidadCustom,
  } = useAppState()
  const { confirm } = useConfirm()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [espModalOpen, setEspModalOpen] = useState(false)
  const [locModalOpen, setLocModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const formPanelRef = useRef<HTMLElement>(null)
  const didAutoSelect = useRef(false)
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)

  useEffect(() => {
    ensureDemoDoctors()
  }, [ensureDemoDoctors])

  function startNew() {
    setEditingId(null)
    setForm(emptyForm)
  }

  function startEdit(d: Doctor, scrollToForm = false) {
    setEditingId(d.id)
    setForm({
      nombre: d.nombre,
      apellido: d.apellido,
      matricula: d.matricula,
      especialidad: d.especialidad,
      telefono: d.telefono,
      localidad: d.localidad ?? '',
      email: d.email,
      porcentaje: formatPorcentajeInput(d.porcentaje),
    })
    if (scrollToForm) {
      requestAnimationFrame(() => {
        formPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      message: '¿Eliminar este médico y datos vinculados?',
    })
    if (!ok) return
    deleteDoctor(id)
    if (editingId === id) startNew()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim() || !form.apellido.trim()) return
    upsertDoctor({
      ...form,
      porcentaje: parsePorcentajeInput(form.porcentaje),
      id: editingId ?? undefined,
    })
    startNew()
  }

  const sorted = [...data.doctors].sort((a, b) =>
    `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
      sensitivity: 'base',
    }),
  )

  const filtered = (() => {
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((d) => {
      const apellido = (d.apellido ?? '').toLowerCase()
      const matricula = (d.matricula ?? '').toLowerCase()
      return apellido.includes(q) || matricula.includes(q)
    })
  })()

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
      const built = buildMedicosPdf(data.doctors)
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

  useEffect(() => {
    if (sorted.length === 0 || didAutoSelect.current) return
    didAutoSelect.current = true
    startEdit(sorted[0]!)
  }, [sorted.length, sorted[0]?.id])

  return (
    <div className="page page--medicos">
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
          <div className="form-grid form-grid--medico-top">
            <div className="field">
              <label htmlFor="m-nombre">Nombre</label>
              <input
                id="m-nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="m-apellido">Apellido</label>
              <input
                id="m-apellido"
                value={form.apellido}
                onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))}
                required
              />
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
          </div>
          <div className="form-grid form-grid--medico-contact">
            <div className="field">
              <label htmlFor="m-tel">Teléfono</label>
              <input
                id="m-tel"
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
              />
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
            <div className="field field--medico-porcentaje">
              <label htmlFor="m-pct">Porcentaje</label>
              <input
                id="m-pct"
                type="text"
                inputMode="numeric"
                maxLength={3}
                placeholder="0"
                value={form.porcentaje}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    porcentaje: e.target.value.replace(/\D/g, '').slice(0, 3),
                  }))
                }
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Guardar cambios' : 'Guardar médico'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-ghost" onClick={startNew}>
                Nuevo médico
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
              <label className="sr-only" htmlFor="m-search">
                Buscar médico
              </label>
              <div className="pill-input">
                <input
                  id="m-search"
                  placeholder="Buscar por matrícula o apellido…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
        </form>
      </section>

      <div className="table-wrap">
        {sorted.length === 0 ? (
          <p className="empty-hint">Cargando médicos de ejemplo…</p>
        ) : filtered.length === 0 ? (
          <p className="empty-hint">No hay médicos que coincidan con la búsqueda.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Médico</th>
                <th>Matrícula</th>
                <th>Especialidad</th>
                <th>Contacto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  className={`data-row--clickable${editingId === d.id ? ' data-row--active' : ''}`}
                  onClick={() => startEdit(d, true)}
                >
                  <td>
                    {d.apellido}, {d.nombre}
                  </td>
                  <td>{d.matricula || '—'}</td>
                  <td>{d.especialidad || '—'}</td>
                  <td>
                    {d.telefono || '—'}
                    {d.email ? ` · ${d.email}` : ''}
                    {d.porcentaje != null ? ` · ${d.porcentaje}%` : ''}
                  </td>
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
                      <IconActionButton
                        variant="delete"
                        label="Eliminar médico"
                        onClick={() => handleDelete(d.id)}
                      >
                        <IconTrash />
                      </IconActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
