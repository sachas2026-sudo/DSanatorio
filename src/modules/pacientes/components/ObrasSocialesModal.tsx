import { useEffect, useState } from 'react'
import { IconEdit, IconTrash } from '../../../shared/components/icons'
import { OBRAS_SOCIALES } from '../../../lib/obrasSociales'
import './obras-sociales-modal.css'

type Props = {
  custom: string[]
  onClose: () => void
  onAdd: (nombre: string) => { ok: boolean; error?: string }
  onRemove: (nombre: string) => void
  onRename: (anterior: string, nuevo: string) => { ok: boolean; error?: string }
}

export function ObrasSocialesModal({
  custom,
  onClose,
  onAdd,
  onRemove,
  onRename,
}: Props) {
  const [nueva, setNueva] = useState('')
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
    const res = onAdd(nueva)
    if (res.ok) {
      setNueva('')
      setMsg({ type: 'ok', text: 'Obra social agregada.' })
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
    if (!editing) return
    const res = onRename(editing, editValue)
    if (res.ok) {
      setEditing(null)
      setEditValue('')
      setMsg({ type: 'ok', text: 'Obra social actualizada.' })
    } else {
      setMsg({ type: 'err', text: res.error ?? 'No se pudo guardar.' })
    }
  }

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
        aria-labelledby="os-modal-title"
      >
        <header className="os-modal-sheet__head">
          <div>
            <h2 id="os-modal-title" className="os-modal-sheet__title">
              Obras sociales
            </h2>
            <p className="os-modal-sheet__sub">
              Lista habitual y las que agregues para el desplegable.
            </p>
          </div>
        </header>

        <div className="os-modal-sheet__body">
          <form className="os-modal-add" onSubmit={handleAdd}>
            <input
              type="text"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              placeholder="Nueva obra social…"
              aria-label="Nueva obra social"
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
              <h3>HABITUALES · {OBRAS_SOCIALES.length}</h3>
              <div className="os-modal-pills">
                {OBRAS_SOCIALES.map((o) => (
                  <span key={o} className="os-modal-pill">
                    {o}
                  </span>
                ))}
              </div>
            </div>

            {/* Agregadas por usted */}
            <div className="os-modal-col">
              <h3>AGREGADAS POR USTED · {custom.length}</h3>
              {custom.length === 0 ? (
                <p className="os-modal-empty">
                  Todavía no agregaste ninguna. Usá el campo de arriba.
                </p>
              ) : (
                <ul className="os-modal-custom-list">
                  {custom.map((o) => (
                    <li key={o} className="os-modal-card">
                      {editing === o ? (
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
                          <span className="os-modal-card__name">{o}</span>
                          <div className="os-modal-card__actions">
                            <button
                              type="button"
                              className="os-modal-btn-edit"
                              aria-label="Editar obra social"
                              title="Editar obra social"
                              onClick={() => startRename(o)}
                            >
                              <IconEdit />
                            </button>
                            <button
                              type="button"
                              className="os-modal-btn-delete"
                              aria-label="Quitar de la lista"
                              title="Quitar de la lista"
                              onClick={() => onRemove(o)}
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
