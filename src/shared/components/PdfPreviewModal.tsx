import { useEffect, useRef } from 'react'
import './pdf-preview.css'

type Props = {
  title: string
  url: string
  filename?: string
  onClose: () => void
  onDownload: () => void
  onPrint?: () => void
}

export function PdfPreviewModal({
  title,
  url,
  filename,
  onClose,
  onDownload,
  onPrint,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="pdf-preview-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="pdf-preview-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-preview-title"
      >
        <header className="pdf-preview__head">
          <div>
            <h2 id="pdf-preview-title">{title}</h2>
            {filename ? (
              <p className="pdf-preview__sub">{filename}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="pdf-preview__close"
            aria-label="Cerrar vista previa"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <iframe
          ref={frameRef}
          className="pdf-preview__frame"
          src={url}
          title={title}
        />
        <footer className="pdf-preview__actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          {onPrint ? (
            <button type="button" className="btn btn-ghost" onClick={onPrint}>
              Imprimir
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                frameRef.current?.contentWindow?.focus()
                frameRef.current?.contentWindow?.print()
              }}
            >
              Imprimir
            </button>
          )}
          <button type="button" className="btn btn-pdf" onClick={onDownload}>
            <span className="btn-pdf__icon" aria-hidden>
              PDF
            </span>
            Descargar
          </button>
        </footer>
      </div>
    </div>
  )
}
