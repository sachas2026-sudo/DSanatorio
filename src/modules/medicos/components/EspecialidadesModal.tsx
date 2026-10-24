import { useEffect, useMemo, useRef, useState } from 'react'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { IconActionButton, IconEdit, IconTrash } from '../../../shared/components/icons'
import { useAppState } from '../../../context/AppStateContext'
import { useAuth } from '../../../context/AuthContext'
import { useConfirm } from '../../../context/ConfirmContext'
import { ESPECIALIDADES_COMUNES, isEspecialidadComun, normalizeEspecialidad } from '../../../lib/especialidades'
import {
  buildEspecialidadesCatalogPdf,
  especialidadesCatalogPdfPreviewTitle,
} from '../../../lib/especialidadesCatalogPdf'
import {
  buildEspecialidadesExcel,
  especialidadesExcelFilename,
  saveEspecialidadesExcelFile,
} from '../../../lib/especialidadesExcel'
import { pdfBlobUrl, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { canExportMedicosListado, EXPORT_DENIED_MESSAGE } from '../../../lib/exportPermissions'
import { preloadPdfHeaderBanner } from '../../../lib/pdfHeaderBanner'
import type jsPDF from 'jspdf'
import './especialidades-modal.css'

type Props = {
  custom: string[]
  onClose: () => void
  onAdd: (nombre: string) => { ok: boolean; error?: string }
  onRemove: (nombre: string) => void
  onRename: (anterior: string, nuevo: string) => { ok: boolean; error?: string }
}

export function EspecialidadesModal({
  custom,
  onClose,
  onAdd,
  onRemove,
  onRename,
}: Props) {
  const { data } = useAppState()
  const { role } = useAuth()
  const { confirm } = useConfirm()
  const puedeExportPdf = canExportMedicosListado(role)
  const [nueva, setNueva] = useState('')
  const [msg, setMsg] = useState<{ type: 'err' | 'ok'; text: string } | null>(
    null,
  )
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)
  const [exportingExcel, setExportingExcel] = useState(false)

  const catalogCount = useMemo(() => {
    let count = ESPECIALIDADES_COMUNES.length
    for (const raw of custom) {
      const nombre = normalizeEspecialidad(raw)
      if (nombre && !isEspecialidadComun(nombre)) count += 1
    }
    return count
  }, [custom])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
      const built = buildEspecialidadesCatalogPdf(custom)
      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: especialidadesCatalogPdfPreviewTitle(catalogCount),
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

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const res = onAdd(nueva)
    if (res.ok) {
      setNueva('')
      setMsg({ type: 'ok', text: 'Especialidad agregada.' })
    } else {
      setMsg({ type: 'err', text: res.error ?? 'No se pudo agregar.' })
    }
  }

  function startRename(name: string) {
    setEditing(name)
    setEditValue(name)
    setMsg(null)
  }

  function saveRename() {
    if (!editing) return
    const res = onRename(editing, editValue)
    if (res.ok) {
      setEditing(null)
      setEditValue('')
      setMsg({ type: 'ok', text: 'Especialidad actualizada.' })
    } else {
      setMsg({ type: 'err', text: res.error ?? 'No se pudo guardar.' })
    }
  }

  return (
    <div
      className="especialidades-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="especialidades-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="esp-modal-title"
      >
        <header className="especialidades-sheet__head">
          <div>
            <h2 id="esp-modal-title">Especialidades</h2>
            <p className="especialidades-sheet__sub">
              Lista habitual y las que agregues para el desplegable.
            </p>
          </div>
          <button
            type="button"
            className="especialidades-sheet__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="especialidades-sheet__body">
          <form className="especialidades-add" onSubmit={handleAdd}>
            <input
              type="text"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              placeholder="Nueva especialidad…"
              aria-label="Nueva especialidad"
            />
            <button type="submit" className="btn btn-primary">
              Agregar
            </button>
          </form>

          {msg && (
            <p
              className={`especialidades-msg${msg.type === 'ok' ? ' especialidades-msg--ok' : ''}`}
            >
              {msg.text}
            </p>
          )}

          <section className="especialidades-section">
            <h3>Habituales</h3>
            <div className="especialidades-tags">
              {ESPECIALIDADES_COMUNES.map((e) => (
                <span key={e} className="especialidad-tag especialidad-tag--fixed">
                  {e}
                </span>
              ))}
            </div>
          </section>

          <section className="especialidades-section">
            <h3>Agregadas por usted</h3>
            {custom.length === 0 ? (
              <p className="empty-hint" style={{ margin: 0 }}>
                Todavía no agregaste ninguna. Usá el campo de arriba.
              </p>
            ) : (
              <ul className="especialidades-list">
                {custom.map((e) => (
                  <li key={e} className="especialidades-list__item">
                    {editing === e ? (
                      <>
                        <input
                          value={editValue}
                          onChange={(ev) => setEditValue(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') saveRename()
                            if (ev.key === 'Escape') setEditing(null)
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.82rem' }}
                          onClick={saveRename}
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.82rem' }}
                          onClick={() => setEditing(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ flex: 1, fontSize: '0.9rem' }}>{e}</span>
                        <IconActionButton
                          variant="edit"
                          label="Editar especialidad"
                          onClick={() => startRename(e)}
                        >
                          <IconEdit />
                        </IconActionButton>
                        <IconActionButton
                          variant="delete"
                          label="Quitar de la lista"
                          onClick={() => onRemove(e)}
                        >
                          <IconTrash />
                        </IconActionButton>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="especialidades-sheet__foot">
          {puedeExportPdf && (
            <>
              <button
                type="button"
                className="btn btn-pdf"
                title="Vista previa del listado de especialidades"
                onClick={() => void handlePdfPreview()}
              >
                <span className="btn-pdf__icon" aria-hidden>
                  PDF
                </span>
                Vista Previa
              </button>
              <button
                type="button"
                className="btn btn-excel"
                title="Exportar lista de médicos y especialidades a Excel"
                onClick={() => void handleExcelExport()}
                disabled={exportingExcel}
              >
                {exportingExcel ? 'Generando…' : 'Excel'}
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </footer>
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
    </div>
  )
}
