import { useEffect, useMemo, useState } from 'react'
import type jsPDF from 'jspdf'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { buildDebtRows } from '../../../lib/doctorDebts'
import {
  buildDoctorDebtWorkbook,
  savePagosGerenciaExcelFile,
} from '../../../lib/pagosGerenciaExcel'
import type { DebtRow } from '../../../lib/doctorDebts'
import { type Doctor, type DoctorDebtPayment, type Payment } from '../../../types'
import { formatMonto } from '../../../lib/formatMonto'
import { buildDoctorDebtPdf, type DoctorDebtSituacion } from '../../../lib/doctorDebtPdf'
import { pdfBlobUrl, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import './gestion-deudas-medicos-modal.css'

/** Destinatario por defecto de los pagos de deuda. */
const DESTINATARIO_POR_DEFECTO = 'Gerencia'

type Props = {
  payments: Payment[]
  debtPayments: DoctorDebtPayment[]
  doctors: Doctor[]
  onRegisterPayment: (payload: {
    doctorId: string
    deudaKey: string
    fecha: string
    monto: number
    metodo: string
    destinatario: string
    nroComprobante: string
    nota: string
  }) => void
  onClose: () => void
}


/**
 * Situación de una deuda: "pagada" es saldo 0 y "pendiente" cualquier saldo
 * mayor a cero (incluye las parciales). Vacío = todas.
 */
function matchesSituation(row: DebtRow, situacion: DoctorDebtSituacion | ''): boolean {
  if (!situacion) return true
  return situacion === 'pagada' ? row.saldo === 0 : row.saldo > 0
}

/** ¿La fecha (YYYY-MM-DD) cae entre "desde" y "hasta"? Campos vacíos = sin límite. */
function inDateRange(fecha: string, desde: string, hasta: string): boolean {
  if (desde && fecha < desde) return false
  if (hasta && fecha > hasta) return false
  return true
}

export function GestionDeudasMedicosModal({
  payments,
  debtPayments,
  doctors,
  onRegisterPayment,
  onClose,
}: Props) {
  const [doctorFilter, setDoctorFilter] = useState('')
  const [situationFilter, setSituationFilter] = useState<DoctorDebtSituacion | ''>('')
  /** Rango de fechas de la deuda (YYYY-MM-DD). Vacío = sin límite. */
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Efectivo')
  const [recipient, setRecipient] = useState(DESTINATARIO_POR_DEFECTO)
  const [receiptNumber, setReceiptNumber] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pdfError, setPdfError] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [pdfPreview, setPdfPreview] = useState<{
    doc: jsPDF
    url: string
    filename: string
  } | null>(null)
  const rows = useMemo(
    () => buildDebtRows(payments, debtPayments, doctors),
    [payments, debtPayments, doctors],
  )
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!doctorFilter || row.doctorId === doctorFilter) &&
          matchesSituation(row, situationFilter) &&
          inDateRange(row.fecha, fromDate, toDate),
      ),
    [doctorFilter, situationFilter, fromDate, toDate, rows],
  )
  const selected = rows.find((row) => row.key === selectedKey) ?? null
  // Los dos totales siguen a los filtros de la barra: si se cambia el médico,
  // el rango de fechas o la situación, se recalculan con las filas visibles.
  const pendingTotal = visibleRows.reduce((sum, row) => sum + row.saldo, 0)
  const paidTotal = visibleRows.reduce((sum, row) => sum + row.pagado, 0)
  const history = useMemo(
    () => debtPayments.filter((payment) => !doctorFilter || payment.doctorId === doctorFilter),
      [debtPayments, doctorFilter],
    )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    return () => {
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    }
  }, [pdfPreview?.url])

  function selectDebt(row: DebtRow) {
    setSelectedKey(row.key)
    setAmount(row.saldo.toFixed(2))
    setError('')
  }

  function registerPayment() {
    if (!selected) return
    const parsed = Number(amount.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Ingresá un importe válido.')
      return
    }
    if (parsed > selected.saldo + 0.005) {
      setError('El pago no puede superar el saldo pendiente.')
      return
    }
    onRegisterPayment({
      doctorId: selected.doctorId,
      deudaKey: selected.key,
      fecha: new Date().toISOString(),
      monto: Math.round(parsed * 100) / 100,
      metodo: method,
      destinatario: recipient.trim() || DESTINATARIO_POR_DEFECTO,
      nroComprobante: receiptNumber.trim(),
      nota: note.trim(),
    })
    setSelectedKey(null)
    setAmount('')
    setReceiptNumber('')
    setNote('')
    setError('')
  }

  async function exportDebtPdf() {
    setPdfError('')
    setExportingPdf(true)
    try {
      // El PDF sale con los mismos filtros que se ven en la tabla.
      const built = buildDoctorDebtPdf({
        payments,
        debtPayments,
        doctors,
        doctorId: doctorFilter || undefined,
        situacion: situationFilter || undefined,
        desde: fromDate || undefined,
        hasta: toDate || undefined,
      })
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        doc: built.doc,
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
      })
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'No se pudo generar el PDF.')
    } finally {
      setExportingPdf(false)
    }
  }

  async function exportDebtExcel() {
    setPdfError('')
    setExportingExcel(true)
    try {
      const doctor = doctorFilter
        ? doctors.find((item) => item.id === doctorFilter)
        : undefined
      const built = buildDoctorDebtWorkbook({
        payments,
        debtPayments,
        doctors,
        doctorId: doctorFilter || undefined,
        desde: fromDate || undefined,
        hasta: toDate || undefined,
      })
      const slug = doctor
        ? `${doctor.apellido}-${doctor.nombre}`
        : 'todos'
      await savePagosGerenciaExcelFile(
        built,
        `deudas-medicos-${slug}-${format(new Date(), 'yyyyMMdd-HHmm')}.xlsx`,
      )
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'No se pudo exportar a Excel.')
    } finally {
      setExportingExcel(false)
    }
  }

  function closePdfPreview() {
    setPdfPreview(null)
  }

  async function downloadPdfPreview() {
    if (!pdfPreview) return
    try {
      await savePdfFile(pdfPreview.doc, pdfPreview.filename)
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'No se pudo guardar el PDF.')
    }
  }

  return (
    <div
      className="gestion-deudas-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="gestion-deudas-modal" role="dialog" aria-modal="true" aria-labelledby="gestion-deudas-title">
        <header className="gestion-deudas-modal__head">
          <div>
            <h2 id="gestion-deudas-title">GESTIÓN DE DEUDAS POR MÉDICO</h2>
            <p>Comisiones pendientes y pagos directos registrados.</p>
          </div>
          <button type="button" className="gestion-deudas-modal__close" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="gestion-deudas-modal__toolbar">
          <div className="gestion-deudas-filter-group">
            <label htmlFor="gestion-deudas-doc-select">Médico</label>
            <select
              id="gestion-deudas-doc-select"
              value={doctorFilter}
              onChange={(event) => setDoctorFilter(event.target.value)}
            >
              <option value="">Todos los médicos</option>
              {[...doctors]
                .sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es'))
                .map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.apellido}, {doctor.nombre}
                  </option>
                ))}
            </select>
          </div>

          <div className="gestion-deudas-filter-group gestion-deudas-filter-group--situacion">
            <label htmlFor="gestion-deudas-situation-select">Situación</label>
            <select
              id="gestion-deudas-situation-select"
              value={situationFilter}
              onChange={(event) => setSituationFilter(event.target.value as DoctorDebtSituacion | '')}
            >
              <option value="">Todas las situaciones</option>
              <option value="pendiente">Pendiente</option>
              <option value="pagada">Pagado</option>
            </select>
          </div>

          <div className="gestion-deudas-filter-group gestion-deudas-filter-group--fecha">
            <label htmlFor="gestion-deudas-from">Desde</label>
            <input
              id="gestion-deudas-from"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </div>

          <div className="gestion-deudas-filter-group gestion-deudas-filter-group--fecha">
            <label htmlFor="gestion-deudas-to">Hasta</label>
            <input
              id="gestion-deudas-to"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => setToDate(event.target.value)}
            />
          </div>

          <button
            type="button"
            className={`gestion-deudas-btn gestion-deudas-btn--clear ${fromDate || toDate ? '' : 'gestion-deudas-btn--clear-off'}`}
            onClick={() => {
              setFromDate('')
              setToDate('')
            }}
            disabled={!fromDate && !toDate}
            title="Ver todas las fechas"
          >
            Todos
          </button>

          <div className="gestion-deudas-modal__toolbar-actions">
            <button
              type="button"
              className="gestion-deudas-btn gestion-deudas-btn--pdf"
              onClick={() => void exportDebtPdf()}
              disabled={exportingPdf || exportingExcel}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>PDF Resumen</span>
            </button>
            <button
              type="button"
              className="gestion-deudas-btn gestion-deudas-btn--excel"
              onClick={() => void exportDebtExcel()}
              disabled={exportingPdf || exportingExcel}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{exportingExcel ? 'Exportando...' : 'Exportar a Excel'}</span>
            </button>
          </div>
        </div>

        {pdfError && <p className="gestion-deudas-modal__error" role="alert">{pdfError}</p>}

        {selected && (
          <div className="gestion-deudas-payment">
            <h3>Registrar pago de deuda</h3>
            <p>{selected.doctorLabel} · Saldo seleccionado: <strong>{formatMonto(selected.saldo)}</strong></p>
            <div className="gestion-deudas-payment__fields">
              <div className="gestion-deudas-payment__field">
                <label htmlFor="pay-debt-amount">Importe *</label>
                <input
                  id="pay-debt-amount"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="gestion-deudas-payment__field">
                <label htmlFor="pay-debt-method">Método</label>
                <select
                  id="pay-debt-method"
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                >
                  <option>Efectivo</option>
                  <option>Transferencia</option>
                </select>
              </div>
              <div className="gestion-deudas-payment__field">
                <label htmlFor="pay-debt-recipient">Destinatario</label>
                <input
                  id="pay-debt-recipient"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder={DESTINATARIO_POR_DEFECTO}
                />
              </div>
              <div className="gestion-deudas-payment__field">
                <label htmlFor="pay-debt-receipt">N° Comprobante</label>
                <input
                  id="pay-debt-receipt"
                  value={receiptNumber}
                  onChange={(event) => setReceiptNumber(event.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div className="gestion-deudas-payment__field gestion-deudas-payment__field--grow">
                <label htmlFor="pay-debt-note">Notas</label>
                <input
                  id="pay-debt-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Detalle del pago..."
                />
              </div>
              <div className="gestion-deudas-payment__actions">
                <button type="button" className="gestion-deudas-btn gestion-deudas-btn--secondary" onClick={() => setSelectedKey(null)}>
                  Cancelar
                </button>
                <button type="button" className="gestion-deudas-btn gestion-deudas-btn--primary" onClick={registerPayment}>
                  Confirmar pago
                </button>
              </div>
            </div>
            {error && <p className="gestion-deudas-payment__error" role="alert">{error}</p>}
          </div>
        )}

        <div className="gestion-deudas-modal__table-wrap">
          <table className="gestion-deudas-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Médico</th>
                <th>Concepto</th>
                <th>Deuda</th>
                <th>Pagado</th>
                <th>Fecha Pago</th>
                <th>Saldo</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="gestion-deudas-table__empty">
                    No hay deudas registradas.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.fechaLabel}</td>
                    <td><strong>{row.doctorLabel}</strong></td>
                    <td>{row.concepto}</td>
                    <td>{formatMonto(row.deuda)}</td>
                    <td>{formatMonto(row.pagado)}</td>
                    <td>{row.fechaPago}</td>
                    <td><strong>{formatMonto(row.saldo)}</strong></td>
                    <td>
                      <span className={`gestion-deuda-status gestion-deuda-status--${row.saldo === 0 ? 'pagada' : row.pagado > 0 ? 'parcial' : 'pendiente'}`}>
                        {row.saldo === 0 ? 'Pagada' : row.pagado > 0 ? 'Parcial' : 'Pendiente'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="gestion-deudas-table__pay-btn"
                        disabled={row.saldo === 0}
                        onClick={() => selectDebt(row)}
                      >
                        Pagar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <details className="gestion-deudas-history">
          <summary>
            Ver historial de pagos directos ({history.length})
            {/* Los totales van en la misma línea, después del texto. El
                stopPropagation evita que al tocarlos se abra o cierre la lista. */}
            <span
              className="gestion-deudas-modal__totals"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="gestion-deudas-modal__total-badge gestion-deudas-modal__total-badge--pendientes">
                Total Pendientes: <strong>{formatMonto(pendingTotal)}</strong>
              </span>
              <span className="gestion-deudas-modal__total-badge gestion-deudas-modal__total-badge--pagado">
                Total Pagado: <strong>{formatMonto(paidTotal)}</strong>
              </span>
            </span>
          </summary>
          {history.length === 0 ? (
            <p>No hay pagos directos registrados.</p>
          ) : (
            <ul>
              {history.map((payment) => (
                <li key={payment.id}>
                  {format(parseISO(payment.fecha), 'dd/MM/yyyy HH:mm', { locale: es })} · <strong>{formatMonto(payment.monto)}</strong> · {payment.metodo} · {payment.destinatario || DESTINATARIO_POR_DEFECTO}{payment.nroComprobante ? ` · Comprobante N° ${payment.nroComprobante}` : ''}{payment.nota ? ` (${payment.nota})` : ''}
                </li>
              ))}
            </ul>
          )}
        </details>

        <footer className="gestion-deudas-modal__actions">
          <button type="button" className="gestion-deudas-btn-close" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </section>
      {pdfPreview && (
        <PdfPreviewModal
          title="Reporte de deudas médicas"
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          onClose={closePdfPreview}
          onDownload={() => void downloadPdfPreview()}
        />
      )}
    </div>
  )
}
