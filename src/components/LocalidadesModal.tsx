import { useEffect, useState } from 'react'
import { IconActionButton, IconEdit, IconTrash } from './icons'
import { LOCALIDADES_MISIONES } from '../lib/localidadesMisiones'
import './especialidades-modal.css'

type Props = {
  custom: string[]
  onClose: () => void
  onAdd: (nombre: string) => { ok: boolean; error?: string }
  onRemove: (nombre: string) => void
  onRename: (anterior: string, nuevo: string) => { ok: boolean; error?: string }
}

export function LocalidadesModal({
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
      setMsg({ type: 'ok', text: 'Localidad agregada.' })
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
      setMsg({ type: 'ok', text: 'Localidad actualizada.' })
    } else {
      setMsg({ type: 'err', text: res.error ?? 'No se pudo guardar.' })
    }
  }

  return (
    <div
      className="especialidades-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="especialidades-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loc-modal-title"
      >
        <header className="especialidades-sheet__head">
          <div>
            <h2 id="loc-modal-title">Localidades</h2>
            <p className="especialidades-sheet__sub">
              Lista de Misiones y las que agregues para el desplegable.
            </p>
          </div>
          <button
            type="button"
            className="especialidades-sheet__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="especialidades-sheet__body">
          <form className="especialidades-add" onSubmit={handleAdd}>
            <input
              type="text"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              placeholder="Nueva localidad…"
              aria-label="Nueva localidad"
            />
            <button type="submit" className="btn btn-primary">
              Agregar
            </button>
          </form>

          {msg && (
            <p
              className={`especialidades-msg${msg.type === 'ok' ? ' especialidades-msg--ok' : ''}`}
            >
              {msg.text}
            </p>
          )}

          <section className="especialidades-section">
            <h3>Misiones</h3>
            <div className="especialidades-tags">
              {LOCALIDADES_MISIONES.map((l) => (
                <span key={l} className="especialidad-tag especialidad-tag--fixed">
                  {l}
                </span>
              ))}
            </div>
          </section>

          <section className="especialidades-section">
            <h3>Agregadas por usted</h3>
            {custom.length === 0 ? (
              <p className="empty-hint" style={{ margin: 0 }}>
                Todavía no agregaste ninguna. Usá el campo de arriba.
              </p>
            ) : (
              <ul className="especialidades-list">
                {custom.map((l) => (
                  <li key={l} className="especialidades-list__item">
                    {editing === l ? (
                      <>
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
                          className="btn btn-primary"
                          style={{
                            padding: '0.35rem 0.65rem',
                            fontSize: '0.82rem',
                          }}
                          onClick={saveRename}
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{
                            padding: '0.35rem 0.65rem',
                            fontSize: '0.82rem',
                          }}
                          onClick={() => setEditing(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ flex: 1, fontSize: '0.9rem' }}>{l}</span>
                        <IconActionButton
                          variant="edit"
                          label="Editar localidad"
                          onClick={() => startRename(l)}
                        >
                          <IconEdit />
                        </IconActionButton>
                        <IconActionButton
                          variant="delete"
                          label="Quitar de la lista"
                          onClick={() => onRemove(l)}
                        >
                          <IconTrash />
                        </IconActionButton>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="especialidades-sheet__foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  )
}

