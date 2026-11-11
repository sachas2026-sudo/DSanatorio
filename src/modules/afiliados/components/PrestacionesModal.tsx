import { useEffect, useMemo, useState } from 'react'
import { useAppState } from '../../../context/AppStateContext'
import {
  GRUPOS_PRESTACIONES_DEFAULT,
  normalizePrestacionKey,
} from '../../../lib/prestacionesCatalog'
import { IconTrash, IconPlus } from '../../../shared/components/icons'
import '../pages/AfiliadosModern.css'

interface Props {
  onClose: () => void
  prestacionSeleccionada?: string
  onPrestacionEliminada?: (nombre: string) => void
}

export function PrestacionesModal({
  onClose,
  prestacionSeleccionada,
  onPrestacionEliminada,
}: Props) {
  const { prestacionesAfiliados, upsertPrestacionAfiliado, deletePrestacionAfiliado } = useAppState()

  const [nombre, setNombre] = useState('')
  const [grupo, setGrupo] = useState<string>(GRUPOS_PRESTACIONES_DEFAULT[0])
  const [grupoOtro, setGrupoOtro] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Cerrar con Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Grupos disponibles
  const gruposOpciones = useMemo(() => {
    const set = new Set<string>(GRUPOS_PRESTACIONES_DEFAULT)
    prestacionesAfiliados.forEach((p) => {
      if (p.grupo) set.add(p.grupo.toUpperCase())
    })
    return [...set]
  }, [prestacionesAfiliados])

  // Filtrado de prestaciones
  const filtradas = useMemo(() => {
    const q = normalizePrestacionKey(busqueda)
    if (!q) return prestacionesAfiliados
    return prestacionesAfiliados.filter(
      (p) =>
        normalizePrestacionKey(p.nombre).includes(q) ||
        normalizePrestacionKey(p.grupo).includes(q),
    )
  }, [prestacionesAfiliados, busqueda])

  // Agrupadas
  const agrupadas = useMemo(() => {
    const map = new Map<string, typeof filtradas>()
    filtradas.forEach((p) => {
      const g = p.grupo || 'PROCEDIMIENTOS Y OTROS'
      const arr = map.get(g) ?? []
      arr.push(p)
      map.set(g, arr)
    })
    return map
  }, [filtradas])

  function handleAgregar(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    const nombreNorm = nombre.trim()
    if (!nombreNorm) {
      setErrorMsg('El nombre de la prestación es obligatorio.')
      return
    }

    const grupoFinal = grupo === '__OTRO__' ? grupoOtro.trim().toUpperCase() : grupo.trim().toUpperCase()
    if (!grupoFinal) {
      setErrorMsg('Indicá el grupo o categoría de la prestación.')
      return
    }

    const res = upsertPrestacionAfiliado({
      nombre: nombreNorm,
      grupo: grupoFinal,
      activa: true,
    })

    if (!res.ok) {
      setErrorMsg(res.error || 'No se pudo agregar la prestación.')
      return
    }

    setSuccessMsg(`"${nombreNorm}" agregada correctamente.`)
    setNombre('')
    setGrupoOtro('')
    setTimeout(() => setSuccessMsg(null), 3500)
  }

  function handleQuitar(id: string, nombreP: string) {
    setErrorMsg(null)
    setSuccessMsg(null)
    const confirmed = window.confirm(`¿Quitar la prestación "${nombreP}" de la lista?`)
    if (!confirmed) return

    const res = deletePrestacionAfiliado(id)
    if (res.ok) {
      if (
        prestacionSeleccionada &&
        normalizePrestacionKey(prestacionSeleccionada) === normalizePrestacionKey(nombreP)
      ) {
        onPrestacionEliminada?.(nombreP)
      }
      setSuccessMsg(`"${nombreP}" fue quitada de la lista.`)
      setTimeout(() => setSuccessMsg(null), 3000)
    } else {
      setErrorMsg(res.error || 'No se pudo quitar la prestación.')
    }
  }

  return (
    <div
      className="af-modal-backdrop"
      style={{ zIndex: 1100 }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="af-modal af-modal-dialog"
        style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prest-modal-title"
      >
        {/* Cabecera */}
        <div className="af-modal__head" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 id="prest-modal-title" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--heading)' }}>
              Prestaciones
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {prestacionesAfiliados.length} prestación{prestacionesAfiliados.length !== 1 ? 'es' : ''} en la lista
            </span>
          </div>
          <button
            type="button"
            className="af-btn af-btn--icon"
            onClick={onClose}
            aria-label="Cerrar modal de prestaciones"
            title="Cerrar (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Mensajes de feedback */}
        {errorMsg && (
          <div style={{ margin: '0.6rem 1.2rem 0', padding: '0.45rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ margin: '0.6rem 1.2rem 0', padding: '0.45rem 0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600 }}>
            {successMsg}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Recuadro Agregar nueva prestación */}
          <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.85rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--heading)', marginBottom: '0.55rem' }}>
              Agregar nueva prestación
            </div>
            <form onSubmit={handleAgregar} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="af-input"
                  placeholder="Nombre de la prestación…"
                  value={nombre}
                  onChange={(e) => {
                    setNombre(e.target.value)
                    if (errorMsg) setErrorMsg(null)
                  }}
                  aria-label="Nombre de la prestación"
                />
                <select
                  className="af-select"
                  value={grupo}
                  onChange={(e) => {
                    setGrupo(e.target.value)
                    if (errorMsg) setErrorMsg(null)
                  }}
                  aria-label="Categoría o grupo"
                >
                  {gruposOpciones.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                  <option value="__OTRO__">+ Otro grupo nuevo…</option>
                </select>
              </div>

              {grupo === '__OTRO__' && (
                <input
                  type="text"
                  className="af-input"
                  placeholder="Escribí el nuevo grupo o categoría…"
                  value={grupoOtro}
                  onChange={(e) => setGrupoOtro(e.target.value)}
                  aria-label="Nuevo grupo"
                />
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="af-btn af-btn--primary" style={{ padding: '0.35rem 0.85rem', fontSize: '0.84rem' }}>
                  <IconPlus /> Agregar
                </button>
              </div>
            </form>
          </div>

          {/* Buscador de prestaciones */}
          <div>
            <input
              type="text"
              className="af-input"
              placeholder="Buscar prestación o categoría…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              aria-label="Buscar prestación"
              style={{ width: '100%' }}
            />
          </div>

          {/* Lista agrupada */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {agrupadas.size === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                No se encontraron prestaciones para "{busqueda}".
              </div>
            ) : (
              [...agrupadas.entries()].map(([nombreGrupo, items]) => (
                <div key={nombreGrupo} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{ background: '#f1f5f9', padding: '0.4rem 0.75rem', fontSize: '0.78rem', fontWeight: 800, color: '#334155', letterSpacing: '0.03em' }}>
                    {nombreGrupo} ({items.length})
                  </div>
                  <div style={{ background: '#ffffff' }}>
                    {items.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.45rem 0.75rem',
                          borderTop: '1px solid #f8fafc',
                          gap: '0.5rem',
                        }}
                      >
                        <span style={{ fontSize: '0.84rem', color: '#1e293b', fontWeight: 500 }}>
                          {item.nombre}
                        </span>
                        <button
                          type="button"
                          className="af-btn af-btn--icon af-btn--danger"
                          onClick={() => handleQuitar(item.id, item.nombre)}
                          aria-label={`Quitar prestación ${item.nombre}`}
                          title="Quitar de la lista"
                          style={{ padding: '0.2rem' }}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="af-modal__foot" style={{ borderTop: '1px solid var(--border)', justifyContent: 'flex-end' }}>
          <button type="button" className="af-btn af-btn--primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
