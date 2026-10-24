import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  DURACION_TURNO_OPCIONES,
  doctorDuracionTurno,
  formatAgendaRanges,
  formatDoctorAgendaResumen,
  groupHorariosByWeekday,
  horariosEfectivosDoctor,
  isDoctorAgendaMensual,
} from '../../../../lib/doctorAgenda'
import { isMedicoActivo } from '../../../../lib/activo'
import { DEFAULT_AGENDA_RANGES } from '../../../../lib/weekSlots'
import {
  DIAS_SEMANA_FORM,
  diaSemanaLabelLargo,
} from '../../../../lib/diasSemana'
import type { AppData, Doctor, DoctorAtencionMensual } from '../../../../types'
import type { DiasLibresGrupo } from '../../../../lib/diasLibres'

export type FranjaFormState = {
  doctorId: string
  duracionTurnoMinutos: number
  tipoAgenda: 'semanal' | 'mensual'
}

export type MensualFormState = {
  doctorId: string
  fecha: string
  horaInicio: string
  horaFin: string
}

export type HorFormState = {
  doctorId: string
  diaSemana: number
  horaInicio: string
  horaFin: string
}

export type LibFormState = {
  doctorId: string
  diasSemana: number[]
}

export type DiasLibresRow = DiasLibresGrupo

type DoctorLookup = (id: string) => Doctor | undefined

type FranjaTabProps = {
  data: AppData
  doctorById: DoctorLookup
  franjaForm: FranjaFormState
  setFranjaForm: React.Dispatch<React.SetStateAction<FranjaFormState>>
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
}

