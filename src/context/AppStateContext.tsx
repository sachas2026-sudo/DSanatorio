import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { format } from 'date-fns'
import { pushResumenDiarioToSupabase } from '../lib/supabaseSync'
import { LoadErrorScreen } from '../shared/components/LoadErrorScreen'
import { LoadingScreen } from '../shared/components/LoadingScreen'
import { useConfirm } from './ConfirmContext'
import {
  especialidadKey,
  isEspecialidadComun,
  mergeEspecialidades,
  normalizeEspecialidad,
} from '../lib/especialidades'
import {
  isObraSocialComun,
  mergeObrasSociales,
  normalizeObraSocial,
  obraSocialKey,
} from '../lib/obrasSociales'
import { saveUltimoDniPacCorto } from '../lib/dniLabels'
import { createId } from '../lib/id'
import { getCurrentUserDisplayName } from '../lib/auth'
import {
  finalizeExitBackup,
  readDailyDataBackup,
  readDataBackup,
  applyDataBackupRestore,
  rotateDataBackups,
  saveDailyDataBackup,
  type BackupSlot,
} from '../lib/appBackup'
import {
  saveStorageRaw,
  serializeAppData,
  serializeAppDataForBackup,
} from '../lib/appStorage'
import {
  EMPTY_APP_DATA,
  enrichLoadedData,
  loadFromStorage,
  saveAppData,
} from '../lib/appStateLoad'
import { isTauri } from '@tauri-apps/api/core'
import type {
  AppData,
  AppSettings,
  Appointment,
  PlanAfiliado,
  CuotaMensual,
  Afiliado,
  Doctor,
  DoctorAtencionMensual,
  DoctorDiaLibre,
  DoctorHorario,
  MotivoCancelacionPago,
  Patient,
  Payment,
  PagoCancelado,
  AtencionSinTurnoFila,
} from '../types'
import { sendDatabaseBackupEmail } from '../lib/backupEmail'
import { formatPersistError, logAppError } from '../lib/persistAlert'
import {
  consumeExitBypassCloseGuard,
  setExitBypassCloseGuard,
} from '../lib/exitApp'
import { validateBackupRaw } from '../lib/restoreBackup'
import {
  saveSmtpSecret,
} from '../lib/smtpSecret'
import {
  deleteAtencionSinTurnoListado,
  replaceAtencionSinTurnoListado,
} from '../lib/atencionSinTurno'
import {
  hasArchiveableRecords,
  mergeHistoricoArchives,
  splitArchiveHistorico,
  type ArchiveHistoricoStats,
} from '../lib/archiveHistorico'
import { buildEntityMap } from '../lib/entityIndexes'
import {
  readHistoricoArchive,
  saveHistoricoArchive,
} from '../lib/historicoStorage'
import {
  isLocalidadMisionera,
  localidadKey,
  mergeLocalidadesAny,
  normalizeLocalidad,
} from '../lib/localidadesMisiones'
import {
  isMotivoConsultaBuiltin,
  mergeMotivosConsulta,
  motivoConsultaKey,
  normalizeMotivoConsulta,
} from '../lib/motivoConsulta'

type Ctx = {
  data: AppData
  upsertPatient: (p: Omit<Patient, 'id'> & { id?: string }) => void
  setPatientActivo: (id: string, activo: boolean) => void
  deletePatient: (id: string) => void
  upsertDoctor: (d: Omit<Doctor, 'id'> & { id?: string }) => void
  setDoctorActivo: (id: string, activo: boolean) => void
  deleteDoctor: (id: string) => void
  upsertHorario: (h: Omit<DoctorHorario, 'id'> & { id?: string }) => void
  deleteHorario: (id: string) => void
  deleteHorariosForDoctor: (doctorId: string) => void
  upsertDiaLibre: (d: Omit<DoctorDiaLibre, 'id'> & { id?: string }) => void
  deleteDiaLibre: (id: string) => void
  upsertAtencionMensual: (
    a: Omit<DoctorAtencionMensual, 'id'> & { id?: string },
  ) => void
  deleteAtencionMensual: (id: string) => void
  upsertAppointment: (a: Omit<Appointment, 'id'> & { id?: string }) => void
  deleteAppointment: (id: string) => void
  upsertPayment: (p: Omit<Payment, 'id'> & { id?: string }) => void
  deletePayment: (id: string) => void
  registrarPagoDeudaMedico: (p: {
    doctorId: string
    deudaKey: string
    fecha: string
    monto: number
    metodo: string
    destinatario: string
    nroComprobante: string
    nota: string
  }) => void
  // Afiliados
  upsertPlanAfiliado: (p: Omit<PlanAfiliado, 'id'> & { id?: string }) => void
  deletePlanAfiliado: (id: string) => void
  upsertAfiliado: (a: Omit<Afiliado, 'id'> & { id?: string }) => void
  deleteAfiliado: (id: string) => void
  // `usos` es opcional al crear: recién se suma al agendar un turno con plan,
// así que una cuota nueva arranca en 0 sin que el llamador tenga que decirlo.
  upsertCuotaMensual: (
    c: Omit<CuotaMensual, 'id' | 'usos'> & { id?: string; usos?: number },
  ) => void
  deleteCuotaMensual: (id: string) => void
  // Distribución por médico · Obras Sociales (sólo porcentajes: el resto sale del filtro)
  setDistribucionOSPorcentaje: (obraSocial: string, porcentaje: number) => void
  saveAtencionSinTurnoListado: (payload: {
    doctorId: string
    fecha: string
    filas: AtencionSinTurnoFila[]
  }) => void
  deleteAtencionSinTurnoListado: (payload: {
    doctorId: string
    fecha: string
  }) => void
  /** Elimina el pago, archiva en pagosCancelados y quita el turno vinculado si hay cita */
  archivePagoCancelado: (
    paymentId: string,
    motivo: MotivoCancelacionPago,
    notasOtros?: string,
  ) => void
  /** Elimina turno desde Agenda (y pagos vinculados) archivando en Pagos Cancelados */
  archiveCitaEliminada: (
    appointmentId: string,
    motivo: MotivoCancelacionPago,
    notasOtros?: string,
  ) => void
  /** Cancela turno desde Agenda (conserva el registro) y archiva pagos vinculados */
  archiveCitaCancelada: (
    appointmentId: string,
    motivo: MotivoCancelacionPago,
    notasOtros?: string,
  ) => void
  /** Vacía la lista de pagos cancelados (irreversible). */
  clearPagosCancelados: () => void
  patientById: (id: string) => Patient | undefined
  doctorById: (id: string) => Doctor | undefined
  especialidadesOpciones: string[]
  addEspecialidadCustom: (nombre: string) => { ok: boolean; error?: string }
  removeEspecialidadCustom: (nombre: string) => void
  renameEspecialidadCustom: (
    anterior: string,
    nuevo: string,
  ) => { ok: boolean; error?: string }
  obrasSocialesOpciones: string[]
  addObraSocialCustom: (nombre: string) => { ok: boolean; error?: string }
  removeObraSocialCustom: (nombre: string) => void
  renameObraSocialCustom: (
    anterior: string,
    nuevo: string,
  ) => { ok: boolean; error?: string }
  localidadesOpciones: string[]
  addLocalidadCustom: (nombre: string) => { ok: boolean; error?: string }
  removeLocalidadCustom: (nombre: string) => void
  renameLocalidadCustom: (
    anterior: string,
    nuevo: string,
  ) => { ok: boolean; error?: string }
  motivosConsultaOpciones: string[]
  addMotivoConsultaCustom: (
    nombre: string,
  ) => { ok: true; nombre: string } | { ok: false; error: string }
  removeMotivoConsultaCustom: (nombre: string) => void
  renameMotivoConsultaCustom: (
    anterior: string,
    nuevo: string,
  ) => { ok: boolean; error?: string }
  updateSettings: (patch: Partial<AppSettings>) => void
  /** Guarda en disco y rota las 3 copias de respaldo (al salir). */
  prepareExit: () => Promise<void>
  /** Confirmación + respaldo; true si puede cerrar o salir (C1). */
  requestExit: () => Promise<boolean>
  /** Aviso visible de fallo de guardado o respaldo (C2). */
  systemAlert: string | null
  dismissSystemAlert: () => void
  /** Fallo del respaldo diario de hoy (Dropbox, disco, permisos). */
  dailyBackupAlert: DailyBackupAlert | null
  dismissDailyBackupAlert: () => void
  retryDailyBackup: () => Promise<{ ok: boolean; error?: string }>
  /** Guarda la base actual y crea copia de resguardo ahora (manual o automática). */
  createBackupNow: () => Promise<{ ok: boolean; error?: string }>
  /** Envía la base JSON por correo al Email Gerente (Configuración). */
  sendDatabaseBackupByEmail: (
    settings?: AppSettings,
  ) => Promise<{ ok: boolean; error?: string }>
  restoreFromBackup: (
    slot: BackupSlot,
  ) => Promise<{ ok: boolean; error?: string }>
  restoreFromDailyBackup: (
    date: string,
  ) => Promise<{ ok: boolean; error?: string }>
  /** Mueve turnos/pagos/cancelados antiguos a archivo histórico en datos/historico. */
  archiveHistoricoBeforeCutoff: (
    cutoffDate: string,
  ) => Promise<
    | { ok: true; stats: ArchiveHistoricoStats }
    | { ok: false; error: string }
  >
  syncData: (silent?: boolean) => Promise<boolean>
  syncBusy: boolean
  lastSyncTime: Date | null
}

