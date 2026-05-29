import { useEffect, useMemo, useRef, useState } from 'react'
import type jsPDF from 'jspdf'
import {
  endOfDay,
  endOfMonth,
  endOfYear,
  format,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
import { useConfirm } from '../context/ConfirmContext'
import { useAppState } from '../context/AppStateContext'
import { preloadPdfHeaderBanner } from '../lib/pdfHeaderBanner'
import {
  buildPagosCanceladosPdf,
  formatPagosCanceladosPdfPeriodLabel,
  pagosCanceladosPdfFileStamp,
} from '../lib/pagosCanceladosPdf'
import { labelMotivoCancelacion } from '../lib/pagosCancelados'
import { pdfBlobUrl, savePdfFile } from '../lib/doctorPaymentsPdf'
import type { MotivoCancelacionPago, PagoCancelado } from '../types'
import './pages.css'
import './pages-pagos-cancelados.css'

type Periodo = 'todo' | 'dia' | 'mes' | 'anio'

function motivoBadgeClass(motivo: MotivoCancelacionPago): string {
  if (motivo === 'cancelacion_paciente') return 'motivo-badge motivo-badge--paciente'
  if (motivo === 'cancelacion_doctor') return 'motivo-badge motivo-badge--doctor'
  return 'motivo-badge motivo-badge--otros'
}

function formatMoney(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  })
}

