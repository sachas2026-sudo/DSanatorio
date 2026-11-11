import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { IconActionButton, IconPlus } from '../../../../components/icons'
import {
  MOTIVO_CONSULTA_2_NINGUNO,
  MOTIVO_CONSULTA_DEFAULT,
} from '../../../../lib/motivoConsulta'
import type { AppointmentEstado, Doctor, Patient } from '../../../../types'
import './agenda-manual-modal.css'

const AGENDA_ESTADOS: { value: AppointmentEstado; label: string }[] = [
  { value: 'programado', label: 'Programado' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'cancelado', label: 'Cancelado' },
]

export type AgendaManualSubmitPayload = {
  patientId: string
  doctorId: string
  fechaHoraLocal: string
  duracionMinutos: number
  estado: AppointmentEstado
  motivoConsulta: string
  motivoOtro: string
  motivoConsulta2: string
  motivoOtro2: string
}

type Props = {
  puedeAgenda: boolean
  pacientesOperativos: Patient[]
  medicosOperativos: Doctor[]
  doctorById: (id: string) => Doctor | undefined
  doctorDuracionTurno: (doc: Doctor) => number
  motivosConsultaOpciones: string[]
  openMotivosConsultaModal: (onAdded: (nombre: string) => void) => void
  defaultDate?: Date | null
  onClose: () => void
  onSave: (payload: AgendaManualSubmitPayload) => { ok: boolean; message?: string }
}

