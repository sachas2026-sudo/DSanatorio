import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '../../../context/AppStateContext'
import { useAuth } from '../../../context/AuthContext'
import type { ObraSocialCatalog } from '../../../types'
import {
  formatPesosAr,
  parsePesosAr,
  formatPorcentajeAr,
  parsePorcentajeAr,
  normalizeSearchText,
} from '../../../lib/obrasSocialesCatalog'
import './obras-sociales-modal.css'

interface Props {
  onClose: () => void
  custom?: string[]
  onAdd?: (nombre: string) => { ok: boolean; error?: string }
  onRemove?: (nombre: string) => void
  onRename?: (anterior: string, nuevo: string) => { ok: boolean; error?: string }
}

export function ObrasSocialesModal({ onClose, onAdd, onRemove }: Props) {
  const { data, obrasSocialesCatalog, saveObraSocialCatalog, deleteObraSocialCatalog } = useAppState()
  // Sólo el administrador ve y edita Arancel, % Cuidar e impuestos/gastos.
  const { role } = useAuth()
  const esAdmin = role === 'admin'

  const planesAfiliadosNombres = useMemo(() => {
    const set = new Set<string>()
    for (const p of data?.planesAfiliados ?? []) {
      if (p.nombre?.trim()) set.add(p.nombre.trim().toLowerCase())
    }
    return set
  }, [data?.planesAfiliados])

  const [nueva, setNueva] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState<number | null>(null)

  // Estados locales de inputs en edición para no perder lo que escribe el usuario antes de blur
  const [inputValues, setInputValues] = useState<Record<string, string>>({})

  // Cerrar con Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Temporizador para feedback de "Guardado"
  const savedTimeoutRef = useRef<number | null>(null)
  function showSavedIndicator() {
    setSavedTick(Date.now())
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
    savedTimeoutRef.current = window.setTimeout(() => {
      setSavedTick(null)
    }, 1800)
  }

  // Filtrado de lista por búsqueda
  const filteredList = useMemo(() => {
    const q = normalizeSearchText(busqueda)
    if (!q) return obrasSocialesCatalog
    return obrasSocialesCatalog.filter((item) =>
      normalizeSearchText(item.nombre).includes(q),
    )
  }, [obrasSocialesCatalog, busqueda])

  // Agregar nueva obra social
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)
    const nombreNorm = nueva.trim()
    if (!nombreNorm) {
      setErrorMsg('Escribí el nombre de la obra social.')
      return
    }

    const exists = obrasSocialesCatalog.some(
      (o) => o.nombre.trim().toLowerCase() === nombreNorm.toLowerCase(),
    )
    if (exists) {
      setErrorMsg('Esa obra social ya existe.')
      return
    }

    const newItem: ObraSocialCatalog = {
      nombre: nombreNorm,
      plus: 0,
      arancel: 0,
      cuidar: 0,
      impBanco: 0,
      impFactura: 0,
      gastosAdm: 0,
      suspendida: false,
      version: 1,
    }

    const res = await saveObraSocialCatalog(newItem)
    if (res.ok) {
      setNueva('')
      showSavedIndicator()
      if (onAdd) onAdd(nombreNorm)
    } else {
      setErrorMsg(res.error || 'No se pudo agregar.')
    }
  }

  // Obtener el valor formateado actual para mostrar en el input
  function getDisplayValue(
    item: ObraSocialCatalog,
    field: keyof Omit<ObraSocialCatalog, 'nombre' | 'suspendida' | 'version'>,
  ): string {
    const key = `${item.nombre}:${field}`
    if (inputValues[key] !== undefined) {
      return inputValues[key]
    }
    const val = item[field]
    if (!val || val === 0) {
      return ''
    }
    if (field === 'plus' || field === 'arancel') {
      return formatPesosAr(val)
    }
    return formatPorcentajeAr(val)
  }

  function handleInputChange(
    item: ObraSocialCatalog,
    field: keyof Omit<ObraSocialCatalog, 'nombre' | 'suspendida' | 'version'>,
    val: string,
  ) {
    const key = `${item.nombre}:${field}`
    setInputValues((prev) => ({ ...prev, [key]: val }))
  }

  async function handleFieldCommit(
    item: ObraSocialCatalog,
    field: keyof Omit<ObraSocialCatalog, 'nombre' | 'suspendida' | 'version'>,
  ) {
    const key = `${item.nombre}:${field}`
    const rawVal = inputValues[key]
    if (rawVal === undefined) return // No cambió

    // Limpiar del estado local temporal
    setInputValues((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })

    let nextVal = 0
    if (field === 'plus' || field === 'arancel') {
      nextVal = parsePesosAr(rawVal)
    } else {
      nextVal = parsePorcentajeAr(rawVal)
    }

    // Si el valor numérico no cambió, no hacemos petición ni guardado
    if (item[field] === nextVal) return

    const updated: ObraSocialCatalog = {
      ...item,
      [field]: nextVal,
    }

    const res = await saveObraSocialCatalog(updated)
    if (res.ok) {
      setErrorMsg(null)
      showSavedIndicator()
    } else if (res.conflict) {
      setErrorMsg('Conflicto: la obra social fue modificada por otro usuario.')
    } else {
      setErrorMsg(res.error || 'No se pudo guardar.')
    }
  }

  // Suspender / Reactivar
  async function handleToggleSuspender(item: ObraSocialCatalog) {
    setErrorMsg(null)
    const updated: ObraSocialCatalog = {
      ...item,
      suspendida: !item.suspendida,
    }
    const res = await saveObraSocialCatalog(updated)
    if (res.ok) {
      showSavedIndicator()
    } else if (res.conflict) {
      setErrorMsg('Conflicto: la obra social fue modificada por otro usuario.')
    } else {
      setErrorMsg(res.error || 'No se pudo actualizar.')
    }
  }

  // Quitar con confirmación
  async function handleDelete(item: ObraSocialCatalog) {
    setErrorMsg(null)
    if (planesAfiliadosNombres.has(item.nombre.trim().toLowerCase())) {
      setErrorMsg(`"${item.nombre}" es un plan de Afiliados; si no lo usás, podés suspenderlo.`)
      return
    }
    const confirmed = window.confirm(`¿Quitar la obra social ${item.nombre}?`)
    if (!confirmed) return

    const res = await deleteObraSocialCatalog(item.nombre)
    if (res.ok) {
      showSavedIndicator()
      if (onRemove) onRemove(item.nombre)
    } else {
      setErrorMsg(res.error || 'No se pudo quitar la obra social.')
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
        {/* Encabezado */}
        <header className="os-modal-sheet__head">
          <div>
            <h2 id="os-modal-title" className="os-modal-sheet__title">
              Obras sociales
            </h2>
            <p className="os-modal-sheet__sub">
              Plus, arancel y porcentajes de cada obra social.
            </p>
          </div>
        </header>

        {/* Toolbar */}
        <div className="os-modal-toolbar">
          <form className="os-modal-add-form" onSubmit={handleAdd}>
            <input
              type="text"
              className="os-modal-add-input"
              value={nueva}
              onChange={(e) => {
                setNueva(e.target.value)
                if (errorMsg) setErrorMsg(null)
              }}
              placeholder="Nueva obra social…"
              aria-label="Nueva obra social"
            />
            <button type="submit" className="os-modal-btn-add">
              Agregar
            </button>
          </form>

          <div className="os-modal-search-wrap">
            <span className="os-modal-search-icon" aria-hidden="true">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              ref={searchInputRef}
              type="text"
              className="os-modal-search-input"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar obra social…"
              aria-label="Buscar obra social"
            />
            {busqueda.length > 0 && (
              <button
                type="button"
                className="os-modal-search-clear"
                onClick={() => {
                  setBusqueda('')
                  searchInputRef.current?.focus()
                }}
                aria-label="Borrar búsqueda"
                title="Borrar búsqueda"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Línea de error */}
        <div className="os-modal-error-line">
          {errorMsg && <span>{errorMsg}</span>}
        </div>

        {/* Encabezado de tabla */}
        <div className={`os-modal-table-header ${esAdmin ? '' : 'os-modal-table-header--basico'}`}>
          <div>Obra social</div>
          <div className="os-modal-th-right">Plus</div>
          {esAdmin && (
            <>
              <div className="os-modal-th-right">Arancel</div>
              <div className="os-modal-th-right">% Cuidar</div>
              <div className="os-modal-th-right">Imp. Banco (%)</div>
              <div className="os-modal-th-right">Imp. Facturación (%)</div>
              <div className="os-modal-th-right">Gastos Adm. (%)</div>
            </>
          )}
          <div style={{ textAlign: 'center' }}>Acciones</div>
        </div>

        {/* Filas scrolleables */}
        <div className="os-modal-rows-scroll">
          {filteredList.length === 0 ? (
            <div className="os-modal-empty">
              No hay obras sociales que coincidan con la búsqueda.
            </div>
          ) : (
            filteredList.map((item) => (
              <div
                key={item.nombre}
                className={`os-modal-row ${item.suspendida ? 'os-modal-row--suspended' : ''} ${esAdmin ? '' : 'os-modal-row--basico'}`}
              >
                {/* Nombre y badge suspendida */}
                <div className="os-modal-name-col">
                  <span className="os-modal-name" title={item.nombre}>
                    {item.nombre}
                  </span>
                  {planesAfiliadosNombres.has(item.nombre.trim().toLowerCase()) && (
                    <span className="os-modal-badge-plan" title="Plan del sistema de Afiliados">
                      Plan
                    </span>
                  )}
                  {item.suspendida && (
                    <span className="os-modal-badge-suspended">SUSPENDIDA</span>
                  )}
                </div>

                {/* Plus */}
                <div className="os-modal-input-box">
                  <span className="os-modal-affix os-modal-affix--prefix">$</span>
                  <input
                    type="text"
                    className="os-modal-num-input"
                    value={getDisplayValue(item, 'plus')}
                    onChange={(e) => handleInputChange(item, 'plus', e.target.value)}
                    onBlur={() => void handleFieldCommit(item, 'plus')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                    aria-label={`Plus de ${item.nombre}`}
                  />
                </div>

                {esAdmin && (
                  <>
                    {/* Arancel */}
                    <div className="os-modal-input-box">
                      <span className="os-modal-affix os-modal-affix--prefix">$</span>
                      <input
                        type="text"
                        className="os-modal-num-input"
                        value={getDisplayValue(item, 'arancel')}
                        onChange={(e) => handleInputChange(item, 'arancel', e.target.value)}
                        onBlur={() => void handleFieldCommit(item, 'arancel')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          }
                        }}
                        aria-label={`Arancel de ${item.nombre}`}
                      />
                    </div>

                    {/* % Cuidar */}
                    <div className="os-modal-input-box">
                      <input
                        type="text"
                        className="os-modal-num-input"
                        value={getDisplayValue(item, 'cuidar')}
                        onChange={(e) => handleInputChange(item, 'cuidar', e.target.value)}
                        onBlur={() => void handleFieldCommit(item, 'cuidar')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          }
                        }}
                        aria-label={`Porcentaje Cuidar de ${item.nombre}`}
                      />
                      <span className="os-modal-affix os-modal-affix--suffix">%</span>
                    </div>

                    {/* Imp. Banco */}
                    <div className="os-modal-input-box">
                      <input
                        type="text"
                        className="os-modal-num-input"
                        value={getDisplayValue(item, 'impBanco')}
                        onChange={(e) => handleInputChange(item, 'impBanco', e.target.value)}
                        onBlur={() => void handleFieldCommit(item, 'impBanco')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          }
                        }}
                        aria-label={`Impuesto Banco de ${item.nombre}`}
                      />
                      <span className="os-modal-affix os-modal-affix--suffix">%</span>
                    </div>

                    {/* Imp. Facturación */}
                    <div className="os-modal-input-box">
                      <input
                        type="text"
                        className="os-modal-num-input"
                        value={getDisplayValue(item, 'impFactura')}
                        onChange={(e) => handleInputChange(item, 'impFactura', e.target.value)}
                        onBlur={() => void handleFieldCommit(item, 'impFactura')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          }
                        }}
                        aria-label={`Impuesto Facturación de ${item.nombre}`}
                      />
                      <span className="os-modal-affix os-modal-affix--suffix">%</span>
                    </div>

                    {/* Gastos Adm */}
                    <div className="os-modal-input-box">
                      <input
                        type="text"
                        className="os-modal-num-input"
                        value={getDisplayValue(item, 'gastosAdm')}
                        onChange={(e) => handleInputChange(item, 'gastosAdm', e.target.value)}
                        onBlur={() => void handleFieldCommit(item, 'gastosAdm')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          }
                        }}
                        aria-label={`Gastos Administrativos de ${item.nombre}`}
                      />
                      <span className="os-modal-affix os-modal-affix--suffix">%</span>
                    </div>
                  </>
                )}

                {/* Acciones */}
                <div className="os-modal-actions">
                  <button
                    type="button"
                    className="os-modal-action-btn os-modal-action-btn--suspend"
                    onClick={() => void handleToggleSuspender(item)}
                    aria-label={item.suspendida ? 'Reactivar' : 'Suspender'}
                    title={item.suspendida ? 'Reactivar' : 'Suspender'}
                  >
                    {item.suspendida ? (
                      /* Ícono de Play para Reactivar */
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        stroke="none"
                      >
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    ) : (
                      /* Ícono de Pausa para Suspender */
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        stroke="none"
                      >
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    )}
                  </button>

                  <button
                    type="button"
                    className="os-modal-action-btn os-modal-action-btn--delete"
                    onClick={() => void handleDelete(item)}
                    aria-label={
                      planesAfiliadosNombres.has(item.nombre.trim().toLowerCase())
                        ? 'Es un plan de Afiliados; suspendelo si no lo usás'
                        : 'Quitar'
                    }
                    title={
                      planesAfiliadosNombres.has(item.nombre.trim().toLowerCase())
                        ? 'Es un plan de Afiliados; suspendelo si no lo usás'
                        : 'Quitar'
                    }
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pie */}
        <footer className="os-modal-footer">
          <div className="os-modal-footer-left">
            <span className="os-modal-counter">
              {busqueda.trim()
                ? `${filteredList.length} de ${obrasSocialesCatalog.length} obras sociales`
                : `${obrasSocialesCatalog.length} obras sociales`}
            </span>
            {savedTick && (
              <span className="os-modal-saved-indicator">Guardado</span>
            )}
          </div>
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
