import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { readPagosGerenciaExcelLog, resolveExportLogTurno, type PagosGerenciaExcelLogRecord } from '../../../lib/pagosGerenciaExcelLog'
import { formatMonto } from '../../../lib/formatMonto'
import { buildGerenciaExportLogPdf } from '../../../lib/gerenciaExportLogPdf'
import { preloadPdfHeaderBanner } from '../../../lib/pdfHeaderBanner'
import { preloadPdfLogo } from '../../../lib/pdfLogo'
import { pdfBlobUrl } from '../../../lib/doctorPaymentsPdf'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { useConfirm } from '../../../context/ConfirmContext'
import '../../../shared/components/app-info-modal.css' // Reusing modal styles

export function GerenciaExportLogModal({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<PagosGerenciaExcelLogRecord[]>([])
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string; title: string } | null>(null)
  const { confirm } = useConfirm()

  useEffect(() => {
    const list = readPagosGerenciaExcelLog()
    // Sort descending by date
    list.sort((a, b) => new Date(b.fechaExportacion).getTime() - new Date(a.fechaExportacion).getTime())
    setLogs(list)
  }, [])

  async function handlePdfPreview() {
    try {
      await Promise.all([preloadPdfLogo(), preloadPdfHeaderBanner()])
      const built = buildGerenciaExportLogPdf(logs)
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: built.title,
      })
    } catch (err: any) {
      console.error(err)
      alert('Error al generar PDF: ' + (err?.message || 'Error desconocido'))
      void confirm({ message: 'No se pudo generar el PDF. Probá de nuevo.' })
    }
  }

  return (
    <>
      <div className="app-info-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
        <div
          className="app-info-sheet"
          style={{ width: '95%', maxWidth: '1000px', height: '80vh', maxHeight: '850px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="app-info-sheet__head" style={{ alignItems: 'center' }}>
            <div className="app-info-sheet__head-text">
              <h2>Registro de Exportaciones</h2>
              <p className="app-info-sheet__sub">Historial de archivos exportados a Gerencia</p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button type="button" className="btn btn-pdf" onClick={() => void handlePdfPreview()}>
                <span className="btn-pdf__icon" aria-hidden>PDF</span>
                PDF
              </button>
              <button type="button" className="app-info-sheet__cerrar" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
          <div className="app-info-sheet__body" style={{ flex: 1, overflowY: 'auto' }}>
            {logs.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#666', padding: '2rem' }}>No hay exportaciones registradas.</p>
            ) : (
              <div className="table-wrap" style={{ margin: 0, border: 'none', borderRadius: 0, height: '100%' }}>
                <table className="data">
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#fff' }}>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem' }}>Fecha</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem' }}>Usuario</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem' }}>Turno</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem' }}>Cuidar</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem' }}>Total Médico</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem' }}>Efectivo Exportado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td style={{ padding: '0.4rem 0.75rem' }}>
                          {format(parseISO(log.fechaExportacion), 'dd/MM/yyyy HH:mm', { locale: es })}
                        </td>
                        <td style={{ padding: '0.4rem 0.75rem' }}>{log.usuario}</td>
                        <td style={{ padding: '0.4rem 0.75rem' }}>{resolveExportLogTurno(log)}</td>
                        <td style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: 'bold' }}>
                          {formatMonto(log.montoCuidar ?? 0)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: 'bold' }}>
                          {formatMonto(log.montoEfectivo - (log.montoCuidar ?? 0))}
                        </td>
                        <td style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: 'bold' }}>
                          {formatMonto(log.montoEfectivo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {pdfPreview && createPortal(
        <PdfPreviewModal
          title={pdfPreview.title}
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          onClose={() => {
            if (pdfPreview.url) URL.revokeObjectURL(pdfPreview.url)
            setPdfPreview(null)
          }}
          onDownload={() => {
            const a = document.createElement('a')
            a.href = pdfPreview.url
            a.download = pdfPreview.filename
            a.click()
          }}
        />,
        document.body
      )}
    </>
  )
}