const AppStateContext = createContext<Ctx | null>(null)

/** Si la carga tarda más que esto, se muestra pantalla de carga. */
const SLOW_LOAD_MS = 450
/** Espera tras el último cambio antes de escribir en disco (evita muchas escrituras seguidas). */
const SAVE_DEBOUNCE_MS = 400
/** Revisa respaldo diario cada hora (con la app abierta). */
const BACKUP_INTERVAL_MS = 60 * 60 * 1000

export type DailyBackupAlert = {
  date: string
  message: string
  failedAt: number
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { confirm } = useConfirm()
  const [data, setData] = useState<AppData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showLoader, setShowLoader] = useState(false)
  const [loaderExiting, setLoaderExiting] = useState(false)
  const [systemAlert, setSystemAlert] = useState<string | null>(null)
  const [dailyBackupAlert, setDailyBackupAlert] = useState<DailyBackupAlert | null>(
    null,
  )
  const [syncBusy, setSyncBusy] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)

  const loaderVisibleRef = useRef(false)
  const loadGenerationRef = useRef(0)
  const dataRef = useRef<AppData | null>(null)
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const skipAutosaveOnceRef = useRef(true)

  const dismissSystemAlert = useCallback(() => {
    setSystemAlert(null)
  }, [])

  const dismissDailyBackupAlert = useCallback(() => {
    setDailyBackupAlert(null)
  }, [])

  const reportPersistError = useCallback((message: string) => {
    setSystemAlert(message)
  }, [])

  const flushPersist = useCallback(async () => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current)
      saveDebounceRef.current = null
    }
    const snapshot = dataRef.current
    if (!snapshot) return
    saveChainRef.current = saveChainRef.current
      .then(() => saveAppData(snapshot))
      .catch((err) => {
        console.error('No se pudieron guardar los datos en disco:', err)
        reportPersistError(
          formatPersistError(
            err,
            'No se pudieron guardar los datos en disco',
          ),
        )
        throw err
      })
    await saveChainRef.current
  }, [reportPersistError])

  const persistSnapshotImmediately = useCallback(
    (snapshot: AppData) => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current)
        saveDebounceRef.current = null
      }
      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(() => saveAppData(snapshot))
        .then(() => {
          if (snapshot.settings?.supabaseUrl && snapshot.settings?.supabaseAnonKey && snapshot.settings?.supabaseAutoSync !== false) {
            void pushResumenDiarioToSupabase(snapshot).catch(() => {})
          }
        })
        .catch((err) => {
          console.error('No se pudieron guardar los datos en disco:', err)
          reportPersistError(
            formatPersistError(
              err,
              'No se pudo guardar el pago de deuda en disco',
            ),
          )
          throw err
        })
      void saveChainRef.current.catch(() => undefined)
    },
    [reportPersistError],
  )

  const syncData = useCallback(async (silent = false): Promise<boolean> => {
    if (saveDebounceRef.current) {
      return false
    }
    if (!silent) setSyncBusy(true)
    try {
      const result = await loadFromStorage()
      if (result.kind === "ok") {
        const enriched = await enrichLoadedData(result.data)
        const currentSnap = dataRef.current
        const currentStr = currentSnap ? serializeAppData(currentSnap) : ""
        const newStr = serializeAppData(enriched)
        if (currentStr !== newStr) {
          dataRef.current = enriched
          skipAutosaveOnceRef.current = true
          setData(enriched)
        }
        setLastSyncTime(new Date())
        if (enriched.settings?.supabaseUrl && enriched.settings?.supabaseAnonKey && enriched.settings?.supabaseAutoSync !== false) {
          void pushResumenDiarioToSupabase(enriched).catch(() => {})
        }
        return true
      }
      return false
    } catch (err) {
      if (!silent) {
        console.warn("Error al sincronizar datos:", err)
      }
      return false
    } finally {
      if (!silent) setSyncBusy(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void syncData(true)
    }, 12000)

    const onFocus = () => {
      void syncData(true)
    }

    window.addEventListener("focus", onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [syncData])

  /** Guarda en disco al salir. */
  const flushPersistForExit = useCallback(async () => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current)
      saveDebounceRef.current = null
    }
    const snapshot = dataRef.current
    if (!snapshot) return
    await saveAppData(snapshot)
  }, [])

  useEffect(() => {
    const generation = ++loadGenerationRef.current
    let slowTimer: ReturnType<typeof window.setTimeout> | undefined

    const run = async () => {
      try {
        slowTimer = window.setTimeout(() => {
          if (generation !== loadGenerationRef.current) return
          loaderVisibleRef.current = true
          setShowLoader(true)
        }, SLOW_LOAD_MS)

        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        const result = await loadFromStorage()

        if (slowTimer !== undefined) window.clearTimeout(slowTimer)
        if (generation !== loadGenerationRef.current) return

        if (loaderVisibleRef.current) {
          setLoaderExiting(true)
          await new Promise<void>((r) => window.setTimeout(r, 220))
          if (generation !== loadGenerationRef.current) return
          setShowLoader(false)
          setLoaderExiting(false)
          loaderVisibleRef.current = false
        }

        document.getElementById('boot-loader')?.remove()

        if (result.kind === 'corrupt') {
          setLoadError(result.message)
          return
        }
        if (result.kind === 'empty') {
          const enriched = await enrichLoadedData({ ...EMPTY_APP_DATA })
          setData(enriched)
          await saveAppData(enriched)
          return
        }
        const enriched = await enrichLoadedData(result.data)
        setData(enriched)
        setLastSyncTime(new Date())
        if (result.integrityAlert) {
          setSystemAlert(result.integrityAlert)
        }
        await saveAppData(enriched)
      } catch (err) {
        if (slowTimer !== undefined) window.clearTimeout(slowTimer)
        if (generation !== loadGenerationRef.current) return
        document.getElementById('boot-loader')?.remove()
        setShowLoader(false)
        setLoaderExiting(false)
        loaderVisibleRef.current = false
        console.error('Error al iniciar la aplicación:', err)
        setLoadError(
          formatPersistError(
            err,
            'No se pudieron cargar los datos de la aplicación',
          ),
        )
      }
    }

    void run()
    return () => {
      if (slowTimer !== undefined) window.clearTimeout(slowTimer)
    }
  }, [])

  useEffect(() => {
    dataRef.current = data
    if (!data) return

    if (skipAutosaveOnceRef.current) {
      skipAutosaveOnceRef.current = false
      return
    }

    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current)
    }
    saveDebounceRef.current = setTimeout(() => {
      saveDebounceRef.current = null
      const snapshot = dataRef.current
      if (!snapshot) return
      saveChainRef.current = saveChainRef.current
        .then(() => saveAppData(snapshot))
        .catch((err) => {
          console.error('No se pudieron guardar los datos en disco:', err)
          reportPersistError(
            formatPersistError(
              err,
              'No se pudieron guardar los cambios en disco',
            ),
          )
          throw err
        })
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current)
        saveDebounceRef.current = null
      }
    }
  }, [data, reportPersistError])

  const archiveHistoricoBeforeCutoff = useCallback(
    async (cutoffDate: string) => {
      if (!dataRef.current) {
        return { ok: false as const, error: 'No hay datos cargados.' }
      }
      try {
        await flushPersist()
        const { active, archive, stats } = splitArchiveHistorico(
          dataRef.current,
          cutoffDate,
        )
        if (!hasArchiveableRecords(stats)) {
          return {
            ok: false as const,
            error: 'No hay registros anteriores a esa fecha para archivar.',
          }
        }
        const existing = await readHistoricoArchive(cutoffDate)
        const payload = existing
          ? mergeHistoricoArchives(existing, archive)
          : archive
        await saveHistoricoArchive(payload)
        setData(active)
        await saveAppData(active)
        return { ok: true as const, stats }
      } catch (err) {
        console.error(err)
        return {
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : 'No se pudo archivar el historial.',
        }
      }
    },
    [flushPersist],
  )

  const createBackupNow = useCallback(async () => {
    if (!dataRef.current) {
      return { ok: false as const, error: 'No hay datos cargados.' }
    }
    try {
      await flushPersist()
      await rotateDataBackups(serializeAppDataForBackup(dataRef.current))
      return { ok: true as const }
    } catch (err) {
      console.error(err)
      return {
        ok: false as const,
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo crear la copia de resguardo.',
      }
    }
  }, [flushPersist])

  const lastDailyBackupDateRef = useRef<string | null>(null)

  const runDailyBackupIfNeeded = useCallback(async () => {
    if (!dataRef.current) return
    const today = format(new Date(), 'yyyy-MM-dd')
    if (lastDailyBackupDateRef.current === today) return
    try {
      await flushPersist()
      await saveDailyDataBackup(serializeAppDataForBackup(dataRef.current), today)
      lastDailyBackupDateRef.current = today
      setDailyBackupAlert(null)
    } catch (err) {
      logAppError('Respaldo diario', err)
      setDailyBackupAlert({
        date: today,
        message: formatPersistError(err, 'No se pudo crear el respaldo diario'),
        failedAt: Date.now(),
      })
    }
  }, [flushPersist])

  const retryDailyBackup = useCallback(async () => {
    if (!dataRef.current) {
      return { ok: false as const, error: 'No hay datos cargados.' }
    }
    const today = format(new Date(), 'yyyy-MM-dd')
    lastDailyBackupDateRef.current = null
    try {
      await flushPersist()
      await saveDailyDataBackup(serializeAppDataForBackup(dataRef.current), today)
      lastDailyBackupDateRef.current = today
      setDailyBackupAlert(null)
      return { ok: true as const }
    } catch (err) {
      logAppError('Reintento respaldo diario', err)
      const message = formatPersistError(err, 'No se pudo crear el respaldo diario')
      setDailyBackupAlert({
        date: today,
        message,
        failedAt: Date.now(),
      })
      return { ok: false as const, error: message }
    }
  }, [flushPersist])

  const runDailyBackupIfNeededRef = useRef(runDailyBackupIfNeeded)

  useEffect(() => {
    runDailyBackupIfNeededRef.current = runDailyBackupIfNeeded
  }, [runDailyBackupIfNeeded])

  const sendDatabaseBackupByEmailFn = useCallback(async (settings?: AppSettings) => {
    if (!dataRef.current) {
      return { ok: false as const, error: 'No hay datos cargados.' }
    }
    try {
      await flushPersist()
      await sendDatabaseBackupEmail(
        settings ?? dataRef.current.settings,
        serializeAppDataForBackup(dataRef.current),
      )
      return { ok: true as const }
    } catch (err) {
      console.error(err)
      return {
        ok: false as const,
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo enviar la copia por correo.',
      }
    }
  }, [flushPersist])

  const prepareExit = useCallback(async () => {
    if (!dataRef.current) return
    await flushPersistForExit()
    const json = serializeAppDataForBackup(dataRef.current)
    await finalizeExitBackup(json)
  }, [flushPersistForExit])

  const requestExit = useCallback(async (): Promise<boolean> => {
    const ok = await confirm({
      titleLogo: true,
      message: '¿Salir del programa?',
    })
    if (!ok) return false
    try {
      await prepareExit()
      return true
    } catch (err) {
      console.error(err)
      reportPersistError(
        formatPersistError(
          err,
          'No se pudo guardar el respaldo al salir',
        ),
      )
      const salirIgual = await confirm({
        titleLogo: true,
        message:
          'No se pudo guardar el respaldo al salir. ¿Salir igualmente?',
        confirmLabel: 'Salir igualmente',
        cancelLabel: 'Cancelar',
      })
      return salirIgual
    }
  }, [confirm, prepareExit, reportPersistError])

  const requestExitRef = useRef(requestExit)

  useEffect(() => {
    requestExitRef.current = requestExit
  }, [requestExit])

  useEffect(() => {
    if (!data) return
    void runDailyBackupIfNeededRef.current()
    const timer = window.setInterval(() => {
      void runDailyBackupIfNeededRef.current()
    }, BACKUP_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [Boolean(data)])

  useEffect(() => {
    if (!isTauri() || !data) return
    let unlisten: (() => void) | undefined
    let closing = false
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      unlisten = await win.onCloseRequested(async (event) => {
        if (consumeExitBypassCloseGuard()) return
        if (closing) return
        event.preventDefault()
        closing = true
        const shouldClose = await requestExitRef.current()
        if (shouldClose) {
          setExitBypassCloseGuard(true)
          await win.destroy()
        } else {
          closing = false
        }
      })
    })()
    return () => {
      unlisten?.()
    }
  }, [data])

  const applyRestoredBackup = useCallback(
    async (
      raw: string,
      companion?: { slot?: BackupSlot; date?: string },
    ) => {
      const { data: parsed, integrityAlert } = validateBackupRaw(raw)
      const enriched = await enrichLoadedData(parsed)
      await applyDataBackupRestore({
        json: serializeAppData(enriched),
        slot: companion?.slot,
        date: companion?.date,
      })
      dataRef.current = enriched
      skipAutosaveOnceRef.current = true
      setData(enriched)
      if (integrityAlert) {
        setSystemAlert(integrityAlert)
      }
      return enriched
    },
    [],
  )

  const restoreFromBackup = useCallback(
    async (slot: BackupSlot) => {
      try {
        const raw = await readDataBackup(slot)
        await applyRestoredBackup(raw, { slot })
        return { ok: true as const }
      } catch (err) {
        console.error(err)
        return {
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : 'No se pudo restaurar el respaldo.',
        }
      }
    },
    [applyRestoredBackup],
  )

  const restoreFromDailyBackup = useCallback(
    async (date: string) => {
      try {
        const raw = await readDailyDataBackup(date)
        await applyRestoredBackup(raw, { date })
        return { ok: true as const }
      } catch (err) {
        console.error(err)
        return {
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : 'No se pudo restaurar el respaldo diario.',
        }
      }
    },
    [applyRestoredBackup],
  )

  const upsertPatient = useCallback((p: Omit<Patient, 'id'> & { id?: string }) => {
    saveUltimoDniPacCorto(p.dni)
    setData((prev) => {
      if (!prev) return prev
      const id = p.id ?? createId()
      const prevPatient = prev.patients.find((x) => x.id === id)
      const next: Patient = {
        id,
        nombre: p.nombre,
        apellido: p.apellido,
        dni: p.dni,
        telefono: p.telefono,
        email: p.email,
        domicilio: p.domicilio ?? '',
        localidad: p.localidad ?? '',
        fechaNacimiento: p.fechaNacimiento,
        obraSocial: p.obraSocial,
        notas: p.notas,
        activo: prevPatient?.activo ?? p.activo ?? true,
        coberturaPreferida: p.coberturaPreferida ?? prevPatient?.coberturaPreferida,
      }
      const exists = prev.patients.some((x) => x.id === id)
      return {
        ...prev,
        patients: exists
          ? prev.patients.map((x) => (x.id === id ? next : x))
          : [...prev.patients, next],
      }
    })
  }, [])

  const setPatientActivo = useCallback((id: string, activo: boolean) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        patients: prev.patients.map((p) =>
          p.id === id ? { ...p, activo } : p,
        ),
      }
    })
  }, [])

  const deletePatient = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      if (!prev.patients.some((p) => p.id === id)) return prev
      return {
        ...prev,
        patients: prev.patients.filter((p) => p.id !== id),
        appointments: prev.appointments.filter((a) => a.patientId !== id),
        payments: prev.payments.filter((p) => p.patientId !== id),
        pagosCancelados: prev.pagosCancelados.filter(
          (r) => r.payment.patientId !== id,
        ),
        atencionesSinTurno: prev.atencionesSinTurno
          .map((list) => ({
            ...list,
            filas: list.filas.filter((f) => f.patientId !== id),
          }))
          .filter((list) => list.filas.length > 0),
      }
    })
  }, [])

  const upsertDoctor = useCallback((d: Omit<Doctor, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = d.id ?? createId()
      const prevDoc = prev.doctors.find((x) => x.id === id)
      const next: Doctor = {
        id,
        nombre: d.nombre,
        apellido: d.apellido,
        dni: d.dni ?? '',
        matricula: d.matricula,
        especialidad: d.especialidad,
        obraSocial: d.obraSocial ?? prevDoc?.obraSocial ?? '',
        obrasSociales:
          d.obrasSociales ??
          (d.obraSocial ? [d.obraSocial] : undefined) ??
          prevDoc?.obrasSociales ??
          (prevDoc?.obraSocial ? [prevDoc.obraSocial] : undefined) ??
          [],
        telefono: d.telefono,
        localidad: d.localidad ?? '',
        email: d.email,
        porcentaje: d.porcentaje,
        duracionTurnoMinutos:
          d.duracionTurnoMinutos ?? prevDoc?.duracionTurnoMinutos ?? 30,
        tipoAgenda: d.tipoAgenda ?? prevDoc?.tipoAgenda ?? 'semanal',
        activo: prevDoc?.activo ?? d.activo ?? true,
      }
      const exists = prev.doctors.some((x) => x.id === id)
      return {
        ...prev,
        doctors: exists
          ? prev.doctors.map((x) => (x.id === id ? next : x))
          : [...prev.doctors, next],
      }
    })
  }, [])

  const setDoctorActivo = useCallback((id: string, activo: boolean) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        doctors: prev.doctors.map((d) =>
          d.id === id ? { ...d, activo } : d,
        ),
      }
    })
  }, [])

  const deleteDoctor = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      if (!prev.doctors.some((d) => d.id === id)) return prev
      return {
        ...prev,
        doctors: prev.doctors.filter((d) => d.id !== id),
        horarios: prev.horarios.filter((h) => h.doctorId !== id),
        diasLibres: prev.diasLibres.filter((d) => d.doctorId !== id),
        atencionesMensuales: prev.atencionesMensuales.filter(
          (a) => a.doctorId !== id,
        ),
        appointments: prev.appointments.filter((a) => a.doctorId !== id),
        payments: prev.payments.filter((p) => p.doctorId !== id),
        pagosCancelados: prev.pagosCancelados.filter(
          (r) => r.payment.doctorId !== id,
        ),
        atencionesSinTurno: prev.atencionesSinTurno.filter(
          (list) => list.doctorId !== id,
        ),
      }
    })
  }, [])

  const upsertHorario = useCallback((h: Omit<DoctorHorario, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = h.id ?? createId()
      const padHm = (t: string) => {
        const parts = t.trim().split(':')
        const hh = Number(parts[0])
        const mm = Number(parts[1])
        if (Number.isNaN(hh) || Number.isNaN(mm)) return t.trim()
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
      }
      const next: DoctorHorario = {
        id,
        doctorId: h.doctorId,
        diaSemana: h.diaSemana,
        horaInicio: padHm(h.horaInicio),
        horaFin: padHm(h.horaFin),
      }
      const exists = prev.horarios.some((x) => x.id === id)
      return {
        ...prev,
        horarios: exists
          ? prev.horarios.map((x) => (x.id === id ? next : x))
          : [...prev.horarios, next],
      }
    })
  }, [])

  const deleteHorario = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        horarios: prev.horarios.filter((x) => x.id !== id),
      }
    })
  }, [])

  const deleteHorariosForDoctor = useCallback((doctorId: string) => {
    if (!doctorId) return
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        horarios: prev.horarios.filter((x) => x.doctorId !== doctorId),
      }
    })
  }, [])

  const upsertDiaLibre = useCallback((d: Omit<DoctorDiaLibre, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = d.id ?? createId()
      const next: DoctorDiaLibre = {
        id,
        doctorId: d.doctorId,
        diaSemana: d.diaSemana,
      }
      const dup = prev.diasLibres.some(
        (x) =>
          x.doctorId === next.doctorId &&
          x.diaSemana === next.diaSemana &&
          x.id !== id,
      )
      if (dup) return prev
      const exists = prev.diasLibres.some((x) => x.id === id)
      return {
        ...prev,
        diasLibres: exists
          ? prev.diasLibres.map((x) => (x.id === id ? next : x))
          : [...prev.diasLibres, next],
      }
    })
  }, [])

  const deleteDiaLibre = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        diasLibres: prev.diasLibres.filter((x) => x.id !== id),
      }
    })
  }, [])

  const upsertAtencionMensual = useCallback(
    (a: Omit<DoctorAtencionMensual, 'id'> & { id?: string }) => {
      setData((prev) => {
        if (!prev) return prev
        const id = a.id ?? createId()
        const next: DoctorAtencionMensual = {
          id,
          doctorId: a.doctorId,
          fecha: a.fecha,
          horaInicio: a.horaInicio,
          horaFin: a.horaFin,
        }
        const exists = prev.atencionesMensuales.some((x) => x.id === id)
        return {
          ...prev,
          atencionesMensuales: exists
            ? prev.atencionesMensuales.map((x) => (x.id === id ? next : x))
            : [...prev.atencionesMensuales, next],
        }
      })
    },
    [],
  )

  const deleteAtencionMensual = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        atencionesMensuales: prev.atencionesMensuales.filter((x) => x.id !== id),
      }
    })
  }, [])

  const upsertAppointment = useCallback((a: Omit<Appointment, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = a.id ?? createId()
      const user = getCurrentUserDisplayName()
      const existing = prev.appointments.find((x) => x.id === id)
      const next: Appointment = {
        id,
        patientId: a.patientId,
        doctorId: a.doctorId,
        fechaHora: a.fechaHora,
        duracionMinutos: a.duracionMinutos,
        notas: a.notas,
        estado: a.estado,
        motivoConsulta2: a.motivoConsulta2?.trim() || undefined,
        obraSocialOverride: a.obraSocialOverride,
        whatsappRecordatorioEnviadoEn: a.whatsappRecordatorioEnviadoEn ?? existing?.whatsappRecordatorioEnviadoEn,
        creadoPor: existing ? (existing.creadoPor || a.creadoPor || user) : (a.creadoPor || user),
        modificadoPor: existing ? user : (a.modificadoPor ?? undefined),
        modificadoEn: existing ? new Date().toISOString() : (a.modificadoEn ?? undefined),
      }
      const exists = Boolean(existing)
      const updatedPayments = prev.payments.map((p) => {
        if (p.citaId === id && p.obraSocialOverride !== a.obraSocialOverride) {
          return {
            ...p,
            obraSocialOverride: a.obraSocialOverride,
          }
        }
        return p
      })
      return {
        ...prev,
        appointments: exists
          ? prev.appointments.map((x) => (x.id === id ? next : x))
          : [...prev.appointments, next],
        payments: updatedPayments,
      }
    })
  }, [])

  const deleteAppointment = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        appointments: prev.appointments.filter((x) => x.id !== id),
        payments: prev.payments.map((p) =>
          p.citaId === id ? { ...p, citaId: null } : p,
        ),
      }
    })
  }, [])

  const upsertPayment = useCallback((p: Omit<Payment, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = p.id ?? createId()
      const user = getCurrentUserDisplayName()
      const existing = prev.payments.find((x) => x.id === id)
      const doctor = prev.doctors.find((d) => d.id === p.doctorId)
      const porcentajeAplicado =
        existing && existing.doctorId === p.doctorId
          ? existing.porcentajeAplicado
          : doctor?.porcentaje
      const next: Payment = {
        id,
        patientId: p.patientId,
        doctorId: p.doctorId,
        citaId: p.citaId,
        monto: p.monto,
        fecha: p.fecha,
        metodo: p.metodo,
        notas: p.notas,
        obraSocialOverride: p.obraSocialOverride,
        porcentajeAplicado,
        registradoPor: existing ? (existing.registradoPor || p.registradoPor || user) : (p.registradoPor || user),
        modificadoPor: existing ? user : (p.modificadoPor ?? undefined),
        modificadoEn: existing ? new Date().toISOString() : (p.modificadoEn ?? undefined),
      }
      const exists = Boolean(existing)
      return {
        ...prev,
        payments: exists
          ? prev.payments.map((x) => (x.id === id ? next : x))
          : [...prev.payments, next],
      }
    })
  }, [])

  const deletePayment = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        payments: prev.payments.filter((x) => x.id !== id),
      }
    })
  }, [])

  // ── Afiliados CRUD ──────────────────────────────────────────────────────

  const upsertPlanAfiliado = useCallback((p: Omit<PlanAfiliado, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = p.id ?? createId()
      const next: PlanAfiliado = {
        id,
        nombre: p.nombre,
        precio: p.precio,
        descripcion: p.descripcion ?? '',
        activo: p.activo ?? true,
        cupoConsultas: p.cupoConsultas ?? 0,
      }
      const exists = prev.planesAfiliados.some((x) => x.id === id)
      return {
        ...prev,
        planesAfiliados: exists
          ? prev.planesAfiliados.map((x) => (x.id === id ? next : x))
          : [...prev.planesAfiliados, next],
      }
    })
  }, [])

  const deletePlanAfiliado = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        planesAfiliados: prev.planesAfiliados.filter((p) => p.id !== id),
      }
    })
  }, [])

  const upsertAfiliado = useCallback((a: Omit<Afiliado, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = a.id ?? createId()
      const next: Afiliado = {
        id,
        patientId: a.patientId,
        planId: a.planId,
        fechaInicio: a.fechaInicio,
        activo: a.activo ?? true,
      }
      const exists = prev.afiliados.some((x) => x.id === id)
      return {
        ...prev,
        afiliados: exists
          ? prev.afiliados.map((x) => (x.id === id ? next : x))
          : [...prev.afiliados, next],
      }
    })
  }, [])

  const deleteAfiliado = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        afiliados: prev.afiliados.filter((a) => a.id !== id),
        cuotasAfiliados: prev.cuotasAfiliados.filter((c) => c.afiliadoId !== id),
      }
    })
  }, [])

  const upsertCuotaMensual = useCallback((c: Omit<CuotaMensual, 'id' | 'usos'> & { id?: string; usos?: number }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = c.id ?? createId()
      const next: CuotaMensual = {
        id,
        afiliadoId: c.afiliadoId,
        mes: c.mes,
        anio: c.anio,
        monto: c.monto,
        estado: c.estado,
        fechaPago: c.fechaPago ?? null,
        formaPago: c.formaPago ?? null,
        comprobante: c.comprobante ?? false,
        notas: c.notas ?? '',
        usos: c.usos ?? 0,
      }
      const exists = prev.cuotasAfiliados.some((x) => x.id === id)
      return {
        ...prev,
        cuotasAfiliados: exists
          ? prev.cuotasAfiliados.map((x) => (x.id === id ? next : x))
          : [...prev.cuotasAfiliados, next],
      }
    })
  }, [])

  const deleteCuotaMensual = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        cuotasAfiliados: prev.cuotasAfiliados.filter((c) => c.id !== id),
      }
    })
  }, [])

  // ── Distribución por médico · Obras Sociales ────────────────────────
  // Nota: no se guardan médicos ni montos porque ambos salen del filtro de
  // Pagos; acá sólo persisten los porcentajes por obra social.

  /** Fija el porcentaje de una obra social (acotado a 0–100). */
  const setDistribucionOSPorcentaje = useCallback(
    (obraSocial: string, porcentaje: number) => {
      setData((prev) => {
        if (!prev) return prev
        const lista = prev.distribucionOSPercentajes ?? []
        const existe = lista.some((x) => x.obraSocial === obraSocial)
        const valor = Math.min(100, Math.max(0, porcentaje))
        return {
          ...prev,
          distribucionOSPercentajes: existe
            ? lista.map((x) =>
                x.obraSocial === obraSocial ? { ...x, porcentaje: valor } : x,
              )
            : [...lista, { obraSocial, porcentaje: valor }],
        }
      })
    },
    [],
  )

  const registrarPagoDeudaMedico = useCallback((p: {
    doctorId: string
    deudaKey: string
    fecha: string
    monto: number
    metodo: string
    destinatario: string
    nroComprobante: string
    nota: string
  }) => {
    const prev = dataRef.current
    if (!prev) return
    const next: AppData = {
      ...prev,
      pagosDeudasMedicos: [
        ...(prev.pagosDeudasMedicos ?? []),
        { ...p, id: createId() },
      ],
    }
    dataRef.current = next
    setData(next)
    persistSnapshotImmediately(next)
  }, [persistSnapshotImmediately])

  const saveAtencionSinTurnoListadoFn = useCallback(
    (payload: {
      doctorId: string
      fecha: string
      filas: AtencionSinTurnoFila[]
    }) => {
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          atencionesSinTurno: replaceAtencionSinTurnoListado(
            prev.atencionesSinTurno,
            payload,
          ),
        }
      })
    },
    [],
  )

  const deleteAtencionSinTurnoListadoFn = useCallback(
    (payload: { doctorId: string; fecha: string }) => {
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          atencionesSinTurno: deleteAtencionSinTurnoListado(
            prev.atencionesSinTurno,
            payload.doctorId,
            payload.fecha,
          ),
        }
      })
    },
    [],
  )

  const archivePagoCancelado = useCallback(
    (
      paymentId: string,
      motivo: MotivoCancelacionPago,
      notasOtros = '',
    ) => {
      setData((prev) => {
        if (!prev) return prev
        const payment = prev.payments.find((p) => p.id === paymentId)
        if (!payment) return prev

        const appointment = payment.citaId
          ? (prev.appointments.find((a) => a.id === payment.citaId) ?? null)
          : null

        const currentUser = getCurrentUserDisplayName()
        const registro: PagoCancelado = {
          id: createId(),
          motivo,
          canceladoEn: new Date().toISOString(),
          payment: { ...payment },
          appointment: appointment ? { ...appointment } : null,
          notasOtros: motivo === 'otros' ? notasOtros.trim() : '',
          canceladoPor: currentUser,
        }

        return {
          ...prev,
          payments: prev.payments.filter((p) => p.id !== paymentId),
          appointments: appointment
            ? prev.appointments.filter((a) => a.id !== appointment.id)
            : prev.appointments,
          pagosCancelados: [...prev.pagosCancelados, registro],
        }
      })
    },
    [],
  )

  const archiveCitaEliminada = useCallback(
    (
      appointmentId: string,
      motivo: MotivoCancelacionPago,
      notasOtros = '',
    ) => {
      setData((prev) => {
        if (!prev) return prev
        const appointment = prev.appointments.find((a) => a.id === appointmentId)
        if (!appointment) return prev

        const linkedPayments = prev.payments.filter(
          (p) => p.citaId === appointmentId,
        )
        const canceladoEn = new Date().toISOString()
        const notas =
          motivo === 'otros' ? notasOtros.trim() : ''
        const currentUser = getCurrentUserDisplayName()

        const nuevos: typeof prev.pagosCancelados = []

        if (linkedPayments.length > 0) {
          for (const payment of linkedPayments) {
            nuevos.push({
              id: createId(),
              motivo,
              canceladoEn,
              payment: { ...payment },
              appointment: { ...appointment },
              notasOtros: notas,
              canceladoPor: currentUser,
            })
          }
        } else {
          nuevos.push({
            id: createId(),
            motivo,
            canceladoEn,
            payment: {
              id: createId(),
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              citaId: appointment.id,
              monto: 0,
              fecha: appointment.fechaHora,
              metodo: '',
              notas: '',
            },
            appointment: { ...appointment },
            notasOtros: notas,
            canceladoPor: currentUser,
          })
        }

        const paymentIds = new Set(linkedPayments.map((p) => p.id))
        return {
          ...prev,
          appointments: prev.appointments.filter((a) => a.id !== appointmentId),
          payments: prev.payments.filter((p) => !paymentIds.has(p.id)),
          pagosCancelados: [...prev.pagosCancelados, ...nuevos],
        }
      })
    },
    [],
  )

  const archiveCitaCancelada = useCallback(
    (
      appointmentId: string,
      motivo: MotivoCancelacionPago,
      notasOtros = '',
    ) => {
      setData((prev) => {
        if (!prev) return prev
        const appointment = prev.appointments.find((a) => a.id === appointmentId)
        if (!appointment) return prev

        const linkedPayments = prev.payments.filter(
          (p) => p.citaId === appointmentId,
        )
        const canceladoEn = new Date().toISOString()
        const notas =
          motivo === 'otros' ? notasOtros.trim() : ''
        const appointmentCancelado = { ...appointment, estado: 'cancelado' as const }

        const nuevos: typeof prev.pagosCancelados = []

        if (linkedPayments.length > 0) {
          for (const payment of linkedPayments) {
            nuevos.push({
              id: createId(),
              motivo,
              canceladoEn,
              payment: { ...payment },
              appointment: { ...appointmentCancelado },
              notasOtros: notas,
            })
          }
        } else {
          nuevos.push({
            id: createId(),
            motivo,
            canceladoEn,
            payment: {
              id: createId(),
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              citaId: appointment.id,
              monto: 0,
              fecha: appointment.fechaHora,
              metodo: '',
              notas: '',
            },
            appointment: { ...appointmentCancelado },
            notasOtros: notas,
          })
        }

        const paymentIds = new Set(linkedPayments.map((p) => p.id))
        return {
          ...prev,
          appointments: prev.appointments.map((a) =>
            a.id === appointmentId ? appointmentCancelado : a,
          ),
          payments: prev.payments.filter((p) => !paymentIds.has(p.id)),
          pagosCancelados: [...prev.pagosCancelados, ...nuevos],
        }
      })
    },
    [],
  )

  const clearPagosCancelados = useCallback(() => {
    setData((prev) => {
      if (!prev) return prev
      if (prev.pagosCancelados.length === 0) return prev
      return { ...prev, pagosCancelados: [] }
    })
  }, [])

  const patientsById = useMemo(
    () => (data ? buildEntityMap(data.patients) : new Map()),
    [data?.patients],
  )
  const doctorsById = useMemo(
    () => (data ? buildEntityMap(data.doctors) : new Map()),
    [data?.doctors],
  )
  const patientById = useCallback(
    (id: string) => patientsById.get(id),
    [patientsById],
  )
  const doctorById = useCallback(
    (id: string) => doctorsById.get(id),
    [doctorsById],
  )

  const especialidadesOpciones = useMemo(
    () =>
      data
        ? mergeEspecialidades(data.especialidadesCustom, data.doctors)
        : [],
    [data?.especialidadesCustom, data?.doctors],
  )

  const addEspecialidadCustom = useCallback((nombre: string) => {
    const n = normalizeEspecialidad(nombre)
    if (!n) return { ok: false as const, error: 'Ingresá un nombre.' }
    if (isEspecialidadComun(n)) {
      return { ok: false as const, error: 'Ya está en la lista habitual.' }
    }
    const key = especialidadKey(n)
    let added = false
    setData((prev) => {
      if (!prev) return prev
      if (
        prev.especialidadesCustom.some((e) => especialidadKey(e) === key) ||
        prev.doctors.some((d) => especialidadKey(d.especialidad) === key)
      ) {
        return prev
      }
      added = true
      return {
        ...prev,
        especialidadesCustom: [...prev.especialidadesCustom, n].sort((a, b) =>
          a.localeCompare(b, 'es'),
        ),
      }
    })
    if (!added) {
      return { ok: false as const, error: 'Esa especialidad ya existe.' }
    }
    return { ok: true as const }
  }, [])

  const removeEspecialidadCustom = useCallback((nombre: string) => {
    const key = especialidadKey(nombre)
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        especialidadesCustom: prev.especialidadesCustom.filter(
          (e) => especialidadKey(e) !== key,
        ),
      }
    })
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      if ('clave' in patch) {
        void saveSmtpSecret(patch.clave ?? '')
      }
      setData((prev) => {
        if (!prev) return prev
        const next: AppData = {
          ...prev,
          settings: { ...prev.settings, ...patch },
        }
        persistSnapshotImmediately(next)
        return next
      })
    },
    [persistSnapshotImmediately],
  )

  const obrasSocialesOpciones = useMemo(
    () =>
      data ? mergeObrasSociales(data.obrasSocialesCustom, data.patients) : [],
    [data?.obrasSocialesCustom, data?.patients],
  )

  const addObraSocialCustom = useCallback((nombre: string) => {
    const n = normalizeObraSocial(nombre)
    if (!n) return { ok: false as const, error: 'Ingresá un nombre.' }
    if (isObraSocialComun(n)) {
      return { ok: false as const, error: 'Ya está en la lista habitual.' }
    }
    const key = obraSocialKey(n)
    let added = false
    setData((prev) => {
      if (!prev) return prev
      if (
        prev.obrasSocialesCustom.some((o) => obraSocialKey(o) === key) ||
        prev.patients.some((p) => obraSocialKey(p.obraSocial) === key)
      ) {
        return prev
      }
      added = true
      return {
        ...prev,
        obrasSocialesCustom: [...prev.obrasSocialesCustom, n].sort((a, b) =>
          a.localeCompare(b, 'es'),
        ),
      }
    })
    if (!added) {
      return { ok: false as const, error: 'Esa obra social ya existe.' }
    }
    return { ok: true as const }
  }, [])

  const removeObraSocialCustom = useCallback((nombre: string) => {
    const key = obraSocialKey(nombre)
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        obrasSocialesCustom: prev.obrasSocialesCustom.filter(
          (o) => obraSocialKey(o) !== key,
        ),
      }
    })
  }, [])

  const renameObraSocialCustom = useCallback(
    (anterior: string, nuevo: string) => {
      const n = normalizeObraSocial(nuevo)
      if (!n) return { ok: false as const, error: 'Ingresá un nombre.' }
      if (isObraSocialComun(n)) {
        return { ok: false as const, error: 'Ya está en la lista habitual.' }
      }
      const oldKey = obraSocialKey(anterior)
      const newKey = obraSocialKey(n)
      if (oldKey === newKey) return { ok: true as const }

      let conflict = false
      setData((prev) => {
        if (!prev) return prev
        const exists =
          prev.obrasSocialesCustom.some(
            (o) => obraSocialKey(o) === newKey && obraSocialKey(o) !== oldKey,
          ) ||
          prev.patients.some(
            (p) =>
              obraSocialKey(p.obraSocial) === newKey &&
              obraSocialKey(p.obraSocial) !== oldKey,
          )
        if (exists) {
          conflict = true
          return prev
        }
        return {
          ...prev,
          obrasSocialesCustom: prev.obrasSocialesCustom.map((o) =>
            obraSocialKey(o) === oldKey ? n : o,
          ),
          patients: prev.patients.map((p) =>
            obraSocialKey(p.obraSocial) === oldKey
              ? { ...p, obraSocial: n }
              : p,
          ),
        }
      })
      if (conflict) {
        return { ok: false as const, error: 'Esa obra social ya existe.' }
      }
      return { ok: true as const }
    },
    [],
  )

  const localidadesOpciones = useMemo(
    () =>
      data
        ? mergeLocalidadesAny(data.localidadesCustom, data.patients, data.doctors)
        : [],
    [data?.localidadesCustom, data?.patients, data?.doctors],
  )

  const addLocalidadCustom = useCallback((nombre: string) => {
    const n = normalizeLocalidad(nombre)
    if (!n) return { ok: false as const, error: 'Ingresá un nombre.' }
    if (isLocalidadMisionera(n)) {
      return { ok: false as const, error: 'Ya está en la lista de Misiones.' }
    }
    const key = localidadKey(n)
    let added = false
    setData((prev) => {
      if (!prev) return prev
      if (
        prev.localidadesCustom.some((l) => localidadKey(l) === key) ||
        prev.patients.some((p) => localidadKey(p.localidad) === key)
      ) {
        return prev
      }
      added = true
      return {
        ...prev,
        localidadesCustom: [...prev.localidadesCustom, n].sort((a, b) =>
          a.localeCompare(b, 'es'),
        ),
      }
    })
    if (!added) {
      return { ok: false as const, error: 'Esa localidad ya existe.' }
    }
    return { ok: true as const }
  }, [])

  const removeLocalidadCustom = useCallback((nombre: string) => {
    const key = localidadKey(nombre)
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        localidadesCustom: prev.localidadesCustom.filter(
          (l) => localidadKey(l) !== key,
        ),
      }
    })
  }, [])

  const renameLocalidadCustom = useCallback(
    (anterior: string, nuevo: string) => {
      const n = normalizeLocalidad(nuevo)
      if (!n) return { ok: false as const, error: 'Ingresá un nombre.' }
      if (isLocalidadMisionera(n)) {
        return { ok: false as const, error: 'Ya está en la lista de Misiones.' }
      }
      const oldKey = localidadKey(anterior)
      const newKey = localidadKey(n)
      if (oldKey === newKey) return { ok: true as const }

      let conflict = false
      setData((prev) => {
        if (!prev) return prev
        const exists =
          prev.localidadesCustom.some(
            (l) => localidadKey(l) === newKey && localidadKey(l) !== oldKey,
          ) ||
          prev.patients.some(
            (p) =>
              localidadKey(p.localidad) === newKey &&
              localidadKey(p.localidad) !== oldKey,
          )
        if (exists) {
          conflict = true
          return prev
        }
        return {
          ...prev,
          localidadesCustom: prev.localidadesCustom.map((l) =>
            localidadKey(l) === oldKey ? n : l,
          ),
          patients: prev.patients.map((p) =>
            localidadKey(p.localidad) === oldKey
              ? { ...p, localidad: n }
              : p,
          ),
        }
      })
      if (conflict) {
        return { ok: false as const, error: 'Esa localidad ya existe.' }
      }
      return { ok: true as const }
    },
    [],
  )

  const motivosConsultaOpciones = useMemo(
    () =>
      data ? mergeMotivosConsulta(data.motivosConsultaCustom) : [],
    [data?.motivosConsultaCustom],
  )

  const addMotivoConsultaCustom = useCallback((nombre: string) => {
    const n = normalizeMotivoConsulta(nombre)
    if (!n) return { ok: false as const, error: 'Ingresá un motivo.' }
    if (n === 'Otro') {
      return { ok: false as const, error: '"Otro" ya está en la lista.' }
    }
    if (isMotivoConsultaBuiltin(n)) {
      return { ok: false as const, error: 'Ya está en la lista habitual.' }
    }
    const key = motivoConsultaKey(n)
    let added = false
    setData((prev) => {
      if (!prev) return prev
      if (
        prev.motivosConsultaCustom.some((m) => motivoConsultaKey(m) === key) ||
        mergeMotivosConsulta([]).some((m) => motivoConsultaKey(m) === key)
      ) {
        return prev
      }
      added = true
      return {
        ...prev,
        motivosConsultaCustom: [...prev.motivosConsultaCustom, n].sort((a, b) =>
          a.localeCompare(b, 'es'),
        ),
      }
    })
    if (!added) {
      return { ok: false as const, error: 'Ese motivo ya existe.' }
    }
    return { ok: true as const, nombre: n }
  }, [])

  const removeMotivoConsultaCustom = useCallback((nombre: string) => {
    const key = motivoConsultaKey(nombre)
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        motivosConsultaCustom: prev.motivosConsultaCustom.filter(
          (m) => motivoConsultaKey(m) !== key,
        ),
      }
    })
  }, [])

  const renameMotivoConsultaCustom = useCallback(
    (anterior: string, nuevo: string) => {
      const n = normalizeMotivoConsulta(nuevo)
      if (!n) return { ok: false as const, error: 'Ingresá un motivo.' }
      if (n === 'Otro') {
        return { ok: false as const, error: '"Otro" ya está en la lista.' }
      }
      if (isMotivoConsultaBuiltin(n)) {
        return { ok: false as const, error: 'Ya está en la lista habitual.' }
      }
      const oldKey = motivoConsultaKey(anterior)
      const newKey = motivoConsultaKey(n)
      if (oldKey === newKey) return { ok: true as const }

      let conflict = false
      setData((prev) => {
        if (!prev) return prev
        const exists =
          prev.motivosConsultaCustom.some(
            (m) =>
              motivoConsultaKey(m) === newKey && motivoConsultaKey(m) !== oldKey,
          ) ||
          mergeMotivosConsulta([]).some(
            (m) =>
              motivoConsultaKey(m) === newKey && motivoConsultaKey(m) !== oldKey,
          )
        if (exists) {
          conflict = true
          return prev
        }
        return {
          ...prev,
          motivosConsultaCustom: prev.motivosConsultaCustom
            .map((m) => (motivoConsultaKey(m) === oldKey ? n : m))
            .sort((a, b) => a.localeCompare(b, 'es')),
        }
      })
      if (conflict) {
        return { ok: false as const, error: 'Ese motivo ya existe.' }
      }
      return { ok: true as const }
    },
    [],
  )

  const renameEspecialidadCustom = useCallback(
    (anterior: string, nuevo: string) => {
      const n = normalizeEspecialidad(nuevo)
      if (!n) return { ok: false as const, error: 'Ingresá un nombre.' }
      if (isEspecialidadComun(n)) {
        return { ok: false as const, error: 'Ya está en la lista habitual.' }
      }
      const oldKey = especialidadKey(anterior)
      const newKey = especialidadKey(n)
      if (oldKey === newKey) return { ok: true as const }

      let conflict = false
      setData((prev) => {
        if (!prev) return prev
        const exists =
          prev.especialidadesCustom.some(
            (e) =>
              especialidadKey(e) === newKey && especialidadKey(e) !== oldKey,
          ) ||
          prev.doctors.some(
            (d) =>
              especialidadKey(d.especialidad) === newKey &&
              especialidadKey(d.especialidad) !== oldKey,
          )
        if (exists) {
          conflict = true
          return prev
        }
        return {
          ...prev,
          especialidadesCustom: prev.especialidadesCustom.map((e) =>
            especialidadKey(e) === oldKey ? n : e,
          ),
          doctors: prev.doctors.map((d) =>
            especialidadKey(d.especialidad) === oldKey
              ? { ...d, especialidad: n }
              : d,
          ),
        }
      })
      if (conflict) {
        return { ok: false as const, error: 'Esa especialidad ya existe.' }
      }
      return { ok: true as const }
    },
    [],
  )

  const value = useMemo(
    () => ({
      data: data!,
      upsertPatient,
      setPatientActivo,
      deletePatient,
      upsertDoctor,
      setDoctorActivo,
      deleteDoctor,
      upsertHorario,
      deleteHorario,
      deleteHorariosForDoctor,
      upsertDiaLibre,
      deleteDiaLibre,
      upsertAtencionMensual,
      deleteAtencionMensual,
      upsertAppointment,
      deleteAppointment,
      upsertPayment,
      deletePayment,
      registrarPagoDeudaMedico,
      upsertPlanAfiliado,
      deletePlanAfiliado,
      upsertAfiliado,
      deleteAfiliado,
      upsertCuotaMensual,
      deleteCuotaMensual,
      setDistribucionOSPorcentaje,
      saveAtencionSinTurnoListado: saveAtencionSinTurnoListadoFn,
      deleteAtencionSinTurnoListado: deleteAtencionSinTurnoListadoFn,
      archivePagoCancelado,
      archiveCitaEliminada,
      archiveCitaCancelada,
      clearPagosCancelados,
      patientById,
      doctorById,
      especialidadesOpciones,
      addEspecialidadCustom,
      removeEspecialidadCustom,
      renameEspecialidadCustom,
      obrasSocialesOpciones,
      addObraSocialCustom,
      removeObraSocialCustom,
      renameObraSocialCustom,
      localidadesOpciones,
      addLocalidadCustom,
      removeLocalidadCustom,
      renameLocalidadCustom,
      motivosConsultaOpciones,
      addMotivoConsultaCustom,
      removeMotivoConsultaCustom,
      renameMotivoConsultaCustom,
      updateSettings,
      prepareExit,
      requestExit,
      systemAlert,
      dismissSystemAlert,
      dailyBackupAlert,
      dismissDailyBackupAlert,
      retryDailyBackup,
      createBackupNow,
      sendDatabaseBackupByEmail: sendDatabaseBackupByEmailFn,
      restoreFromBackup,
      restoreFromDailyBackup,
      archiveHistoricoBeforeCutoff,
      syncData,
      syncBusy,
      lastSyncTime,
    }),
    [
      data,
      upsertPatient,
      setPatientActivo,
      deletePatient,
      upsertDoctor,
      setDoctorActivo,
      deleteDoctor,
      upsertHorario,
      deleteHorario,
      deleteHorariosForDoctor,
      upsertDiaLibre,
      deleteDiaLibre,
      upsertAtencionMensual,
      deleteAtencionMensual,
      upsertAppointment,
      deleteAppointment,
      upsertPayment,
      deletePayment,
      registrarPagoDeudaMedico,
      upsertPlanAfiliado,
      deletePlanAfiliado,
      upsertAfiliado,
      deleteAfiliado,
      upsertCuotaMensual,
      deleteCuotaMensual,
      setDistribucionOSPorcentaje,
      saveAtencionSinTurnoListadoFn,
      deleteAtencionSinTurnoListadoFn,
      archivePagoCancelado,
      archiveCitaEliminada,
      archiveCitaCancelada,
      clearPagosCancelados,
      patientById,
      doctorById,
      especialidadesOpciones,
      addEspecialidadCustom,
      removeEspecialidadCustom,
      renameEspecialidadCustom,
      obrasSocialesOpciones,
      addObraSocialCustom,
      removeObraSocialCustom,
      renameObraSocialCustom,
      localidadesOpciones,
      addLocalidadCustom,
      removeLocalidadCustom,
      renameLocalidadCustom,
      motivosConsultaOpciones,
      addMotivoConsultaCustom,
      removeMotivoConsultaCustom,
      renameMotivoConsultaCustom,
      updateSettings,
      prepareExit,
      requestExit,
      systemAlert,
      dismissSystemAlert,
      dailyBackupAlert,
      dismissDailyBackupAlert,
      retryDailyBackup,
      createBackupNow,
      sendDatabaseBackupByEmailFn,
      restoreFromBackup,
      restoreFromDailyBackup,
      archiveHistoricoBeforeCutoff,
      syncData,
      syncBusy,
      lastSyncTime,
    ],
  )

  if (loadError) {
    return (
      <LoadErrorScreen
        message={loadError}
        onRestore={async (slot) => {
          const result = await restoreFromBackup(slot)
          if (result.ok) {
            setLoadError(null)
            return
          }
          void confirm({
            title: 'ADMINISTRACION',
            message: result.error ?? `No se pudo restaurar el respaldo ${slot}.`,
          })
        }}
        onStartEmpty={async () => {
          const ok = await confirm({
            title: 'ADMINISTRACION',
            message:
              '¿Iniciar con una base vacía?\n\nEl archivo dañado no se usará. No se cargarán pacientes ni médicos de demostración.',
            confirmLabel: 'Base vacía',
            cancelLabel: 'Cancelar',
          })
          if (!ok) return
          const vacia = { ...EMPTY_APP_DATA }
          dataRef.current = vacia
          skipAutosaveOnceRef.current = true
          setData(vacia)
          setLoadError(null)
          try {
            await saveStorageRaw(serializeAppData(vacia))
          } catch (err) {
            console.error(err)
            void confirm({
              title: 'ADMINISTRACION',
              message: formatPersistError(
                err,
                'No se pudo guardar la base vacía en disco',
              ),
            })
          }
        }}
      />
    )
  }

  if (!data) {
    return showLoader ? (
      <LoadingScreen exiting={loaderExiting} />
    ) : (
      <div className="boot-placeholder" aria-hidden />
    )
  }

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  )
}

export function useAppState() {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState debe usarse dentro de AppStateProvider')
  return ctx
}