export function AgendaManualModal({
  puedeAgenda,
  pacientesOperativos,
  medicosOperativos,
  doctorById,
  doctorDuracionTurno,
  motivosConsultaOpciones,
  openMotivosConsultaModal,
  defaultDate,
  onClose,
  onSave,
}: Props) {
  const initialFecha = defaultDate
    ? format(defaultDate, "yyyy-MM-dd'T'09:00")
    : format(new Date(), "yyyy-MM-dd'T'09:00")

  const [form, setForm] = useState<AgendaManualSubmitPayload>({
    patientId: '',
    doctorId: medicosOperativos[0]?.id || '',
    fechaHoraLocal: initialFecha,
    duracionMinutos: medicosOperativos[0] ? doctorDuracionTurno(medicosOperativos[0]) : 30,
    estado: 'programado',
    motivoConsulta: MOTIVO_CONSULTA_DEFAULT,
    motivoOtro: '',
    motivoConsulta2: MOTIVO_CONSULTA_2_NINGUNO,
    motivoOtro2: '',
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.patientId || !form.doctorId || !form.fechaHoraLocal) {
      setError('Completá paciente, médico y fecha/hora.')
      return
    }

    const res = onSave(form)
    if (!res.ok) {
      setError(res.message || 'Error al guardar el turno.')
      return
    }

    onClose()
  }

  return (
    <div
      className="agenda-manual-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agenda-manual-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="agenda-manual-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="agenda-manual-sheet__head">
          <div>
            <h2 id="agenda-manual-title" className="agenda-manual-sheet__title">
              Agenda Manual
            </h2>
            <p className="agenda-manual-sheet__sub">
              Carga manual directa de turnos para cualquier día u horario
            </p>
          </div>
          <button
            type="button"
            className="agenda-manual-sheet__close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="agenda-manual-sheet__body">
          {error && <div className="agenda-manual-sheet__error">{error}</div>}

          {!puedeAgenda ? (
            <p className="empty-hint">
              Cargá al menos un paciente y un médico para poder agendar turnos.
            </p>
          ) : (
            <form id="agenda-manual-form" onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="am-pac">Paciente</label>
                  <select
                    id="am-pac"
                    value={form.patientId}
                    onChange={(e) => setForm((f) => ({ ...f, patientId: e.target.value }))}
                    required
                  >
                    <option value="">Elegir…</option>
                    {pacientesOperativos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.apellido}, {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="am-doc">Médico</label>
                  <select
                    id="am-doc"
                    value={form.doctorId}
                    onChange={(e) => {
                      const docId = e.target.value
                      const doc = doctorById(docId)
                      setForm((f) => ({
                        ...f,
                        doctorId: docId,
                        duracionMinutos: doc ? doctorDuracionTurno(doc) : f.duracionMinutos,
                      }))
                    }}
                    required
                  >
                    <option value="">Elegir…</option>
                    {medicosOperativos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.apellido}, {d.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="am-fh">Fecha y hora</label>
                  <input
                    id="am-fh"
                    type="datetime-local"
                    value={form.fechaHoraLocal}
                    onChange={(e) => setForm((f) => ({ ...f, fechaHoraLocal: e.target.value }))}
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="am-dur">Duración turno (min)</label>
                  <input
                    id="am-dur"
                    type="number"
                    min={5}
                    step={5}
                    value={form.duracionMinutos}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        duracionMinutos: Number(e.target.value) || 30,
                      }))
                    }
                  />
                </div>

                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="am-est">Estado</label>
                  <select
                    id="am-est"
                    value={form.estado}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        estado: e.target.value as AppointmentEstado,
                      }))
                    }
                  >
                    {AGENDA_ESTADOS.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field field--pill" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="am-motivo">Motivo Consulta</label>
                  <div className="motivo-consulta-row">
                    <div className="pill-select motivo-consulta-row__select">
                      <select
                        id="am-motivo"
                        value={form.motivoConsulta}
                        onChange={(e) => setForm((f) => ({ ...f, motivoConsulta: e.target.value }))}
                      >
                        {motivosConsultaOpciones.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <IconActionButton
                      variant="add"
                      label="Agregar motivo de consulta"
                      onClick={() =>
                        openMotivosConsultaModal((nombre) =>
                          setForm((f) => ({ ...f, motivoConsulta: nombre })),
                        )
                      }
                    >
                      <IconPlus />
                    </IconActionButton>
                  </div>
                  {form.motivoConsulta === 'Otro' && (
                    <input
                      id="am-motivo-otro"
                      type="text"
                      className="motivo-consulta-otro"
                      placeholder="Especificar motivo"
                      value={form.motivoOtro}
                      onChange={(e) => setForm((f) => ({ ...f, motivoOtro: e.target.value }))}
                    />
                  )}
                </div>

                <div className="field field--pill" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="am-motivo-2">Prestación</label>
                  <div className="motivo-consulta-row">
                    <div className="pill-select motivo-consulta-row__select">
                      <select
                        id="am-motivo-2"
                        value={form.motivoConsulta2}
                        onChange={(e) => {
                          const motivo = e.target.value
                          setForm((f) => ({
                            ...f,
                            motivoConsulta2: motivo,
                            motivoOtro2: motivo === 'Otro' ? f.motivoOtro2 : '',
                          }))
                        }}
                      >
                        <option value={MOTIVO_CONSULTA_2_NINGUNO}>Sin motivo 2</option>
                        {motivosConsultaOpciones.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <IconActionButton
                      variant="add"
                      label="Agregar motivo de consulta"
                      onClick={() =>
                        openMotivosConsultaModal((nombre) =>
                          setForm((f) => ({ ...f, motivoConsulta2: nombre })),
                        )
                      }
                    >
                      <IconPlus />
                    </IconActionButton>
                  </div>
                  {form.motivoConsulta2 === 'Otro' && (
                    <input
                      id="am-motivo-otro-2"
                      type="text"
                      className="motivo-consulta-otro"
                      placeholder="Especificar motivo"
                      value={form.motivoOtro2}
                      onChange={(e) => setForm((f) => ({ ...f, motivoOtro2: e.target.value }))}
                    />
                  )}
                </div>
              </div>

              <p className="agenda-manual-sheet__hint">
                Si el médico tiene horarios configurados, el turno debe respetar la franja horaria y no solaparse con otros turnos activos.
              </p>
            </form>
          )}
        </div>

        <div className="agenda-manual-sheet__footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="agenda-manual-form"
            className="btn btn-primary"
            disabled={!puedeAgenda}
          >
            Guardar turno
          </button>
        </div>
      </div>
    </div>
  )
}
