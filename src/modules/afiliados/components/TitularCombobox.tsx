import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Patient } from '../../../types'
import {
  extraerInicialesPaciente,
  filtrarPacientes,
  moverIndiceResaltado,
  precargarDatosPacienteNuevo,
  resaltarCoincidencias,
} from '../titularSearch'

export interface TitularComboboxProps {
  id?: string
  pacientesDisponibles: readonly Patient[]
  motivosNoElegible?: ReadonlyMap<string, string>
  selectedPatientId: string
  onSelectPatient: (patientId: string) => void
  onSelectNuevoPaciente: (prefill: {
    texto: string
    dni: string
    apellido: string
    nombre: string
  }) => void
  placeholder?: string
}

export function TitularCombobox({
  id = 'af-fil-paciente',
  pacientesDisponibles,
  motivosNoElegible,
  selectedPatientId,
  onSelectPatient,
  onSelectNuevoPaciente,
  placeholder = 'Buscar por nombre o DNI…',
}: TitularComboboxProps) {
  const uid = useId()
  const listboxId = `${id}-listbox-${uid}`
  const optionNuevoId = `${id}-opt-nuevo`

  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [noElegibleAviso, setNoElegibleAviso] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const selectedPatient = useMemo(() => {
    if (!selectedPatientId || selectedPatientId === '__nuevo__') return null
    return pacientesDisponibles.find((p) => p.id === selectedPatientId) ?? null
  }, [pacientesDisponibles, selectedPatientId])

  const filtrados = useMemo(
    () => filtrarPacientes(pacientesDisponibles, query, 50),
    [pacientesDisponibles, query],
  )

  // Total de opciones navegables: 1 ("+ Cargar paciente nuevo") + filtrados.length
  const totalOpciones = 1 + filtrados.length

  // Mantener highlightedIndex dentro de rango cuando cambia el filtro
  useEffect(() => {
    setHighlightedIndex(0)
  }, [query])

  // Cerrar al hacer click afuera
  useEffect(() => {
    if (!isOpen) return
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [isOpen])

  // Hacer scroll automático a la opción resaltada
  useEffect(() => {
    if (!isOpen || !listRef.current) return
    const activeId =
      highlightedIndex === 0
        ? optionNuevoId
        : `${id}-opt-${filtrados[highlightedIndex - 1]?.id ?? ''}`
    const el = listRef.current.querySelector<HTMLElement>(`[id="${CSS.escape(activeId)}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex, isOpen, filtrados, id, optionNuevoId])

  const activeDescendantId = useMemo(() => {
    if (!isOpen) return undefined
    if (highlightedIndex === 0) return optionNuevoId
    const p = filtrados[highlightedIndex - 1]
    return p ? `${id}-opt-${p.id}` : optionNuevoId
  }, [isOpen, highlightedIndex, filtrados, id, optionNuevoId])

  const elegirNuevoPaciente = () => {
    setNoElegibleAviso(null)
    const prefill = precargarDatosPacienteNuevo(query)
    setIsOpen(false)
    onSelectNuevoPaciente({
      texto: query.trim(),
      ...prefill,
    })
  }

  const elegirPaciente = (p: Patient) => {
    const motivo = motivosNoElegible?.get(p.id)
    if (motivo) {
      const nombreCompleto = `${p.apellido}, ${p.nombre}`.replace(/^,\s*/, '').trim()
      setNoElegibleAviso(`${nombreCompleto} no se puede elegir porque ${motivo.toLowerCase()}.`)
      return
    }
    setNoElegibleAviso(null)
    setIsOpen(false)
    setQuery('')
    onSelectPatient(p.id)
  }

  const limpiarSeleccion = () => {
    setNoElegibleAviso(null)
    onSelectPatient('')
    setQuery('')
    setHighlightedIndex(0)
    setIsOpen(true)
    setTimeout(() => {
      inputRef.current?.focus()
    }, 20)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        setHighlightedIndex(0)
      } else {
        setHighlightedIndex((idx) => moverIndiceResaltado(idx, 1, totalOpciones))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        setHighlightedIndex(0)
      } else {
        setHighlightedIndex((idx) => moverIndiceResaltado(idx, -1, totalOpciones))
      }
    } else if (e.key === 'Enter') {
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      e.preventDefault()
      if (highlightedIndex === 0) {
        elegirNuevoPaciente()
      } else {
        const target = filtrados[highlightedIndex - 1]
        if (target) {
          elegirPaciente(target)
        }
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(false)
      }
    } else if (e.key === 'Tab') {
      setIsOpen(false)
    }
  }

  const renderHighlightedText = (text: string) => {
    const segments = resaltarCoincidencias(text, query)
    return segments.map((seg, i) =>
      seg.match ? (
        <mark
          key={i}
          style={{
            background: '#FFF1B8',
            color: '#1F2A44',
            padding: '0 1px',
            borderRadius: '2px',
            fontWeight: 700,
          }}
        >
          {seg.text}
        </mark>
      ) : (
        <React.Fragment key={i}>{seg.text}</React.Fragment>
      ),
    )
  }

  // Si hay un paciente existente elegido, mostrar pastilla celeste con "✕"
  if (selectedPatient) {
    const nombreCompleto = `${selectedPatient.apellido}, ${selectedPatient.nombre}`.replace(/^,\s*/, '').trim()
    return (
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '0.5rem 0.75rem',
          borderRadius: '9px',
          background: '#EAF1FF',
          border: '1.5px solid #0E8FAD',
          color: '#1F2A44',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1F2A44' }}>
          {nombreCompleto} · DNI {selectedPatient.dni || '—'}
        </span>
        <button
          type="button"
          onClick={limpiarSeleccion}
          aria-label="Quitar paciente elegido y volver a buscar"
          title="Quitar titular y buscar otro"
          style={{
            border: 'none',
            background: 'rgba(14, 143, 173, 0.14)',
            color: '#0E8FAD',
            borderRadius: '6px',
            width: '24px',
            height: '24px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.82rem',
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
    )
  }

  const trimmedQuery = query.trim()

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Campo de texto con lupa */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.42rem 0.7rem',
          borderRadius: '9px',
          background: '#ffffff',
          border: isFocused || isOpen ? '1.5px solid #0E8FAD' : '1px solid #cbd5e1',
          boxShadow:
            isFocused || isOpen ? '0 0 0 3px rgba(14, 143, 173, 0.14)' : 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={isFocused || isOpen ? '#0E8FAD' : '#52606D'}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendantId}
          value={query}
          placeholder={placeholder}
          onFocus={() => {
            setIsFocused(true)
            setIsOpen(true)
          }}
          onBlur={() => {
            setIsFocused(false)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            if (noElegibleAviso) setNoElegibleAviso(null)
            if (!isOpen) setIsOpen(true)
          }}
          onKeyDown={handleKeyDown}
          style={{
            border: 'none',
            outline: 'none',
            width: '100%',
            fontSize: '0.88rem',
            color: '#1F2A44',
            background: 'transparent',
          }}
        />
        {query && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('')
              setHighlightedIndex(0)
              inputRef.current?.focus()
            }}
            aria-label="Limpiar búsqueda"
            style={{
              border: 'none',
              background: 'transparent',
              color: '#52606D',
              cursor: 'pointer',
              fontSize: '0.8rem',
              padding: '0 0.2rem',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Lista desplegable */}
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Opciones de contratante titular"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.14), 0 4px 10px -2px rgba(15, 23, 42, 0.08)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 1. PRIMERA FILA SIEMPRE FIJA ARRIBA: "+ Cargar paciente nuevo" */}
          <div
            id={optionNuevoId}
            role="option"
            aria-selected={highlightedIndex === 0}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHighlightedIndex(0)}
            onClick={elegirNuevoPaciente}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              padding: '0.55rem 0.75rem',
              cursor: 'pointer',
              background: highlightedIndex === 0 ? '#E6F4F8' : '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              flexShrink: 0,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                background: '#0E8FAD',
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '1.05rem',
                flexShrink: 0,
              }}
            >
              +
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  color: '#0E8FAD',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {trimmedQuery
                  ? `+ Cargar paciente nuevo: "${trimmedQuery}"`
                  : '+ Cargar paciente nuevo'}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#52606D' }}>
                ¿No está en la lista? Se abre el alta de paciente
              </div>
            </div>
          </div>

          {/* 2. Cuerpo desplazable de pacientes (~260px máx) */}
          <div
            ref={listRef}
            style={{
              maxHeight: '215px',
              overflowY: 'auto',
            }}
          >
            {filtrados.length === 0 ? (
              <div
                style={{
                  padding: '0.75rem 0.85rem',
                  fontSize: '0.83rem',
                  color: '#52606D',
                }}
              >
                Sin resultados para &ldquo;{trimmedQuery}&rdquo;
              </div>
            ) : (
              filtrados.map((p, index) => {
                const optionIdx = index + 1
                const isHighlighted = highlightedIndex === optionIdx
                const nombreCompleto = `${p.apellido}, ${p.nombre}`.replace(/^,\s*/, '').trim()
                const coberturaLabel = (p.obraSocial || '').trim() || 'Particular'
                const motivoNoElegible = motivosNoElegible?.get(p.id)
                const isIneligible = Boolean(motivoNoElegible)
                return (
                  <div
                    key={p.id}
                    id={`${id}-opt-${p.id}`}
                    role="option"
                    aria-selected={isHighlighted}
                    aria-disabled={isIneligible || undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(optionIdx)}
                    onClick={() => elegirPaciente(p)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      padding: '0.5rem 0.75rem',
                      cursor: isIneligible ? 'not-allowed' : 'pointer',
                      background: isHighlighted
                        ? isIneligible
                          ? '#f8fafc'
                          : '#EAF1FF'
                        : '#ffffff',
                      borderBottom: '1px solid #f1f5f9',
                      opacity: isIneligible ? 0.78 : 1,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: '30px',
                        height: '30px',
                        borderRadius: '50%',
                        background: isIneligible ? '#f1f5f9' : '#E6F4F8',
                        color: isIneligible ? '#64748b' : '#0E8FAD',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                        flexShrink: 0,
                      }}
                    >
                      {extraerInicialesPaciente(p)}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.4rem',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: '0.86rem',
                            color: '#1F2A44',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {renderHighlightedText(nombreCompleto)}
                        </div>
                        {motivoNoElegible && (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '0.1rem 0.45rem',
                              borderRadius: '999px',
                              background: '#fef3c7',
                              color: '#92400e',
                              border: '1px solid #fde68a',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}
                          >
                            {motivoNoElegible}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#52606D' }}>
                        DNI {renderHighlightedText(String(p.dni || '—'))} · {coberturaLabel}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* 3. Pie chico de la lista */}
          <div
            style={{
              padding: '0.38rem 0.75rem',
              background: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              fontSize: '0.71rem',
              color: '#52606D',
              flexShrink: 0,
            }}
          >
            {filtrados.length} {filtrados.length === 1 ? 'paciente' : 'pacientes'} · ↑ ↓ para moverte · Enter para elegir · Esc para cerrar
          </div>
        </div>
      )}
      {noElegibleAviso && (
        <div
          role="alert"
          style={{
            marginTop: '0.32rem',
            padding: '0.35rem 0.6rem',
            borderRadius: '7px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: '0.76rem',
            fontWeight: 600,
          }}
        >
          {noElegibleAviso}
        </div>
      )}
    </div>
  )
}

