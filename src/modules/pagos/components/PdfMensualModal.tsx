import { useState, useMemo } from 'react'
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns'
import type { Appointment, Doctor, Payment } from '../../../types'

interface PdfMensualModalProps {
  title?: string
  subtitle?: string
  doctors: Doctor[]
  payments: Payment[]
  appointments?: Appointment[]
  emptyCheckMode?: 'pagos' | 'turnos'
  onClose: () => void
  onGenerate: (anioMes: string, doctorId: string) => void
}

export function PdfMensualModal({
  title = 'PDF Mensual',
  subtitle,
  doctors,
  payments,
  appointments = [],
  emptyCheckMode = 'pagos',
  onClose,
  onGenerate,
}: PdfMensualModalProps) {
  // Mes actual por defecto (YYYY-MM)
  const defaultMes = useMemo(() => format(new Date(), 'yyyy-MM'), [])
  const [mes, setMes] = useState(defaultMes)
  const [doctorId, setDoctorId] = useState('todos')
  const [errorAviso, setErrorAviso] = useState<string | null>(null)

  // Lista de médicos ordenados alfabéticamente
  const medicosOrdenados = useMemo(() => {
    return [...doctors].sort((a, b) =>
      `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
        sensitivity: 'base',
      }),
    )
  }, [doctors])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorAviso(null)

    if (!mes) {
      setErrorAviso('Por favor seleccioná un mes.')
      return
    }

    const [y, m] = mes.split('-').map(Number)
    const refDate = new Date(y ?? 2026, (m ?? 1) - 1, 1, 12, 0, 0)
    const start = startOfMonth(refDate)
    const end = endOfMonth(refDate)

    if (emptyCheckMode === 'turnos') {
      const tieneTurnos = appointments.some((a) => {
        if (!a.fechaHora || a.estado === 'cancelado') return false
        const d = parseISO(a.fechaHora)
        if (!isWithinInterval(d, { start, end })) return false
        if (doctorId !== 'todos' && a.doctorId !== doctorId) return false
        return true
      })

      if (!tieneTurnos) {
        setErrorAviso('No hay turnos en el mes elegido')
        return
      }
    } else {
      const tienePagos = payments.some((p) => {
        if (!p.fecha) return false
        const d = parseISO(p.fecha)
        if (!isWithinInterval(d, { start, end })) return false
        if (doctorId !== 'todos' && p.doctorId !== doctorId) return false
        return Number(p.monto) > 0
      })

      if (!tienePagos) {
        setErrorAviso('No hay pagos en el mes elegido')
        return
      }
    }

    onGenerate(mes, doctorId)
  }

  return (
    <div
      className="pendientes-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(2px)',
      }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="panel"
        style={{
          width: '90%',
          maxWidth: '420px',
          backgroundColor: '#fff',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-mensual-title"
      >
        <header style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
          <h3
            id="pdf-mensual-title"
            style={{
              margin: 0,
              fontSize: '1.15rem',
              fontWeight: 700,
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2f6fe4"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            {title}
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            {subtitle ??
              (title === 'PDF Mensual B'
                ? 'Generá el detalle turno por turno del mes en PDF.'
                : 'Generá el Dashboard ejecutivo y Resumen del mes en PDF.')}
          </p>
        </header>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label
              htmlFor="pdf-mensual-mes"
              style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}
            >
              Mes
            </label>
            <input
              id="pdf-mensual-mes"
              type="month"
              value={mes}
              onChange={(e) => {
                setMes(e.target.value)
                setErrorAviso(null)
              }}
              required
              style={{
                height: '38px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                color: '#1e293b',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label
              htmlFor="pdf-mensual-medico"
              style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}
            >
              Médico
            </label>
            <select
              id="pdf-mensual-medico"
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value)
                setErrorAviso(null)
              }}
              style={{
                height: '38px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                color: '#1e293b',
                outline: 'none',
                backgroundColor: '#fff',
              }}
            >
              <option value="todos">Todos los médicos</option>
              {medicosOrdenados.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.apellido}, {d.nombre} ({d.especialidad || 'General'})
                </option>
              ))}
            </select>
          </div>

          {errorAviso && (
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecdd3',
                borderRadius: '6px',
                color: '#b91c1c',
                fontSize: '0.82rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{errorAviso}</span>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '0.5rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#fff',
                color: '#475569',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              style={{
                height: '36px',
                padding: '0 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#2f6fe4',
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 4px rgba(47, 111, 228, 0.25)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Generar PDF
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

