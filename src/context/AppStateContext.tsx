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
import { LoadErrorScreen } from '../components/LoadErrorScreen'
import { LoadingScreen } from '../components/LoadingScreen'
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
import { createId } from '../lib/id'
import { format } from 'date-fns'
import {
  finalizeExitBackup,
  restoreDataBackup,
  rotateDataBackups,
  saveDailyDataBackup,
  type BackupSlot,
} from '../lib/appBackup'
import {
  loadStorageRaw,
  saveStorageRaw,
  serializeAppData,
} from '../lib/appStorage'
import { isTauri } from '@tauri-apps/api/core'
import { generateDemoDoctors, generateDemoPatients } from '../lib/seedData'
import type {
  AppData,
  AppSettings,
  Appointment,
  Doctor,
  DoctorAtencionMensual,
  DoctorDiaLibre,
  DoctorHorario,
  MotivoCancelacionPago,
  Patient,
  Payment,
  PagoCancelado,
} from '../types'
import { sendDatabaseBackupEmail } from '../lib/backupEmail'
import { formatPersistError, logAppError } from '../lib/persistAlert'
import {
  migrateSmtpSecretFromSettings,
  saveSmtpSecret,
} from '../lib/smtpSecret'
import { parseAppDataJson } from '../lib/parseAppData'
import {
  isLocalidadMisionera,
  localidadKey,
  mergeLocalidadesAny,
  normalizeLocalidad,
} from '../lib/localidadesMisiones'
const empty: AppData = {
  patients: [],
  doctors: [],
  horarios: [],
  diasLibres: [],
  atencionesMensuales: [],
  appointments: [],
  payments: [],
  pagosCancelados: [],
  especialidadesCustom: [],
  obrasSocialesCustom: [],
  localidadesCustom: [],
  settings: {
    email: '',
    emailGerente: '',
    telefonoGerente: '',
    clave: '',
    telefono: '',
    cuit: '',
  },
}

function withDemoData(data: AppData): AppData {
  const needsPatients = data.patients.length === 0
  const needsDoctors = data.doctors.length === 0
  if (!needsPatients && !needsDoctors) return data
  return {
    ...data,
    patients: needsPatients ? generateDemoPatients() : data.patients,
    doctors: needsDoctors ? generateDemoDoctors() : data.doctors,
  }
}

function parseStoredData(raw: string): AppData {
  return withDemoData(parseAppDataJson(raw))
}

type StorageLoadResult =
  | { kind: 'ok'; data: AppData }
  | { kind: 'empty' }
  | { kind: 'corrupt'; message: string }

async function loadFromStorage(): Promise<StorageLoadResult> {
  try {
    let timeoutId: ReturnType<typeof window.setTimeout> | undefined
    const raw = await Promise.race([
      loadStorageRaw(),
      new Promise<string | null>((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new Error(
                'Tardó demasiado en leer la base de datos. Cerrá otros programas que la usen o reiniciá la PC.',
              ),
            ),
          LOAD_READ_TIMEOUT_MS,
        )
      }),
    ])
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    if (!raw?.trim()) return { kind: 'empty' }
    try {
      const data = parseStoredData(raw)
      return { kind: 'ok', data }
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : 'Error al interpretar el archivo.'
      return {
        kind: 'corrupt',
        message: detail,
      }
    }
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : 'No se pudo leer el archivo de datos.'
    return { kind: 'corrupt', message: detail }
  }
}

async function enrichLoadedData(data: AppData): Promise<AppData> {
  const clave = await migrateSmtpSecretFromSettings(data.settings)
  return {
    ...data,
    settings: { ...data.settings, clave },
  }
}

async function save(data: AppData): Promise<void> {
  await saveStorageRaw(serializeAppData(data))
}

type Ctx = {
  data: AppData
  upsertPatient: (p: Omit<Patient, 'id'> & { id?: string }) => void
  deletePatient: (id: string) => void
  upsertDoctor: (d: Omit<Doctor, 'id'> & { id?: string }) => void
  deleteDoctor: (id: string) => void
  upsertHorario: (h: Omit<DoctorHorario, 'id'> & { id?: string }) => void
  deleteHorario: (id: string) => void
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
  patientById: (id: string) => Patient | undefined
  doctorById: (id: string) => Doctor | undefined
  ensureDemoDoctors: () => void
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
  updateSettings: (patch: Partial<AppSettings>) => void
  /** Guarda en disco y rota las 3 copias de respaldo (al salir). */
  prepareExit: () => Promise<void>
  /** Confirmación + respaldo; true si puede cerrar o salir (C1). */
  requestExit: () => Promise<boolean>
  /** Aviso visible de fallo de guardado o respaldo (C2). */
  systemAlert: string | null
  dismissSystemAlert: () => void
  /** Guarda la base actual y crea copia de resguardo ahora (manual o automática). */
  createBackupNow: () => Promise<{ ok: boolean; error?: string }>
  /** Envía la base JSON por correo al Email Gerente (Configuración). */
  sendDatabaseBackupByEmail: (
    settings?: AppSettings,
  ) => Promise<{ ok: boolean; error?: string }>
  restoreFromBackup: (
    slot: BackupSlot,
  ) => Promise<{ ok: boolean; error?: string }>
}

