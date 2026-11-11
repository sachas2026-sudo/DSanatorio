import { useEffect, useState, useMemo, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { format, parseISO, subDays, subMonths, startOfWeek, addDays } from 'date-fns'
import {
  fetchResumenDiario,
  fetchAvailableDates,
  fetchRecentRows,
  fetchMonthRows,
  fetchAgendaMedicosMap,
  normalizeResumenRow,
  fetchMedicosActivosCount,
  fetchMedicosDirectorio,
  getCachedMedicosDirectorio,
  getStoredSupabaseConfig,
  saveStoredSupabaseConfig,
  getStoredSession,
  saveStoredSession,
  loginWithEmail,
  logoutUser,
  clearLocalCache,
  type UserSession,
  type FechaResumenItem,
} from './supabase'
import type { MedicoDirectorio, ResumenDiario, SupabaseConfig, TurnosClasificacion } from './types'
import { formatDoctorName, getDoctorInitials } from './formatUtils'
import logoCuidar from './assets/Logo.jpeg'
import './App.css'


function adjustPercentages(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0)
  const rawPcts = counts.map((c) => Math.round((c / total) * 100))
  const sum = rawPcts.reduce((a, b) => a + b, 0)
  const diff = 100 - sum
  if (diff !== 0 && counts.some((c) => c > 0)) {
    let maxIdx = 0
    for (let i = 1; i < counts.length; i++) {
      if (counts[i] > counts[maxIdx]) maxIdx = i
    }
    rawPcts[maxIdx] += diff
  }
  return rawPcts
}

function extractClasificacion(r: ResumenDiario | null | undefined): TurnosClasificacion | undefined {
  if (!r) return undefined
  if (r.turnos_clasificacion && typeof r.turnos_clasificacion === 'object' && Object.keys(r.turnos_clasificacion).length > 0) {
    if (r.turnos_clasificacion.atendidos || r.turnos_clasificacion.pendientes || r.turnos_clasificacion.cancelados) {
      return r.turnos_clasificacion
    }
  }
  if (r.origen && typeof r.origen === 'string' && r.origen.includes('|{')) {
    try {
      const idx = r.origen.indexOf('|{')
      const json = JSON.parse(r.origen.slice(idx + 1))
      if (json.atendidos || json.pendientes || json.cancelados) {
        return json as TurnosClasificacion
      }
    } catch {}
  }
  return undefined
}

function formatMoney(amount: number): string {
  const rounded = Math.round(amount || 0)
  const formatted = new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 0,
  }).format(rounded)
  return `$ ${formatted}`
}

type PeriodoTab = 'hoy' | 'ayer' | 'semana' | 'mes' | 'dia'
type SeccionTab = 'pagos' | 'turno' | 'turnos' | 'medicos'

const PERIODOS: PeriodoTab[] = ['hoy', 'ayer', 'semana', 'mes']

// Zona horaria America/Argentina/Buenos_Aires
function getFechaArgentinaNow(): Date {
  const now = new Date()
  const argStr = now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
  return new Date(argStr)
}

function formatFechaArg(d: Date, formato: 'dia' | 'semana' | 'mes'): string {
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const day = String(d.getDate()).padStart(2, '0')
  const mes = meses[d.getMonth()]
  const year = d.getFullYear()
  if (formato === 'dia') return `${day}-${mes}-${year}`
  if (formato === 'mes') return `${mes}-${year}`
  return `${day}-${mes}`
}

const AVATAR_PALETTES = [
  { bg: '#E0F2FE', color: '#0369A1' },
  { bg: '#FEF3C7', color: '#B45309' },
  { bg: '#DCFCE7', color: '#15803D' },
  { bg: '#F3E8FF', color: '#7E22CE' },
  { bg: '#FCE7F3', color: '#BE185D' },
  { bg: '#FFEDD5', color: '#C2410C' },
]