export function AgendaFranjaTab({
  data,
  doctorById,
  franjaForm,
  setFranjaForm,
  onSubmit,
  onClose,
}: FranjaTabProps) {
  return (
    <>
      <section className="panel">
        <h2>Franja del turno por médico</h2>
        <p className="panel-hint panel-hint--oneline">
          Cada cuántos minutos se ofrecen turnos (ej. 15 → 8:00, 8:15, 8:30…). Al elegir
          médico en la reserva se muestra su horario del día.
        </p>
        {data.doctors.length === 0 ? (
          <p className="empty-hint">Primero cargá médicos.</p>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="form-grid form-grid--franja-medico">
              <div className="field">
                <label htmlFor="f-doc">Médico</label>
                <select
                  id="f-doc"
                  value={franjaForm.doctorId}
                  onChange={(e) => {
                    const id = e.target.value
                    const doc = doctorById(id)
                    setFranjaForm({
                      doctorId: id,
                      duracionTurnoMinutos: doctorDuracionTurno(doc),
                      tipoAgenda: doc?.tipoAgenda === 'mensual' ? 'mensual' : 'semanal',
                    })
                  }}
                  required
                >
                  <option value="">Elegir…</option>
                  {data.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.apellido}, {d.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field field--pill field--franja-tipo">
                <label htmlFor="f-tipo">Tipo de agenda</label>
                <div className="pill-select">
                  <select
                    id="f-tipo"
                    value={franjaForm.tipoAgenda}
                    onChange={(e) =>
                      setFranjaForm((f) => ({
                        ...f,
                        tipoAgenda: e.target.value as 'semanal' | 'mensual',
                      }))
                    }
                  >
                    <option value="semanal">Semanal (horarios por día)</option>
                    <option value="mensual">Mensual (fechas puntuales)</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-dur">Duración de cada turno</label>
                <select
                  id="f-dur"
                  value={franjaForm.duracionTurnoMinutos}
                  onChange={(e) =>
                    setFranjaForm((f) => ({
                      ...f,
                      duracionTurnoMinutos: Number(e.target.value),
                    }))
                  }
                >
                  {DURACION_TURNO_OPCIONES.map((m) => (
                    <option key={m} value={m}>
                      {m} minutos
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Guardar
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </form>
        )}
      </section>
      {franjaForm.doctorId && (
        <p className="panel-hint">
          {franjaForm.tipoAgenda === 'mensual'
            ? 'Este médico solo aparece en la agenda los días cargados en Atención mensual.'
            : 'Configurá los días y horarios en Horarios por médico.'}
        </p>
      )}
    </>
  )
}

type MensualTabProps = {
  data: AppData
  doctorById: DoctorLookup
  mensualForm: MensualFormState
  setMensualForm: React.Dispatch<React.SetStateAction<MensualFormState>>
  onSubmit: (e: React.FormEvent) => void
  onDelete: (id: string) => void
}

export function AgendaMensualTab({
  data,
  doctorById,
  mensualForm,
  setMensualForm,
  onSubmit,
  onDelete,
}: MensualTabProps) {
  return (
    <>
      <section className="panel">
        <h2>Atención mensual (fechas puntuales)</h2>
        <p className="panel-hint panel-hint--oneline">
          Para médicos que atienden una vez al mes (u otras fechas especiales). Marcá el
          médico como &quot;Mensual&quot; en Franja del turno.
        </p>
        {data.doctors.length === 0 ? (
          <p className="empty-hint">Primero cargá médicos.</p>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="m-doc">Médico</label>
                <select
                  id="m-doc"
                  value={mensualForm.doctorId}
                  onChange={(e) =>
                    setMensualForm((f) => ({ ...f, doctorId: e.target.value }))
                  }
                  required
                >
                  <option value="">Elegir…</option>
                  {data.doctors
                    .filter((d) => isDoctorAgendaMensual(d))
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.apellido}, {d.nombre}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-fecha">Fecha de atención</label>
                <input
                  id="m-fecha"
                  type="date"
                  value={mensualForm.fecha}
                  onChange={(e) =>
                    setMensualForm((f) => ({ ...f, fecha: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="m-ini">Desde</label>
                <input
                  id="m-ini"
                  type="time"
                  value={mensualForm.horaInicio}
                  onChange={(e) =>
                    setMensualForm((f) => ({ ...f, horaInicio: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="m-fin">Hasta</label>
                <input
                  id="m-fin"
                  type="time"
                  value={mensualForm.horaFin}
                  onChange={(e) =>
                    setMensualForm((f) => ({ ...f, horaFin: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Agregar fecha
              </button>
            </div>
          </form>
        )}
      </section>
      <div className="table-wrap">
        {data.atencionesMensuales.length === 0 ? (
          <p className="empty-hint">No hay fechas de atención mensual cargadas.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Médico</th>
                <th>Fecha</th>
                <th>Horario</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...data.atencionesMensuales]
                .sort((a, b) => b.fecha.localeCompare(a.fecha))
                .map((a: DoctorAtencionMensual) => {
                  const d = doctorById(a.doctorId)
                  return (
                    <tr key={a.id}>
                      <td>{d ? `${d.apellido}, ${d.nombre}` : '—'}</td>
                      <td>
                        {format(parseISO(`${a.fecha}T12:00:00`), 'dd/MM/yyyy', {
                          locale: es,
                        })}
                      </td>
                      <td>
                        {a.horaInicio} – {a.horaFin}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => onDelete(a.id)}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

type HorariosTabProps = {
  data: AppData
  doctorById: DoctorLookup
  horForm: HorFormState
  setHorForm: React.Dispatch<React.SetStateAction<HorFormState>>
  onSubmit: (e: React.FormEvent) => void
  onDelete: (id: string) => void
  onClearDoctorHorarios: (doctorId: string) => void
  onOpenMensual: () => void
  onClose: () => void
}

export function AgendaHorariosTab({
  data,
  doctorById,
  horForm,
  setHorForm,
  onSubmit,
  onDelete,
  onClearDoctorHorarios,
  onOpenMensual,
  onClose,
}: HorariosTabProps) {
  const [busquedaMedico, setBusquedaMedico] = useState('')

  const medicosSemanales = useMemo(
    () =>
      [...data.doctors]
        .filter((d) => isMedicoActivo(d) && !isDoctorAgendaMensual(d))
        .sort((a, b) =>
          `${a.apellido} ${a.nombre}`.localeCompare(
            `${b.apellido} ${b.nombre}`,
            'es',
            { sensitivity: 'base' },
          ),
        ),
    [data.doctors],
  )

  const medicosFiltrados = useMemo(() => {
    const q = busquedaMedico.trim().toLowerCase()
    if (!q) return medicosSemanales
    return medicosSemanales.filter((d) =>
      `${d.apellido} ${d.nombre}`.toLowerCase().includes(q),
    )
  }, [medicosSemanales, busquedaMedico])

  const docSeleccionado = horForm.doctorId
    ? doctorById(horForm.doctorId)
    : undefined
  const horariosDelMedico = horForm.doctorId
    ? data.horarios.filter((h) => h.doctorId === horForm.doctorId)
    : []
  const horariosEfectivos = horForm.doctorId
    ? horariosEfectivosDoctor(horForm.doctorId, data.horarios)
    : []
  const franjasPorDia = useMemo(
    () => groupHorariosByWeekday(horariosDelMedico),
    [horariosDelMedico],
  )

  const conteoFranjasPorMedico = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of data.horarios) {
      m.set(h.doctorId, (m.get(h.doctorId) ?? 0) + 1)
    }
    return m
  }, [data.horarios])

  return (
    <>
      <section className="panel horarios-tab__panel">
        <div className="horarios-tab__panel-head">
          <h2>Horarios por médico</h2>
          <button
            type="button"
            className="tab tab--agenda-verde tab--agenda-inline tab--agenda-mensual"
            onClick={onOpenMensual}
          >
            Atención mensual
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <p className="panel-hint panel-hint--oneline">
          Elegí un médico, cargá sus franjas y volvé a la lista cuando termines. Sin franjas
          propias se usa el horario general ({formatAgendaRanges(DEFAULT_AGENDA_RANGES)}).
        </p>

        {data.doctors.length === 0 ? (
          <p className="empty-hint">Primero cargá médicos.</p>
        ) : !horForm.doctorId ? (
          <>
            <div className="field horarios-tab__search">
              <label htmlFor="h-buscar">Buscar médico</label>
              <input
                id="h-buscar"
                type="search"
                placeholder="Apellido o nombre…"
                value={busquedaMedico}
                onChange={(e) => setBusquedaMedico(e.target.value)}
                autoComplete="off"
              />
            </div>
            {medicosFiltrados.length === 0 ? (
              <p className="empty-hint">Ningún médico coincide con la búsqueda.</p>
            ) : (
              <ul className="horarios-tab__doctor-list" role="list">
                {medicosFiltrados.map((d) => {
                  const n = conteoFranjasPorMedico.get(d.id) ?? 0
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="horarios-tab__doctor-card"
                        onClick={() =>
                          setHorForm((f) => ({ ...f, doctorId: d.id }))
                        }
                      >
                        <span className="horarios-tab__doctor-card-name">
                          {d.apellido}, {d.nombre}
                        </span>
                        <span className="horarios-tab__doctor-card-resumen">
                          {formatDoctorAgendaResumen(d, data)}
                        </span>
                        <span className="horarios-tab__doctor-card-meta">
                          {n === 0
                            ? 'Horario general'
                            : `${n} franja${n === 1 ? '' : 's'}`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="horarios-tab__toolbar">
              <button
                type="button"
                className="btn btn-pdf horarios-tab__back"
                onClick={() => setHorForm((f) => ({ ...f, doctorId: '' }))}
              >
                ← Todos los médicos
              </button>
              {docSeleccionado && (
                <h3 className="horarios-tab__doctor-title">
                  {docSeleccionado.apellido}, {docSeleccionado.nombre}
                </h3>
              )}
            </div>

            {docSeleccionado && isDoctorAgendaMensual(docSeleccionado) ? (
              <p className="empty-hint">
                Este médico usa agenda mensual. Configurá fechas en la pestaña Atención
                mensual.
              </p>
            ) : (
              <>
                {docSeleccionado && (
                  <p className="panel-hint horarios-tab__plan-hint">
                    <strong>Al agendar turnos:</strong>{' '}
                    {formatDoctorAgendaResumen(docSeleccionado, data)}
                  </p>
                )}

                {horariosEfectivos.length === 0 &&
                  horariosDelMedico.length > 0 && (
                    <p className="panel-hint">
                      Las franjas guardadas coinciden con el horario general; al reservar se
                      usa {formatAgendaRanges(DEFAULT_AGENDA_RANGES)}.
                    </p>
                  )}

                <section
                  className="horarios-tab__franjas-panel"
                  aria-label="Franjas cargadas"
                >
                  <div className="horarios-tab__franjas-head">
                    <h3 className="horarios-tab__franjas-title">Franjas por día</h3>
                    {horariosDelMedico.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-danger btn--compact"
                        onClick={() => onClearDoctorHorarios(horForm.doctorId)}
                      >
                        Quitar todas
                      </button>
                    )}
                  </div>

                  {franjasPorDia.length === 0 ? (
                    <p className="empty-hint">
                      Sin franjas propias: usa horario general lun–sáb (
                      {formatAgendaRanges(DEFAULT_AGENDA_RANGES)}).
                    </p>
                  ) : (
                    <ul className="horarios-tab__day-list" role="list">
                      {franjasPorDia.map(({ diaSemana, franjas }) => (
                        <li key={diaSemana} className="horarios-tab__day-row">
                          <span className="horarios-tab__day-label">
                            {diaSemanaLabelLargo(diaSemana)}
                          </span>
                          <div className="horarios-tab__day-chips">
                            {franjas.map((h) => (
                              <span key={h.id} className="horarios-tab__franja-chip">
                                <span className="horarios-tab__franja-chip-time">
                                  {h.horaInicio}–{h.horaFin}
                                </span>
                                <button
                                  type="button"
                                  className="horarios-tab__franja-chip-remove"
                                  title="Quitar franja"
                                  aria-label={`Quitar ${h.horaInicio} a ${h.horaFin}`}
                                  onClick={() => onDelete(h.id)}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <form onSubmit={onSubmit} className="horarios-tab__add-form">
                  <h3 className="horarios-tab__add-title">Agregar franja</h3>
                  <div className="form-grid form-grid--horarios-add">
                    <div className="field">
                      <label htmlFor="h-dia">Día</label>
                      <select
                        id="h-dia"
                        value={horForm.diaSemana}
                        onChange={(e) =>
                          setHorForm((f) => ({
                            ...f,
                            diaSemana: Number(e.target.value),
                          }))
                        }
                      >
                        {DIAS_SEMANA_FORM.map((n) => (
                          <option key={n} value={n}>
                            {diaSemanaLabelLargo(n)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="h-ini">Desde</label>
                      <input
                        id="h-ini"
                        type="time"
                        value={horForm.horaInicio}
                        onChange={(e) =>
                          setHorForm((f) => ({
                            ...f,
                            horaInicio: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="h-fin">Hasta</label>
                      <input
                        id="h-fin"
                        type="time"
                        value={horForm.horaFin}
                        onChange={(e) =>
                          setHorForm((f) => ({ ...f, horaFin: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">
                      Agregar franja
                    </button>
                  </div>
                </form>
              </>
            )}
          </>
        )}
      </section>
    </>
  )
}

type LibresTabProps = {
  data: AppData
  libForm: LibFormState
  setLibForm: React.Dispatch<React.SetStateAction<LibFormState>>
  diasLibresPorMedico: DiasLibresRow[]
  onSubmit: (e: React.FormEvent) => void
  onToggleDia: (dia: number) => void
  onDeleteDia: (id: string) => void
  onClose: () => void
}

export function AgendaLibresTab({
  data,
  libForm,
  setLibForm,
  diasLibresPorMedico,
  onSubmit,
  onToggleDia,
  onDeleteDia,
  onClose,
}: LibresTabProps) {
  return (
    <>
      <section className="panel">
        <h2>Días que no atiende</h2>
        <p className="panel-hint panel-hint--oneline">
          Marcá los días sin atención (ej. lunes y martes); el médico no aparecerá en la agenda esos días.
        </p>
        {data.doctors.length === 0 ? (
          <p className="empty-hint">Primero cargá médicos.</p>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="form-grid form-grid--dias-libres">
              <div className="field field--dias-libres-medico">
                <label htmlFor="l-doc">Médico</label>
                <select
                  id="l-doc"
                  value={libForm.doctorId}
                  onChange={(e) =>
                    setLibForm((f) => ({
                      ...f,
                      doctorId: e.target.value,
                      diasSemana: [],
                    }))
                  }
                  required
                >
                  <option value="">Elegir…</option>
                  {data.doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.apellido}, {d.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field field--dias-libres-dias">
                <span className="field-label-block">Días sin atención</span>
                <div className="dias-libres-picks" role="group" aria-label="Días de la semana">
                  {DIAS_SEMANA_FORM.map((n) => {
                    const ya =
                      libForm.doctorId &&
                      data.diasLibres.some(
                        (d) =>
                          d.doctorId === libForm.doctorId && d.diaSemana === n,
                      )
                    return (
                      <label
                        key={n}
                        className={`dias-libres-pick${ya ? ' dias-libres-pick--saved' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={libForm.diasSemana.includes(n)}
                          disabled={!libForm.doctorId || !!ya}
                          onChange={() => onToggleDia(n)}
                        />
                        <span>{diaSemanaLabelLargo(n)}</span>
                      </label>
                    )
                  })}
                </div>
                {libForm.doctorId && (
                  <p className="dias-libres-picks__hint">
                    Los días ya guardados aparecen atenuados. Marcá otros y
                    pulsá Guardar.
                  </p>
                )}
              </div>
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!libForm.doctorId || libForm.diasSemana.length === 0}
              >
                Guardar días
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </form>
        )}
      </section>

      <div className="table-wrap">
        {data.diasLibres.length === 0 ? (
          <p className="empty-hint">
            No hay días de la semana marcados como libres.
          </p>
        ) : (
          <table className="data data--dias-libres">
            <thead>
              <tr>
                <th>Médico</th>
                <th>Días sin atención</th>
              </tr>
            </thead>
            <tbody>
              {diasLibresPorMedico.map((row) => (
                <tr key={row.doctorId}>
                  <td className="dias-libres-lista__medico">{row.nombre}</td>
                  <td>
                    <span className="dias-libres-lista-linea">
                      {row.dias.map((d, i) => (
                        <span key={d.id} className="dias-libres-lista-item">
                          {i > 0 && (
                            <span className="dias-libres-lista-sep">, </span>
                          )}
                          <span>{diaSemanaLabelLargo(d.diaSemana)}</span>
                          <button
                            type="button"
                            className="dias-libres-lista-quitar"
                            onClick={() => onDeleteDia(d.id)}
                            aria-label={`Quitar ${diaSemanaLabelLargo(d.diaSemana)}`}
                            title="Quitar día"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
