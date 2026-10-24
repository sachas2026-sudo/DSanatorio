import { useEffect, useState } from 'react'
import { IconEdit, IconTrash } from '../../../shared/components/icons'
import { MOTIVOS_CONSULTA } from '../../../lib/motivoConsulta'
import './obras-sociales-modal.css'

type Props = {
  custom: string[]
  onClose: () => void
  onAdd: (
    nombre: string,
  ) => { ok: true; nombre: string } | { ok: false; error: string }
  onRemove: (nombre: string) => void
  onRename?: (anterior: string, nuevo: string) => { ok: boolean; error?: string }
  onAdded?: (nombre: string) => void
}

export function MotivosConsultaModal({
  custom,
  onClose,
  onAdd,
  onRemove,
  onRename,
  onAdded,
}: Props) {
  const [nuevo, setNuevo] = useState('')
  const [msg, setMsg] = useState<{ type: 'err' | 'ok'; text: string } | null>(
    null,
  )
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const res = onAdd(nuevo)
    if (res.ok) {
      setNuevo('')
      setMsg({ type: 'ok', text: 'Motivo de consulta agregado.' })
      onAdded?.(res.nombre)
    } else {
      setMsg({ type: 'err', text: res.error ?? 'No se pudo agregar.' })
    }
  }

  function startRename(name: string) {
    setEditing(name)
    setEditValue(name)
    setMsg(null)
  }

  function saveRename() {
    if (!editing || !onRename) return
    const res = onRename(editing, editValue)
    if (res.ok) {
      setEditing(null)
      setEditValue('')
      setMsg({ type: 'ok', text: 'Motivo de consulta actualizado.' })
    } else {
      setMsg({ type: 'err', text: res.error ?? 'No se pudo guardar.' })
    }
  }

  const habituales = MOTIVOS_CONSULTA.filter((m) => m !== 'Otro')

  return (
    <div
      className="os-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="os-modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="motivo-consulta-modal-title"
      >
        <header className="os-modal-sheet__head">
          <div>
            <h2 id="motivo-consulta-modal-title" className="os-modal-sheet__title">
              Motivos de consulta
            </h2>
            <p className="os-modal-sheet__sub">
              Lista habitual y los que agregues para el desplegable.
            </p>
          </div>
        </header>

        <div className="os-modal-sheet__body">
          <form className="os-modal-add" onSubmit={handleAdd}>
            <input
              type="text"
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              placeholder="Nuevo motivo de consulta…"
              aria-label="Nuevo motivo de consulta"
            />
            <button type="submit" className="os-modal-btn-add">
              Agregar
            </button>
          </form>

          {msg && (
            <p
              className={`os-modal-msg${msg.type === 'ok' ? ' os-modal-msg--ok' : ''}`}
            >
              {msg.text}
            </p>
          )}

          <div className="os-modal-cols">
            {/* Habituales */}
            <div className="os-modal-col">
              <h3>HABITUALES · {habituales.length}</h3>
              <div className="os-modal-pills">
                {habituales.map((m) => (
                  <span key={m} className="os-modal-pill">
                    {m}
                  </span>
                ))}
              </div>
            </div>

            {/* Agregados por usted */}
            <div className="os-modal-col">
              <h3>AGREGADOS POR USTED · {custom.length}</h3>
              {custom.length === 0 ? (
                <p className="os-modal-empty">
                  Todavía no agregaste ninguno. Usá el campo de arriba.
                </p>
              ) : (
                <ul className="os-modal-custom-list">
                  {custom.map((m) => (
                    <li key={m} className="os-modal-card">
                      {editing === m ? (
                        <div className="os-modal-card__edit-form">
                          <input
                            value={editValue}
                            onChange={(ev) => setEditValue(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') saveRename()
                              if (ev.key === 'Escape') setEditing(null)
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="os-modal-btn-save"
                            onClick={saveRename}
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            className="os-modal-btn-cancel"
                            onClick={() => setEditing(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="os-modal-card__name">{m}</span>
                          <div className="os-modal-card__actions">
                            {onRename && (
                              <button
                                type="button"
                                className="os-modal-btn-edit"
                                aria-label="Editar motivo de consulta"
                                title="Editar motivo de consulta"
                                onClick={() => startRename(m)}
                              >
                                <IconEdit />
                              </button>
                            )}
                            <button
                              type="button"
                              className="os-modal-btn-delete"
                              aria-label="Quitar de la lista"
                              title="Quitar de la lista"
                              onClick={() => onRemove(m)}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <footer className="os-modal-sheet__foot">
          <button
            type="button"
            className="os-modal-btn-close"
            onClick={onClose}
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  )
}