function getInitials(nombre: string): string {
  const clean = nombre.replace(/^Dr\.\s*|^Dra\.\s*|^Lic\.\s*/i, '').trim()
  const parts = clean.split(/[,\s]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase()
}

function createEmptyResumen(fechaStr: string): ResumenDiario {
  return normalizeResumenRow({
    fecha: fechaStr,
    total_cobrado: 0,
    total_centro: 0,
    total_medicos: 0,
    total_efectivo: 0,
    total_transferencia: 0,
    total_otros: 0,
    turnos_totales: 0,
    turnos_atendidos: 0,
    turnos_cancelados: 0,
    turnos_pendientes: 0,
    recaudacion_manana: 0,
    recaudacion_tarde: 0,
    recaudacion_mary: 0,
    recaudacion_andrea: 0,
    medicos_detalle: [],
    ultima_actualizacion: new Date().toISOString(),
    origen: 'Sanatorio Móvil',
  })
}

export function App() {
  const [periodo, setPeriodo] = useState<PeriodoTab>('hoy')
  const [selectedTurnoTipo, setSelectedTurnoTipo] = useState<'totales' | 'atendidos' | 'pendientes' | 'cancelados' | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const lastFocusedCardRef = useRef<HTMLElement | null>(null)
  const clasifModalRef = useRef<HTMLDivElement | null>(null)
  const logoutModalRef = useRef<HTMLDivElement | null>(null)
  const [selectedFecha, setSelectedFecha] = useState<string>('')
  const [customDayResumen, setCustomDayResumen] = useState<ResumenDiario | null>(null)
  const [seccion, setSeccion] = useState<SeccionTab>('pagos')
  const [config, setConfig] = useState<SupabaseConfig>(getStoredSupabaseConfig)
  const [session, setSession] = useState<UserSession | null>(getStoredSession)

  // Resúmenes por día y mes
  const [resumenHoy, setResumenHoy] = useState<ResumenDiario | null>(null)
  const [resumenAyer, setResumenAyer] = useState<ResumenDiario | null>(null)
  const [monthRows, setMonthRows] = useState<ResumenDiario[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>(() => format(new Date(), 'HH:mm:ss'))

  // Ajustes de servidor y login
  const [showSettings, setShowSettings] = useState(false)
  const [tempUrl, setTempUrl] = useState(config.url)
  const [tempKey, setTempKey] = useState(config.anonKey)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  // Lista de fechas con actividad
  const [_availableDates, setAvailableDates] = useState<FechaResumenItem[]>([])

  // Directorio de médicos (Ventana emergente)
  const initialCachedMedicos = useMemo(() => getCachedMedicosDirectorio(), [])
  const [medicosCount, setMedicosCount] = useState<number>(() => initialCachedMedicos.data.length)
  const [showMedicosModal, setShowMedicosModal] = useState<boolean>(false)
  const [medicosList, setMedicosList] = useState<MedicoDirectorio[]>(() => initialCachedMedicos.data)
  const [loadingMedicos, setLoadingMedicos] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectedEspecialidad, setSelectedEspecialidad] = useState<string>('Todas')
  const [sortMode, setSortMode] = useState<'az' | 'pct'>('az')
  const [agrupar, setAgrupar] = useState<boolean>(true)
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0)
  const [openRowId, setOpenRowId] = useState<string | null>(null)

  const medicosBtnRef = useRef<HTMLButtonElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const listContainerRef = useRef<HTMLDivElement | null>(null)

  // Fecha real en zona horaria de Buenos Aires (siempre muestra la fecha real del día aunque no se hayan cobrado plus ni montos)
  const [hoyArg, setHoyArg] = useState<Date>(() => getFechaArgentinaNow())
  const hoyStr = useMemo(() => format(hoyArg, 'yyyy-MM-dd'), [hoyArg])
  const ayerStr = useMemo(() => format(subDays(hoyArg, 1), 'yyyy-MM-dd'), [hoyArg])
  // Semana actual de Lunes a Sábado
  const semanaInicioDate = useMemo(() => startOfWeek(hoyArg, { weekStartsOn: 1 }), [hoyArg])
  const semanaFinDate = useMemo(() => addDays(semanaInicioDate, 5), [semanaInicioDate])
  const semanaInicioStr = useMemo(() => format(semanaInicioDate, 'yyyy-MM-dd'), [semanaInicioDate])
  const semanaFinStr = useMemo(() => format(semanaFinDate, 'yyyy-MM-dd'), [semanaFinDate])
  const mesActualStr = useMemo(() => format(hoyArg, 'yyyy-MM'), [hoyArg])

  // Cargar lista de fechas
  const loadDates = async () => {
    const list = await fetchAvailableDates(config, session?.accessToken)
    if (list && list.length > 0) {
      setAvailableDates(list)
    }
  }

  // Cargar mes actual, anterior y últimos registros sincronizados desde la PC
  const loadMonth = async (refDate: Date = hoyArg) => {
    const actual = format(refDate, 'yyyy-MM')
    const anterior = format(subMonths(refDate, 1), 'yyyy-MM')
    const [recent, a, b] = await Promise.all([
      fetchRecentRows(config, session?.accessToken, 120),
      fetchMonthRows(actual, config, session?.accessToken),
      fetchMonthRows(anterior, config, session?.accessToken),
    ])
    const map = new Map<string, ResumenDiario>()
    for (const r of [...b, ...a, ...recent]) {
      map.set(r.fecha, normalizeResumenRow(r))
    }
    const sorted = Array.from(map.values()).sort((x, y) => (x.fecha < y.fecha ? 1 : -1))
    setMonthRows(sorted)
    return sorted
  }

  // Cargar todos los datos principales
  const loadAll = async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const nowArg = getFechaArgentinaNow()
      setHoyArg(nowArg)
      const currentHoyStr = format(nowArg, 'yyyy-MM-dd')
      const currentAyerStr = format(subDays(nowArg, 1), 'yyyy-MM-dd')

      await fetchAgendaMedicosMap(config, session?.accessToken)

      const [rHoy, rAyer, rows] = await Promise.all([
        fetchResumenDiario(currentHoyStr, config, session?.accessToken),
        fetchResumenDiario(currentAyerStr, config, session?.accessToken),
        loadMonth(nowArg),
        loadDates(),
      ])

      const hoyRow = normalizeResumenRow(
        rHoy.data || rows.find((r) => r.fecha === currentHoyStr) || createEmptyResumen(currentHoyStr),
      )
      const ayerRow = normalizeResumenRow(
        rAyer.data || rows.find((r) => r.fecha === currentAyerStr) || createEmptyResumen(currentAyerStr),
      )

      setResumenHoy(hoyRow)
      setResumenAyer(ayerRow)
      setLastUpdatedTime(format(new Date(), 'HH:mm:ss'))

      if (rHoy.error && !rHoy.fromCache && rows.length === 0) {
        setErrorMsg(rHoy.error)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // Cargar conteo liviano de médicos para la insignia del botón
  const loadMedicosCount = async () => {
    try {
      const cnt = await fetchMedicosActivosCount(config, session?.accessToken)
      if (cnt > 0) {
        setMedicosCount(cnt)
      }
    } catch {
      // silencioso
    }
  }

  // Cargar directorio de médicos completo al abrir la ventana emergente
  const loadMedicosDirectorio = async () => {
    setLoadingMedicos(true)
    try {
      const res = await fetchMedicosDirectorio(config, session?.accessToken)
      setMedicosList(res.data)
      if (res.data.length > 0) {
        setMedicosCount(res.data.length)
      }
    } catch {
      // silencioso
    } finally {
      setLoadingMedicos(false)
    }
  }

  const handleOpenMedicos = () => {
    setShowMedicosModal(true)
    setSearchQuery('')
    setSelectedEspecialidad('Todas')
    setAgrupar(true)
    setDropdownOpen(false)
    setOpenRowId(null)
    void loadMedicosDirectorio()
  }

  useEffect(() => {
    void loadAll()
    void loadMedicosCount()

    // Auto-refresco cada 30 segundos mientras la app permanece abierta
    const interval = setInterval(() => {
      void loadAll()
      void loadMedicosCount()
    }, 30000)

    // Refresco automático al desbloquear el teléfono o volver a la app
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadAll()
        void loadMedicosCount()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [config, session])

  useEffect(() => {
    if (periodo === 'dia' && selectedFecha) {
      const exists = monthRows.some((r) => r.fecha === selectedFecha)
      if (!exists && selectedFecha !== hoyStr && selectedFecha !== ayerStr) {
        void (async () => {
          setLoading(true)
          try {
            const res = await fetchResumenDiario(selectedFecha, config, session?.accessToken)
            if (res.data) {
              setCustomDayResumen(res.data)
            }
          } catch {
            // silencioso
          } finally {
            setLoading(false)
          }
        })()
      }
    }
  }, [periodo, selectedFecha, monthRows, hoyStr, ayerStr, config, session])

  const handleDateChange = (newDateStr: string) => {
    if (!newDateStr) return
    setSelectedFecha(newDateStr)
    if (newDateStr === hoyStr) {
      setPeriodo('hoy')
    } else if (newDateStr === ayerStr) {
      setPeriodo('ayer')
    } else {
      setPeriodo('dia')
    }
  }

  const handleRefresh = async () => {
    try {
      await Promise.all([loadAll(), loadMedicosCount()])
    } catch {
      showToast('No se pudo actualizar')
    }
  }

  // Flechas ‹ y › para navegar día a día o períodos
  const handlePrev = () => {
    if (periodo === 'hoy') {
      setPeriodo('ayer')
      setSelectedFecha(ayerStr)
    } else if (periodo === 'ayer') {
      const ant = subDays(parseISO(ayerStr), 1)
      const antStr = format(ant, 'yyyy-MM-dd')
      setPeriodo('dia')
      setSelectedFecha(antStr)
    } else if (periodo === 'dia') {
      const cur = parseISO(selectedFecha || hoyStr)
      const ant = subDays(cur, 1)
      const antStr = format(ant, 'yyyy-MM-dd')
      if (antStr === hoyStr) {
        setPeriodo('hoy')
      } else if (antStr === ayerStr) {
        setPeriodo('ayer')
      } else {
        setPeriodo('dia')
      }
      setSelectedFecha(antStr)
    } else if (periodo === 'semana') {
      setPeriodo('ayer')
      setSelectedFecha(ayerStr)
    } else if (periodo === 'mes') {
      setPeriodo('semana')
    }
  }

  const handleNext = () => {
    if (periodo === 'dia') {
      const cur = parseISO(selectedFecha || hoyStr)
      const sig = addDays(cur, 1)
      const sigStr = format(sig, 'yyyy-MM-dd')
      if (sigStr === hoyStr) {
        setPeriodo('hoy')
      } else if (sigStr === ayerStr) {
        setPeriodo('ayer')
      } else {
        setPeriodo('dia')
      }
      setSelectedFecha(sigStr)
    } else if (periodo === 'ayer') {
      setPeriodo('hoy')
      setSelectedFecha(hoyStr)
    } else if (periodo === 'hoy') {
      setPeriodo('semana')
    } else if (periodo === 'semana') {
      setPeriodo('mes')
    } else if (periodo === 'mes') {
      setPeriodo('hoy')
      setSelectedFecha(hoyStr)
    }
  }

  // Formato de texto de fecha para la barra central
  const dateNavLabel = useMemo(() => {
    if (periodo === 'hoy') {
      return `Hoy (${formatFechaArg(hoyArg, 'dia')})`
    }
    if (periodo === 'ayer') {
      const ayerArg = subDays(hoyArg, 1)
      return `Ayer (${formatFechaArg(ayerArg, 'dia')})`
    }
    if (periodo === 'dia') {
      try {
        const d = parseISO(selectedFecha || hoyStr)
        return formatFechaArg(d, 'dia')
      } catch {
        return selectedFecha || hoyStr
      }
    }
    if (periodo === 'semana') {
      const dayIni = String(semanaInicioDate.getDate()).padStart(2, '0')
      const dayFin = String(semanaFinDate.getDate()).padStart(2, '0')
      const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
      const mesIni = meses[semanaInicioDate.getMonth()]
      const mesFin = meses[semanaFinDate.getMonth()]
      if (mesIni === mesFin) {
        return `Semana (${dayIni} al ${dayFin} de ${mesFin})`
      }
      return `Semana (${dayIni}-${mesIni} al ${dayFin}-${mesFin})`
    }
    if (periodo === 'mes') {
      return `Mes (${formatFechaArg(hoyArg, 'mes')})`
    }
    return ''
  }, [periodo, hoyArg, selectedFecha, hoyStr, semanaInicioDate, semanaFinDate])

  // Datos consolidados según el período seleccionado
  const activeData = useMemo(() => {
    if (periodo === 'hoy') {
      const found =
        (resumenHoy?.fecha === hoyStr ? resumenHoy : null) ||
        monthRows.find((r) => r.fecha === hoyStr)
      if (found) return normalizeResumenRow({ ...found })
      return createEmptyResumen(hoyStr)
    }
    if (periodo === 'ayer') {
      const found =
        (resumenAyer?.fecha === ayerStr ? resumenAyer : null) ||
        monthRows.find((r) => r.fecha === ayerStr)
      if (found) return normalizeResumenRow({ ...found })
      return createEmptyResumen(ayerStr)
    }
    if (periodo === 'dia') {
      const fTarget = selectedFecha || hoyStr
      const found =
        (fTarget === hoyStr && resumenHoy?.fecha === hoyStr ? resumenHoy : null) ||
        (fTarget === ayerStr && resumenAyer?.fecha === ayerStr ? resumenAyer : null) ||
        monthRows.find((r) => r.fecha === fTarget) ||
        (customDayResumen?.fecha === fTarget ? customDayResumen : null)
      if (found) return normalizeResumenRow({ ...found })
      return createEmptyResumen(fTarget)
    }

    let relevantRows: ResumenDiario[] = []
    if (periodo === 'semana') {
      relevantRows = monthRows.filter((r) => r.fecha >= semanaInicioStr && r.fecha <= semanaFinStr)
    } else if (periodo === 'mes') {
      relevantRows = monthRows.filter((r) => r.fecha.startsWith(mesActualStr))
    }

    let cobrado = 0,
      centro = 0,
      medicos = 0,
      efectivo = 0,
      transf = 0,
      otros = 0
    let turnosTotales = 0,
      turnosAtendidos = 0,
      turnosCancelados = 0,
      turnosPendientes = 0
    const sumClasif: TurnosClasificacion = {
      atendidos: { obra_social: 0, individual: 0, familiar: 0, plan_plus: 0, particular: 0 },
      pendientes: { obra_social: 0, individual: 0, familiar: 0, plan_plus: 0, particular: 0 },
      cancelados: { obra_social: 0, individual: 0, familiar: 0, plan_plus: 0, particular: 0 },
    }
    let manana = 0,
      tarde = 0,
      mary = 0,
      andrea = 0
    const medMap = new Map<
      string,
      { nombre: string; especialidad?: string; pacientes: number; cobrado: number; centro: number; medico: number }
    >()

    for (const rawRow of relevantRows) {
      const r = normalizeResumenRow({ ...rawRow })
      cobrado += Number(r.total_cobrado) || 0
      centro += Number(r.total_centro) || 0
      medicos += Number(r.total_medicos) || 0
      efectivo += Number(r.total_efectivo) || 0
      transf += Number(r.total_transferencia) || 0
      otros += Number(r.total_otros) || 0
      turnosTotales += Number(r.turnos_totales) || 0
      turnosAtendidos += Number(r.turnos_atendidos) || 0
      turnosCancelados += Number(r.turnos_cancelados) || 0
      turnosPendientes += Number(r.turnos_pendientes) || 0
      manana += Number(r.recaudacion_manana) || 0
      tarde += Number(r.recaudacion_tarde) || 0
      mary += Number(r.recaudacion_mary || r.recaudacion_manana) || 0
      andrea += Number(r.recaudacion_andrea || r.recaudacion_tarde) || 0

      const rowClasif = extractClasificacion(r)
      if (rowClasif) {
        for (const estado of ['atendidos', 'pendientes', 'cancelados'] as const) {
          sumClasif[estado].obra_social += Number(rowClasif[estado]?.obra_social) || 0
          sumClasif[estado].plan_plus += Number(rowClasif[estado]?.plan_plus) || 0
          sumClasif[estado].particular += Number(rowClasif[estado]?.particular) || 0
        }
      }

      for (const m of r.medicos_detalle || []) {
        const cleanNombre = (m.nombre || '').trim().replace(/\s*,\s*/g, ', ')
        const medKey = cleanNombre.toUpperCase()
        const item = medMap.get(medKey) || {
          nombre: cleanNombre,
          especialidad: m.especialidad,
          pacientes: 0,
          cobrado: 0,
          centro: 0,
          medico: 0,
        }
        item.pacientes += Number(m.pacientes) || 0
        const mCobrado = Number(m.totalCobrado || m.monto) || 0
        const mCentro = Number(m.totalCentro) || 0
        const mMed = Number(m.totalMedico) || Math.max(0, mCobrado - mCentro)
        item.cobrado += mCobrado
        item.centro += mCentro
        item.medico += mMed
        medMap.set(medKey, item)
      }
    }

    const medicosDetalle = Array.from(medMap.values())
      .map((x) => ({
        nombre: x.nombre,
        especialidad: x.especialidad,
        pacientes: x.pacientes,
        totalCobrado: x.cobrado,
        totalCentro: x.centro,
        totalMedico: x.medico,
        monto: x.cobrado,
      }))
      .sort((a, b) => b.totalMedico - a.totalMedico || b.pacientes - a.pacientes)

    return {
      fecha: periodo === 'semana' ? semanaInicioStr : (periodo === 'mes' ? mesActualStr : (selectedFecha || hoyStr)),
      total_cobrado: cobrado,
      total_centro: centro,
      total_medicos: medicos,
      total_efectivo: efectivo,
      total_transferencia: transf,
      total_otros: otros,
      turnos_totales: turnosTotales,
      turnos_atendidos: turnosAtendidos,
      turnos_cancelados: turnosCancelados,
      turnos_pendientes: turnosPendientes,
      recaudacion_manana: manana,
      recaudacion_tarde: tarde,
      recaudacion_mary: mary,
      recaudacion_andrea: andrea,
      medicos_detalle: medicosDetalle,
      turnos_clasificacion: sumClasif,
      ultima_actualizacion: new Date().toISOString(),
      origen: 'Consolidado móvil',
    }
  }, [periodo, selectedFecha, customDayResumen, resumenHoy, resumenAyer, monthRows, hoyStr, ayerStr, semanaInicioStr, semanaFinStr, mesActualStr])

  // Manejo de tecla Escape para cerrar desplegable o ventana emergente
  useEffect(() => {
    if (!showMedicosModal) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dropdownOpen) {
          e.preventDefault()
          e.stopPropagation()
          setDropdownOpen(false)
        } else {
          setShowMedicosModal(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showMedicosModal, dropdownOpen])

  // Cerrar el desplegable al hacer clic o tocar afuera
  useEffect(() => {
    if (!dropdownOpen) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [dropdownOpen])

  const handleSheetKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !sheetRef.current) return
    const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      last.focus()
      e.preventDefault()
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus()
      e.preventDefault()
    }
  }

  // Normalizar cadenas para búsqueda sin tildes ni mayúsculas (NFD)
  const normalizeStr = (str: string) =>
    (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

  // Especialidades únicas deduplicadas con conteo de médicos
  const especialidadesOpciones = useMemo<
    Array<{ key: string; label: string; count: number }>
  >(() => {
    const normMap = new Map<string, { label: string; count: number }>()

    for (const m of medicosList) {
      const rawEsp = (m.especialidad || '').trim()
      const isSinEsp = !rawEsp || normalizeStr(rawEsp) === 'sin especialidad'
      const label = isSinEsp ? 'Sin especialidad' : rawEsp
      const norm = normalizeStr(label)

      const existing = normMap.get(norm)
      if (existing) {
        existing.count++
      } else {
        normMap.set(norm, { label, count: 1 })
      }
    }

    const sorted = Array.from(normMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }),
    )

    return [
      {
        key: 'Todas',
        label: 'Todas las especialidades',
        count: medicosList.length,
      },
      ...sorted.map((s) => ({
        key: s.label,
        label: s.label,
        count: s.count,
      })),
    ]
  }, [medicosList])

  // Opción actualmente seleccionada para el botón del desplegable
  const selectedOption = useMemo(() => {
    if (selectedEspecialidad === 'Todas') {
      return (
        especialidadesOpciones[0] || {
          key: 'Todas',
          label: 'Todas las especialidades',
          count: medicosList.length,
        }
      )
    }
    const normSelected = normalizeStr(selectedEspecialidad)
    return (
      especialidadesOpciones.find((o) => normalizeStr(o.label) === normSelected) || {
        key: selectedEspecialidad,
        label: selectedEspecialidad,
        count: 0,
      }
    )
  }, [selectedEspecialidad, especialidadesOpciones, medicosList.length])

  // Filtrado y ordenamiento de médicos en vivo
  const medicosFiltrados = useMemo(() => {
    const q = normalizeStr(searchQuery)
    const normSelected = normalizeStr(selectedEspecialidad)

    return medicosList
      .filter((m) => {
        if (selectedEspecialidad !== 'Todas') {
          const rawEsp = (m.especialidad || '').trim()
          const isSinEsp = !rawEsp || normalizeStr(rawEsp) === 'sin especialidad'
          const docLabel = isSinEsp ? 'Sin especialidad' : rawEsp
          if (normalizeStr(docLabel) !== normSelected) {
            return false
          }
        }
        if (q) {
          const matchNombre = normalizeStr(m.nombre).includes(q)
          const matchEsp = normalizeStr(m.especialidad || '').includes(q)
          if (!matchNombre && !matchEsp) return false
        }
        return true
      })
      .sort((a, b) => {
        const nameA = formatDoctorName(a.nombre)
        const nameB = formatDoctorName(b.nombre)
        if (sortMode === 'pct') {
          const diff = b.porcentaje_medico - a.porcentaje_medico
          if (diff !== 0) return diff
          return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' })
        }
        return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' })
      })
  }, [medicosList, searchQuery, selectedEspecialidad, sortMode])

  // Grupos por especialidad (cuando selectedEspecialidad === 'Todas' y agrupar === true)
  const gruposPorEspecialidad = useMemo<
    Array<{ especialidad: string; medicos: MedicoDirectorio[] }>
  >(() => {
    if (selectedEspecialidad !== 'Todas' || !agrupar) {
      return []
    }

    const map = new Map<string, { label: string; medicos: MedicoDirectorio[] }>()
    for (const m of medicosFiltrados) {
      const rawEsp = (m.especialidad || '').trim()
      const isSinEsp = !rawEsp || normalizeStr(rawEsp) === 'sin especialidad'
      const label = isSinEsp ? 'Sin especialidad' : rawEsp
      const norm = normalizeStr(label)

      let entry = map.get(norm)
      if (!entry) {
        entry = { label, medicos: [] }
        map.set(norm, entry)
      }
      entry.medicos.push(m)
    }

    const res = Array.from(map.values()).map((entry) => ({
      especialidad: entry.label,
      medicos: entry.medicos,
    }))

    return res.sort((a, b) =>
      a.especialidad.localeCompare(b.especialidad, 'es', { sensitivity: 'base' }),
    )
  }, [medicosFiltrados, selectedEspecialidad, agrupar])

  // Manejo de teclado en el desplegable de especialidades
  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!dropdownOpen) {
        setDropdownOpen(true)
        setHighlightedIndex(0)
      } else {
        setHighlightedIndex((i) => Math.min(especialidadesOpciones.length - 1, i + 1))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!dropdownOpen) {
        setDropdownOpen(true)
        setHighlightedIndex(especialidadesOpciones.length - 1)
      } else {
        setHighlightedIndex((i) => Math.max(0, i - 1))
      }
    } else if (e.key === 'Home' && dropdownOpen) {
      e.preventDefault()
      setHighlightedIndex(0)
    } else if (e.key === 'End' && dropdownOpen) {
      e.preventDefault()
      setHighlightedIndex(especialidadesOpciones.length - 1)
    } else if (e.key === 'Enter') {
      if (dropdownOpen) {
        e.preventDefault()
        const opt = especialidadesOpciones[highlightedIndex]
        if (opt) {
          setSelectedEspecialidad(opt.key)
          setDropdownOpen(false)
          setOpenRowId(null)
          listContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' })
        }
      } else {
        e.preventDefault()
        setDropdownOpen(true)
      }
    } else if (e.key === 'Escape' && dropdownOpen) {
      e.preventDefault()
      e.stopPropagation()
      setDropdownOpen(false)
    }
  }

  const showToast = (msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(null), 3000)
  }


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedTurnoTipo) {
          e.preventDefault()
          handleCloseClasificacion()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTurnoTipo])

  useEffect(() => {
    if (selectedTurnoTipo) {
      clasifModalRef.current?.focus()
    }
  }, [selectedTurnoTipo])

  // Desglose de totales
  const total = Number(activeData.total_cobrado) || 0
  const centro = Number(activeData.total_centro) || 0
  const medicos = Number(activeData.total_medicos) || 0

  const pctCentro = total > 0 ? Math.round((centro / total) * 100) : 0
  const pctMedicos = total > 0 ? 100 - pctCentro : 0

  const handleOpenClasificacion = (tipo: 'totales' | 'atendidos' | 'pendientes' | 'cancelados', elem: HTMLElement) => {
    lastFocusedCardRef.current = elem
    setSelectedTurnoTipo(tipo)
  }

  const handleCloseClasificacion = () => {
    setSelectedTurnoTipo(null)
    lastFocusedCardRef.current?.focus()
  }

  const handleExitApp = async () => {
    try {
      await CapApp.exitApp()
    } catch {
      window.close()
    }
  }

  // Guardar configuración manual
  const handleSaveSettings = () => {
    const newCfg = { url: tempUrl.trim(), anonKey: tempKey.trim() }
    setConfig(newCfg)
    saveStoredSupabaseConfig(newCfg)
    setShowSettings(false)
  }

  // Manejo de login admin
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginEmail.trim() || !loginPass) return
    setLoginBusy(true)
    setLoginError(null)
    const res = await loginWithEmail(loginEmail, loginPass, config)
    setLoginBusy(false)
    if (res.success && res.session) {
      setSession(res.session)
      setLoginPass('')
    } else {
      setLoginError(res.error || 'Credenciales inválidas.')
    }
  }

  const handleLogout = () => {
    setSession(null)
    saveStoredSession(null)
  }

  return (
    <div className="app-wrapper">
      <div className="mobile-shell">
        {/* ENCABEZADO EN PASTILLA */}
        <div className="encabezado-pastilla">
          <div className="fila-logo">
            <div className="logo-brand-box">
              <img src={logoCuidar} alt="Cuidar Centro Médico" height={75} width="auto" />
            </div>
            <div className="iconos">
              {/* 1. Botón Médicos y Especialidades (antes de sincronizar) */}
              <button
                ref={medicosBtnRef}
                type="button"
                className="medicos-circle-btn"
                onClick={handleOpenMedicos}
                aria-label="Médicos y especialidades"
                title="Médicos y especialidades"
              >
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4.5 3v5a4.5 4.5 0 0 0 9 0V3" />
                  <path d="M2.5 3h4" />
                  <path d="M11.5 3h4" />
                  <path d="M9 12.5V17a3 3 0 0 0 6 0v-2.5" />
                  <circle cx="18" cy="14.5" r="3" />
                </svg>
                {medicosCount > 0 && (
                  <span className="medicos-badge" aria-label={`${medicosCount} médicos activos`}>
                    {medicosCount}
                  </span>
                )}
              </button>

              {/* 2. Botón Sincronizar */}
              <button
                type="button"
                className="refresh-circle-btn"
                onClick={() => void handleRefresh()}
                disabled={loading}
                title="Actualizar datos"
                aria-label="Actualizar datos"
              >
                <svg
                  className={loading ? 'spin' : ''}
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19" />
                </svg>
              </button>

              {/* 3. Botón Configuración */}
              <button
                type="button"
                className="settings-circle-btn"
                onClick={() => {
                  setTempUrl(config.url)
                  setTempKey(config.anonKey)
                  setShowSettings(true)
                }}
                title="Ajustes de conexión"
                aria-label="Ajustes de conexión"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>

              {/* 4. Botón Salir */}
              <button
                type="button"
                className="logout-circle-btn"
                onClick={() => void handleExitApp()}
                title="Salir de la aplicación"
                aria-label="Salir de la aplicación"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#B3261E"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          {/* PERIODOS (Hoy, Ayer, Semana, Mes) */}
          <div className="periodos">
            <button
              type="button"
              className={periodo === 'hoy' ? 'active' : ''}
              aria-pressed={periodo === 'hoy'}
              onClick={() => {
                const nowArg = getFechaArgentinaNow()
                setHoyArg(nowArg)
                setPeriodo('hoy')
                setSelectedFecha(format(nowArg, 'yyyy-MM-dd'))
              }}
            >
              Hoy
            </button>
            <button
              type="button"
              className={periodo === 'ayer' ? 'active' : ''}
              aria-pressed={periodo === 'ayer'}
              onClick={() => {
                const nowArg = getFechaArgentinaNow()
                setHoyArg(nowArg)
                setPeriodo('ayer')
                setSelectedFecha(format(subDays(nowArg, 1), 'yyyy-MM-dd'))
              }}
            >
              Ayer
            </button>
            <button
              type="button"
              className={periodo === 'semana' ? 'active' : ''}
              aria-pressed={periodo === 'semana'}
              onClick={() => {
                setHoyArg(getFechaArgentinaNow())
                setPeriodo('semana')
              }}
            >
              Semana
            </button>
            <button
              type="button"
              className={periodo === 'mes' ? 'active' : ''}
              aria-pressed={periodo === 'mes'}
              onClick={() => {
                setHoyArg(getFechaArgentinaNow())
                setPeriodo('mes')
              }}
            >
              Mes
            </button>
          </div>

          {/* NAVEGADOR DE FECHA Y SELECTOR DE DÍA */}
          <div className="date-navigator">
            <button
              type="button"
              className="date-nav-chevron"
              onClick={handlePrev}
              title="Día o período anterior"
              aria-label="Día o período anterior"
            >
              ‹
            </button>
            <div className="date-nav-label" title="Tocar para elegir fecha en el calendario">
              <input
                type="date"
                className="date-hidden-input"
                aria-label="Elegir fecha específica en el calendario"
                value={periodo === 'dia' ? (selectedFecha || hoyStr) : (periodo === 'ayer' ? ayerStr : hoyStr)}
                onChange={(e) => handleDateChange(e.target.value)}
              />
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0, opacity: 0.85 }}
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{dateNavLabel}</span>
            </div>
            <button
              type="button"
              className="date-nav-chevron"
              onClick={handleNext}
              title="Día o período siguiente"
              aria-label="Día o período siguiente"
            >
              ›
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="status-banner warning">
            <span>{errorMsg}</span>
          </div>
        )}

        {/* TARJETA 1: TOTAL RECAUDADO */}
        <div className="gerencial-card">
          <div className="card-label-muted">Total recaudado</div>
          <div className="total-valor">{formatMoney(total)}</div>

          {/* DUAL SPLIT BAR */}
          <div className="dual-split-bar">
            <div className="split-seg-centro" style={{ width: `${total > 0 ? pctCentro : 50}%` }} />
            <div className="split-seg-medicos" style={{ width: `${total > 0 ? pctMedicos : 50}%` }} />
          </div>

          {/* BREAKDOWN ROWS */}
          <div className="breakdown-row">
            <div className="breakdown-left">
              <span className="dot-indicator dot-blue-primary" />
              <span>Centro Cuidar ({pctCentro}%)</span>
            </div>
            <div className="breakdown-amount">{formatMoney(centro)}</div>
          </div>

          <div className="breakdown-row">
            <div className="breakdown-left">
              <span className="dot-indicator dot-blue-light" />
              <span>Médicos ({pctMedicos}%)</span>
            </div>
            <div className="breakdown-amount">{formatMoney(medicos)}</div>
          </div>
        </div>

        {/* PILLS DE SECCIONES (Pagos, Por turno, Turnos, Médicos) */}
        <div className="tabs-compactas">
          <button
            type="button"
            className={seccion === 'pagos' ? 'active' : ''}
            onClick={() => setSeccion('pagos')}
          >
            Pagos
          </button>
          <button
            type="button"
            className={seccion === 'turno' ? 'active' : ''}
            onClick={() => setSeccion('turno')}
          >
            Por turno
          </button>
          <button
            type="button"
            className={seccion === 'turnos' ? 'active' : ''}
            onClick={() => setSeccion('turnos')}
          >
            Turnos
          </button>
          <button
            type="button"
            className={seccion === 'medicos' ? 'active' : ''}
            onClick={() => setSeccion('medicos')}
          >
            Médicos
          </button>
        </div>

        {/* SECCION 1: FORMAS DE PAGO */}
        {seccion === 'pagos' && (
          <div className="gerencial-card">
            <div className="section-card-header">
              <div className="section-badge-icon" style={{ background: '#EDE9FE', color: '#7C3AED' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <div className="section-card-title">Formas de pago</div>
            </div>

            <div className="progress-group">
              <div className="progress-label-row">
                <span className="progress-name">Efectivo</span>
                <span className="progress-val">{formatMoney(activeData.total_efectivo)}</span>
              </div>
              <div className="progress-track" style={{ background: '#E5E7EB' }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${total > 0 ? (activeData.total_efectivo / total) * 100 : 0}%`,
                    background: '#2563EB',
                  }}
                />
              </div>
            </div>

            <div className="progress-group">
              <div className="progress-label-row">
                <span className="progress-name">Transferencia</span>
                <span className="progress-val">{formatMoney(activeData.total_transferencia)}</span>
              </div>
              <div className="progress-track" style={{ background: '#E5E7EB' }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${total > 0 ? (activeData.total_transferencia / total) * 100 : 0}%`,
                    background: '#2563EB',
                  }}
                />
              </div>
            </div>

            {Number(activeData.total_otros) > 0 && (
              <div className="progress-group">
                <div className="progress-label-row">
                  <span className="progress-name">Otros medios</span>
                  <span className="progress-val">{formatMoney(activeData.total_otros)}</span>
                </div>
                <div className="progress-track" style={{ background: '#E5E7EB' }}>
                  <div
                    className="progress-fill"
                    style={{
                      width: `${total > 0 ? (activeData.total_otros / total) * 100 : 0}%`,
                      background: '#2563EB',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECCION 2: POR TURNO */}
        {seccion === 'turno' && (
          <div className="gerencial-card">
            <div className="section-card-header">
              <div className="section-card-title">Recaudación por turno</div>
            </div>

            <div className="progress-group">
              <div className="progress-label-row">
                <span className="progress-name">
                  <span className="badge-chip">☀️</span> Turno Mañana
                </span>
                <span className="progress-val">{formatMoney(activeData.recaudacion_manana)}</span>
              </div>
              <div className="progress-track" style={{ background: '#E5E7EB' }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${total > 0 ? (activeData.recaudacion_manana / total) * 100 : 0}%`,
                    background: '#2563EB',
                  }}
                />
              </div>
            </div>

            <div className="progress-group">
              <div className="progress-label-row">
                <span className="progress-name">
                  <span className="badge-chip">🌙</span> Turno Tarde
                </span>
                <span className="progress-val">{formatMoney(activeData.recaudacion_tarde)}</span>
              </div>
              <div className="progress-track" style={{ background: '#E5E7EB' }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${total > 0 ? (activeData.recaudacion_tarde / total) * 100 : 0}%`,
                    background: '#2563EB',
                  }}
                />
              </div>
            </div>

            
          </div>
        )}

        {/* SECCION 3: TURNOS (Resumen de turnos 2x2 + barra) */}
        {seccion === 'turnos' && (() => {
          const tot = Number(activeData.turnos_totales) || 0
          const aten = Number(activeData.turnos_atendidos) || 0
          const pend = Number(activeData.turnos_pendientes) || 0
          const canc = Number(activeData.turnos_cancelados) || 0


          return (
            <div className="gerencial-card card-turnos-resumen">
              <div className="turnos-panel-header">
                <div className="turnos-icon-box" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B3FB5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <div className="turnos-panel-title">Resumen de turnos</div>
              </div>

              <div className="turnos-grid-2x2">
                <button
                  type="button"
                  className="turno-card-item turno-card-totales"
                  onClick={(e) => handleOpenClasificacion('totales', e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleOpenClasificacion('totales', e.currentTarget)
                    }
                  }}
                  aria-label={`Totales: ${tot}. Ver clasificación`}
                >
                  <span className="turno-card-lbl">Totales</span>
                  <span className="turno-card-num-group">
                    <span className="turno-card-num">{tot}</span>
                    <span className="turno-card-chevron" aria-hidden="true">›</span>
                  </span>
                </button>

                <button
                  type="button"
                  className="turno-card-item turno-card-atendidos"
                  onClick={(e) => handleOpenClasificacion('atendidos', e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleOpenClasificacion('atendidos', e.currentTarget)
                    }
                  }}
                  aria-label={`Atendidos: ${aten}. Ver clasificación`}
                >
                  <span className="turno-card-lbl">Atendidos</span>
                  <span className="turno-card-num-group">
                    <span className="turno-card-num">{aten}</span>
                    <span className="turno-card-chevron" aria-hidden="true">›</span>
                  </span>
                </button>

                <button
                  type="button"
                  className="turno-card-item turno-card-pendientes"
                  onClick={(e) => handleOpenClasificacion('pendientes', e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleOpenClasificacion('pendientes', e.currentTarget)
                    }
                  }}
                  aria-label={`Pendientes: ${pend}. Ver clasificación`}
                >
                  <span className="turno-card-lbl">Pendientes</span>
                  <span className="turno-card-num-group">
                    <span className="turno-card-num">{pend}</span>
                    <span className="turno-card-chevron" aria-hidden="true">›</span>
                  </span>
                </button>

                <button
                  type="button"
                  className="turno-card-item turno-card-cancelados"
                  onClick={(e) => handleOpenClasificacion('cancelados', e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleOpenClasificacion('cancelados', e.currentTarget)
                    }
                  }}
                  aria-label={`Cancelados: ${canc}. Ver clasificación`}
                >
                  <span className="turno-card-lbl">Cancelados</span>
                  <span className="turno-card-num-group">
                    <span className="turno-card-num">{canc}</span>
                    <span className="turno-card-chevron" aria-hidden="true">›</span>
                  </span>
                </button>
              </div>


            </div>
          )
        })()}

        {/* SECCION 4: ACTIVIDAD POR MEDICO EN EL PERIODO */}
        {seccion === 'medicos' && (
          <div className="gerencial-card">
            <div className="section-card-header">
              <div className="section-badge-icon" style={{ background: '#CCFBF1', color: '#0F766E' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="section-card-title">
                Actividad por Médico ({activeData.medicos_detalle?.length || 0})
              </div>
            </div>

            {(!activeData.medicos_detalle || activeData.medicos_detalle.length === 0) && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748B', fontSize: '0.88rem' }}>
                No hay actividad médica registrada en este período.
              </div>
            )}

            <div className="medicos-list">
              {activeData.medicos_detalle?.map((med, idx) => (
                <div key={idx} className="medico-item-card">
                  <div className="medico-item-header">
                    <span className="medico-item-name">{med.nombre}</span>
                    <span className="medico-item-pacientes">{med.pacientes} pac.</span>
                  </div>
                  <div className="medico-item-stats">
                    <div className="medico-stat-col">
                      <span>Honorarios</span>
                      <strong>
                        {formatMoney(
                          Math.max(0, (med.totalCobrado || 0) - (med.totalCentro || 0)) || med.monto || 0,
                        )}
                      </strong>
                    </div>
                    <div className="medico-stat-col">
                      <span>Centro Cuidar</span>
                      <strong>{formatMoney(med.totalCentro || 0)}</strong>
                    </div>
                    <div className="medico-stat-col">
                      <span>Total Cobrado</span>
                      <strong style={{ color: 'var(--blue-primary)' }}>
                        {formatMoney(med.totalCobrado || med.monto || 0)}
                      </strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ textAlign: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid #E2E8F0' }}>
              <button
                type="button"
                onClick={handleOpenMedicos}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid #2563EB',
                  background: '#EFF6FF',
                  color: '#2563EB',
                  fontWeight: 800,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 3v5a4.5 4.5 0 0 0 9 0V3" />
                  <path d="M2.5 3h4" />
                  <path d="M11.5 3h4" />
                  <path d="M9 12.5V17a3 3 0 0 0 6 0v-2.5" />
                  <circle cx="18" cy="14.5" r="3" />
                </svg>
                Ver directorio de médicos y % ({medicosCount})
              </button>
            </div>
          </div>
        )}

        {/* ==================================================================
            VENTANA EMERGENTE (BOTTOM SHEET): MÉDICOS Y ESPECIALIDADES
            ================================================================== */}
        {showMedicosModal && (
          <div className="bottom-sheet-backdrop" onClick={() => setShowMedicosModal(false)}>
            <div
              ref={sheetRef}
              className="bottom-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-medicos-titulo"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={handleSheetKeyDown}
            >
              {/* Barrita de arrastre superior */}
              <div className="sheet-drag-handle" />

              {/* PARTE SUPERIOR FIJA */}
              <div className="sheet-fixed-top">
                {/* 1. Encabezado */}
                <header className="sheet-header">
                  <div className="sheet-header-info">
                    <h2 id="modal-medicos-titulo" className="sheet-title">
                      Médicos y especialidades
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="sheet-close-btn"
                    onClick={() => setShowMedicosModal(false)}
                    aria-label="Cerrar ventana de médicos"
                    title="Cerrar (Esc)"
                  >
                    ✕
                  </button>
                </header>


                {/* 3. Buscador en vivo */}
                <div className="sheet-search-wrap">
                  <div className="sheet-search-box">
                    <svg
                      className="sheet-search-icon"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      aria-hidden="true"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="sheet-search-input"
                      placeholder="Buscar médico o especialidad"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value)
                        setOpenRowId(null)
                      }}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('')
                          setOpenRowId(null)
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#94A3B8',
                          padding: '0 4px',
                          fontSize: '14px',
                        }}
                        aria-label="Limpiar búsqueda"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* 4. Desplegable de especialidades (ancho completo) */}
                <div className="sheet-dropdown-wrap" ref={dropdownRef}>
                  <button
                    type="button"
                    className={`sheet-dropdown-btn ${dropdownOpen ? 'open' : ''}`}
                    onClick={() => setDropdownOpen((v) => !v)}
                    onKeyDown={handleDropdownKeyDown}
                    aria-haspopup="listbox"
                    aria-expanded={dropdownOpen}
                    aria-label={`Filtrar especialidad: ${selectedOption.label}`}
                  >
                    <svg
                      className="sheet-dropdown-icon"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4.5 3v5a4.5 4.5 0 0 0 9 0V3" />
                      <path d="M2.5 3h4" />
                      <path d="M11.5 3h4" />
                      <path d="M9 12.5V17a3 3 0 0 0 6 0v-2.5" />
                      <circle cx="18" cy="14.5" r="3" />
                    </svg>
                    <span className="sheet-dropdown-text">{selectedOption.label}</span>
                    <span className="sheet-dropdown-count">({selectedOption.count})</span>
                    <svg
                      className={`sheet-dropdown-chevron ${dropdownOpen ? 'open' : ''}`}
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {dropdownOpen && (
                    <div className="sheet-dropdown-panel" role="listbox">
                      {especialidadesOpciones.map((opt, i) => {
                        const isSelected = selectedEspecialidad === opt.key
                        const isHighlighted = highlightedIndex === i
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`sheet-dropdown-option ${isSelected ? 'selected' : ''} ${
                              isHighlighted ? 'highlighted' : ''
                            }`}
                            onClick={() => {
                              setSelectedEspecialidad(opt.key)
                              setDropdownOpen(false)
                              setOpenRowId(null)
                              listContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' })
                            }}
                          >
                            <span className="sheet-opt-label">
                              {isSelected && <span className="sheet-opt-check">✓ </span>}
                              {opt.label}
                            </span>
                            <span className="sheet-opt-count">({opt.count})</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 5. Fila de controles: orden a la izquierda y agrupar a la derecha */}
                <div className="sheet-controls-row">
                  <div className="sheet-segmented-sort" role="radiogroup" aria-label="Ordenar médicos">
                    <button
                      type="button"
                      className={`sheet-segmented-btn ${sortMode === 'az' ? 'active' : ''}`}
                      onClick={() => {
                        setSortMode('az')
                        setOpenRowId(null)
                      }}
                      role="radio"
                      aria-checked={sortMode === 'az'}
                    >
                      A–Z
                    </button>
                    <button
                      type="button"
                      className={`sheet-segmented-btn ${sortMode === 'pct' ? 'active' : ''}`}
                      onClick={() => {
                        setSortMode('pct')
                        setOpenRowId(null)
                      }}
                      role="radio"
                      aria-checked={sortMode === 'pct'}
                    >
                      Mayor %
                    </button>
                  </div>

                  {selectedEspecialidad === 'Todas' && (
                    <button
                      type="button"
                      className={`sheet-toggle-agrupar ${agrupar ? 'active' : ''}`}
                      onClick={() => {
                        setAgrupar((v) => !v)
                        setOpenRowId(null)
                      }}
                      aria-pressed={agrupar}
                      title="Agrupar médicos por especialidad"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="3" />
                        <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="3" />
                        <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="3" />
                      </svg>
                      <span>Agrupar</span>
                    </button>
                  )}
                </div>

              </div>

              {/* LISTA CON SCROLL INTERNO (ÚNICA PARTE CON SCROLL) */}
              <div className="sheet-content" ref={listContainerRef}>
                {loadingMedicos && medicosList.length === 0 ? (
                  <>
                    <div className="sheet-skeleton-item" />
                    <div className="sheet-skeleton-item" />
                    <div className="sheet-skeleton-item" />
                    <div className="sheet-skeleton-item" />
                  </>
                ) : medicosFiltrados.length === 0 ? (
                  <div className="sheet-empty-box">No hay médicos con ese filtro</div>
                ) : selectedEspecialidad === 'Todas' && agrupar ? (
                  /* VISTA AGRUPADA POR ESPECIALIDAD */
                  gruposPorEspecialidad.map((grupo) => (
                    <div key={grupo.especialidad} className="sheet-specialty-group">
                      <div className="sheet-sticky-header">
                        <span className="sheet-sticky-title">{grupo.especialidad}</span>
                      </div>
                      <div className="sheet-group-list">
                        {grupo.medicos.map((m, idx) => {
                          const isOpen = openRowId === m.medico_id
                          const palette = AVATAR_PALETTES[idx % AVATAR_PALETTES.length]
                          const pctMed = m.porcentaje_medico
                          const pctCentro = Math.max(
                            0,
                            Math.min(100, Math.round((100 - pctMed) * 100) / 100),
                          )
                          const nombreFormateado = formatDoctorName(m.nombre)
                          const iniciales = getDoctorInitials(m.nombre)

                          return (
                            <div
                              key={m.medico_id}
                              className={`sheet-doctor-item ${isOpen ? 'open' : ''}`}
                            >
                              <div
                                className="sheet-doctor-main"
                                onClick={() => setOpenRowId(isOpen ? null : m.medico_id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setOpenRowId(isOpen ? null : m.medico_id)
                                  }
                                }}
                                aria-expanded={isOpen}
                              >
                                <div
                                  className="sheet-doctor-avatar"
                                  style={{ background: palette.bg, color: palette.color }}
                                  aria-hidden="true"
                                >
                                  {iniciales}
                                </div>

                                <div className="sheet-doctor-info">
                                  <span className="sheet-doctor-name" title={nombreFormateado}>
                                    {nombreFormateado}
                                  </span>
                                </div>

                                <div className="sheet-doctor-pct-box">
                                  <span className="sheet-doctor-badge">{pctMed}%</span>
                                  <span className="sheet-doctor-centro-label">
                                    Centro {pctCentro}%
                                  </span>
                                </div>
                              </div>

                              {isOpen && (
                                <div className="sheet-doctor-detail">
                                  <div
                                    className="sheet-doctor-split-bar"
                                    role="progressbar"
                                    aria-valuenow={pctMed}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                  >
                                    <div
                                      className="sheet-split-medico"
                                      style={{ width: `${pctMed}%` }}
                                    />
                                    <div
                                      className="sheet-split-centro"
                                      style={{ width: `${pctCentro}%` }}
                                    />
                                  </div>
                                  <div className="sheet-doctor-split-labels">
                                    <span>Médico {pctMed}%</span>
                                    <span>Centro {pctCentro}%</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  /* VISTA PLANA */
                  medicosFiltrados.map((m, idx) => {
                    const isOpen = openRowId === m.medico_id
                    const palette = AVATAR_PALETTES[idx % AVATAR_PALETTES.length]
                    const pctMed = m.porcentaje_medico
                    const pctCentro = Math.max(
                      0,
                      Math.min(100, Math.round((100 - pctMed) * 100) / 100),
                    )
                    const nombreFormateado = formatDoctorName(m.nombre)
                    const iniciales = getDoctorInitials(m.nombre)
                    // Si se eligió una especialidad concreta, no se repite debajo del nombre
                    const showSpec = selectedEspecialidad === 'Todas' && !agrupar

                    return (
                      <div
                        key={m.medico_id}
                        className={`sheet-doctor-item ${isOpen ? 'open' : ''}`}
                      >
                        <div
                          className="sheet-doctor-main"
                          onClick={() => setOpenRowId(isOpen ? null : m.medico_id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setOpenRowId(isOpen ? null : m.medico_id)
                            }
                          }}
                          aria-expanded={isOpen}
                        >
                          <div
                            className="sheet-doctor-avatar"
                            style={{ background: palette.bg, color: palette.color }}
                            aria-hidden="true"
                          >
                            {iniciales}
                          </div>

                          <div className="sheet-doctor-info">
                            <span className="sheet-doctor-name" title={nombreFormateado}>
                              {nombreFormateado}
                            </span>
                            {showSpec && (
                              <span className="sheet-doctor-spec">
                                {m.especialidad || 'Sin especialidad'}
                              </span>
                            )}
                          </div>

                          <div className="sheet-doctor-pct-box">
                            <span className="sheet-doctor-badge">{pctMed}%</span>
                            <span className="sheet-doctor-centro-label">
                              Centro {pctCentro}%
                            </span>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="sheet-doctor-detail">
                            <div
                              className="sheet-doctor-split-bar"
                              role="progressbar"
                              aria-valuenow={pctMed}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <div
                                className="sheet-split-medico"
                                style={{ width: `${pctMed}%` }}
                              />
                              <div
                                className="sheet-split-centro"
                                style={{ width: `${pctCentro}%` }}
                              />
                            </div>
                            <div className="sheet-doctor-split-labels">
                              <span>Médico {pctMed}%</span>
                              <span>Centro {pctCentro}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODAL CONFIGURACION Y LOGIN */}
        {/* AVISO TOAST FLOTANTE */}
        {toastMsg && (
          <div className="toast-notification" role="status" aria-live="polite">
            {toastMsg}
          </div>
        )}

        {/* VENTANITA CENTRADA DE CLASIFICACIÓN DE TURNOS */}
        {selectedTurnoTipo && (() => {
          const clasif = extractClasificacion(activeData) || activeData.turnos_clasificacion
          const count =
            selectedTurnoTipo === 'totales'
              ? Number(activeData.turnos_totales) || 0
              : selectedTurnoTipo === 'atendidos'
              ? Number(activeData.turnos_atendidos) || 0
              : selectedTurnoTipo === 'pendientes'
              ? Number(activeData.turnos_pendientes) || 0
              : Number(activeData.turnos_cancelados) || 0

          const title =
            selectedTurnoTipo === 'totales'
              ? 'Totales'
              : selectedTurnoTipo === 'atendidos'
              ? 'Atendidos'
              : selectedTurnoTipo === 'pendientes'
              ? 'Pendientes'
              : 'Cancelados'

          const headerColorClass = `header-badge-${selectedTurnoTipo}`

          let os = 0
          let indiv = 0
          let fam = 0
          let plus = 0
          let part = 0

          if (selectedTurnoTipo === 'totales') {
            os =
              (Number(clasif?.atendidos?.obra_social) || 0) +
              (Number(clasif?.pendientes?.obra_social) || 0) +
              (Number(clasif?.cancelados?.obra_social) || 0)
            indiv =
              (Number(clasif?.atendidos?.individual) || 0) +
              (Number(clasif?.pendientes?.individual) || 0) +
              (Number(clasif?.cancelados?.individual) || 0)
            fam =
              (Number(clasif?.atendidos?.familiar) || 0) +
              (Number(clasif?.pendientes?.familiar) || 0) +
              (Number(clasif?.cancelados?.familiar) || 0)
            plus =
              (Number(clasif?.atendidos?.plan_plus) || 0) +
              (Number(clasif?.pendientes?.plan_plus) || 0) +
              (Number(clasif?.cancelados?.plan_plus) || 0)
            part =
              (Number(clasif?.atendidos?.particular) || 0) +
              (Number(clasif?.pendientes?.particular) || 0) +
              (Number(clasif?.cancelados?.particular) || 0)
          } else {
            os = Number(clasif?.[selectedTurnoTipo]?.obra_social) || 0
            indiv = Number(clasif?.[selectedTurnoTipo]?.individual) || 0
            fam = Number(clasif?.[selectedTurnoTipo]?.familiar) || 0
            plus = Number(clasif?.[selectedTurnoTipo]?.plan_plus) || 0
            part = Number(clasif?.[selectedTurnoTipo]?.particular) || 0
          }

          const sumConocidos = os + indiv + fam + plus + part
          const sinClasif = Math.max(0, count - sumConocidos)

          const itemsToPct = sinClasif > 0
            ? [os, indiv, fam, plus, part, sinClasif]
            : [os, indiv, fam, plus, part]
          const pcts = adjustPercentages(itemsToPct, count)
          const pctOs = pcts[0]
          const pctIndiv = pcts[1]
          const pctFam = pcts[2]
          const pctPlus = pcts[3]
          const pctPart = pcts[4]
          const pctSin = sinClasif > 0 ? pcts[5] : 0

          const periodoNombre =
            periodo === 'hoy'
              ? 'Hoy'
              : periodo === 'ayer'
              ? 'Ayer'
              : periodo === 'semana'
              ? 'Semana'
              : periodo === 'mes'
              ? 'Mes'
              : dateNavLabel

          return (
            <div
              className="clasificacion-modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clasif-modal-title"
              onClick={handleCloseClasificacion}
            >
              <div
                className="clasificacion-modal-card"
                onClick={(e) => e.stopPropagation()}
                ref={clasifModalRef}
                tabIndex={-1}
              >
                {/* ENCABEZADO */}
                <div className="clasif-modal-header">
                  <div className={`clasif-badge-sq ${headerColorClass}`}>
                    {count}
                  </div>
                  <div className="clasif-header-info">
                    <h3 id="clasif-modal-title" className="clasif-header-title">{title}</h3>
                    <div className="clasif-header-sub">
                      {periodoNombre} · {count} turno{count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="clasif-close-btn"
                    onClick={handleCloseClasificacion}
                    title="Cerrar"
                    aria-label="Cerrar ventana"
                  >
                    ✕
                  </button>
                </div>

                {count === 0 ? (
                  <div className="clasif-empty-state">
                    <svg
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#9CA3AF"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                      <line x1="3" y1="3" x2="21" y2="21" />
                    </svg>
                    <p>No hay turnos {selectedTurnoTipo} en este período</p>
                  </div>
                ) : (
                  <>
                    {/* BARRA APILADA 10PX */}
                    <div className="clasif-stacked-bar" role="img" aria-label={`Distribución: Obra social ${pctOs}%, Individual ${pctIndiv}%, Familiar ${pctFam}%, Coberturas ${pctPlus}%, Particular ${pctPart}%`}>
                      {os > 0 && <div className="clasif-seg-os" style={{ width: `${(os / count) * 100}%` }} title={`Obra social: ${os}`} />}
                      {indiv > 0 && <div className="clasif-seg-indiv" style={{ width: `${(indiv / count) * 100}%` }} title={`Individual: ${indiv}`} />}
                      {fam > 0 && <div className="clasif-seg-fam" style={{ width: `${(fam / count) * 100}%` }} title={`Familiar: ${fam}`} />}
                      {plus > 0 && <div className="clasif-seg-plus" style={{ width: `${(plus / count) * 100}%` }} title={`Coberturas: ${plus}`} />}
                      {part > 0 && <div className="clasif-seg-part" style={{ width: `${(part / count) * 100}%` }} title={`Particular: ${part}`} />}
                      {sinClasif > 0 && <div className="clasif-seg-sin" style={{ width: `${(sinClasif / count) * 100}%` }} title={`Sin clasificar: ${sinClasif}`} />}
                    </div>

                    {/* TRES FILAS */}
                    <div className="clasif-rows-list">
                      {/* Fila 1: Obra social */}
                      <div className="clasif-row-item">
                        <div className="clasif-row-left">
                          <div className="clasif-row-icon icon-os" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                              <polyline points="9 12 11 14 15 10" />
                            </svg>
                          </div>
                          <div className="clasif-row-names">
                            <span className="clasif-row-title">Obra social</span>
                            <span className="clasif-row-pct">{pctOs}%</span>
                          </div>
                        </div>
                        <span className="clasif-row-qty">{os}</span>
                      </div>

                      {/* Fila 2: Individual */}
                      <div className="clasif-row-item">
                        <div className="clasif-row-left">
                          <div className="clasif-row-icon icon-indiv" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                          </div>
                          <div className="clasif-row-names">
                            <span className="clasif-row-title">Individual</span>
                            <span className="clasif-row-pct">{pctIndiv}%</span>
                          </div>
                        </div>
                        <span className="clasif-row-qty">{indiv}</span>
                      </div>

                      {/* Fila 3: Familiar */}
                      <div className="clasif-row-item">
                        <div className="clasif-row-left">
                          <div className="clasif-row-icon icon-fam" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                          </div>
                          <div className="clasif-row-names">
                            <span className="clasif-row-title">Familiar</span>
                            <span className="clasif-row-pct">{pctFam}%</span>
                          </div>
                        </div>
                        <span className="clasif-row-qty">{fam}</span>
                      </div>

                      {/* Fila legacy: Coberturas (solo si hay datos viejos) */}
                      {plus > 0 && (
                        <div className="clasif-row-item">
                          <div className="clasif-row-left">
                            <div className="clasif-row-icon icon-plus" aria-hidden="true">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A5FD0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                              </svg>
                            </div>
                            <div className="clasif-row-names">
                              <span className="clasif-row-title">Coberturas</span>
                              <span className="clasif-row-pct">{pctPlus}%</span>
                            </div>
                          </div>
                          <span className="clasif-row-qty">{plus}</span>
                        </div>
                      )}

                      {/* Fila 3: Particular */}
                      <div className="clasif-row-item">
                        <div className="clasif-row-left">
                          <div className="clasif-row-icon icon-part" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F9A8F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                          </div>
                          <div className="clasif-row-names">
                            <span className="clasif-row-title">Particular</span>
                            <span className="clasif-row-pct">{pctPart}%</span>
                          </div>
                        </div>
                        <span className="clasif-row-qty">{part}</span>
                      </div>

                      {/* Fila 4: Sin clasificar (solo si hay diferencia) */}
                      {sinClasif > 0 && (
                        <div className="clasif-row-item">
                          <div className="clasif-row-left">
                            <div className="clasif-row-icon icon-sin" aria-hidden="true">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                              </svg>
                            </div>
                            <div className="clasif-row-names">
                              <span className="clasif-row-title">Sin clasificar</span>
                              <span className="clasif-row-pct">{pctSin}%</span>
                            </div>
                          </div>
                          <span className="clasif-row-qty">{sinClasif}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })()}



        {showSettings && (
          <div className="modal-overlay" onClick={() => setShowSettings(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Ajustes y Sesión</h2>
                <button type="button" className="close-btn" onClick={() => setShowSettings(false)}>
                  ✕
                </button>
              </div>

              {session ? (
                <div style={{ marginBottom: 16, padding: '10px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.82rem', color: '#166534', fontWeight: 700 }}>
                    Sesión iniciada: {session.email}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#15803D' }}>Rol: {session.rol || 'admin'}</div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    style={{
                      marginTop: 8,
                      padding: '5px 10px',
                      background: '#FFFFFF',
                      border: '1px solid #CBD5E1',
                      borderRadius: 6,
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cerrar sesión
                  </button>
                </div>
              ) : (
                <form onSubmit={handleLoginSubmit} style={{ marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, marginBottom: 8, color: '#1E293B' }}>
                    Iniciar Sesión Admin
                  </div>
                  {loginError && (
                    <div style={{ fontSize: '0.78rem', color: '#991B1B', background: '#FEF2F2', padding: '6px 8px', borderRadius: 6, marginBottom: 8 }}>
                      {loginError}
                    </div>
                  )}
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email"
                      placeholder="admin@cuidar.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Contraseña</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="modal-btn"
                    disabled={loginBusy}
                    style={{ background: '#1E293B' }}
                  >
                    {loginBusy ? 'Verificando...' : 'Entrar con Supabase Auth'}
                  </button>
                </form>
              )}

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
                Guardar Configuración
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