const AppStateContext = createContext<Ctx | null>(null)

/** Si la carga tarda más que esto, se muestra pantalla de carga. */
const SLOW_LOAD_MS = 450
/** Tiempo máximo para leer el archivo de datos desde disco. */
const LOAD_READ_TIMEOUT_MS = 25_000
/** Espera tras el último cambio antes de escribir en disco (evita muchas escrituras seguidas). */
const SAVE_DEBOUNCE_MS = 400
/** Copia de resguardo automática cada hora (con la app abierta). */
const BACKUP_INTERVAL_MS = 60 * 60 * 1000

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { confirm } = useConfirm()
  const [data, setData] = useState<AppData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showLoader, setShowLoader] = useState(false)
  const [loaderExiting, setLoaderExiting] = useState(false)
  const [systemAlert, setSystemAlert] = useState<string | null>(null)

  const loaderVisibleRef = useRef(false)
  const loadGenerationRef = useRef(0)
  const dataRef = useRef<AppData | null>(null)
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const skipAutosaveOnceRef = useRef(true)

  const dismissSystemAlert = useCallback(() => {
    setSystemAlert(null)
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
      .then(() => save(snapshot))
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

  useEffect(() => {
    const generation = ++loadGenerationRef.current
    let slowTimer: ReturnType<typeof window.setTimeout> | undefined

    const run = async () => {
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
        setData(await enrichLoadedData(withDemoData({ ...empty })))
        return
      }
      setData(await enrichLoadedData(result.data))
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
        .then(() => save(snapshot))
        .catch((err) => {
          console.error('No se pudieron guardar los datos en disco:', err)
          reportPersistError(
            formatPersistError(
              err,
              'No se pudieron guardar los cambios en disco',
            ),
          )
        })
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current)
        saveDebounceRef.current = null
      }
    }
  }, [data, reportPersistError])

  const createBackupNow = useCallback(async () => {
    if (!dataRef.current) {
      return { ok: false as const, error: 'No hay datos cargados.' }
    }
    try {
      await flushPersist()
      await rotateDataBackups(serializeAppData(dataRef.current))
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

  const createBackupNowRef = useRef(createBackupNow)
  const lastDailyBackupDateRef = useRef<string | null>(null)
  const dailyBackupFailedRef = useRef(false)

  useEffect(() => {
    createBackupNowRef.current = createBackupNow
  }, [createBackupNow])

  const runDailyBackupIfNeeded = useCallback(async () => {
    if (!dataRef.current) return
    const today = format(new Date(), 'yyyy-MM-dd')
    if (lastDailyBackupDateRef.current === today) return
    try {
      await flushPersist()
      await saveDailyDataBackup(serializeAppData(dataRef.current), today)
      lastDailyBackupDateRef.current = today
      dailyBackupFailedRef.current = false
    } catch (err) {
      logAppError('Respaldo diario', err)
      if (!dailyBackupFailedRef.current) {
        dailyBackupFailedRef.current = true
        reportPersistError(
          formatPersistError(err, 'No se pudo crear el respaldo diario'),
        )
      }
    }
  }, [flushPersist, reportPersistError])

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
        serializeAppData(dataRef.current),
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
    await flushPersist()
    const json = serializeAppData(dataRef.current)
    await finalizeExitBackup(json)
  }, [flushPersist])

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
      void createBackupNowRef.current().then((result) => {
        if (!result.ok) {
          console.error('Respaldo automático:', result.error)
          reportPersistError(
            `No se pudo crear el respaldo automático (cada hora). ${result.error ?? ''}`.trim(),
          )
        }
      })
    }, BACKUP_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [Boolean(data), reportPersistError])

  useEffect(() => {
    if (!isTauri() || !data) return
    let unlisten: (() => void) | undefined
    let closing = false
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      unlisten = await win.onCloseRequested(async (event) => {
        if (closing) return
        event.preventDefault()
        closing = true
        const shouldClose = await requestExitRef.current()
        if (shouldClose) {
          await win.close()
        } else {
          closing = false
        }
      })
    })()
    return () => {
      unlisten?.()
    }
  }, [data])

  const restoreFromBackup = useCallback(async (slot: BackupSlot) => {
    try {
      const raw = await restoreDataBackup(slot)
      const restored = await enrichLoadedData(parseStoredData(raw))
      dataRef.current = restored
      skipAutosaveOnceRef.current = true
      setData(restored)
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
  }, [])

  const upsertPatient = useCallback((p: Omit<Patient, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = p.id ?? createId()
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

  const deletePatient = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      const citaIds = new Set(
        prev.appointments
          .filter((a) => a.patientId === id)
          .map((a) => a.id),
      )
      return {
        ...prev,
        patients: prev.patients.filter((x) => x.id !== id),
        appointments: prev.appointments.filter((a) => a.patientId !== id),
        payments: prev.payments.filter(
          (p) =>
            p.patientId !== id &&
            (p.citaId == null || !citaIds.has(p.citaId)),
        ),
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
        matricula: d.matricula,
        especialidad: d.especialidad,
        telefono: d.telefono,
        localidad: d.localidad ?? '',
        email: d.email,
        porcentaje: d.porcentaje,
        duracionTurnoMinutos:
          d.duracionTurnoMinutos ?? prevDoc?.duracionTurnoMinutos ?? 30,
        tipoAgenda: d.tipoAgenda ?? prevDoc?.tipoAgenda ?? 'semanal',
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

  const deleteDoctor = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        doctors: prev.doctors.filter((x) => x.id !== id),
        horarios: prev.horarios.filter((x) => x.doctorId !== id),
        diasLibres: prev.diasLibres.filter((x) => x.doctorId !== id),
        atencionesMensuales: prev.atencionesMensuales.filter(
          (x) => x.doctorId !== id,
        ),
        appointments: prev.appointments.filter((x) => x.doctorId !== id),
        payments: prev.payments.filter((x) => x.doctorId !== id),
      }
    })
  }, [])

  const upsertHorario = useCallback((h: Omit<DoctorHorario, 'id'> & { id?: string }) => {
    setData((prev) => {
      if (!prev) return prev
      const id = h.id ?? createId()
      const next: DoctorHorario = {
        id,
        doctorId: h.doctorId,
        diaSemana: h.diaSemana,
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
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
      const next: Appointment = {
        id,
        patientId: a.patientId,
        doctorId: a.doctorId,
        fechaHora: a.fechaHora,
        duracionMinutos: a.duracionMinutos,
        notas: a.notas,
        estado: a.estado,
      }
      const exists = prev.appointments.some((x) => x.id === id)
      return {
        ...prev,
        appointments: exists
          ? prev.appointments.map((x) => (x.id === id ? next : x))
          : [...prev.appointments, next],
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
      const next: Payment = {
        id,
        patientId: p.patientId,
        doctorId: p.doctorId,
        citaId: p.citaId,
        monto: p.monto,
        fecha: p.fecha,
        metodo: p.metodo,
        notas: p.notas,
      }
      const exists = prev.payments.some((x) => x.id === id)
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

        const registro: PagoCancelado = {
          id: createId(),
          motivo,
          canceladoEn: new Date().toISOString(),
          payment: { ...payment },
          appointment: appointment ? { ...appointment } : null,
          notasOtros: motivo === 'otros' ? notasOtros.trim() : '',
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

  const patientById = useCallback(
    (id: string) => data?.patients.find((p) => p.id === id),
    [data?.patients],
  )
  const doctorById = useCallback(
    (id: string) => data?.doctors.find((d) => d.id === id),
    [data?.doctors],
  )

  const ensureDemoDoctors = useCallback(() => {
    setData((prev) => {
      if (!prev || prev.doctors.length > 0) return prev
      return { ...prev, doctors: generateDemoDoctors() }
    })
  }, [])

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

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    if ('clave' in patch) {
      void saveSmtpSecret(patch.clave ?? '')
    }
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        settings: { ...prev.settings, ...patch },
      }
    })
  }, [])

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
      deletePatient,
      upsertDoctor,
      deleteDoctor,
      upsertHorario,
      deleteHorario,
      upsertDiaLibre,
      deleteDiaLibre,
      upsertAtencionMensual,
      deleteAtencionMensual,
      upsertAppointment,
      deleteAppointment,
      upsertPayment,
      deletePayment,
      archivePagoCancelado,
      archiveCitaEliminada,
      patientById,
      doctorById,
      ensureDemoDoctors,
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
      updateSettings,
      prepareExit,
      requestExit,
      systemAlert,
      dismissSystemAlert,
      createBackupNow,
      sendDatabaseBackupByEmail: sendDatabaseBackupByEmailFn,
      restoreFromBackup,
    }),
    [
      data,
      upsertPatient,
      deletePatient,
      upsertDoctor,
      deleteDoctor,
      upsertHorario,
      deleteHorario,
      upsertDiaLibre,
      deleteDiaLibre,
      upsertAtencionMensual,
      deleteAtencionMensual,
      upsertAppointment,
      deleteAppointment,
      upsertPayment,
      deletePayment,
      archivePagoCancelado,
      archiveCitaEliminada,
      patientById,
      doctorById,
      ensureDemoDoctors,
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
      updateSettings,
      prepareExit,
      requestExit,
      systemAlert,
      dismissSystemAlert,
      createBackupNow,
      sendDatabaseBackupByEmailFn,
      restoreFromBackup,
    ],
  )

  if (loadError) {
    return (
      <LoadErrorScreen
        message={loadError}
        onRestore={async (slot) => {
          try {
            const raw = await restoreDataBackup(slot)
            const restored = await enrichLoadedData(parseStoredData(raw))
            dataRef.current = restored
            skipAutosaveOnceRef.current = false
            setData(restored)
            setLoadError(null)
          } catch (err) {
            console.error(err)
            void confirm({
              title: 'ADMINISTRACION',
              message:
                err instanceof Error
                  ? err.message
                  : `No se pudo restaurar el respaldo ${slot}.`,
            })
          }
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
          const vacia = { ...empty }
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
