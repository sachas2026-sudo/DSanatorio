import { useMemo, useState } from 'react'

import { Link } from 'react-router-dom'

import { format, isWithinInterval, parseISO } from 'date-fns'

import { es } from 'date-fns/locale'

import {

  IconTileEspecialidades,

  IconTileMedicos,

  IconTilePacientes,

  IconTilePagos,

  IconTileTurnos,

} from '../components/icons'

import { AgendaMedicosEspecialidadesModal } from '../components/AgendaMedicosEspecialidadesModal'
import { useAppState } from '../context/AppStateContext'
import { buildMedicosEspecialidadesRows } from '../lib/doctorAgenda'
import { useAuth } from '../context/AuthContext'

import { agruparPorMedico, citasDelDia } from '../lib/dayTurnos'

import { formatMonto } from '../lib/formatMonto'

import { groupDoctorsByEspecialidad } from '../lib/especialidades'

import { computeHomeAlerts, computeHomeStats } from '../lib/homeInsights'
import { periodBounds } from '../lib/periodBounds'

import type { Appointment } from '../types'

import './pages.css'



export function HomePage() {

  const { data, doctorById, patientById } = useAppState()
  const { canAccessPath } = useAuth()
  const puedePagos = canAccessPath('/pagos')

  const [espModalOpen, setEspModalOpen] = useState(false)

  const hoy = useMemo(() => new Date(), [])



  const stats = useMemo(() => computeHomeStats(data, hoy), [data, hoy])



  const alerts = useMemo(

    () =>

      computeHomeAlerts(data, {

        patientLabel: (id) => {

          const p = patientById(id)

          return p ? `${p.apellido}, ${p.nombre}` : '—'

        },

        doctorLabel: (id) => {

          const d = doctorById(id)

          return d ? `${d.apellido}, ${d.nombre}` : '—'

        },

      }, hoy),

    [data, hoy, patientById, doctorById],

  )



  const citasHoy = useMemo(

    () => citasDelDia(data.appointments, hoy),

    [data.appointments, hoy],

  )



  const turnosPorMedico = useMemo(

    () =>

      agruparPorMedico(citasHoy, (doctorId) => {

        const doc = doctorById(doctorId)

        return doc ? `${doc.apellido}, ${doc.nombre}` : '—'

      }),

    [citasHoy, doctorById],

  )



  const tituloDia = format(hoy, "EEEE d 'de' MMMM", { locale: es })



  const medicosEspecialidadesRows = useMemo(
    () => buildMedicosEspecialidadesRows(data),
    [data],
  )

  const espGrupos = useMemo(

    () => groupDoctorsByEspecialidad(data.doctors),

    [data.doctors],

  )



  const tieneAlertas =

    alerts.turnosManana.length > 0 || alerts.atendidosSinPago.length > 0

  const pendientesPacientes = useMemo(() => {
    const mesBounds = periodBounds('mes', hoy)
    const paidCitaIds = new Set(
      data.payments
        .filter((p) => p.monto > 0)
        .map((p) => p.citaId)
        .filter((id): id is string => Boolean(id)),
    )
    const paidDayKeys = new Set(
      data.payments
        .filter((p) => p.monto > 0)
        .map((p) => {
          const day = format(parseISO(p.fecha), 'yyyy-MM-dd')
          return `${p.patientId}__${p.doctorId}__${day}`
        }),
    )

    const latestByPatient = new Map<
      string,
      { patientLabel: string; doctorLabel: string; fechaHora: string }
    >()

    for (const c of data.appointments) {
      if (c.estado === 'cancelado') continue
      if (paidCitaIds.has(c.id)) continue
      const t = parseISO(c.fechaHora)
      if (!isWithinInterval(t, { start: mesBounds.start, end: mesBounds.end })) continue
      const key = `${c.patientId}__${c.doctorId}__${format(t, 'yyyy-MM-dd')}`
      if (paidDayKeys.has(key)) continue

      const curr = latestByPatient.get(c.patientId)
      if (!curr || parseISO(c.fechaHora).getTime() > parseISO(curr.fechaHora).getTime()) {
        const p = patientById(c.patientId)
        const d = doctorById(c.doctorId)
        latestByPatient.set(c.patientId, {
          patientLabel: p ? `${p.apellido}, ${p.nombre}` : '—',
          doctorLabel: d ? `${d.apellido}, ${d.nombre}` : '—',
          fechaHora: c.fechaHora,
        })
      }
    }

    return [...latestByPatient.entries()]
      .map(([patientId, row]) => ({ patientId, ...row }))
      .sort((a, b) => parseISO(b.fechaHora).getTime() - parseISO(a.fechaHora).getTime())
  }, [data.appointments, data.payments, doctorById, patientById, hoy])

  const tienePendientes = pendientesPacientes.length > 0

  function renderCita(c: Appointment) {

    const p = patientById(c.patientId)

    return (

      <li key={c.id} className="day-cita day-cita--static">

        <div className="day-cita__main">

          <span className="day-cita__time">

            {format(parseISO(c.fechaHora), 'HH:mm', { locale: es })}

          </span>

          <span className="day-cita__who">

            {p ? `${p.apellido}, ${p.nombre}` : '—'}

          </span>

        </div>

      </li>

    )

  }



  return (

    <div className="page page--home">

      <header className="page-header">

        <h1>Bienvenido</h1>

      </header>



      <div className="tiles">

        <Link className="tile tile--welcome" to="/pacientes">

          <span className="tile__badge" aria-hidden>

            <IconTilePacientes className="tile__icon" />

          </span>

          <div className="tile__body">

            <span className="tile-k">Pacientes</span>

            <span className="tile-v">{data.patients.length} registrados</span>

          </div>

        </Link>

        <Link className="tile tile--welcome" to="/medicos">

          <span className="tile__badge" aria-hidden>

            <IconTileMedicos className="tile__icon" />

          </span>

          <div className="tile__body">

            <span className="tile-k">Médicos</span>

            <span className="tile-v">{data.doctors.length} registrados</span>

          </div>

        </Link>

        <Link className="tile tile--welcome" to="/agenda">

          <span className="tile__badge" aria-hidden>

            <IconTileTurnos className="tile__icon" />

          </span>

          <div className="tile__body">

            <span className="tile-k">Turnos</span>

            <span className="tile-v">{data.appointments.length} en agenda</span>

          </div>

        </Link>

        {puedePagos && (
          <Link className="tile tile--welcome" to="/pagos">
            <span className="tile__badge" aria-hidden>
              <IconTilePagos className="tile__icon" />
            </span>
            <div className="tile__body">
              <span className="tile-k">Pagos</span>
              <span className="tile-v">{data.payments.length} movimientos</span>
            </div>
          </Link>
        )}

        <button
          type="button"
          className="tile tile--welcome tile--action"
          onClick={() => setEspModalOpen(true)}
        >
          <span className="tile__badge" aria-hidden>
            <IconTileEspecialidades className="tile__icon" />
          </span>
          <div className="tile__body">
            <span className="tile-k">Especialidades</span>
            <span className="tile-v">
              {espGrupos.length} especialidad{espGrupos.length === 1 ? '' : 'es'}
            </span>
            <span className="tile-v-sub">Médicos, especialidad y días</span>
          </div>
        </button>
      </div>

      {espModalOpen && (
        <AgendaMedicosEspecialidadesModal
          rows={medicosEspecialidadesRows}
          data={data}
          onClose={() => setEspModalOpen(false)}
        />
      )}



      <section className="panel panel--home-stats">

        <h2 className="home-section-title">Resumen</h2>

        <div className="home-stats-grid">

          {puedePagos && (
            <>
              <div className="home-stat-card">
                <span className="home-stat-card__k">Ingresos hoy</span>
                <span className="home-stat-card__v">{formatMonto(stats.ingresosHoy)}</span>
              </div>
            </>
          )}

          <div className="home-stat-card home-stat-card--turnos">

            <span className="home-stat-card__k">Turnos del mes</span>

            <div className="home-stat-card__chips home-stat-card__chips--turnos">

              <span className="home-stat-chip" title="Programados">

                {stats.turnosMes.programado} prog.

              </span>

              <span className="home-stat-chip" title="Atendidos">

                {stats.turnosMes.atendido} atend.

              </span>

              <span className="home-stat-chip" title="Cancelados">

                {stats.turnosMes.cancelado} canc.

              </span>

            </div>

          </div>

          {stats.topObrasSociales.length > 0 && (

            <div className="home-stat-card home-stat-card--obras">

              <span className="home-stat-card__k">Obras sociales (top)</span>

              <span className="home-stat-card__chips home-stat-card__chips--obra">

                {stats.topObrasSociales.map((o) => (

                  <span key={o.nombre} className="obra-pill">

                    {o.nombre} ({o.cantidad})

                  </span>

                ))}

              </span>

            </div>

          )}

        </div>

        {puedePagos && (
          <p className="home-stats__link">
            <Link to="/pagos">Ver detalle en Pagos →</Link>
          </p>
        )}

      </section>
      <div className="home-alerts-row">
        <section className="panel panel--home-alerts">

        <h2 className="home-section-title">Avisos</h2>

        <div className="home-panel__body">
          {!tieneAlertas ? (

            <p className="empty-hint">No hay avisos pendientes por ahora.</p>

          ) : (

            <div className="home-alerts-grid">

            <div className="home-alert-block">

              <h3>Turnos de mañana</h3>

              {alerts.turnosManana.length === 0 ? (

                <p className="home-alert-empty">Ninguno programado.</p>

              ) : (

                <ul className="home-alert-list">

                  {alerts.turnosManana.map((t) => (

                    <li key={t.id}>

                      <span className="home-alert-list__time">

                        {format(parseISO(t.fechaHora), 'HH:mm', { locale: es })}

                      </span>

                      <span>

                        {t.patientLabel}

                        <span className="home-alert-list__sub">{t.doctorLabel}</span>

                      </span>

                    </li>

                  ))}

                </ul>

              )}

            </div>

            <div className="home-alert-block">

              <h3>Atendidos sin pago</h3>

              {alerts.atendidosSinPago.length === 0 ? (

                <p className="home-alert-empty">Todo al día.</p>

              ) : (

                <ul className="home-alert-list">

                  {alerts.atendidosSinPago.slice(0, 8).map((t) => (

                    <li key={t.id}>

                      <span className="home-alert-list__time">

                        {format(parseISO(t.fechaHora), 'dd/MM', { locale: es })}

                      </span>

                      <span>

                        {t.patientLabel}

                        <span className="home-alert-list__sub">{t.doctorLabel}</span>

                      </span>

                    </li>

                  ))}

                </ul>

              )}

              {alerts.atendidosSinPago.length > 8 && (
                <p className="home-alert-more">
                  {puedePagos
                    ? `+${alerts.atendidosSinPago.length - 8} más en Pagos`
                    : `+${alerts.atendidosSinPago.length - 8} más`}
                </p>
              )}

            </div>

            </div>

          )}
        </div>

        <p className="home-stats__link">

          <Link to="/agenda">Agenda</Link>

          <span aria-hidden> · </span>

          <Link to="/pacientes">Pacientes</Link>

        </p>

        </section>

        <section className="panel panel--home-pendientes">
          <h2 className="home-section-title">Pendiente</h2>

          <div className="home-panel__body">
            {!tienePendientes ? (
              <p className="empty-hint">No hay pacientes pendientes por ahora.</p>
            ) : (
              <ul className="home-alert-list">
                {pendientesPacientes.map((t) => (
                  <li key={t.patientId}>
                    <span className="home-alert-list__time">
                      {format(parseISO(t.fechaHora), 'dd/MM', { locale: es })}
                    </span>
                    <span>
                      {t.patientLabel}
                      <span className="home-alert-list__sub">{t.doctorLabel}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="home-stats__link">
            <Link to="/pagos">Pagos</Link>
            <span aria-hidden> · </span>
            <Link to="/pacientes">Pacientes</Link>
          </p>
        </section>
      </div>



      <section className="panel panel--home-turnos">

        <div className="home-turnos__head">

          <h2 className="home-turnos__title">Turnos de hoy</h2>

          <span className="home-turnos__date">{tituloDia}</span>

        </div>

        {turnosPorMedico.length === 0 ? (

          <p className="empty-hint">No hay turnos programados para hoy.</p>

        ) : (

          <div className="home-turnos-pills">

            {turnosPorMedico.map((g) => (

              <div key={g.key} className="day-pill">

                <div className="day-pill__head">

                  <h3 className="day-pill__title day-pill__title--doctor">

                    {g.label}

                  </h3>

                  <span className="day-pill__range">

                    {g.citas.length} turno{g.citas.length === 1 ? '' : 's'}

                  </span>

                </div>

                <ul className="day-cita-list">{g.citas.map(renderCita)}</ul>

              </div>

            ))}

          </div>

        )}

        <p className="home-turnos__link">

          <Link to="/agenda">Ver agenda completa →</Link>

        </p>

      </section>

    </div>

  )

}


