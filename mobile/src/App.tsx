import { useEffect, useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  fetchResumenDiario,
  fetchAvailableDates,
  fetchMonthRows,
  getStoredSupabaseConfig,
  saveStoredSupabaseConfig,
  type FechaResumenItem,
} from './supabase'
import type { ResumenDiario, SupabaseConfig, MedicoResumenItem } from './types'
import './App.css'
import logoImg from './assets/Logo.jpeg'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount || 0)
}

type TabView = 'dia' | 'mes' | 'historial'

export function App() {
  const [activeTab, setActiveTab] = useState<TabView>('dia')
  const [fecha, setFecha] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [config, setConfig] = useState<SupabaseConfig>(getStoredSupabaseConfig)
  const [resumen, setResumen] = useState<ResumenDiario | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Lista de fechas con actividad
  const [availableDates, setAvailableDates] = useState<FechaResumenItem[]>([])

  // Datos para vista mensual
  const [selectedMes, setSelectedMes] = useState('2026-07')
  const [monthRows, setMonthRows] = useState<ResumenDiario[]>([])
  const [loadingMonth, setLoadingMonth] = useState(false)

  // Config temporal para el modal
  const [tempUrl, setTempUrl] = useState(config.url)
  const [tempKey, setTempKey] = useState(config.anonKey)

  const isToday = fecha === format(new Date(), 'yyyy-MM-dd')

  // Cargar fechas disponibles
  const loadDates = async () => {
    const list = await fetchAvailableDates(config)
    if (list && list.length > 0) {
      setAvailableDates(list)
    }
  }

  // Cargar datos del día
  const loadData = async (targetFecha: string) => {
    setLoading(true)
    setErrorMsg(null)
    const res = await fetchResumenDiario(targetFecha, config)
    setLoading(false)

    if (res.data) {
      setResumen(res.data)
      setFromCache(res.fromCache || false)
    } else {
      setResumen(null)
    }

    if (res.error) {
      setErrorMsg(res.error)
    }
  }

  // Cargar datos del mes
  const loadMonthData = async (mesStr: string) => {
    setLoadingMonth(true)
    const rows = await fetchMonthRows(mesStr, config)
    setLoadingMonth(false)
    setMonthRows(rows)
  }

  useEffect(() => {
    void loadDates()
  }, [config])

  useEffect(() => {
    if (activeTab === 'dia') {
      void loadData(fecha)
    } else if (activeTab === 'mes') {
      void loadMonthData(selectedMes)
    }
  }, [fecha, activeTab, selectedMes, config])

  // Navegación inteligente de fechas entre las que tienen datos
  const currentIndex = availableDates.findIndex((d) => d.fecha === fecha)

  const handlePrevAvailableDay = () => {
    if (currentIndex >= 0 && currentIndex < availableDates.length - 1) {
      setFecha(availableDates[currentIndex + 1].fecha)
    } else if (availableDates.length > 0) {
      // ir al primer día anterior disponible
      const prev = availableDates.find((d) => d.fecha < fecha)
      if (prev) setFecha(prev.fecha)
    }
  }

  const handleNextAvailableDay = () => {
    if (currentIndex > 0) {
      setFecha(availableDates[currentIndex - 1].fecha)
    } else if (availableDates.length > 0) {
      const next = [...availableDates].reverse().find((d) => d.fecha > fecha)
      if (next) setFecha(next.fecha)
    }
  }

  const handleSaveSettings = () => {
    const newCfg: SupabaseConfig = {
      url: tempUrl.trim(),
      anonKey: tempKey.trim(),
    }
    setConfig(newCfg)
    saveStoredSupabaseConfig(newCfg)
    setShowSettings(false)
  }

  // Métricas acumuladas del mes
  const monthSummary = useMemo(() => {
    let cobrado = 0, centro = 0, medicos = 0, efectivo = 0, transf = 0, turnos = 0, atendidos = 0
    const medMap = new Map<string, { nombre: string; especialidad?: string; pacientes: number; cobrado: number; centro: number; medico: number }>()

    for (const r of monthRows) {
      cobrado += Number(r.total_cobrado) || 0
      centro += Number(r.total_centro) || 0
      medicos += Number(r.total_medicos) || 0
      efectivo += Number(r.total_efectivo) || 0
      transf += Number(r.total_transferencia) || 0
      turnos += Number(r.turnos_totales) || 0
      atendidos += Number(r.turnos_atendidos) || 0

      for (const m of (r.medicos_detalle || [])) {
        const item = medMap.get(m.id || m.nombre) || {
          nombre: m.nombre,
          especialidad: m.especialidad,
          pacientes: 0,
          cobrado: 0,
          centro: 0,
          medico: 0,
        }
        item.pacientes += Number(m.pacientes) || 0
        item.cobrado += Number(m.totalCobrado) || 0
        item.centro += Number(m.totalCentro) || 0
        item.medico += Number(m.totalMedico) || 0
        medMap.set(m.id || m.nombre, item)
      }
    }

    const medicosList = Array.from(medMap.values()).sort((a, b) => b.cobrado - a.cobrado)

    return {
      cobrado,
      centro,
      medicos,
      efectivo,
      transf,
      turnos,
      atendidos,
      medicosList,
      diasConActividad: monthRows.length,
    }
  }, [monthRows])

  // Porcentajes día
  const total = resumen?.total_cobrado || 0
  const centro = resumen?.total_centro || 0
  const medicos = resumen?.total_medicos || 0
  const pctCentro = total > 0 ? Math.round((centro / total) * 100) : 0
  const pctMedicos = total > 0 ? Math.round((medicos / total) * 100) : 0

  const fechaLabel = (() => {
    try {
      return format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })
    } catch {
      return fecha
    }
  })()

  // Meses disponibles a partir de las fechas
  const mesesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const d of availableDates) {
      if (d.fecha) set.add(d.fecha.slice(0, 7))
    }
    return Array.from(set).sort().reverse()
  }, [availableDates])

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="header-top">
          <div className="header-brand">
            <img src={logoImg} alt="Logo" className="header-logo" />
            <div className="brand-text">
              <h1>CUIDAR</h1>
              <span>Panel Gerencial</span>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                void loadDates()
                if (activeTab === 'dia') void loadData(fecha)
                else if (activeTab === 'mes') void loadMonthData(selectedMes)
              }}
              disabled={loading || loadingMonth}
              title="Refrescar datos"
            >
              <svg
                className={loading || loadingMonth ? 'spin' : ''}
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>

            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setTempUrl(config.url)
                setTempKey(config.anonKey)
                setShowSettings(true)
              }}
              title="Configuración de conexión"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>

        {/* TABS DE VISTA: DÍA / MES / HISTORIAL */}
        <div className="view-tabs">
          <button
            type="button"
            className={`view-tab ${activeTab === 'dia' ? 'active' : ''}`}
            onClick={() => setActiveTab('dia')}
          >
            📅 Resumen del Día
          </button>
          <button
            type="button"
            className={`view-tab ${activeTab === 'mes' ? 'active' : ''}`}
            onClick={() => setActiveTab('mes')}
          >
            📊 Acumulado Mensual
          </button>
          <button
            type="button"
            className={`view-tab ${activeTab === 'historial' ? 'active' : ''}`}
            onClick={() => setActiveTab('historial')}
          >
            📋 Todos los Días
          </button>
        </div>

        {/* NAVEGADOR DE FECHA (SOLO EN TAB DÍA) */}
        {activeTab === 'dia' && (
          <>
            <div className="date-nav">
              <button
                type="button"
                className="date-nav-btn"
                onClick={handlePrevAvailableDay}
                title="Día anterior con movimientos"
              >
                ◀
              </button>
              <div className="date-display">
                <span style={{ textTransform: 'capitalize' }}>{fechaLabel}</span>
                {isToday && <span className="today-badge">Hoy</span>}
                <input
                  type="date"
                  className="hidden-date-input"
                  value={fecha}
                  onChange={(e) => e.target.value && setFecha(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="date-nav-btn"
                onClick={handleNextAvailableDay}
                title="Día siguiente con movimientos"
              >
                ▶
              </button>
            </div>

            <div
              className="quick-dates-pill"
              onClick={() => setActiveTab('historial')}
            >
              <span>📋 Ver historial ({availableDates.length} días con actividad)</span>
            </div>
          </>
        )}

        {/* SELECTOR DE MES (SOLO EN TAB MES) */}
        {activeTab === 'mes' && (
          <div className="date-nav" style={{ justifyContent: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '0.92rem' }}>
              Mes Seleccionado:
            </span>
            <select
              value={selectedMes}
              onChange={(e) => setSelectedMes(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                fontWeight: 700,
                fontSize: '0.9rem',
                background: '#ffffff',
                color: 'var(--text-main)',
              }}
            >
              {mesesDisponibles.map((m) => {
                const label = (() => {
                  try {
                    return format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es })
                  } catch {
                    return m
                  }
                })()
                return (
                  <option key={m} value={m}>
                    {label.toUpperCase()}
                  </option>
                )
              })}
            </select>
          </div>
        )}
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="main-content">
        {errorMsg && (
          <div className={`status-banner ${fromCache ? 'warning' : 'error'}`}>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ======================================================== */}
        {/* VISTA 1: RESUMEN DEL DÍA                                 */}
        {/* ======================================================== */}
        {activeTab === 'dia' && (
          <>
            {!resumen && !loading && (
              <div className="card" style={{ textAlign: 'center', padding: '32px 16px' }}>
                <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                  No se encontraron registros para el día {fecha}.
                </p>
                {availableDates.length > 0 && (
                  <button
                    type="button"
                    className="modal-btn"
                    style={{ marginTop: '14px', width: 'auto', padding: '10px 20px' }}
                    onClick={() => setActiveTab('historial')}
                  >
                    Ver días con recaudación
                  </button>
                )}
              </div>
            )}

            {resumen && (
              <>
                {/* TARJETA 1: TOTAL RECAUDADO */}
                <div className="card total-card">
                  <div className="card-title">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="1" x2="12" y2="23" />
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                    <span>Recaudación del Día</span>
                  </div>
                  <div className="big-amount">{formatMoney(resumen.total_cobrado)}</div>
                  <div className="total-split">
                    <div className="split-col">
                      <span>Centro Cuidar</span>
                      <strong>{formatMoney(resumen.total_centro)}</strong>
                      <small>{pctCentro}%</small>
                    </div>
                    <div className="split-col">
                      <span>Médicos</span>
                      <strong>{formatMoney(resumen.total_medicos)}</strong>
                      <small>{pctMedicos}%</small>
                    </div>
                  </div>
                </div>

                {/* TARJETA 2: RECAUDACIÓN POR TURNO */}
                <div className="card">
                  <div className="card-title">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>Recaudación por Turno</span>
                  </div>
                  <div className="metrics-grid-2">
                    <div className="metric-box">
                      <div className="label">
                        <span>☀️ Turno Mañana</span>
                      </div>
                      <div className="value">{formatMoney(resumen.recaudacion_manana)}</div>
                      <div className="subtext">
                        Mary: {formatMoney(resumen.recaudacion_mary || resumen.recaudacion_manana)}
                      </div>
                    </div>

                    <div className="metric-box">
                      <div className="label">
                        <span>🌙 Turno Tarde</span>
                      </div>
                      <div className="value">{formatMoney(resumen.recaudacion_tarde)}</div>
                      <div className="subtext">
                        Andrea: {formatMoney(resumen.recaudacion_andrea || resumen.recaudacion_tarde)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* TARJETA 3: FORMAS DE PAGO */}
                <div className="card">
                  <div className="card-title">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <line x1="2" y1="10" x2="22" y2="10" />
                    </svg>
                    <span>Formas de Pago</span>
                  </div>
                  <div className="payments-list">
                    <div className="payment-row">
                      <div className="payment-name">
                        <span>💵</span>
                        <span>Efectivo</span>
                      </div>
                      <div className="payment-amount">{formatMoney(resumen.total_efectivo)}</div>
                    </div>
                    <div className="payment-row">
                      <div className="payment-name">
                        <span>📲</span>
                        <span>Transferencias</span>
                      </div>
                      <div className="payment-amount">{formatMoney(resumen.total_transferencia)}</div>
                    </div>
                    {resumen.total_otros > 0 && (
                      <div className="payment-row">
                        <div className="payment-name">
                          <span>💳</span>
                          <span>Otros (Tarjetas/Débito)</span>
                        </div>
                        <div className="payment-amount">{formatMoney(resumen.total_otros)}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* TARJETA 4: TURNOS DEL DÍA */}
                <div className="card">
                  <div className="card-title">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>Turnos del Día</span>
                  </div>
                  <div className="turnos-stats-grid">
                    <div className="turno-stat-item">
                      <div className="turno-stat-num">{resumen.turnos_totales}</div>
                      <div className="turno-stat-lbl">Totales</div>
                    </div>
                    <div className="turno-stat-item atendido">
                      <div className="turno-stat-num">{resumen.turnos_atendidos}</div>
                      <div className="turno-stat-lbl">Atendidos</div>
                    </div>
                    <div className="turno-stat-item pendiente">
                      <div className="turno-stat-num">{resumen.turnos_pendientes}</div>
                      <div className="turno-stat-lbl">Pendientes</div>
                    </div>
                    <div className="turno-stat-item cancelado">
                      <div className="turno-stat-num">{resumen.turnos_cancelados}</div>
                      <div className="turno-stat-lbl">Cancelados</div>
                    </div>
                  </div>
                </div>

                {/* TARJETA 5: RENDICIÓN POR MÉDICO */}
                <div className="card">
                  <div className="card-title" style={{ justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
                        <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4" />
                        <circle cx="20" cy="10" r="2" />
                      </svg>
                      <span>Rendición por Médico</span>
                    </div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                      {resumen.medicos_detalle?.length || 0} médicos
                    </span>
                  </div>

                  <div className="medicos-list">
                    {(!resumen.medicos_detalle || resumen.medicos_detalle.length === 0) && (
                      <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
                        Sin atenciones médicas registradas este día.
                      </p>
                    )}

                    {resumen.medicos_detalle?.map((med) => (
                      <div key={med.id || med.nombre} className="medico-card">
                        <div className="medico-header">
                          <div>
                            <div className="medico-name">{med.nombre}</div>
                            {med.especialidad && <div className="medico-spec">{med.especialidad}</div>}
                          </div>
                          <div className="medico-pacientes-badge">{med.pacientes} pac.</div>
                        </div>
                        <div className="medico-numbers">
                          <div className="medico-num-item">
                            <span>Total Facturado</span>
                            <strong>{formatMoney(med.totalCobrado)}</strong>
                          </div>
                          <div className="medico-num-item">
                            <span>Centro Cuidar</span>
                            <strong>{formatMoney(med.totalCentro)}</strong>
                          </div>
                          <div className="medico-num-item highlight">
                            <span>Honorarios Méd.</span>
                            <strong>{formatMoney(med.totalMedico)}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="last-sync-footer">
                  Última actualización sincronizada:{' '}
                  {resumen.ultima_actualizacion
                    ? format(parseISO(resumen.ultima_actualizacion), 'dd/MM/yyyy HH:mm:ss')
                    : 'Recién'}
                </div>
              </>
            )}
          </>
        )}

        {/* ======================================================== */}
        {/* VISTA 2: ACUMULADO MENSUAL                               */}
        {/* ======================================================== */}
        {activeTab === 'mes' && (
          <>
            <div className="card total-card">
              <div className="card-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                <span>Total Acumulado del Mes</span>
              </div>
              <div className="big-amount">{formatMoney(monthSummary.cobrado)}</div>
              <div className="total-split">
                <div className="split-col">
                  <span>Total Centro</span>
                  <strong>{formatMoney(monthSummary.centro)}</strong>
                  <small>
                    {monthSummary.cobrado > 0
                      ? Math.round((monthSummary.centro / monthSummary.cobrado) * 100)
                      : 0}
                    %
                  </small>
                </div>
                <div className="split-col">
                  <span>Total Médicos</span>
                  <strong>{formatMoney(monthSummary.medicos)}</strong>
                  <small>
                    {monthSummary.cobrado > 0
                      ? Math.round((monthSummary.medicos / monthSummary.cobrado) * 100)
                      : 0}
                    %
                  </small>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">
                <span>Resumen del Mes</span>
              </div>
              <div className="metrics-grid-2">
                <div className="metric-box">
                  <div className="label">💵 Efectivo Acumulado</div>
                  <div className="value">{formatMoney(monthSummary.efectivo)}</div>
                </div>
                <div className="metric-box">
                  <div className="label">📲 Transferencias</div>
                  <div className="value">{formatMoney(monthSummary.transf)}</div>
                </div>
                <div className="metric-box">
                  <div className="label">👥 Turnos Atendidos</div>
                  <div className="value">{monthSummary.atendidos}</div>
                </div>
                <div className="metric-box">
                  <div className="label">📅 Días con Actividad</div>
                  <div className="value">{monthSummary.diasConActividad} días</div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title" style={{ justifyContent: 'space-between' }}>
                <span>Ranking de Médicos del Mes</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                  {monthSummary.medicosList.length} médicos
                </span>
              </div>

              <div className="medicos-list">
                {monthSummary.medicosList.map((med) => (
                  <div key={med.nombre} className="medico-card">
                    <div className="medico-header">
                      <div>
                        <div className="medico-name">{med.nombre}</div>
                        {med.especialidad && <div className="medico-spec">{med.especialidad}</div>}
                      </div>
                      <div className="medico-pacientes-badge">{med.pacientes} pac.</div>
                    </div>
                    <div className="medico-numbers">
                      <div className="medico-num-item">
                        <span>Facturado Mes</span>
                        <strong>{formatMoney(med.cobrado)}</strong>
                      </div>
                      <div className="medico-num-item">
                        <span>Centro</span>
                        <strong>{formatMoney(med.centro)}</strong>
                      </div>
                      <div className="medico-num-item highlight">
                        <span>Honorarios</span>
                        <strong>{formatMoney(med.medico)}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ======================================================== */}
        {/* VISTA 3: HISTORIAL DE TODOS LOS DÍAS                     */}
        {/* ======================================================== */}
        {activeTab === 'historial' && (
          <div className="historial-list">
            <div style={{ padding: '0 4px', fontSize: '0.84rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              Tocá cualquier fecha para abrir su balance detallado:
            </div>
            {availableDates.map((item) => {
              const label = (() => {
                try {
                  return format(parseISO(item.fecha), "EEEE d 'de' MMMM yyyy", { locale: es })
                } catch {
                  return item.fecha
                }
              })()

              return (
                <div
                  key={item.fecha}
                  className="historial-card"
                  onClick={() => {
                    setFecha(item.fecha)
                    setActiveTab('dia')
                  }}
                >
                  <div className="historial-date-info">
                    <strong>{label}</strong>
                    <span>{item.fecha}</span>
                  </div>
                  <div className="historial-amount">{formatMoney(item.total_cobrado)}</div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* MODAL DE CONFIGURACIÓN SUPABASE */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Ajustes de Conexión</h2>
              <button type="button" className="close-btn" onClick={() => setShowSettings(false)}>
                ✕
              </button>
            </div>

            <div className="form-group">
              <label>Project URL de Supabase</label>
              <input
                type="text"
                placeholder="https://xxxxxxxx.supabase.co"
                value={tempUrl}
                onChange={(e) => setTempUrl(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Anon Public Key</label>
              <input
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
              />
            </div>

            <button type="button" className="modal-btn" onClick={handleSaveSettings}>
              Guardar y Conectar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
export default App