export function PagosCanceladosPage() {
  const { data, patientById, doctorById } = useAppState()
  const { confirm } = useConfirm()
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [refDia, setRefDia] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [refMes, setRefMes] = useState(() => format(new Date(), 'yyyy-MM'))
  const [refAnio, setRefAnio] = useState(() => format(new Date(), 'yyyy'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const pdfDocRef = useRef<jsPDF | null>(null)

  const interval = useMemo(() => {
    const now = new Date()
    if (periodo === 'todo') return null
    if (periodo === 'dia') {
      const d = parseISO(`${refDia}T12:00:00`)
      return { start: startOfDay(d), end: endOfDay(d) }
    }
    if (periodo === 'mes') {
      const d = parseISO(`${refMes}-15T12:00:00`)
      return { start: startOfMonth(d), end: endOfMonth(d) }
    }
    const y = Number(refAnio) || now.getFullYear()
    const d = new Date(y, 6, 1)
    return { start: startOfYear(d), end: endOfYear(d) }
  }, [periodo, refDia, refMes, refAnio])

  const sorted = useMemo(
    () =>
      [...data.pagosCancelados].sort(
        (a, b) =>
          parseISO(b.canceladoEn).getTime() - parseISO(a.canceladoEn).getTime(),
      ),
    [data.pagosCancelados],
  )

  const filtered = useMemo(() => {
    if (!interval) return sorted
    return sorted.filter((r) =>
      isWithinInterval(parseISO(r.canceladoEn), interval),
    )
  }, [sorted, interval])

  const resolvedSelectedId = useMemo(() => {
    if (filtered.length === 0) return null
    if (selectedId && filtered.some((r) => r.id === selectedId)) return selectedId
    return filtered[0]!.id
  }, [filtered, selectedId])

  const selected = useMemo(
    () => filtered.find((r) => r.id === resolvedSelectedId) ?? null,
    [filtered, resolvedSelectedId],
  )

  const periodLabel = useMemo(
    () => formatPagosCanceladosPdfPeriodLabel(periodo, refDia, refMes, refAnio),
    [periodo, refDia, refMes, refAnio],
  )

  const stats = useMemo(() => {
    const total = filtered.reduce((s, r) => s + r.payment.monto, 0)
    const porMotivo: Record<MotivoCancelacionPago, number> = {
      cancelacion_paciente: 0,
      cancelacion_doctor: 0,
      otros: 0,
    }
    for (const r of filtered) porMotivo[r.motivo] += 1
    return { count: filtered.length, total, porMotivo }
  }, [filtered])

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

  function patientLabel(id: string): string {
    const p = patientById(id)
    return p ? `${p.apellido}, ${p.nombre}` : '—'
  }

  function doctorLabel(id: string): string {
    const d = doctorById(id)
    return d ? `${d.apellido}, ${d.nombre}` : '—'
  }

  async function handlePdfPreview() {
    try {
      await preloadPdfHeaderBanner()
      const built = buildPagosCanceladosPdf({
        scope: periodo,
        periodLabel,
        records: filtered,
        patientLabel,
        doctorLabel,
        fileStamp: pagosCanceladosPdfFileStamp(periodo, refDia, refMes, refAnio),
      })
      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: `Pagos cancelados (${periodLabel})`,
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
      void confirm({ message: 'No se pudo guardar el PDF.' })
    }
  }

  function selectRow(r: PagoCancelado) {
    setSelectedId(r.id)
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function renderDetalle(r: PagoCancelado) {
    const pac = patientById(r.payment.patientId)
    const doc = doctorById(r.payment.doctorId)
    const pacLabel = pac ? `${pac.apellido}, ${pac.nombre}` : '—'
    const docLabel = doc ? `${doc.apellido}, ${doc.nombre}` : '—'

    return (
      <dl className="pago-cancelado-detalle">
        <div>
          <dt>Cancelado el</dt>
          <dd>
            {format(parseISO(r.canceladoEn), "d MMM yyyy 'a las' HH:mm", {
              locale: es,
            })}
          </dd>
        </div>
        <div>
          <dt>Motivo</dt>
          <dd>
            <span className={motivoBadgeClass(r.motivo)}>
              {labelMotivoCancelacion(r.motivo)}
            </span>
          </dd>
        </div>
        {r.motivo === 'otros' && r.notasOtros && (
          <div className="pago-cancelado-detalle__full">
            <dt>Detalle</dt>
            <dd>{r.notasOtros}</dd>
          </div>
        )}
        <div>
          <dt>Fecha del pago</dt>
          <dd>
            {format(parseISO(r.payment.fecha), 'd MMM yyyy HH:mm', {
              locale: es,
            })}
          </dd>
        </div>
        <div>
          <dt>Paciente</dt>
          <dd>{pacLabel}</dd>
        </div>
        <div>
          <dt>Médico</dt>
          <dd>{docLabel}</dd>
        </div>
        <div>
          <dt>Monto</dt>
          <dd>{formatMoney(r.payment.monto)}</dd>
        </div>
        <div>
          <dt>Forma de pago</dt>
          <dd>{r.payment.metodo}</dd>
        </div>
        <div>
          <dt>Turno vinculado</dt>
          <dd>
            {r.appointment
              ? format(parseISO(r.appointment.fechaHora), 'd MMM yyyy HH:mm', {
                  locale: es,
                }) +
                (r.appointment.notas.trim()
                  ? ` — ${r.appointment.notas}`
                  : '')
              : '—'}
          </dd>
        </div>
        {r.payment.notas.trim() && (
          <div className="pago-cancelado-detalle__full">
            <dt>Notas del pago</dt>
            <dd>{r.payment.notas}</dd>
          </div>
        )}
      </dl>
    )
  }

  return (
    <div className="page page--pagos-cancelados">
      <header className="page-header">
        <h1>Pagos Cancelados</h1>
      </header>

      <section className="panel panel--resumen">
        <div className="resumen-header">
          <h2>Resumen</h2>
        </div>
        <div className="summary-cards summary-cards--pagos-cancelados">
          <div className="summary-card summary-card--pagos-periodo">
            <div className="summary-card__headline">
              <span className="label">Cancelados en período</span>
              <span className="value">{stats.count}</span>
            </div>
          </div>
          <div className="summary-card summary-card--pagos-periodo">
            <div className="summary-card__headline">
              <span className="label">Monto total</span>
              <span className="value value--money">{formatMoney(stats.total)}</span>
            </div>
          </div>
          <div className="summary-card summary-card--motivo-paciente">
            <div className="summary-card__headline">
              <span className="label">Paciente</span>
              <span className="value">{stats.porMotivo.cancelacion_paciente}</span>
            </div>
          </div>
          <div className="summary-card summary-card--motivo-doctor">
            <div className="summary-card__headline">
              <span className="label">Médico</span>
              <span className="value">{stats.porMotivo.cancelacion_doctor}</span>
            </div>
          </div>
          <div className="summary-card summary-card--motivo-otros">
            <div className="summary-card__headline">
              <span className="label">Otros</span>
              <span className="value">{stats.porMotivo.otros}</span>
            </div>
          </div>
        </div>

        <div className="resumen-pdf-pills resumen-pdf-pills--line pagos-cancelados-filtros">
          <div
            className={`pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline${periodo === 'todo' ? ' is-active' : ''}`}
          >
            <button
              type="button"
              className="resumen-pdf-pill__scope"
              onClick={() => setPeriodo('todo')}
            >
              Todos
            </button>
          </div>
          <div
            className={`pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline${periodo === 'dia' ? ' is-active' : ''}`}
          >
            <button
              type="button"
              className="resumen-pdf-pill__scope"
              onClick={() => setPeriodo('dia')}
            >
              Por día
            </button>
            <div className="field field--pill pdf-export-pill__field field--pdf-fecha">
              <label htmlFor="pc-dia">Día</label>
              <input
                id="pc-dia"
                type="date"
                value={refDia}
                onChange={(e) => {
                  setRefDia(e.target.value)
                  setPeriodo('dia')
                }}
                onFocus={() => setPeriodo('dia')}
              />
            </div>
          </div>
          <div
            className={`pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline${periodo === 'mes' ? ' is-active' : ''}`}
          >
            <button
              type="button"
              className="resumen-pdf-pill__scope"
              onClick={() => setPeriodo('mes')}
            >
              Por mes
            </button>
            <div className="field field--pill pdf-export-pill__field field--pdf-mes">
              <label htmlFor="pc-mes">Mes</label>
              <input
                id="pc-mes"
                type="month"
                value={refMes}
                onChange={(e) => {
                  setRefMes(e.target.value)
                  setPeriodo('mes')
                }}
                onFocus={() => setPeriodo('mes')}
              />
            </div>
          </div>
          <div
            className={`pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline${periodo === 'anio' ? ' is-active' : ''}`}
          >
            <button
              type="button"
              className="resumen-pdf-pill__scope"
              onClick={() => setPeriodo('anio')}
            >
              Por año
            </button>
            <div className="field field--pill pdf-export-pill__field field--pdf-anio">
              <label htmlFor="pc-anio">Año</label>
              <input
                id="pc-anio"
                type="number"
                min={2000}
                max={2100}
                value={refAnio}
                onChange={(e) => {
                  setRefAnio(e.target.value)
                  setPeriodo('anio')
                }}
                onFocus={() => setPeriodo('anio')}
              />
            </div>
          </div>
          <div className="pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--actions">
            <button
              type="button"
              className="btn btn-pdf"
              title={`PDF según filtro: ${periodo === 'todo' ? 'Todos' : periodo === 'dia' ? 'Día' : periodo === 'mes' ? 'Mes' : 'Año'}`}
              onClick={handlePdfPreview}
            >
              <span className="btn-pdf__icon" aria-hidden>
                PDF
              </span>
              Vista previa
            </button>
          </div>
        </div>
        <p className="resumen-ventana">
          PDF: <strong>{periodLabel}</strong>
          {' — '}
          {filtered.length === 0
            ? 'sin cancelaciones en este período.'
            : `${filtered.length} cancelación${filtered.length === 1 ? '' : 'es'}.`}
        </p>
      </section>

      {selected && (
        <section className="panel panel--pago-cancelado-detalle" ref={detailRef}>
          <h2>Detalle del pago cancelado</h2>
          {renderDetalle(selected)}
        </section>
      )}

      <div className="table-wrap">
        {filtered.length === 0 ? (
          <p className="empty-hint">
            {data.pagosCancelados.length === 0
              ? 'No hay pagos cancelados. Los registros aparecen al eliminar un pago en Pagos de consultas.'
              : 'No hay cancelaciones en el período seleccionado.'}
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Cancelado</th>
                <th>Fecha pago</th>
                <th>Paciente</th>
                <th>Médico</th>
                <th>Monto</th>
                <th>Motivo</th>
                <th>Método</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const pac = patientById(r.payment.patientId)
                const doc = doctorById(r.payment.doctorId)
                const isSelected = r.id === resolvedSelectedId
                return (
                  <tr
                    key={r.id}
                    className={isSelected ? 'data-row--selected' : undefined}
                    onClick={() => selectRow(r)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectRow(r)
                      }
                    }}
                  >
                    <td>
                      {format(parseISO(r.canceladoEn), 'd MMM yyyy HH:mm', {
                        locale: es,
                      })}
                    </td>
                    <td>
                      {format(parseISO(r.payment.fecha), 'd MMM yyyy HH:mm', {
                        locale: es,
                      })}
                    </td>
                    <td>{pac ? `${pac.apellido}, ${pac.nombre}` : '—'}</td>
                    <td>{doc ? `${doc.apellido}, ${doc.nombre}` : '—'}</td>
                    <td>{formatMoney(r.payment.monto)}</td>
                    <td>
                      <span className={motivoBadgeClass(r.motivo)}>
                        {labelMotivoCancelacion(r.motivo)}
                      </span>
                    </td>
                    <td>{r.payment.metodo}</td>
                  </tr>
                )
              })}
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
    </div>
  )
}
