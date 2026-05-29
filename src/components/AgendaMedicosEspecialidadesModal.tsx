import { useEffect, useMemo, useRef, useState } from 'react'
import { PdfPreviewModal } from './PdfPreviewModal'
import { useConfirm } from '../context/ConfirmContext'
import type { AppData } from '../types'
import type { MedicoEspecialidadListRow } from '../lib/doctorAgenda'
import { pdfBlobUrl, savePdfFile } from '../lib/doctorPaymentsPdf'
import {
  buildMedicosEspecialidadesPdf,
  medicosEspecialidadesPdfPreviewTitle,
} from '../lib/medicosEspecialidadesPdf'
import { preloadPdfHeaderBanner } from '../lib/pdfHeaderBanner'
import type jsPDF from 'jspdf'
import './especialidades-modal.css'
import './agenda-medicos-esp-modal.css'

export type MedicoEspecialidadRow = MedicoEspecialidadListRow

type Props = {
  rows: MedicoEspecialidadRow[]
  data: Pick<
    AppData,
    'doctors' | 'horarios' | 'diasLibres' | 'atencionesMensuales'
  >
  onClose: () => void
}

export function AgendaMedicosEspecialidadesModal({ rows, data, onClose }: Props) {
  const { confirm } = useConfirm()
  const [filtro, setFiltro] = useState('')
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)
  const pdfDocRef = useRef<jsPDF | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.medico.toLowerCase().includes(q) ||
        r.especialidad.toLowerCase().includes(q) ||
        r.dias.toLowerCase().includes(q) ||
        r.horario.toLowerCase().includes(q) ||
        r.duracion.toLowerCase().includes(q),
    )
  }, [rows, filtro])

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
      const built = buildMedicosEspecialidadesPdf(filtradas, data)
      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: medicosEspecialidadesPdfPreviewTitle(filtradas.length),
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
    <div
      className="especialidades-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="especialidades-sheet especialidades-sheet--medicos-esp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="medicos-esp-modal-title"
      >
        <header className="especialidades-sheet__head">
          <div>
            <h2 id="medicos-esp-modal-title">Especialidades</h2>
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
          <div className="medicos-esp-toolbar">
            <input
              type="search"
              className="medicos-esp-search"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar médico, especialidad, día, horario o duración…"
              aria-label="Buscar en la lista"
            />
            <span className="medicos-esp-count">
              {filtradas.length} de {rows.length}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="empty-hint" style={{ margin: 0 }}>
              No hay médicos cargados.
            </p>
          ) : filtradas.length === 0 ? (
            <p className="empty-hint" style={{ margin: 0 }}>
              Ningún resultado para esa búsqueda.
            </p>
          ) : (
            <div className="medicos-esp-table-wrap">
              <table className="medicos-esp-table">
                <thead>
                  <tr>
                    <th scope="col">Médico</th>
                    <th scope="col">Especialidad</th>
                    <th scope="col">Día que atiende</th>
                    <th scope="col">Horario</th>
                    <th scope="col">Duracion</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((r) => (
                    <tr key={r.id}>
                      <td className="medicos-esp-table__medico">{r.medico}</td>
                      <td>{r.especialidad || '—'}</td>
                      <td className="medicos-esp-table__dias">{r.dias}</td>
                      <td className="medicos-esp-table__horario">{r.horario}</td>
                      <td className="medicos-esp-table__duracion">{r.duracion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="especialidades-sheet__foot">
          <button type="button" className="btn btn-pdf" onClick={() => void handlePdfPreview()}>
            PDF
          </button>
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
