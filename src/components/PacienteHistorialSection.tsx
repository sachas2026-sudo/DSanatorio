import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Link } from 'react-router-dom'
import { useAppState } from '../context/AppStateContext'
import { formatMonto } from '../lib/formatMonto'
import {
  formatPagosLine,
  paymentsForCita,
  totalPagosMonto,
} from '../lib/paymentDisplay'
import './paciente-historial.css'

const ESTADO_LABEL: Record<string, string> = {
  atendido: 'Atendido',
  cancelado: 'Cancelado',
}

/** Día-mes-año (ej. 22-05-2026) */
const FECHA_DM_Y = 'dd-MM-yyyy'
const FECHA_DM_Y_HORA = 'dd-MM-yyyy HH:mm'

type Props = {
  patientId: string
}

export function PacienteHistorialSection({ patientId }: Props) {
  const { data, doctorById, patientById } = useAppState()

  const patient = patientById(patientId)
  const obraSocial = patient?.obraSocial?.trim() ?? ''

  const citas = useMemo(
    () =>
      [...data.appointments]
        .filter((c) => c.patientId === patientId)
        .sort(
          (a, b) =>
            parseISO(b.fechaHora).getTime() - parseISO(a.fechaHora).getTime(),
        ),
    [data.appointments, patientId],
  )

  const pagos = useMemo(
    () =>
      [...data.payments]
        .filter((p) => p.patientId === patientId)
        .sort((a, b) => parseISO(b.fecha).getTime() - parseISO(a.fecha).getTime()),
    [data.payments, patientId],
  )

  const totalPagos = useMemo(
    () => pagos.reduce((s, p) => s + p.monto, 0),
    [pagos],
  )

  const pagosSinCita = useMemo(() => {
    const citasIds = new Set(citas.map((c) => c.id))
    return pagos.filter((p) => !p.citaId || !citasIds.has(p.citaId))
  }, [citas, pagos])

  return (
    <section className="paciente-historial" aria-labelledby="paciente-historial-title">
      <div className="paciente-historial__head">
        <h3 id="paciente-historial-title">Historial del paciente</h3>
        <span className="paciente-historial__meta">
          {citas.length} turno{citas.length === 1 ? '' : 's'} ·{' '}
          {pagos.length} pago{pagos.length === 1 ? '' : 's'}
          {pagos.length > 0 && (
            <> · Total {formatMonto(totalPagos)}</>
          )}
        </span>
      </div>

      <div className="paciente-historial__scroll">
        <div className="paciente-historial__table">
          <div className="paciente-historial__table-head" role="row">
            <span role="columnheader">Turnos</span>
            <span role="columnheader">Pagos</span>
          </div>

          {citas.length === 0 ? (
            <p className="empty-hint">Sin turnos registrados.</p>
          ) : (
            <ul className="paciente-historial__table-body" role="rowgroup">
              {citas.map((c) => {
                const doc = doctorById(c.doctorId)
                const pagosCita = paymentsForCita(pagos, c.id)
                const pago = pagosCita[0] ?? null
                const motivo = c.notas?.trim() ?? ''
                const historiaClinica = pago?.notas?.trim() ?? ''
                const docPago = pago ? doctorById(pago.doctorId) : null
                return (
                  <li key={c.id} className="paciente-historial__row" role="row">
                    <div className="paciente-historial__cell" role="cell">
                      <div className="paciente-historial__item">
                        <span className="paciente-historial__date">
                          {format(parseISO(c.fechaHora), FECHA_DM_Y_HORA, {
                            locale: es,
                          })}
                        </span>
                        <span className="paciente-historial__detail">
                          {doc
                            ? `Dr/a. ${doc.apellido}, ${doc.nombre}${motivo ? ` - ${motivo}` : ''}`
                            : '—'}
                          {historiaClinica ? (
                            <span className="paciente-historial__sub paciente-historial__hc">
                              Historia Clínica: {historiaClinica}
                            </span>
                          ) : null}
                          {c.estado !== 'programado' && ESTADO_LABEL[c.estado] && (
                            <span
                              className={`paciente-historial__estado paciente-historial__estado--${c.estado}`}
                            >
                              {ESTADO_LABEL[c.estado]}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="paciente-historial__cell" role="cell">
                      {pagosCita.length > 0 ? (
                        <div className="paciente-historial__item">
                          <span className="paciente-historial__date">
                            {format(parseISO(pago!.fecha), FECHA_DM_Y, { locale: es })}
                          </span>
                          <span className="paciente-historial__detail paciente-historial__pago-line">
                            {pagosCita.length > 1
                              ? `${formatMonto(totalPagosMonto(pagosCita))} (${formatPagosLine(pagosCita)})`
                              : formatPagosLine(pagosCita)}
                            {obraSocial ? (
                              <>
                                {' · '}
                                <span className="obra-pill">{obraSocial}</span>
                              </>
                            ) : null}
                            {docPago ? ` - ${docPago.apellido}, ${docPago.nombre}` : ''}
                          </span>
                        </div>
                      ) : (
                        <div className="paciente-historial__item paciente-historial__item--empty">
                          <span className="paciente-historial__date"> </span>
                          <span className="paciente-historial__detail paciente-historial__empty">
                            —
                          </span>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {pagosSinCita.length > 0 && (
            <div className="paciente-historial__orphans">
              <h4>Pagos sin turno</h4>
              <ul className="paciente-historial__list">
                {pagosSinCita.map((p) => {
                  const doc = doctorById(p.doctorId)
                  return (
                    <li key={p.id}>
                      <span className="paciente-historial__date">
                        {format(parseISO(p.fecha), FECHA_DM_Y, { locale: es })}
                      </span>
                      <span className="paciente-historial__detail paciente-historial__pago-line">
                        {formatPagosLine([p])}
                        {obraSocial ? (
                          <>
                            {' · '}
                            <span className="obra-pill">{obraSocial}</span>
                          </>
                        ) : null}
                        {doc ? ` - ${doc.apellido}, ${doc.nombre}` : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

      <p className="paciente-historial__links">
        <Link to="/agenda">Ir a agenda</Link>
        <span aria-hidden> · </span>
        <Link to="/pagos">Ir a pagos</Link>
      </p>
      </div>
    </section>
  )
}
