import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAppState } from '../../../context/AppStateContext'
import { formatMonto } from '../../../lib/formatMonto'
import { joinMotivosConsulta } from '../../../lib/motivoConsulta'
import {
  compactAppointmentStatus,
  paymentsWithoutAppointment,
} from '../../../lib/patientHistorySummary'
import {
  formatPagosLine,
  paymentsForCita,
  totalPagosMonto,
} from '../../../lib/paymentDisplay'
import './paciente-historial.css'

/** Día-mes-año (ej. 22-05-2026) */
const FECHA_DM_Y = 'dd-MM-yyyy'
const FECHA_DM_Y_HORA = 'dd-MM-yyyy HH:mm'

type Props = {
  patientId: string
  compact?: boolean
}

export function PacienteHistorialSection({ patientId, compact = false }: Props) {
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
    return paymentsWithoutAppointment(citas, pagos)
  }, [citas, pagos])

  if (compact) {
    return (
      <section className="paciente-historial paciente-historial--compact" aria-labelledby="paciente-historial-title">
        <div className="paciente-historial__head">
          <h3 id="paciente-historial-title">Historial</h3>
          <span className="paciente-historial__meta">
            {citas.length} turnos · {pagos.length} pagos · Total {formatMonto(totalPagos)}
          </span>
        </div>
        <div className="paciente-historial__compact-list">
          {citas.length === 0 ? (
            <p className="empty-hint">Sin registros de turnos.</p>
          ) : (
            citas.slice(0, 3).map((c) => {
              const doctor = doctorById(c.doctorId)
              const pagosCita = paymentsForCita(pagos, c.id)
              const metodosPago = [...new Set(pagosCita.map((p) => p.metodo).filter(Boolean))]
              const detallePago = [...metodosPago, ...(obraSocial ? [obraSocial] : [])].join(' · ')
              const estado = compactAppointmentStatus(c.estado)
              return (
                <div key={c.id} className="paciente-historial__compact-row">
                  <span className={`paciente-historial__compact-check paciente-historial__compact-check--${c.estado}`} aria-label={estado.label}>
                    {estado.marker}
                  </span>
                  <div className="paciente-historial__compact-main">
                    <strong>
                      {doctor ? `Dr/a. ${doctor.apellido}, ${doctor.nombre}` : 'Turno'}
                      {c.notas?.trim() || c.motivoConsulta2?.trim()
                        ? ` · ${joinMotivosConsulta(c.notas ?? '', c.motivoConsulta2)}`
                        : ''}
                    </strong>
                    <span>{format(parseISO(c.fechaHora), FECHA_DM_Y_HORA, { locale: es })} · {estado.label}</span>
                  </div>
                  <div className="paciente-historial__compact-payment">
                    <strong>{pagosCita.length ? formatMonto(totalPagosMonto(pagosCita)) : 'Sin pago'}</strong>
                    <span>{detallePago || '—'}</span>
                  </div>
                </div>
              )
            })
          )}
          {pagosSinCita.length > 0 && (
            <div className="paciente-historial__compact-orphans">
              <h4>Pagos sin turno</h4>
              {pagosSinCita.map((p) => {
                const doctor = doctorById(p.doctorId)
                const detallePago = [p.metodo?.trim(), obraSocial].filter(Boolean).join(' · ')
                return (
                  <div key={p.id} className="paciente-historial__compact-row">
                    <span className="paciente-historial__compact-check paciente-historial__compact-check--orphan" aria-hidden="true">$</span>
                    <div className="paciente-historial__compact-main">
                      <strong>Pago sin turno{doctor ? ` · Dr/a. ${doctor.apellido}, ${doctor.nombre}` : ''}</strong>
                      <span>{format(parseISO(p.fecha), FECHA_DM_Y, { locale: es })}</span>
                    </div>
                    <div className="paciente-historial__compact-payment">
                      <strong>{formatMonto(p.monto)}</strong>
                      <span>{detallePago || '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    )
  }

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
                const motivo = joinMotivosConsulta(c.notas ?? '', c.motivoConsulta2)
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
                          {c.estado !== 'programado' && (
                            <span
                              className={`paciente-historial__estado paciente-historial__estado--${c.estado}`}
                            >
                              {compactAppointmentStatus(c.estado).label}
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
                            {obraSocial ? <> {' · '}{obraSocial}</> : null}
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
                        {obraSocial ? <> {' · '}{obraSocial}</> : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

      </div>
    </section>
  )
}
