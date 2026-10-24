import { useEffect, useMemo, useRef, useState } from 'react'
import { DNI_PAC_LABEL, dniPacDuplicadoMsg } from '../../lib/dniLabels'
import type { Patient } from '../../types'
import './quick-paciente-modal.css'

type BasePacienteForm = Pick<
  Patient,
  'apellido' | 'nombre' | 'dni' | 'telefono' | 'email' | 'obraSocial' | 'localidad'
>

type Props = {
  initial?: Partial<BasePacienteForm>
  existingPatients: Patient[]
  localidadesOpciones: string[]
  onSave: (data: BasePacienteForm) => void
  onClose: () => void
}

const emptyForm: BasePacienteForm = {
  apellido: '',
  nombre: '',
  dni: '',
  telefono: '',
  email: '',
  obraSocial: '',
  localidad: 'Puerto Piray',
}

export function QuickPacienteModal({
  initial,
  existingPatients,
  localidadesOpciones,
  onSave,
  onClose,
}: Props) {
  const [form, setForm] = useState<BasePacienteForm>({ ...emptyForm, ...initial })
  const [dniMsg, setDniMsg] = useState<string | null>(null)
  const apellidoRef = useRef<HTMLInputElement>(null)

  const dniLabel = DNI_PAC_LABEL || 'DNI'

  const normalizedDni = useMemo(() => String(form.dni ?? '').trim(), [form.dni])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    requestAnimationFrame(() => apellidoRef.current?.focus())
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.apellido.trim() || !form.nombre.trim()) return
    if (normalizedDni) {
      const dup = existingPatients.find((p) => (p.dni ?? '').trim() === normalizedDni)
      if (dup) {
        setDniMsg(dniPacDuplicadoMsg(dup.apellido, dup.nombre, true))
        return
      }
    }
    setDniMsg(null)
    onSave({
      ...form,
      apellido: form.apellido.trim(),
      nombre: form.nombre.trim(),
      dni: normalizedDni,
      telefono: String(form.telefono ?? '').trim(),
      email: String(form.email ?? '').trim(),
      obraSocial: String(form.obraSocial ?? '').trim(),
      localidad: String(form.localidad ?? '').trim(),
    })
  }

  return (
    <div
      className="quick-pac-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="quick-pac-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-pac-title"
      >
        <header className="quick-pac__head">
          <div>
            <h2 id="quick-pac-title">Nuevo paciente</h2>
            <p className="quick-pac__sub">Carga rápida (sin salir de la agenda)</p>
          </div>
          <button
            type="button"
            className="quick-pac__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="quick-pac__body" onSubmit={submit} noValidate>
          {dniMsg && <div className="msg msg-error">{dniMsg}</div>}
          <div className="form-grid form-grid--paciente-quick">
            <div className="field">
              <label htmlFor="qp-ap">Apellido</label>
              <input
                id="qp-ap"
                ref={apellidoRef}
                value={form.apellido}
                onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="qp-nom">Nombre</label>
              <input
                id="qp-nom"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="qp-dni">{dniLabel}</label>
              <input
                id="qp-dni"
                inputMode="numeric"
                value={form.dni}
                onChange={(e) => setForm((f) => ({ ...f, dni: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
            <div className="field">
              <label htmlFor="qp-tel">Teléfono</label>
              <input
                id="qp-tel"
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
            <div className="field">
              <label htmlFor="qp-mail">Email</label>
              <input
                id="qp-mail"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
            <div className="field">
              <label htmlFor="qp-obra">Obra social</label>
              <input
                id="qp-obra"
                value={form.obraSocial}
                onChange={(e) => setForm((f) => ({ ...f, obraSocial: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
            <div className="field field--pill">
              <label htmlFor="qp-loc">Localidad</label>
              <div className="pill-select">
                <select
                  id="qp-loc"
                  value={form.localidad}
                  onChange={(e) => setForm((f) => ({ ...f, localidad: e.target.value }))}
                >
                  {localidadesOpciones.length === 0 ? (
                    <option value={form.localidad || 'Puerto Piray'}>
                      {form.localidad || 'Puerto Piray'}
                    </option>
                  ) : (
                    <>
                      {localidadesOpciones.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                      {form.localidad &&
                        !localidadesOpciones.includes(form.localidad) && (
                          <option value={form.localidad}>{form.localidad}</option>
                        )}
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>

          <footer className="quick-pac__actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Guardar paciente
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

