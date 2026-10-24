import { useState, useMemo } from 'react'
import { format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Payment, Doctor } from '../../../types'
import { computeDoctorPorcentajeSettlement, computeEfectivoAEntregar, resolvePaymentPorcentaje } from '../../../lib/pagosPdfLayout'
import { formatMonto } from '../../../lib/formatMonto'
import { getTurnoFromFecha } from '../../../lib/dayTurnos'
import { buildResumenCuidarPdf } from '../../../lib/resumenCuidarPdf'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import '../../../shared/styles/pages.css'

type Props = {
  payments: Payment[]
  doctors: Doctor[]
  onClose: () => void
}

export function ResumenCuidarModal({ payments, doctors, onClose }: Props) {
  const [desde, setDesde] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [hasta, setHasta] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [medicoId, setMedicoId] = useState<string>('')
  const [turno, setTurno] = useState<string>('todos')
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string; title: string } | null>(null)

  const medicosActivos = useMemo(() => {
    return [...doctors].sort((a, b) =>
      `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
        sensitivity: 'base',
      })
    )
  }, [doctors])

  const { rows, totalCuidar, totalFacturado, totalTransferencias, totalMedico } = useMemo(() => {
    let tCuidar = 0
    let tFacturado = 0
    let tTransferencias = 0
    let tMedico = 0

    const start = parseISO(`${desde}T00:00:00`)
    const end = parseISO(`${hasta}T23:59:59`)

    const validPayments = payments.filter((p) => {
      const d = parseISO(p.fecha)
      if (!isWithinInterval(d, { start, end })) return false
      if (medicoId && p.doctorId !== medicoId) return false
      if (turno !== 'todos') {
        const t = getTurnoFromFecha(p.fecha)
        if (t.toLowerCase() !== turno.toLowerCase()) return false
      }
      return true
    })

    const byDayAndTurno = new Map<string, { day: string; turno: string; facturado: number; cuidar: number; transferencias: number; medico: number; cantidad: number }>()

    for (const p of validPayments) {
      const day = format(parseISO(p.fecha), 'yyyy-MM-dd')
      const turno = getTurnoFromFecha(p.fecha)
      const key = `${day}__${turno}`

      const doctor = doctors.find((d) => d.id === p.doctorId)
      const pct = resolvePaymentPorcentaje(p, doctor?.porcentaje)
      const s = computeDoctorPorcentajeSettlement(p.monto, pct)

      const cuidar = s.totalPorcentaje || 0
      const transferencias = p.metodo.trim().toLowerCase() === 'transferencia' ? p.monto : 0
      const medico = computeEfectivoAEntregar(s.totalGeneral || 0, transferencias)
      const facturado = p.monto

      tCuidar += cuidar
      tFacturado += facturado
      tTransferencias += transferencias
      tMedico += medico

      const existing = byDayAndTurno.get(key) ?? { day, turno, facturado: 0, cuidar: 0, transferencias: 0, medico: 0, cantidad: 0 }
      existing.facturado += facturado
      existing.cuidar += cuidar
      existing.transferencias += transferencias
      existing.medico += medico
      existing.cantidad += 1
      byDayAndTurno.set(key, existing)
    }

    const turnoOrder: Record<string, number> = { 'Mañana': 1, 'Tarde': 2, 'Noche': 3 }
    const rowList = Array.from(byDayAndTurno.values())
      .sort((a, b) => {
        const cmp = a.day.localeCompare(b.day)
        if (cmp !== 0) return cmp
        return (turnoOrder[a.turno] ?? 9) - (turnoOrder[b.turno] ?? 9)
      })

    return { rows: rowList, totalCuidar: tCuidar, totalFacturado: tFacturado, totalTransferencias: tTransferencias, totalMedico: tMedico }
  }, [payments, doctors, desde, hasta, medicoId, turno])

  return (
    <div
      className="pendientes-backdrop"
      style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="panel"
        style={{ width: '95%', maxWidth: '1000px', height: '90vh', display: 'flex', flexDirection: 'column', backgroundColor: '#fff', padding: '1.5rem', borderRadius: '8px' }}
        role="dialog"
        aria-modal="true"
      >
        <header style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Resumen Cuidar</h2>
        </header>

        <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: '1.5rem', gap: '1rem', alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="rc-desde">Desde</label>
            <input
              id="rc-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="rc-hasta">Hasta</label>
            <input
              id="rc-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '1 1 200px', minWidth: '200px' }}>
            <label htmlFor="rc-medico">Médico</label>
            <select
              id="rc-medico"
              value={medicoId}
              onChange={(e) => setMedicoId(e.target.value)}
            >
              <option value="">Todos los médicos</option>
              {medicosActivos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.apellido}, {d.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 180px', minWidth: '160px' }}>
            <label htmlFor="rc-turno">Turno</label>
            <select
              id="rc-turno"
              value={turno}
              onChange={(e) => setTurno(e.target.value)}
            >
              <option value="todos">Todos los turnos</option>
              <option value="Mañana">Turno Mañana</option>
              <option value="Tarde">Turno Tarde</option>
              <option value="Noche">Turno Noche</option>
            </select>
          </div>
          <div style={{ paddingBottom: '0.2rem' }}>
            <button
              type="button"
              className="btn btn-pdf"
              onClick={() => {
                const medicoLabel = medicoId
                  ? `${doctors.find((d) => d.id === medicoId)?.apellido}, ${doctors.find((d) => d.id === medicoId)?.nombre}`
                  : 'Todos los médicos'
                const turnoLabel = turno !== 'todos' ? turno : undefined
                const built = buildResumenCuidarPdf(
                  desde,
                  hasta,
                  medicoLabel,
                  rows,
                  { facturado: totalFacturado, transferencias: totalTransferencias, medico: totalMedico, cuidar: totalCuidar },
                  undefined,
                  turnoLabel,
                )
                setPdfPreview({ url: URL.createObjectURL(built.doc.output('blob')), filename: built.filename, title: built.title })
              }}
            >
              PDF
            </button>
          </div>
        </div>

        <div className="table-wrap table-wrap--scroll" style={{ flex: 1, overflowY: 'auto', marginBottom: '1.5rem' }}>
          <table className="data data--pagos">
            <thead style={{ backgroundColor: '#e2e8f0' }}>
              <tr>
                <th style={{ padding: '0.75rem', backgroundColor: '#e2e8f0' }}>Fecha</th>
                <th style={{ padding: '0.75rem', backgroundColor: '#e2e8f0' }}>Turno</th>
                <th style={{ padding: '0.75rem', textAlign: 'right', backgroundColor: '#e2e8f0' }}>Cant. Pagos</th>
                <th style={{ padding: '0.75rem', textAlign: 'center', backgroundColor: '#e2e8f0' }}>Porcentaje</th>
                <th style={{ padding: '0.75rem', textAlign: 'right', backgroundColor: '#e2e8f0' }}>Total Facturado</th>
                <th style={{ padding: '0.75rem', textAlign: 'right', backgroundColor: '#e2e8f0' }}>Total Transferencias</th>
                <th style={{ padding: '0.75rem', textAlign: 'right', backgroundColor: '#e2e8f0' }}>Total Médico</th>
                <th style={{ padding: '0.75rem', textAlign: 'right', backgroundColor: '#e2e8f0' }}>Monto Cuidar</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                    No hay pagos registrados en este período.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const pct = r.facturado > 0 ? Math.round((r.cuidar / r.facturado) * 1000) / 10 : 0
                  const pctStr = r.facturado > 0 ? `${pct % 1 === 0 ? pct : pct.toFixed(1)}%` : '—'
                  return (
                    <tr key={`${r.day}__${r.turno}`}>
                      <td>{format(parseISO(r.day), 'dd/MM/yyyy')}</td>
                      <td>{r.turno}</td>
                      <td style={{ textAlign: 'right' }}>{r.cantidad}</td>
                      <td style={{ textAlign: 'center', fontWeight: '600' }}>{pctStr}</td>
                      <td style={{ textAlign: 'right' }}>{formatMonto(r.facturado)}</td>
                      <td style={{ textAlign: 'right' }}>{formatMonto(r.transferencias)}</td>
                      <td style={{ textAlign: 'right' }}>{formatMonto(r.medico)}</td>
                      <td style={{ textAlign: 'right', fontWeight: '600' }}>{formatMonto(r.cuidar)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1rem' }}>
          <div className="summary-card" style={{ textAlign: 'right' }}>
            <div className="label">Total Facturado</div>
            <div className="value">{formatMonto(totalFacturado)}</div>
          </div>
          <div className="summary-card" style={{ textAlign: 'right' }}>
            <div className="label">Total Transferencias</div>
            <div className="value">{formatMonto(totalTransferencias)}</div>
          </div>
          <div className="summary-card" style={{ textAlign: 'right' }}>
            <div className="label">Total Médico</div>
            <div className="value">{formatMonto(totalMedico)}</div>
          </div>
          <div className="summary-card" style={{ backgroundColor: '#eef2ff', textAlign: 'right' }}>
            <div className="label">Total Cuidar (Mensual/Período)</div>
            <div className="value" style={{ color: '#4f46e5' }}>{formatMonto(totalCuidar)}</div>
          </div>
        </div>

        <footer style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </div>
      {pdfPreview && (
        <PdfPreviewModal
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          title={pdfPreview.title}
          onClose={() => {
            URL.revokeObjectURL(pdfPreview.url)
            setPdfPreview(null)
          }}
          onDownload={() => {
            const a = document.createElement('a')
            a.href = pdfPreview.url
            a.download = pdfPreview.filename || 'download.pdf'
            a.click()
          }}
        />
      )}
    </div>
  )
}
