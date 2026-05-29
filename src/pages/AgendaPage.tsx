import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addMonths,
  addWeeks,
  format,
  isSameDay,
  parseISO,
  startOfWeek,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  IconActionButton,
  IconCancelDay,
  IconEdit,
  IconRestoreDay,
  IconTrash,
  IconWhatsApp,
} from '../components/icons'
import { AgendaMedicosEspecialidadesModal } from '../components/AgendaMedicosEspecialidadesModal'
import { EliminarPagoModal } from '../components/EliminarPagoModal'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
import { formatMonto } from '../lib/formatMonto'
import { formatAppError, logAppError } from '../lib/persistAlert'
import { APP_DISPLAY_NAME } from '../lib/pdfBranding'
import { preloadPdfHeaderBanner } from '../lib/pdfHeaderBanner'
import { preloadPdfLogo } from '../lib/pdfLogo'
import { useAuth } from '../context/AuthContext'
import { useAppState } from '../context/AppStateContext'
import { useConfirm } from '../context/ConfirmContext'
import {
  buildAgendaEmailBodyWithPdf,
  buildMailtoUrl,
  openMailtoUrl,
  isGmailAddress,
  isSmtpAuthError,
  normalizeGmailAppPassword,
  openAgendaEmailDraft,
  sendAgendaEmailSmtp,
  validateGmailAppPassword,
} from '../lib/agendaEmail'
import { isTauri } from '@tauri-apps/api/core'
import {
  buildAgendaWeekPdf,
  collectAgendaDayRows,
  collectAgendaMonthRows,
  collectAgendaWeekRows,
  type AgendaPdfScope,
  type AgendaWeekPdfRow,
} from '../lib/agendaWeekPdf'
import {
  agendaTurnosPdfPreviewTitle,
  buildAgendaTurnosPdf,
  collectAgendaTurnosPdfDays,
} from '../lib/agendaTurnosPdf'
import { pdfBlobUrl, pdfToBase64, savePdfFile } from '../lib/doctorPaymentsPdf'
import type jsPDF from 'jspdf'
import {
  validateAppointmentSlot,
  diaSemanaLabel,
  diaSemanaLabelLargo,
  DIAS_SEMANA_FORM,
  eachAgendaWeekDay,
  isAgendaWorkingDay,
} from '../lib/agendaRules'
import { groupDiasLibresByDoctor } from '../lib/diasLibres'
import { citasEnFranja, medicoGroupsEnFranja, mergeMedicoGroupsDia, splitCitasMananaTarde } from '../lib/dayTurnos'
import {
  buildMedicosEspecialidadesRows,
  DURACION_TURNO_OPCIONES,
  doctorDuracionTurno,
  formatAgendaRanges,
  isDoctorAgendaMensual,
} from '../lib/doctorAgenda'
import {
  combineDateAndTimeLocal,
  DEFAULT_AGENDA_RANGES,
  generateSlotsForDay,
  turnosLibresMedicoDia,
  type TurnosLibresMedicoDia,
  normalizeHmInput,
  doctorsAvailableOnDate,
  isDoctorAvailableOnDate,
  planDoctorDay,
} from '../lib/weekSlots'
import type { Appointment, AppointmentEstado, Doctor } from '../types'
import { createId } from '../lib/id'
import {
  buildMedicoAgendaMessage,
  buildTurnoReminderMessage,
  buildWhatsAppSendUrl,
  openWhatsAppUrl,
} from '../lib/whatsapp'
import './pages.css'

type Tab = 'turnos' | 'horarios' | 'franja' | 'mensual' | 'libres'

const estados: { value: AppointmentEstado; label: string }[] = [
  { value: 'programado', label: 'Programado' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'cancelado', label: 'Cancelado' },
]

const AGENDA_COMPACT_ESTADO_THRESHOLD = 8

const estadoAbreviado: Record<AppointmentEstado, string> = {
  programado: 'Prog.',
  atendido: 'Atend.',
  cancelado: 'Canc.',
}

function dayCitaEstadoParts(c: Appointment, isPagado: boolean) {
  const base = estados.find((e) => e.value === c.estado)?.label ?? c.estado
  const parts = [base]
  if (/urgencia/i.test(c.notas)) parts.push('Urgencia')
  if (isPagado) parts.push('Pagado')
  return parts
}

function formatDayCitaEstado(c: Appointment, isPagado: boolean, compact: boolean) {
  if (!compact) return dayCitaEstadoParts(c, isPagado).join(' - ')
  const parts = [estadoAbreviado[c.estado] ?? c.estado]
  if (/urgencia/i.test(c.notas)) parts.push('Urg.')
  if (isPagado) parts.push('Pag.')
  return parts.join(' · ')
}

function splitMedicoPillLabel(label: string): { name: string; esp: string | null } {
  const sep = label.indexOf(' - ')
  if (sep === -1) return { name: label, esp: null }
  return { name: label.slice(0, sep), esp: label.slice(sep + 3) }
}

export function AgendaPage() {
  const { role } = useAuth()
  const {
    data,
    upsertAppointment,
    archiveCitaEliminada,
    upsertHorario,
    deleteHorario,
    upsertDiaLibre,
    deleteDiaLibre,
    upsertAtencionMensual,
    deleteAtencionMensual,
    upsertDoctor,
    upsertPayment,
    deletePayment,
    patientById,
    doctorById,
  } = useAppState()
  const { confirm } = useConfirm()

  const [tab, setTab] = useState<Tab>('turnos')
  const [medicosEspModalOpen, setMedicosEspModalOpen] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [citaToDelete, setCitaToDelete] = useState<Appointment | null>(null)

  const [agendaPdfPreview, setAgendaPdfPreview] = useState<{
    url: string
    filename: string
    title: string
    showFilename?: boolean
  } | null>(null)
  const agendaPdfDocRef = useRef<jsPDF | null>(null)
  const correoAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const CORREO_ANIM_MS = 5000

  const [enviandoCorreo, setEnviandoCorreo] = useState(false)

  function startCorreoAnim() {
    if (correoAnimTimerRef.current) {
      clearTimeout(correoAnimTimerRef.current)
    }
    setEnviandoCorreo(true)
    correoAnimTimerRef.current = setTimeout(() => {
      setEnviandoCorreo(false)
      correoAnimTimerRef.current = null
    }, CORREO_ANIM_MS)
  }

  function stopCorreoAnimNow() {
    if (correoAnimTimerRef.current) {
      clearTimeout(correoAnimTimerRef.current)
      correoAnimTimerRef.current = null
    }
    setEnviandoCorreo(false)
  }

  const [weekCursor, setWeekCursor] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  )

  const [selectedWeekDay, setSelectedWeekDay] = useState<Date | null>(null)
  const [libresHorasOpen, setLibresHorasOpen] = useState<{
    doctorId: string
    franja: 'manana' | 'tarde'
  } | null>(null)
  const [agendaExportScope, setAgendaExportScope] =
    useState<AgendaPdfScope>('week')
  const [agendaExportDoctorId, setAgendaExportDoctorId] = useState('')

  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingEditingId, setBookingEditingId] = useState<string | null>(null)
  const [bookingDate, setBookingDate] = useState<Date | null>(null)
  const [bookingDoctorId, setBookingDoctorId] = useState('')
  const [bookingPatientId, setBookingPatientId] = useState('')
  const [bookingPatientQuery, setBookingPatientQuery] = useState('')
  const [bookingPatientPickerOpen, setBookingPatientPickerOpen] = useState(false)
  const [bookingDuracion, setBookingDuracion] = useState(30)
  const [bookingEstado, setBookingEstado] = useState<AppointmentEstado>('programado')
  const [bookingNotas, setBookingNotas] = useState('')
  const [bookingMonto, setBookingMonto] = useState('')
  const [bookingMetodo, setBookingMetodo] = useState('Efectivo')
  const [bookingMonto2, setBookingMonto2] = useState('')
  const [bookingMetodo2, setBookingMetodo2] = useState('Transferencia')
  const [bookingPaymentId, setBookingPaymentId] = useState<string | null>(null)
  const [bookingPaymentId2, setBookingPaymentId2] = useState<string | null>(null)
  const [bookingSlotHm, setBookingSlotHm] = useState<string | null>(null)
  const [bookingFueraGrilla, setBookingFueraGrilla] = useState(false)
  const [bookingManualHm, setBookingManualHm] = useState('')
  const [bookingFormError, setBookingFormError] = useState<string | null>(null)

  const URGENCIA_DURACION_DEFAULT = 15

  const PAYMENT_METODOS = [
    'Efectivo',
    'Tarjeta',
    'Transferencia',
    'Obra social',
    'Otro',
  ] as const

  function parseMontoInput(value: string): number {
    const norm = (value ?? '').replace(/\./g, '').replace(/\$/g, '').trim()
    const n = Number(norm.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }

  function formatMontoFieldInput(raw: string): string {
    if (!raw.trim()) return ''
    const norm = raw.replace(/\./g, '').replace(/\$/g, '').trim()
    const parsed = Number(norm.replace(',', '.'))
    if (!Number.isFinite(parsed)) return raw
    return parsed <= 0 ? '' : formatMonto(parsed)
  }

  const bookingTotalMonto = useMemo(() => {
    return parseMontoInput(bookingMonto) + parseMontoInput(bookingMonto2)
  }, [bookingMonto, bookingMonto2])

  const resolveBookingPatientId = useCallback((): string | null => {
    if (bookingPatientId) return bookingPatientId
    const q = bookingPatientQuery.trim().toLowerCase()
    if (!q) return null
    const label = (p: (typeof data.patients)[0]) =>
      `${p.dni ? `${p.dni} · ` : ''}${p.apellido}, ${p.nombre}`.toLowerCase()
    const exact = data.patients.filter(
      (p) =>
        (p.dni ?? '').toLowerCase() === q ||
        `${p.apellido}, ${p.nombre}`.toLowerCase() === q ||
        label(p) === q,
    )
    if (exact.length === 1) return exact[0]!.id
    const partial = data.patients.filter(
      (p) =>
        (p.dni ?? '').toLowerCase().includes(q) ||
        (p.apellido ?? '').toLowerCase().includes(q),
    )
    if (partial.length === 1) return partial[0]!.id
    return null
  }, [bookingPatientId, bookingPatientQuery, data.patients])

  const [citaEditing, setCitaEditing] = useState<string | null>(null)
  const [citaForm, setCitaForm] = useState({
    patientId: '',
    doctorId: '',
    fechaHoraLocal: '',
    duracionMinutos: 30,
    estado: 'programado' as AppointmentEstado,
    notas: '',
  })

  const [horForm, setHorForm] = useState({
    doctorId: '',
    diaSemana: 1,
    horaInicio: '09:00',
    horaFin: '13:00',
  })

  const [libForm, setLibForm] = useState({
    doctorId: '',
    diasSemana: [] as number[],
  })

  const [franjaForm, setFranjaForm] = useState({
    doctorId: '',
    duracionTurnoMinutos: 30,
    tipoAgenda: 'semanal' as 'semanal' | 'mensual',
  })

  const [mensualForm, setMensualForm] = useState({
    doctorId: '',
    fecha: '',
    horaInicio: '09:00',
    horaFin: '13:00',
  })

  const weekDays = useMemo(
    () => eachAgendaWeekDay(weekCursor),
    [weekCursor],
  )

  const weekLabel = useMemo(() => {
    const a = weekDays[0]
    const b = weekDays[weekDays.length - 1]
    if (!a || !b) return ''
    return `${format(a, 'd MMMM', { locale: es })} al ${format(b, 'd MMMM yyyy', { locale: es })}`
  }, [weekDays])

  const monthLabel = useMemo(
    () => format(weekCursor, 'MMMM yyyy', { locale: es }),
    [weekCursor],
  )

  const citasDelDia = useMemo(() => {
    if (!selectedWeekDay) return []
    return [...data.appointments]
      .filter((c) => isSameDay(parseISO(c.fechaHora), selectedWeekDay))
      .sort(
        (a, b) =>
          parseISO(a.fechaHora).getTime() - parseISO(b.fechaHora).getTime(),
      )
  }, [data.appointments, selectedWeekDay])

  const doctorNameLabel = useCallback(
    (doctorId: string) => {
      const doc = doctorById(doctorId)
      return doc ? `${doc.apellido}, ${doc.nombre}` : ''
    },
    [doctorById],
  )

  const doctorLabel = useCallback(
    (doctorId: string) => {
      const doc = doctorById(doctorId)
      if (!doc) return '—'
      const esp = doc.especialidad?.trim() ?? ''
      return `${doc.apellido}, ${doc.nombre}${esp ? ` - ${esp}` : ''}`
    },
    [doctorById],
  )

  const estadoLabel = useCallback(
    (estado: AppointmentEstado) =>
      estados.find((e) => e.value === estado)?.label ?? estado,
    [],
  )

  useEffect(() => {
    return () => {
      if (agendaPdfPreview?.url) URL.revokeObjectURL(agendaPdfPreview.url)
      if (correoAnimTimerRef.current) {
        clearTimeout(correoAnimTimerRef.current)
      }
    }
  }, [agendaPdfPreview?.url])

  function closeAgendaPdfPreview() {
    if (agendaPdfPreview?.url) URL.revokeObjectURL(agendaPdfPreview.url)
    setAgendaPdfPreview(null)
    agendaPdfDocRef.current = null
  }

  const selectedDayLabel = useMemo(() => {
    if (!selectedWeekDay) return ''
    return format(selectedWeekDay, "EEEE d 'de' MMMM yyyy", { locale: es })
  }, [selectedWeekDay])

  const pdfPatientLabel = (id: string) => {
    const p = patientById(id)
    return p ? `${p.apellido}, ${p.nombre}` : ''
  }

  const pdfObraSocialLabel = (id: string) => {
    const p = patientById(id)
    const os = p?.obraSocial?.trim()
    return os || ''
  }

  const paymentsForAppointment = useCallback(
    (c: Appointment) => {
      const day = format(parseISO(c.fechaHora), 'yyyy-MM-dd')
      return data.payments.filter((p) => {
        if (p.citaId === c.id) return true
        const pDay = format(parseISO(p.fecha), 'yyyy-MM-dd')
        return (
          p.patientId === c.patientId &&
          p.doctorId === c.doctorId &&
          pDay === day
        )
      })
    },
    [data.payments],
  )

  const pdfMontoForAppointment = useCallback(
    (c: Appointment) => {
      const pays = paymentsForAppointment(c).filter((p) => p.monto > 0)
      const total = pays.reduce((sum, p) => sum + p.monto, 0)
      return total > 0 ? formatMonto(total) : ''
    },
    [paymentsForAppointment],
  )

  const pdfObsForAppointment = useCallback(
    (c: Appointment) => {
      const parts: string[] = []
      const citaNotas = c.notas?.trim()
      if (citaNotas) parts.push(citaNotas)
      for (const p of paymentsForAppointment(c)) {
        const n = p.notas?.trim()
        if (n && !parts.includes(n)) parts.push(n)
      }
      return parts.length > 0 ? parts.join(' · ') : ''
    },
    [paymentsForAppointment],
  )

  const agendaExportDoctors = useMemo(
    () =>
      [...data.doctors].sort((a, b) =>
        a.apellido.localeCompare(b.apellido, 'es', { sensitivity: 'base' }),
      ),
    [data.doctors],
  )

  const agendaExportDoctorSuffix = useMemo(() => {
    if (!agendaExportDoctorId) return ''
    const d = doctorById(agendaExportDoctorId)
    return d ? ` — ${d.apellido}, ${d.nombre}` : ''
  }, [agendaExportDoctorId, doctorById])

  const agendaPdfSingleDoctorLabel = useMemo(() => {
    if (!agendaExportDoctorId) return undefined
    const doc = doctorById(agendaExportDoctorId)
    if (!doc) return undefined
    const esp = doc.especialidad?.trim() ?? ''
    return `${doc.apellido}, ${doc.nombre}${esp ? ` - ${esp}` : ''}`
  }, [agendaExportDoctorId, doctorById])

  const appointmentsForAgendaExport = useMemo(() => {
    if (!agendaExportDoctorId) return data.appointments
    return data.appointments.filter((c) => c.doctorId === agendaExportDoctorId)
  }, [data.appointments, agendaExportDoctorId])

  function collectSelectedDayAgendaRows() {
    if (!selectedWeekDay) return []
    return collectAgendaDayRows({
      appointments: appointmentsForAgendaExport,
      day: selectedWeekDay,
      patientLabel: pdfPatientLabel,
      doctorLabel: doctorNameLabel,
      obraSocialLabel: pdfObraSocialLabel,
      montoLabel: pdfMontoForAppointment,
      estadoLabel,
      obsLabel: pdfObsForAppointment,
    })
  }

  function collectWeekAgendaRows() {
    return collectAgendaWeekRows({
      appointments: appointmentsForAgendaExport,
      weekDays,
      patientLabel: pdfPatientLabel,
      doctorLabel: doctorNameLabel,
      obraSocialLabel: pdfObraSocialLabel,
      montoLabel: pdfMontoForAppointment,
      estadoLabel,
      obsLabel: pdfObsForAppointment,
    })
  }

  function collectMonthAgendaRows() {
    return collectAgendaMonthRows({
      appointments: appointmentsForAgendaExport,
      monthRef: weekCursor,
      patientLabel: pdfPatientLabel,
      doctorLabel: doctorNameLabel,
      obraSocialLabel: pdfObraSocialLabel,
      montoLabel: pdfMontoForAppointment,
      estadoLabel,
      obsLabel: pdfObsForAppointment,
    })
  }

  function showAgendaPdfPreview(
    built: { doc: jsPDF; filename: string },
    title: string,
    options?: { showFilename?: boolean },
  ) {
    agendaPdfDocRef.current = built.doc
    if (agendaPdfPreview?.url) URL.revokeObjectURL(agendaPdfPreview.url)
    setAgendaPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title,
      showFilename: options?.showFilename !== false,
    })
  }

  function resolveAgendaExport():
    | {
        ok: true
        data: {
          rows: AgendaWeekPdfRow[]
          periodLabel: string
          fileStamp: string
          scope: AgendaPdfScope
          emailSubject: string
          previewTitle: string
        }
      }
    | { ok: false; message: string } {
    if (agendaExportScope === 'day') {
      if (!selectedWeekDay) {
        return {
          ok: false,
          message: 'Seleccioná un día en la vista semanal.',
        }
      }
      return {
        ok: true,
        data: {
          rows: collectSelectedDayAgendaRows(),
          periodLabel: selectedDayLabel,
          fileStamp: format(selectedWeekDay, 'yyyy-MM-dd'),
          scope: 'day',
          emailSubject: `Agenda — ${selectedDayLabel}${agendaExportDoctorSuffix}`,
          previewTitle: `Agenda del día — ${selectedDayLabel}${agendaExportDoctorSuffix}`,
        },
      }
    }
    if (agendaExportScope === 'week') {
      return {
        ok: true,
        data: {
          rows: collectWeekAgendaRows(),
          periodLabel: weekLabel,
          fileStamp: weekDays[0]
            ? format(weekDays[0], 'yyyy-MM-dd')
            : format(new Date(), 'yyyy-MM-dd'),
          scope: 'week',
          emailSubject: `Agenda semanal — ${weekLabel}${agendaExportDoctorSuffix}`,
          previewTitle: `Agenda semanal — ${weekLabel}${agendaExportDoctorSuffix}`,
        },
      }
    }
    return {
      ok: true,
      data: {
        rows: collectMonthAgendaRows(),
        periodLabel: monthLabel,
        fileStamp: format(weekCursor, 'yyyy-MM'),
        scope: 'month',
        emailSubject: `Agenda mensual — ${monthLabel}${agendaExportDoctorSuffix}`,
        previewTitle: `Agenda mensual — ${monthLabel}${agendaExportDoctorSuffix}`,
      },
    }
  }

  async function handleEnviarCorreoAgenda() {
    const origen = data.settings.email.trim()
    const to = data.settings.emailGerente.trim()
    const clave = data.settings.clave
    if (!origen) {
      void confirm({
        message: 'Cargá el Email en Configuración (remitente).',
      })
      return
    }
    if (!clave) {
      void confirm({
        message: 'Cargá la Clave del correo en Configuración.',
      })
      return
    }
    if (isGmailAddress(origen)) {
      const appPassClean = normalizeGmailAppPassword(clave)
      const gmailErr = validateGmailAppPassword(appPassClean)
      if (gmailErr) {
        void confirm({ message: gmailErr })
        return
      }
    }
    if (!to) {
      void confirm({
        message: 'Cargá el Email Gerente en Configuración (destino).',
      })
      return
    }
    const resolved = resolveAgendaExport()
    if (!resolved.ok) {
      void confirm({ message: resolved.message })
      return
    }
    const { rows, periodLabel, fileStamp, scope, emailSubject } =
      resolved.data
    const subject = emailSubject

    startCorreoAnim()
    try {
      await Promise.all([preloadPdfLogo(), preloadPdfHeaderBanner()])
      let pdfBuilt
      try {
        pdfBuilt = buildAgendaWeekPdf({
          weekLabel: periodLabel,
          rows,
          fileStamp,
          scope,
          singleDoctorLabel: agendaPdfSingleDoctorLabel,
        })
      } catch (pdfErr) {
        console.error(pdfErr)
        stopCorreoAnimNow()
        void confirm({
          message: 'No se pudo generar el PDF para el correo. Probá de nuevo.',
        })
        return
      }

      const body = buildAgendaEmailBodyWithPdf({
        periodLabel,
        pdfFilename: pdfBuilt.filename,
        cantidadTurnos: rows.length,
      })
      const pdfBase64 = pdfToBase64(pdfBuilt.doc)
      const pdfFilename = pdfBuilt.filename

      try {
        if (isTauri()) {
          await sendAgendaEmailSmtp({
            from: origen,
            password: clave,
            to,
            subject,
            body,
            pdfBase64,
            pdfFilename,
          })
          setMsg({
            type: 'ok',
            text: `Correo enviado con PDF adjunto desde ${origen} a ${to}.`,
          })
          return
        }
        const url = buildMailtoUrl(to, subject, body)
        await openMailtoUrl(url)
      } catch (err) {
        console.error(err)
        const text =
          err instanceof Error
            ? err.message
            : 'No se pudo enviar el correo. Revisá Email, Clave y conexión.'
        if (
          isTauri() &&
          (isGmailAddress(origen) || isSmtpAuthError(text))
        ) {
          try {
            await openAgendaEmailDraft({
              from: origen,
              to,
              subject,
              body,
              pdfBase64,
              pdfFilename,
            })
            void confirm({
              message: `No se pudo enviar automáticamente.\n\nSe abrió un borrador en su programa de correo (desde ${origen} hacia ${to}) con el PDF adjunto. Revisalo y pulsá Enviar.\n\nPara envío automático con Gmail: contraseña de aplicación de 16 caracteres en Configuración → Clave (como en Admi).`,
            })
            return
          } catch (draftErr) {
            console.error(draftErr)
          }
        }
        void confirm({ message: text })
      }
    } catch (err) {
      logAppError('Envío correo agenda', err)
      stopCorreoAnimNow()
      void confirm({
        message: formatAppError(
          err,
          'No se pudo enviar el correo. Probá de nuevo.',
        ),
      })
    }
  }

  async function handleAgendaPdfPreview() {
    const resolved = resolveAgendaExport()
    if (!resolved.ok) {
      void confirm({ message: resolved.message })
      return
    }
    const { periodLabel, rows, fileStamp, scope, previewTitle } =
      resolved.data
    try {
      await Promise.all([preloadPdfLogo(), preloadPdfHeaderBanner()])
      const built = buildAgendaWeekPdf({
        weekLabel: periodLabel,
        rows,
        fileStamp,
        scope,
        singleDoctorLabel: agendaPdfSingleDoctorLabel,
      })
      showAgendaPdfPreview(built, previewTitle)
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo generar el PDF. Probá de nuevo.',
      })
    }
  }

  async function handleAgendaTurnosPdfPreview() {
    const resolved = resolveAgendaExport()
    if (!resolved.ok) {
      void confirm({ message: resolved.message })
      return
    }
    const { periodLabel, fileStamp, scope } = resolved.data
    try {
      await Promise.all([preloadPdfLogo(), preloadPdfHeaderBanner()])
      const days = collectAgendaTurnosPdfDays({
        scope,
        data,
        weekCursor,
        selectedDay: selectedWeekDay,
        weekDays,
        doctorFilterId: agendaExportDoctorId || undefined,
        doctorLabel,
        patientLabel: pdfPatientLabel,
        estadoFor: (c) => {
          const t = parseISO(c.fechaHora)
          const isPagado =
            pagadoCitaIds.has(c.id) ||
            pagadoDayKeys.has(
              `${c.patientId}__${c.doctorId}__${format(t, 'yyyy-MM-dd')}`,
            )
          return formatDayCitaEstado(c, isPagado, false)
        },
      })
      const built = buildAgendaTurnosPdf({
        scope,
        periodLabel,
        days,
        fileStamp,
        singleDoctorLabel: agendaPdfSingleDoctorLabel,
      })
      showAgendaPdfPreview(
        built,
        agendaTurnosPdfPreviewTitle(scope, periodLabel),
        { showFilename: false },
      )
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo generar el PDF de turnos. Probá de nuevo.',
      })
    }
  }

  async function handleAgendaPdfDownload() {
    const doc = agendaPdfDocRef.current
    const filename = agendaPdfPreview?.filename
    if (!doc || !filename) return
    try {
      await savePdfFile(doc, filename)
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo guardar el PDF. Probá de nuevo.',
      })
    }
  }

  const citasPorMedicoManana = useMemo(() => {
    if (!selectedWeekDay) return []
    return medicoGroupsEnFranja({
      citasFranja: citasEnFranja(citasDelDia, DEFAULT_AGENDA_RANGES[0]!),
      selectedDay: selectedWeekDay,
      franja: DEFAULT_AGENDA_RANGES[0]!,
      data,
      doctorLabel,
    })
  }, [selectedWeekDay, citasDelDia, data, doctorLabel])

  const citasPorMedicoTarde = useMemo(() => {
    if (!selectedWeekDay) return []
    return medicoGroupsEnFranja({
      citasFranja: citasEnFranja(citasDelDia, DEFAULT_AGENDA_RANGES[1]!),
      selectedDay: selectedWeekDay,
      franja: DEFAULT_AGENDA_RANGES[1]!,
      data,
      doctorLabel,
    })
  }, [selectedWeekDay, citasDelDia, data, doctorLabel])

  const citasPorMedicoDia = useMemo(() => {
    if (!selectedWeekDay) return []
    return mergeMedicoGroupsDia(citasPorMedicoManana, citasPorMedicoTarde)
  }, [selectedWeekDay, citasPorMedicoManana, citasPorMedicoTarde])

  const turnosActivosPorMedicoDia = useMemo(() => {
    const counts = new Map<string, number>()
    if (!selectedWeekDay) return counts
    for (const c of data.appointments) {
      if (c.estado === 'cancelado') continue
      if (!isSameDay(parseISO(c.fechaHora), selectedWeekDay)) continue
      counts.set(c.doctorId, (counts.get(c.doctorId) ?? 0) + 1)
    }
    return counts
  }, [selectedWeekDay, data.appointments])

  const turnosLibresPorMedicoDia = useMemo(() => {
    const map = new Map<string, TurnosLibresMedicoDia>()
    if (!selectedWeekDay) return map
    for (const d of data.doctors) {
      const info = turnosLibresMedicoDia(d.id, selectedWeekDay, data)
      if (info) map.set(d.id, info)
    }
    return map
  }, [selectedWeekDay, data])

  const turnosCanceladosPorMedicoDia = useMemo(() => {
    const counts = new Map<string, number>()
    if (!selectedWeekDay) return counts
    for (const c of data.appointments) {
      if (c.estado !== 'cancelado') continue
      if (!isSameDay(parseISO(c.fechaHora), selectedWeekDay)) continue
      counts.set(c.doctorId, (counts.get(c.doctorId) ?? 0) + 1)
    }
    return counts
  }, [selectedWeekDay, data.appointments])

  const bookingResolvedHm = useCallback((): string | null => {
    if (bookingFueraGrilla) return normalizeHmInput(bookingManualHm)
    return bookingSlotHm
  }, [bookingFueraGrilla, bookingManualHm, bookingSlotHm])

  const bookingManualSlotCheck = useMemo(() => {
    if (!bookingFueraGrilla || !bookingDate || !bookingDoctorId) return null
    const hm = normalizeHmInput(bookingManualHm)
    if (!hm) {
      if (bookingManualHm.trim()) {
        return { ok: false as const, message: 'Hora inválida. Usá formato HH:MM (ej. 09:15).' }
      }
      return null
    }
    const fechaHora = new Date(
      combineDateAndTimeLocal(bookingDate, hm),
    ).toISOString()
    return validateAppointmentSlot({
      fechaHora,
      doctorId: bookingDoctorId,
      data,
      excludeAppointmentId: bookingEditingId ?? undefined,
      duracionMinutos: bookingDuracion,
    })
  }, [
    bookingFueraGrilla,
    bookingManualHm,
    bookingDate,
    bookingDoctorId,
    bookingDuracion,
    data,
    bookingEditingId,
  ])

  const bookingSlots = useMemo(() => {
    if (!bookingOpen || !bookingDate || !bookingDoctorId) return []
    const base = generateSlotsForDay({
      date: bookingDate,
      doctorId: bookingDoctorId,
      duracionMinutos: bookingDuracion,
      data,
      excludeAppointmentId: bookingEditingId ?? undefined,
    })
    const extraHm = bookingFueraGrilla
      ? normalizeHmInput(bookingManualHm)
      : bookingSlotHm
    if (extraHm && !base.some((s) => s.hm === extraHm)) {
      return [{ hm: extraHm, available: true }, ...base].sort((a, b) =>
        a.hm.localeCompare(b.hm),
      )
    }
    return base
  }, [
    bookingOpen,
    bookingDate,
    bookingDoctorId,
    bookingDuracion,
    data,
    bookingEditingId,
    bookingSlotHm,
    bookingFueraGrilla,
    bookingManualHm,
  ])

  const bookingDayPlan = useMemo(() => {
    if (!bookingDate || !bookingDoctorId) return null
    return planDoctorDay(bookingDoctorId, bookingDate, data)
  }, [bookingDate, bookingDoctorId, data])

  const bookingScheduleHint = useMemo(() => {
    if (!bookingDoctorId || !bookingDate) return null
    const doc = doctorById(bookingDoctorId)
    const plan = planDoctorDay(bookingDoctorId, bookingDate, data)
    const mins = doctorDuracionTurno(doc)
    if (plan.kind !== 'slots' || plan.ranges.length === 0) {
      if (isDoctorAgendaMensual(doc)) {
        return 'Sin atención configurada este día. Revisá la pestaña Atención mensual.'
      }
      return 'Sin franja horaria este día.'
    }
    return `Turnos cada ${mins} min · Atiende ${formatAgendaRanges(plan.ranges)}`
  }, [bookingDoctorId, bookingDate, data, doctorById])

  const bookingDoctors = useMemo(() => {
    if (!bookingDate) return data.doctors
    return data.doctors.filter((d) => {
      if (bookingEditingId && d.id === bookingDoctorId) return true
      return isDoctorAvailableOnDate(d.id, bookingDate, data)
    })
  }, [bookingDate, data, bookingEditingId, bookingDoctorId])

  useEffect(() => {
    if (!bookingDoctorId) return
    const doc = doctorById(bookingDoctorId)
    if (!doc) return
    setBookingDuracion(doctorDuracionTurno(doc))
  }, [bookingDoctorId, doctorById])

  const diasLibresPorMedico = useMemo(
    () =>
      groupDiasLibresByDoctor(data.diasLibres, (id) => {
        const d = doctorById(id)
        return d ? `${d.apellido}, ${d.nombre}` : '—'
      }),
    [data.diasLibres, doctorById],
  )

  useEffect(() => {
    if (!bookingOpen || !bookingDate) return
    if (
      bookingDoctorId &&
      !bookingDoctors.some((d) => d.id === bookingDoctorId)
    ) {
      setBookingDoctorId('')
      setBookingSlotHm(null)
    }
  }, [bookingOpen, bookingDate, bookingDoctorId, bookingDoctors])

  useEffect(() => {
    if (!bookingOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeBooking()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bookingOpen])

  useEffect(() => {
    if (tab !== 'turnos') return
    const valid =
      selectedWeekDay &&
      weekDays.some((d) => isSameDay(d, selectedWeekDay))
    if (valid) return
    const today = new Date()
    const pick = weekDays.find((d) => isSameDay(d, today)) ?? weekDays[0]
    if (pick) setSelectedWeekDay(pick)
  }, [tab, weekCursor, weekDays, selectedWeekDay])

  useEffect(() => {
    setLibresHorasOpen(null)
  }, [selectedWeekDay])

  const selectedDayIndex = useMemo(() => {
    if (!selectedWeekDay) return -1
    return weekDays.findIndex((d) => isSameDay(d, selectedWeekDay))
  }, [selectedWeekDay, weekDays])

  function goAdjacentDay(delta: -1 | 1) {
    if (selectedDayIndex < 0) return
    const next = weekDays[selectedDayIndex + delta]
    if (next) setSelectedWeekDay(next)
  }

  function toggleLibresHoras(doctorId: string, franja: 'manana' | 'tarde') {
    setLibresHorasOpen((prev) =>
      prev?.doctorId === doctorId && prev.franja === franja
        ? null
        : { doctorId, franja },
    )
  }

  function localDayAndHmFromIso(iso: string): { day: Date; hm: string } {
    const t = parseISO(iso)
    const day = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const pad = (n: number) => String(n).padStart(2, '0')
    const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`
    return { day, hm }
  }

  function buildBookingNotas(): string {
    let n = bookingNotas.trim()
    if (bookingFueraGrilla) {
      if (!/urgencia/i.test(n)) {
        n = n ? `Urgencia — ${n}` : 'Urgencia'
      }
    } else {
      n = n
        .replace(/^Urgencia\s*[—–-]\s*/i, '')
        .replace(/^Urgencia$/i, '')
        .trim()
    }
    return n
  }

  function setBookingUrgencia(on: boolean) {
    setBookingFueraGrilla(on)
    const doc = bookingDoctorId ? doctorById(bookingDoctorId) : undefined
    if (on) {
      setBookingDuracion(URGENCIA_DURACION_DEFAULT)
      if (bookingSlotHm && !bookingManualHm) {
        setBookingManualHm(bookingSlotHm)
      }
      setBookingSlotHm(null)
    } else {
      setBookingDuracion(doctorDuracionTurno(doc))
      const hm = normalizeHmInput(bookingManualHm)
      if (hm) setBookingSlotHm(hm)
      setBookingManualHm('')
    }
  }

  function resetBookingPayment() {
    setBookingPaymentId(null)
    setBookingMonto('')
    setBookingMetodo('Efectivo')
    setBookingPaymentId2(null)
    setBookingMonto2('')
    setBookingMetodo2('Transferencia')
  }

  function loadBookingPayment(citaId: string) {
    const pays = data.payments
      .filter((p) => p.citaId === citaId && p.monto > 0)
      .sort((a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime())
    const pay1 = pays[0] ?? null
    const pay2 = pays[1] ?? null
    if (pay1) {
      setBookingPaymentId(pay1.id)
      setBookingMonto(formatMonto(pay1.monto))
      setBookingMetodo(pay1.metodo)
      if (pay2) {
        setBookingPaymentId2(pay2.id)
        setBookingMonto2(formatMonto(pay2.monto))
        setBookingMetodo2(pay2.metodo)
      } else {
        setBookingPaymentId2(null)
        setBookingMonto2('')
        setBookingMetodo2('Transferencia')
      }
    } else {
      resetBookingPayment()
    }
  }

  function openBooking(day: Date) {
    setMsg(null)
    setBookingFormError(null)
    setBookingEditingId(null)
    setCitaEditing(null)
    setSelectedWeekDay(day)
    setBookingDate(day)
    setBookingPatientId('')
    setBookingPatientQuery('')
    setBookingPatientPickerOpen(false)
    setBookingSlotHm(null)
    setBookingFueraGrilla(false)
    setBookingManualHm('')
    setBookingNotas('')
    resetBookingPayment()
    setBookingEstado('programado')
    setBookingDuracion(30)
    const disponibles = data.doctors.filter((d) =>
      isDoctorAvailableOnDate(d.id, day, data),
    )
    if (disponibles.length === 1) {
      setBookingDoctorId(disponibles[0]!.id)
    } else {
      setBookingDoctorId('')
    }
    setBookingOpen(true)
  }

  function openBookingForEdit(c: Appointment) {
    setMsg(null)
    setBookingFormError(null)
    setCitaEditing(null)
    const { day, hm } = localDayAndHmFromIso(c.fechaHora)
    setWeekCursor(startOfWeek(day, { weekStartsOn: 1 }))
    setBookingEditingId(c.id)
    setSelectedWeekDay(day)
    setBookingDate(day)
    setBookingDoctorId(c.doctorId)
    setBookingPatientId(c.patientId)
    const p = patientById(c.patientId)
    setBookingPatientQuery(p ? `${p.dni ? `${p.dni} · ` : ''}${p.apellido}, ${p.nombre}` : '')
    setBookingPatientPickerOpen(false)
    setBookingDuracion(c.duracionMinutos)
    setBookingEstado(c.estado)
    const doc = doctorById(c.doctorId)
    const step = doctorDuracionTurno(doc)
    const gridSlots = generateSlotsForDay({
      date: day,
      doctorId: c.doctorId,
      duracionMinutos: step,
      data,
      excludeAppointmentId: c.id,
    })
    const onGrid = gridSlots.some((s) => s.hm === hm)
    const esUrgencia =
      /urgencia/i.test(c.notas) || !onGrid || c.duracionMinutos !== step
    setBookingFueraGrilla(esUrgencia)
    if (esUrgencia) {
      setBookingManualHm(hm)
      setBookingSlotHm(null)
    } else {
      setBookingSlotHm(hm)
      setBookingManualHm('')
    }
    setBookingNotas(
      c.notas
        .replace(/^Urgencia\s*[—–-]\s*/i, '')
        .replace(/^Urgencia$/i, '')
        .trim(),
    )
    loadBookingPayment(c.id)
    setBookingOpen(true)
  }

  function closeBooking() {
    setBookingOpen(false)
    setBookingDate(null)
    setBookingSlotHm(null)
    setBookingFueraGrilla(false)
    setBookingManualHm('')
    setBookingEditingId(null)
    setBookingPatientId('')
    setBookingPatientQuery('')
    setBookingFormError(null)
    resetBookingPayment()
    setBookingPatientPickerOpen(false)
  }

  function resetCita() {
    setCitaEditing(null)
    setCitaForm({
      patientId: '',
      doctorId: '',
      fechaHoraLocal: '',
      duracionMinutos: 30,
      estado: 'programado',
      notas: '',
    })
  }

  function submitCita(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!citaForm.patientId || !citaForm.doctorId || !citaForm.fechaHoraLocal) {
      setMsg({ type: 'err', text: 'Completá paciente, médico y fecha.' })
      return
    }
    const citaDay = new Date(citaForm.fechaHoraLocal)
    if (!isAgendaWorkingDay(citaDay)) {
      setMsg({ type: 'err', text: 'No se atiende los domingos.' })
      return
    }
    const fechaHora = new Date(citaForm.fechaHoraLocal).toISOString()
    const check = validateAppointmentSlot({
      fechaHora,
      doctorId: citaForm.doctorId,
      data,
      excludeAppointmentId: citaEditing ?? undefined,
      duracionMinutos: citaForm.duracionMinutos,
    })
    if (!check.ok) {
      setMsg({ type: 'err', text: check.message })
      return
    }
    upsertAppointment({
      id: citaEditing ?? undefined,
      patientId: citaForm.patientId,
      doctorId: citaForm.doctorId,
      fechaHora,
      duracionMinutos: citaForm.duracionMinutos,
      estado: citaForm.estado,
      notas: citaForm.notas,
    })
    setMsg({ type: 'ok', text: 'Turno guardado.' })
    resetCita()
  }

  function submitBooking(e: React.FormEvent) {
    e.preventDefault()
    setBookingFormError(null)
    const patientId = resolveBookingPatientId()
    const hm = bookingResolvedHm()
    if (!bookingDate || !bookingDoctorId || !patientId || !hm) {
      setBookingFormError(
        !patientId
          ? 'Elegí un paciente de la lista (buscá por DNI o apellido y seleccioná).'
          : bookingFueraGrilla
            ? 'Elegí médico, paciente e ingresá una hora válida (HH:MM).'
            : 'Elegí médico, paciente y un horario disponible.',
      )
      return
    }
    if (!isAgendaWorkingDay(bookingDate)) {
      setBookingFormError('No se atiende los domingos.')
      return
    }
    const fechaHoraLocal = combineDateAndTimeLocal(bookingDate, hm)
    const fechaHora = new Date(fechaHoraLocal).toISOString()
    const check = validateAppointmentSlot({
      fechaHora,
      doctorId: bookingDoctorId,
      data,
      excludeAppointmentId: bookingEditingId ?? undefined,
      duracionMinutos: bookingDuracion,
    })
    if (!check.ok) {
      setBookingFormError(check.message)
      return
    }
    const appointmentId = bookingEditingId ?? createId()
    upsertAppointment({
      id: appointmentId,
      patientId,
      doctorId: bookingDoctorId,
      fechaHora,
      duracionMinutos: bookingDuracion,
      estado: bookingEstado,
      notas: buildBookingNotas(),
    })

    const monto = parseMontoInput(bookingMonto)
    if (monto > 0) {
      upsertPayment({
        id: bookingPaymentId ?? undefined,
        patientId,
        doctorId: bookingDoctorId,
        citaId: appointmentId,
        monto,
        fecha: fechaHora,
        metodo: bookingMetodo,
        notas: '',
      })
    } else if (bookingPaymentId) {
      deletePayment(bookingPaymentId)
    }

    const monto2 = parseMontoInput(bookingMonto2)
    if (monto2 > 0) {
      upsertPayment({
        id: bookingPaymentId2 ?? undefined,
        patientId,
        doctorId: bookingDoctorId,
        citaId: appointmentId,
        monto: monto2,
        fecha: fechaHora,
        metodo: bookingMetodo2,
        notas: '',
      })
    } else if (bookingPaymentId2) {
      deletePayment(bookingPaymentId2)
    }

    const okText = bookingEditingId
      ? 'Turno actualizado.'
      : 'Turno creado desde la agenda semanal.'
    closeBooking()
    setMsg({ type: 'ok', text: okText })
  }

  function submitHor(e: React.FormEvent) {
    e.preventDefault()
    if (!horForm.doctorId) return
    upsertHorario({
      id: createId(),
      doctorId: horForm.doctorId,
      diaSemana: horForm.diaSemana,
      horaInicio: horForm.horaInicio,
      horaFin: horForm.horaFin,
    })
    setMsg({ type: 'ok', text: 'Franja horaria agregada.' })
  }

  function submitFranja(e: React.FormEvent) {
    e.preventDefault()
    const doc = doctorById(franjaForm.doctorId)
    if (!doc) return
    upsertDoctor({
      ...doc,
      duracionTurnoMinutos: franjaForm.duracionTurnoMinutos,
      tipoAgenda: franjaForm.tipoAgenda,
    })
    setMsg({
      type: 'ok',
      text:
        franjaForm.tipoAgenda === 'mensual'
          ? 'Médico en modo atención mensual. Cargá fechas en Atención mensual.'
          : 'Duración de turno guardada para el médico.',
    })
  }

  function submitMensual(e: React.FormEvent) {
    e.preventDefault()
    if (!mensualForm.doctorId || !mensualForm.fecha) return
    upsertAtencionMensual({
      id: createId(),
      doctorId: mensualForm.doctorId,
      fecha: mensualForm.fecha,
      horaInicio: mensualForm.horaInicio,
      horaFin: mensualForm.horaFin,
    })
    setMsg({ type: 'ok', text: 'Fecha de atención agregada.' })
    setMensualForm((f) => ({ ...f, fecha: '' }))
  }

  function toggleLibDia(dia: number) {
    setLibForm((f) => ({
      ...f,
      diasSemana: f.diasSemana.includes(dia)
        ? f.diasSemana.filter((d) => d !== dia)
        : [...f.diasSemana, dia].sort((a, b) => a - b),
    }))
  }

  function submitLib(e: React.FormEvent) {
    e.preventDefault()
    if (!libForm.doctorId || libForm.diasSemana.length === 0) return
    let added = 0
    for (const diaSemana of libForm.diasSemana) {
      const exists = data.diasLibres.some(
        (d) => d.doctorId === libForm.doctorId && d.diaSemana === diaSemana,
      )
      if (!exists) {
        upsertDiaLibre({
          id: createId(),
          doctorId: libForm.doctorId,
          diaSemana,
        })
        added++
      }
    }
    setLibForm((f) => ({ ...f, diasSemana: [] }))
    if (added === 0) {
      setMsg({
        type: 'err',
        text: 'Esos días ya estaban marcados para el médico.',
      })
    } else {
      setMsg({
        type: 'ok',
        text:
          added === 1
            ? 'Día sin atención registrado.'
            : `${added} días sin atención registrados.`,
      })
    }
  }

  const puedeAgenda =
    data.patients.length > 0 && data.doctors.length > 0

  function countTurnosDia(day: Date) {
    return data.appointments.filter((c) => {
      if (c.estado === 'cancelado') return false
      return isSameDay(parseISO(c.fechaHora), day)
    }).length
  }

  function medicoAgendaWeekLine(doc: Doctor): string {
    const esp = doc.especialidad?.trim()
    const nombre = `${doc.apellido}, ${doc.nombre}`
    return esp ? `${nombre} - ${esp}` : nombre
  }

  const medicosDiaSeleccionado = useMemo(() => {
    if (!selectedWeekDay) return []
    return doctorsAvailableOnDate(selectedWeekDay, data)
  }, [
    selectedWeekDay,
    data.doctors,
    data.horarios,
    data.diasLibres,
    data.atencionesMensuales,
  ])

  const medicosEspecialidadesRows = useMemo(
    () => buildMedicosEspecialidadesRows(data),
    [data],
  )

  function turnosLineasAgenda(citas: Appointment[]) {
    return citas
      .filter((c) => c.estado !== 'cancelado')
      .map((c) => {
        const p = patientById(c.patientId)
        return {
          hora: format(parseISO(c.fechaHora), 'HH:mm', { locale: es }),
          paciente: p ? `${p.apellido}, ${p.nombre}` : '—',
        }
      })
  }

  async function cancelDoctorDayTurns(doctorId: string, doctorName: string) {
    if (!selectedWeekDay) return
    const toCancel = data.appointments.filter(
      (c) =>
        c.doctorId === doctorId &&
        c.estado !== 'cancelado' &&
        isSameDay(parseISO(c.fechaHora), selectedWeekDay),
    )
    if (toCancel.length === 0) {
      setMsg({ type: 'err', text: 'No hay turnos activos para cancelar.' })
      return
    }
    const dayLabel = format(selectedWeekDay, "EEEE d 'de' MMMM", { locale: es })
    const ok = await confirm({
      message: `¿Cancelar los ${toCancel.length} turno(s) de ${doctorName} el ${dayLabel}?\n\nNo aparecerán en la agenda ni en los PDF (día, semana, mes o año).`,
      confirmLabel: 'Cancelar turnos',
      cancelLabel: 'Volver',
    })
    if (!ok) return
    for (const c of toCancel) {
      upsertAppointment({ ...c, estado: 'cancelado' })
    }
    setMsg({
      type: 'ok',
      text: `${toCancel.length} turno(s) cancelado(s) para ${doctorName}.`,
    })
  }

  async function restoreDoctorDayTurns(doctorId: string, doctorName: string) {
    if (!selectedWeekDay) return
    const toRestore = data.appointments.filter(
      (c) =>
        c.doctorId === doctorId &&
        c.estado === 'cancelado' &&
        isSameDay(parseISO(c.fechaHora), selectedWeekDay),
    )
    if (toRestore.length === 0) {
      setMsg({ type: 'err', text: 'No hay turnos cancelados para restaurar.' })
      return
    }
    const dayLabel = format(selectedWeekDay, "EEEE d 'de' MMMM", { locale: es })
    const ok = await confirm({
      message: `¿Restaurar los ${toRestore.length} turno(s) cancelado(s) de ${doctorName} el ${dayLabel}?\n\nVolverán a la agenda y a los PDF si el horario sigue libre.`,
      confirmLabel: 'Restaurar turnos',
      cancelLabel: 'Volver',
    })
    if (!ok) return

    let restored = 0
    const failed: string[] = []
    for (const c of toRestore) {
      const check = validateAppointmentSlot({
        fechaHora: c.fechaHora,
        doctorId: c.doctorId,
        data,
        excludeAppointmentId: c.id,
        duracionMinutos: c.duracionMinutos,
      })
      const p = patientById(c.patientId)
      const who = p ? `${p.apellido}, ${p.nombre}` : 'Paciente'
      const hora = format(parseISO(c.fechaHora), 'HH:mm', { locale: es })
      if (!check.ok) {
        failed.push(`${who} ${hora}: ${check.message}`)
        continue
      }
      upsertAppointment({ ...c, estado: 'programado' })
      restored++
    }

    if (restored > 0 && failed.length === 0) {
      setMsg({
        type: 'ok',
        text: `${restored} turno(s) restaurado(s) para ${doctorName}.`,
      })
    } else if (restored > 0) {
      setMsg({
        type: 'err',
        text: `Restaurados ${restored}. No se pudieron ${failed.length}: ${failed.join(' · ')}`,
      })
    } else {
      setMsg({
        type: 'err',
        text: `No se pudo restaurar ningún turno. ${failed.join(' · ')}`,
      })
    }
  }

  async function openWhatsAppMedico(doctorId: string) {
    const doctor = doctorById(doctorId)
    const tel = doctor?.telefono?.trim() ?? ''
    if (!tel) {
      void confirm({
        message:
          'El médico no tiene teléfono cargado. Agregalo en Médicos para enviar WhatsApp.',
      })
      return
    }
    const medicoLabel = doctor
      ? `${doctor.apellido}, ${doctor.nombre}`
      : '—'
    const fechaLabel = selectedWeekDay
      ? format(selectedWeekDay, "EEEE d 'de' MMMM", { locale: es })
      : 'hoy'
    const delMedico = citasDelDia.filter((c) => c.doctorId === doctorId)
    const mensaje = buildMedicoAgendaMessage({
      medicoLabel,
      fechaLabel,
      manana: turnosLineasAgenda(
        citasEnFranja(delMedico, DEFAULT_AGENDA_RANGES[0]!),
      ),
      tarde: turnosLineasAgenda(
        citasEnFranja(delMedico, DEFAULT_AGENDA_RANGES[1]!),
      ),
    })
    if (!buildWhatsAppSendUrl(tel, mensaje)) {
      void confirm({
        message:
          'El teléfono del médico no es válido. Usá formato con código de área (ej. 11 4000-0000).',
      })
      return
    }
    try {
      await openWhatsAppUrl(tel, mensaje)
    } catch (err) {
      console.error(err)
      void confirm({
        message:
          'No se pudo abrir WhatsApp. Comprobá que tengas WhatsApp o un navegador predeterminado.',
      })
    }
  }

  async function openWhatsAppTurno(c: Appointment) {
    const patient = patientById(c.patientId)
    const tel = patient?.telefono?.trim() ?? ''
    if (!tel) {
      void confirm({
        message:
          'El paciente no tiene teléfono cargado. Agregalo en Pacientes para enviar WhatsApp.',
      })
      return
    }
    const doctor = doctorById(c.doctorId)
    const mensaje = buildTurnoReminderMessage({
      medicoLabel: doctor
        ? `${doctor.apellido}, ${doctor.nombre}`
        : '—',
      fechaLabel: format(parseISO(c.fechaHora), "EEEE d 'de' MMMM", {
        locale: es,
      }),
      hora: format(parseISO(c.fechaHora), 'HH:mm', { locale: es }),
    })
    if (!buildWhatsAppSendUrl(tel, mensaje)) {
      void confirm({
        message:
          'El teléfono del paciente no es válido. Usá formato con código de área (ej. 11 4000-0000).',
      })
      return
    }
    try {
      await openWhatsAppUrl(tel, mensaje)
    } catch (err) {
      console.error(err)
      void confirm({
        message:
          'No se pudo abrir WhatsApp. Comprobá que tengas WhatsApp o un navegador predeterminado.',
      })
    }
  }

  const pagadoCitaIds = useMemo(() => {
    const pagosConMonto = data.payments.filter((p) => p.monto > 0)
    const set = new Set<string>()
    for (const p of pagosConMonto) {
      if (p.citaId) set.add(p.citaId)
    }
    return set
  }, [data.payments])

  const pagadoDayKeys = useMemo(() => {
    return new Set(
      data.payments
        .filter((p) => p.monto > 0)
        .map((p) => {
          const day = format(parseISO(p.fecha), 'yyyy-MM-dd')
          return `${p.patientId}__${p.doctorId}__${day}`
        }),
    )
  }, [data.payments])

  function renderDayCitaRow(c: Appointment, secondary: string, compactEstado = false) {
    const t = parseISO(c.fechaHora)
    const isPagado =
      pagadoCitaIds.has(c.id) ||
      pagadoDayKeys.has(`${c.patientId}__${c.doctorId}__${format(t, 'yyyy-MM-dd')}`)
    const estadoLabel = formatDayCitaEstado(c, isPagado, compactEstado)
    const estadoTitle = compactEstado
      ? dayCitaEstadoParts(c, isPagado).join(' - ')
      : undefined
    return (
      <li
        key={c.id}
        className={`day-cita${bookingOpen && bookingEditingId === c.id ? ' day-cita--active' : ''}`}
        onClick={() => openBookingForEdit(c)}
      >
        <div className="day-cita__main">
          <span className="day-cita__time">
            {format(parseISO(c.fechaHora), 'HH:mm', { locale: es })}
          </span>
          <span className="day-cita__who">{secondary}</span>
          <span className="day-cita__estado" title={estadoTitle}>
            {estadoLabel}
          </span>
        </div>
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          <IconActionButton
            variant="whatsapp"
            label="Enviar mensaje por WhatsApp"
            onClick={() => void openWhatsAppTurno(c)}
          >
            <IconWhatsApp />
          </IconActionButton>
          <IconActionButton
            variant="edit"
            label="Editar turno"
            onClick={() => openBookingForEdit(c)}
          >
            <IconEdit />
          </IconActionButton>
          <IconActionButton
            variant="delete"
            label="Eliminar turno"
            onClick={() => setCitaToDelete(c)}
          >
            <IconTrash />
          </IconActionButton>
        </div>
      </li>
    )
  }

  function renderMedicoDayPill(
    g: {
      key: string
      label: string
      citas: Appointment[]
      sinTurnosDisponibles?: boolean
    },
    secondaryFor: (c: Appointment) => string,
  ) {
    const libres = turnosLibresPorMedicoDia.get(g.key)
    const libresPanelOpen =
      libresHorasOpen?.doctorId === g.key ? libresHorasOpen.franja : null
    const libresHorasVisibles =
      libresPanelOpen === 'manana'
        ? libres?.manana.horas
        : libresPanelOpen === 'tarde'
          ? libres?.tarde.horas
          : null
    const { manana: citasManana, tarde: citasTarde } = splitCitasMananaTarde(g.citas)
    const compact = g.citas.length > AGENDA_COMPACT_ESTADO_THRESHOLD
    const showFranjaDivider = citasManana.length > 0 && citasTarde.length > 0
    const { name: medicoName, esp: medicoEsp } = splitMedicoPillLabel(g.label)
    const medicoActions = (
      <div className="day-pill__group-actions">
        <IconActionButton
          variant="whatsapp"
          label={`WhatsApp — ${g.label}`}
          onClick={() => void openWhatsAppMedico(g.key)}
        >
          <IconWhatsApp />
        </IconActionButton>
        {(turnosActivosPorMedicoDia.get(g.key) ?? 0) > 0 && (
          <IconActionButton
            variant="cancel"
            label={`Cancelar turnos del día — ${g.label}`}
            onClick={() => void cancelDoctorDayTurns(g.key, g.label)}
          >
            <IconCancelDay />
          </IconActionButton>
        )}
        {(turnosCanceladosPorMedicoDia.get(g.key) ?? 0) > 0 && (
          <IconActionButton
            variant="restore"
            label={`Restaurar turnos cancelados — ${g.label}`}
            onClick={() => void restoreDoctorDayTurns(g.key, g.label)}
          >
            <IconRestoreDay />
          </IconActionButton>
        )}
      </div>
    )
    return (
      <div key={g.key} className="day-pill day-pill--medico">
        <div className="day-pill__group">
          <div className="day-pill__group-name">
            <div className="day-pill__doctor-head">
              <div className="day-pill__doctor-text">
                <span className="day-pill__doctor">
                  {medicoName}
                  {medicoEsp ? ' -' : ''}
                </span>
                {medicoEsp && (
                  <span className="day-pill__doctor-esp">{medicoEsp}</span>
                )}
              </div>
              {medicoActions}
            </div>
            {libres && (libres.manana.atiende || libres.tarde.atiende) && (
              <div className="day-pill__libres-chips">
                {libres.manana.atiende && (
                  <button
                    type="button"
                    className={`day-pill__libres-chip day-pill__libres-chip--manana${libresPanelOpen === 'manana' ? ' day-pill__libres-chip--open' : ''}`}
                    title="Ver horarios libres de la mañana"
                    onClick={() => toggleLibresHoras(g.key, 'manana')}
                  >
                    Libre {libres.manana.count} T. Mañana
                  </button>
                )}
                {libres.tarde.atiende && (
                  <button
                    type="button"
                    className={`day-pill__libres-chip day-pill__libres-chip--tarde${libresPanelOpen === 'tarde' ? ' day-pill__libres-chip--open' : ''}`}
                    title="Ver horarios libres de la tarde"
                    onClick={() => toggleLibresHoras(g.key, 'tarde')}
                  >
                    Libre {libres.tarde.count} T. Tarde
                  </button>
                )}
              </div>
            )}
          </div>
          {libresHorasVisibles && (
            <div className="day-pill__libres-horas-panel" role="status">
              {libresHorasVisibles.length > 0
                ? libresHorasVisibles.join(' · ')
                : 'Sin horarios libres en esta franja.'}
            </div>
          )}
          {g.citas.length > 0 ? (
            <ul
              className={`day-cita-list${compact ? ' day-cita-list--compact' : ''}`}
            >
              {citasManana.map((c) =>
                renderDayCitaRow(c, secondaryFor(c), compact),
              )}
              {showFranjaDivider && (
                <li className="day-cita-list__franja-divider" aria-hidden="true" />
              )}
              {citasTarde.map((c) =>
                renderDayCitaRow(c, secondaryFor(c), compact),
              )}
            </ul>
          ) : (
            !g.sinTurnosDisponibles && (
              <p className="day-pill__empty day-pill__empty--medico">Sin turnos</p>
            )
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`page page--agenda${role === 'admin' ? ' page--agenda-admi' : ' page--agenda-secretaria'}`}
    >
      <header className="page-header page-header--agenda">
        <div className="tabs tabs--agenda">
          <h1 className="tabs--agenda__title">Agenda</h1>
        <button
          type="button"
          className={`tab tab--agenda-celeste${tab === 'turnos' ? ' tab--on' : ''}`}
          onClick={() => setTab('turnos')}
        >
          Turnos
        </button>
        <div className="tabs--agenda__right">
          <div className="tabs--agenda__secondary">
            <button
              type="button"
              className={`tab tab--agenda-verde${tab === 'horarios' ? ' tab--on' : ''}`}
              onClick={() => setTab('horarios')}
            >
              Horarios por médico
            </button>
            <button
              type="button"
              className={`tab tab--agenda-lila${tab === 'franja' ? ' tab--on' : ''}`}
              onClick={() => setTab('franja')}
            >
              Franja del turno
            </button>
            <button
              type="button"
              className={`tab tab--agenda-naranja${tab === 'mensual' ? ' tab--on' : ''}`}
              onClick={() => setTab('mensual')}
            >
              Atención mensual
            </button>
            <button
              type="button"
              className={`tab tab--agenda-menta${tab === 'libres' ? ' tab--on' : ''}`}
              onClick={() => setTab('libres')}
            >
              Días libres
            </button>
            <button
              type="button"
              className="tab tab--agenda-violeta"
              onClick={() => setMedicosEspModalOpen(true)}
            >
              Especialidades
            </button>
          </div>
          <div className="agenda-export-bar">
          <div className="agenda-export-bar__field">
            <label className="agenda-export-bar__label" htmlFor="agenda-export-doctor">
              Médico
            </label>
            <select
              id="agenda-export-doctor"
              className="agenda-export-bar__select agenda-export-bar__select--doctor"
              value={agendaExportDoctorId}
              onChange={(e) => setAgendaExportDoctorId(e.target.value)}
              aria-label="Médico para PDF y correo"
            >
              <option value="">Todos</option>
              {agendaExportDoctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.apellido}, {d.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="agenda-export-bar__field">
            <label className="agenda-export-bar__label" htmlFor="agenda-export-scope">
              Exportar
            </label>
            <select
              id="agenda-export-scope"
              className="agenda-export-bar__select"
              value={agendaExportScope}
              onChange={(e) =>
                setAgendaExportScope(e.target.value as AgendaPdfScope)
              }
              aria-label="Período para PDF y correo"
            >
              <option value="day">Día</option>
              <option value="week">Semana</option>
              <option value="month">Mes</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-pdf agenda-export-bar__pdf agenda-export-bar__pdf-turnos"
            onClick={() => void handleAgendaTurnosPdfPreview()}
          >
            <span className="btn-pdf__label">PDF Turnos</span>
          </button>
          <button
            type="button"
            className="btn btn-pdf agenda-export-bar__pdf"
            onClick={handleAgendaPdfPreview}
          >
            Vista previa
          </button>
          <button
            type="button"
            className={`btn btn-email agenda-export-bar__email${enviandoCorreo ? ' btn-email--sending' : ''}`}
            disabled={enviandoCorreo}
            aria-busy={enviandoCorreo}
            onClick={() => void handleEnviarCorreoAgenda()}
          >
            {enviandoCorreo ? (
              <>
                <span className="btn-email__spinner" aria-hidden />
                <span className="btn-email__label btn-email__label--sending">
                  Enviar Correo
                </span>
              </>
            ) : (
              <>
                <span className="btn-email__icon" aria-hidden>
                  @
                </span>
                <span className="btn-email__label">Enviar Correo</span>
              </>
            )}
          </button>
        </div>
        </div>
        </div>
      </header>

      {msg && (
        <div className={`msg ${msg.type === 'err' ? 'msg-error' : 'msg-ok'}`}>
          {msg.text}
        </div>
      )}

      {tab === 'turnos' && (
        <div className="agenda-turnos-layout">
          <section className="panel panel--day-list panel--day-list-scroll panel--day-list-unified">
            <div className="day-list-week-inset">
              <div className="week-toolbar">
                <div className="week-toolbar__title-row">
                  <h2 className="week-toolbar__range">SEMANA {weekLabel}</h2>
                </div>
                <div className="week-nav" aria-label="Cambiar semana">
                  <button
                    type="button"
                    className="week-nav__arrow week-nav__btn--celeste"
                    aria-label="Semana anterior"
                    onClick={() => setWeekCursor((d) => addWeeks(d, -1))}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="week-nav__arrow week-nav__btn--lila"
                    aria-label="Semana siguiente"
                    onClick={() => setWeekCursor((d) => addWeeks(d, 1))}
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    className="week-nav__pill week-nav__btn--verde"
                    onClick={() =>
                      setWeekCursor(startOfWeek(new Date(), { weekStartsOn: 1 }))
                    }
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    className="week-nav__pill week-nav__btn--celeste"
                    onClick={() => setWeekCursor((d) => addWeeks(d, 1))}
                  >
                    Semana siguiente
                  </button>
                  <button
                    type="button"
                    className="week-nav__pill week-nav__btn--naranja"
                    onClick={() =>
                      setWeekCursor((d) =>
                        startOfWeek(addMonths(d, 1), { weekStartsOn: 1 }),
                      )
                    }
                  >
                    Mes Siguiente
                  </button>
                </div>
              </div>
              <div className="week-strip" role="list">
                {weekDays.map((day) => {
                  const today = isSameDay(day, new Date())
                  const selected =
                    selectedWeekDay !== null && isSameDay(day, selectedWeekDay)
                  const n = countTurnosDia(day)
                  return (
                    <div
                      key={day.toISOString()}
                      role="listitem"
                      className={`week-day${day.getDay() === 6 ? ' week-day--sabado' : ''}${today ? ' week-day--today' : ''}${selected ? ' week-day--selected' : ''}`}
                      title="Clic para marcar · doble clic para reservar"
                      onClick={() => setSelectedWeekDay(day)}
                      onDoubleClick={() => openBooking(day)}
                    >
                      <div className="week-day__dow">
                        {format(day, 'EEE', { locale: es })}
                      </div>
                      <div className="week-day__num">{format(day, 'd')}</div>
                      <div className="week-day__meta">
                        {format(day, 'MMM', { locale: es })}
                      </div>
                      {n > 0 && (
                        <div>
                          <span className="week-day__badge">
                            {n} turno{n === 1 ? '' : 's'}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {selectedWeekDay && (
                <div
                  className="week-medics-row"
                  aria-label={`Médicos que atienden el ${format(selectedWeekDay, "EEEE d 'de' MMMM", { locale: es })}`}
                >
                  {medicosDiaSeleccionado.length > 0 ? (
                    medicosDiaSeleccionado.map((doc, i) => (
                      <span key={doc.id} className="week-medics-row__item">
                        {i > 0 && (
                          <span className="week-medics-row__sep" aria-hidden>
                            ·
                          </span>
                        )}
                        {medicoAgendaWeekLine(doc)}
                      </span>
                    ))
                  ) : (
                    <span className="week-medics-row__empty">
                      Ningún médico atiende ese día
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="day-list__head">
              <h2 className="day-list__title">
                {selectedWeekDay
                  ? format(selectedWeekDay, "EEEE d 'de' MMMM", {
                      locale: es,
                    }).toLocaleUpperCase('es')
                  : 'SELECCIONÁ UN DÍA'}
              </h2>
              {selectedWeekDay && (
                <div className="day-list__day-nav week-nav" aria-label="Cambiar día">
                  <button
                    type="button"
                    className="week-nav__arrow"
                    aria-label="Día anterior"
                    disabled={selectedDayIndex <= 0}
                    onClick={() => goAdjacentDay(-1)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="week-nav__arrow"
                    aria-label="Día siguiente"
                    disabled={
                      selectedDayIndex < 0 ||
                      selectedDayIndex >= weekDays.length - 1
                    }
                    onClick={() => goAdjacentDay(1)}
                  >
                    ›
                  </button>
                </div>
              )}
              <details className="details-advanced details-advanced--pill">
                <summary>Agenda Manual</summary>
                <div className="details-advanced__panel">
                  {!puedeAgenda ? (
                    <p className="empty-hint">
                      Cargá al menos un paciente y un médico para poder dar turnos.
                    </p>
                  ) : (
                    <form onSubmit={submitCita}>
                      <div className="form-grid">
                        <div className="field">
                          <label htmlFor="c-pac">Paciente</label>
                          <select
                            id="c-pac"
                            value={citaForm.patientId}
                            onChange={(e) =>
                              setCitaForm((f) => ({ ...f, patientId: e.target.value }))
                            }
                            required
                          >
                            <option value="">Elegir…</option>
                            {data.patients.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.apellido}, {p.nombre}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="c-doc">Médico</label>
                          <select
                            id="c-doc"
                            value={citaForm.doctorId}
                            onChange={(e) => {
                              const id = e.target.value
                              const doc = doctorById(id)
                              setCitaForm((f) => ({
                                ...f,
                                doctorId: id,
                                duracionMinutos: doc
                                  ? doctorDuracionTurno(doc)
                                  : f.duracionMinutos,
                              }))
                            }}
                            required
                          >
                            <option value="">Elegir…</option>
                            {data.doctors.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.apellido}, {d.nombre}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="c-fh">Fecha y hora</label>
                          <input
                            id="c-fh"
                            type="datetime-local"
                            value={citaForm.fechaHoraLocal}
                            onChange={(e) =>
                              setCitaForm((f) => ({
                                ...f,
                                fechaHoraLocal: e.target.value,
                              }))
                            }
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="c-dur">Duración turno (min)</label>
                          <input
                            id="c-dur"
                            type="number"
                            min={5}
                            step={5}
                            value={citaForm.duracionMinutos}
                            readOnly
                            title="Definida en Agenda → Franja del turno"
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="c-est">Estado</label>
                          <select
                            id="c-est"
                            value={citaForm.estado}
                            onChange={(e) =>
                              setCitaForm((f) => ({
                                ...f,
                                estado: e.target.value as AppointmentEstado,
                              }))
                            }
                          >
                            {estados.map((x) => (
                              <option key={x.value} value={x.value}>
                                {x.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field" style={{ gridColumn: '1 / -1' }}>
                          <label htmlFor="c-historia-clinica">Historia Clínica</label>
                          <textarea
                            id="c-historia-clinica"
                            rows={2}
                            placeholder="Motivo de consulta o por qué se atendió al paciente"
                            value={citaForm.notas}
                            onChange={(e) =>
                              setCitaForm((f) => ({ ...f, notas: e.target.value }))
                            }
                          />
                        </div>
                      </div>
                      <p className="empty-hint" style={{ marginTop: 0 }}>
                        Si el médico tiene horarios cargados, el turno debe caer dentro de
                        una franja. No se permiten solapamientos entre turnos activos del
                        mismo médico.
                      </p>
                      <div className="form-actions">
                        <button type="submit" className="btn btn-primary">
                          {citaEditing ? 'Guardar turno' : 'Crear turno'}
                        </button>
                        {citaEditing && (
                          <button type="button" className="btn btn-ghost" onClick={resetCita}>
                            Cancelar
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </div>
              </details>
            </div>
            <div className="day-list__scroll day-list__scroll--horizontal">
              {!selectedWeekDay ? (
                <p className="empty-hint">Seleccioná un día en la semana.</p>
              ) : citasPorMedicoDia.length === 0 ? (
                <p className="empty-hint">Sin turnos ni médicos con agenda ese día.</p>
              ) : (
                <div className="day-list-pills day-list-pills--por-medico">
                  {citasPorMedicoDia.map((g) =>
                    renderMedicoDayPill(g, (c) => {
                      const p = patientById(c.patientId)
                      return p ? `${p.apellido}, ${p.nombre}` : '—'
                    }),
                  )}
                </div>
              )}
            </div>
          </section>

          {bookingOpen && bookingDate && (
            <div
              className="booking-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="booking-title"
              onMouseDown={(ev) => {
                if (ev.target === ev.currentTarget) closeBooking()
              }}
            >
              <div className="booking-sheet" onMouseDown={(e) => e.stopPropagation()}>
                <div className="booking-brand" id="booking-title">
                  <div className="booking-logo">C</div>
                  <div className="booking-brand__body">
                    <strong>{APP_DISPLAY_NAME}</strong>
                    <div className="booking-brand__row">
                      <span className="booking-brand__subtitle">
                        {bookingEditingId ? 'Modificar turno' : 'Nuevo turno'}
                      </span>
                      <span className="booking-brand__date">
                        {format(bookingDate, "EEEE d 'de' MMMM", { locale: es })}
                      </span>
                    </div>
                  </div>
                </div>

                {!puedeAgenda ? (
                  <p className="empty-hint">
                    Cargá pacientes y médicos para poder reservar desde acá.
                  </p>
                ) : (
                  <form onSubmit={submitBooking} noValidate>
                    <div className="form-grid form-grid--booking-fields">
                      <div className="field field--booking-doc">
                        <label htmlFor="bk-doc">Médico</label>
                        <select
                          id="bk-doc"
                          value={bookingDoctorId}
                          onChange={(e) => {
                            const id = e.target.value
                            setBookingDoctorId(id)
                            setBookingSlotHm(null)
                            setBookingManualHm('')
                            const doc = doctorById(id)
                            if (doc && !bookingFueraGrilla) {
                              setBookingDuracion(doctorDuracionTurno(doc))
                            }
                          }}
                          required
                          disabled={bookingDoctors.length === 0}
                        >
                          <option value="">
                            {bookingDoctors.length === 0
                              ? 'Sin médicos ese día'
                              : 'Elegir…'}
                          </option>
                          {bookingDoctors.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.apellido}, {d.nombre}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field field--booking-pac">
                        <label htmlFor="bk-pac">Paciente</label>
                        <div className="booking-patient-picker">
                          <input
                            id="bk-pac"
                            value={bookingPatientQuery}
                            onChange={(e) => {
                              const q = e.target.value
                              setBookingPatientQuery(q)
                              setBookingPatientPickerOpen(true)
                              if (bookingPatientId) setBookingPatientId('')
                            }}
                            onFocus={() => setBookingPatientPickerOpen(true)}
                            onBlur={() => {
                              window.setTimeout(() => setBookingPatientPickerOpen(false), 120)
                            }}
                            placeholder="Buscar por DNI o apellido…"
                          />
                          {bookingPatientPickerOpen && (
                            <div className="booking-patient-picker__menu">
                              {(bookingPatientQuery.trim()
                                ? data.patients.filter((p) => {
                                    const q = bookingPatientQuery.trim().toLowerCase()
                                    return (
                                      (p.dni ?? '').toLowerCase().includes(q) ||
                                      (p.apellido ?? '').toLowerCase().includes(q)
                                    )
                                  })
                                : data.patients
                              )
                                .slice(0, 12)
                                .map((p) => (
                                  <button
                                    type="button"
                                    key={p.id}
                                    className="booking-patient-picker__opt"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setBookingPatientId(p.id)
                                      setBookingPatientQuery(
                                        `${p.dni ? `${p.dni} · ` : ''}${p.apellido}, ${p.nombre}`,
                                      )
                                      setBookingPatientPickerOpen(false)
                                    }}
                                  >
                                    <span className="booking-patient-picker__opt-dni">
                                      {p.dni || '—'}
                                    </span>
                                    <span className="booking-patient-picker__opt-name">
                                      {p.apellido}, {p.nombre}
                                    </span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {bookingScheduleHint && (
                        <p className="booking-schedule-hint field--booking-schedule">
                          {bookingScheduleHint}
                        </p>
                      )}
                      {bookingDoctors.length === 0 && (
                        <p className="empty-hint form-grid--booking-fields__hint">
                          Ningún médico atiende ese día en las franjas horarias (o
                          está marcado como día libre).
                        </p>
                      )}
                      <div className="booking-pay form-grid--booking-fields__full">
                        <p className="booking-pay__label">Pago (opcional)</p>
                        <div className="booking-pay__grid">
                          <div className="field">
                            <label htmlFor="bk-monto">Monto</label>
                            <input
                              id="bk-monto"
                              inputMode="decimal"
                              placeholder="0"
                              value={bookingMonto}
                              onChange={(e) =>
                                setBookingMonto(formatMontoFieldInput(e.target.value))
                              }
                            />
                          </div>
                          <div className="field field--pill">
                            <label htmlFor="bk-met">Método</label>
                            <div className="pill-select">
                              <select
                                id="bk-met"
                                value={bookingMetodo}
                                onChange={(e) => setBookingMetodo(e.target.value)}
                              >
                                {PAYMENT_METODOS.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="field field--pill">
                            <label htmlFor="bk-est">Estado</label>
                            <div className="pill-select">
                              <select
                                id="bk-est"
                                value={bookingEstado}
                                onChange={(e) =>
                                  setBookingEstado(e.target.value as AppointmentEstado)
                                }
                              >
                                {estados.map((x) => (
                                  <option key={x.value} value={x.value}>
                                    {x.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="field">
                            <label htmlFor="bk-monto-2">Monto (2)</label>
                            <input
                              id="bk-monto-2"
                              inputMode="decimal"
                              placeholder="0"
                              value={bookingMonto2}
                              onChange={(e) =>
                                setBookingMonto2(formatMontoFieldInput(e.target.value))
                              }
                            />
                          </div>
                          <div className="field field--pill">
                            <label htmlFor="bk-met-2">Método (2)</label>
                            <div className="pill-select">
                              <select
                                id="bk-met-2"
                                value={bookingMetodo2}
                                onChange={(e) => setBookingMetodo2(e.target.value)}
                              >
                                {PAYMENT_METODOS.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="field field--pill field--booking-total">
                            <label htmlFor="bk-total-monto">Total Monto</label>
                            <div className="pill-select">
                              <output
                                id="bk-total-monto"
                                className="booking-pay__total-value"
                                aria-live="polite"
                              >
                                {formatMonto(bookingTotalMonto)}
                              </output>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="booking-historia-row form-grid--booking-fields__full">
                        <div className="field field--booking-historia">
                          <label htmlFor="bk-historia-clinica">Historia Clínica</label>
                          <textarea
                            id="bk-historia-clinica"
                            rows={2}
                            placeholder="Motivo de consulta o por qué se atendió al paciente"
                            value={bookingNotas}
                            onChange={(e) => setBookingNotas(e.target.value)}
                          />
                        </div>
                        <div className="field field--booking-urgencia-inline">
                          <span className="booking-urgencia-inline__label">Urgencia</span>
                          <label className="booking-urgencia__check booking-urgencia__check--pill">
                            <input
                              type="checkbox"
                              checked={bookingFueraGrilla}
                              onChange={(e) => setBookingUrgencia(e.target.checked)}
                            />
                            <span>Urgencia / fuera de grilla (hora manual)</span>
                          </label>
                        </div>
                      </div>
                      {bookingFueraGrilla && (
                        <div className="booking-urgencia__fields form-grid--booking-fields__full">
                          <div className="field">
                            <label htmlFor="bk-hora-manual">Hora</label>
                            <input
                              id="bk-hora-manual"
                              type="time"
                              value={bookingManualHm}
                              onChange={(e) => setBookingManualHm(e.target.value)}
                              required
                            />
                          </div>
                          <div className="field field--pill">
                            <label htmlFor="bk-dur-urg">Duración (min)</label>
                            <div className="pill-select">
                              <select
                                id="bk-dur-urg"
                                value={bookingDuracion}
                                onChange={(e) =>
                                  setBookingDuracion(Number(e.target.value))
                                }
                              >
                                {DURACION_TURNO_OPCIONES.map((m) => (
                                  <option key={m} value={m}>
                                    {m} min
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {bookingManualSlotCheck && !bookingManualSlotCheck.ok && (
                            <p className="booking-urgencia__hint booking-urgencia__hint--err">
                              {bookingManualSlotCheck.message}
                            </p>
                          )}
                          {bookingManualSlotCheck?.ok && normalizeHmInput(bookingManualHm) && (
                            <p className="booking-urgencia__hint booking-urgencia__hint--ok">
                              Horario disponible para este médico.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {bookingDoctorId && bookingDayPlan?.kind === 'no-day' && (
                      <p className="msg msg-error" style={{ marginTop: '0.75rem' }}>
                        Este médico no tiene franja ese día de la semana. Ajustá
                        horarios o elegí otro día.
                      </p>
                    )}

                    {bookingDoctorId && bookingDayPlan?.kind !== 'no-day' && (
                      <>
                        <div className="slot-section-title">
                          {bookingFueraGrilla
                            ? 'Horarios de referencia (tocá para copiar la hora)'
                            : 'Horarios sugeridos'}
                        </div>
                        {bookingSlots.length === 0 ? (
                          <p className="empty-hint" style={{ padding: '0.5rem 0' }}>
                            No hay cupos de {bookingDuracion} min en las franjas de ese
                            día (o ya están ocupados).
                          </p>
                        ) : (
                          <div className="slot-grid">
                            {bookingSlots.map((s) => (
                              <button
                                key={s.hm}
                                type="button"
                                disabled={!bookingFueraGrilla && !s.available}
                                title={s.available ? 'Disponible' : s.reason}
                                className={`slot-btn${
                                  (bookingFueraGrilla
                                    ? normalizeHmInput(bookingManualHm) === s.hm
                                    : bookingSlotHm === s.hm)
                                    ? ' slot-btn--picked'
                                    : ''
                                }`}
                                onClick={() => {
                                  if (bookingFueraGrilla) {
                                    setBookingManualHm(s.hm)
                                    return
                                  }
                                  if (!s.available) return
                                  setBookingSlotHm(s.hm)
                                }}
                              >
                                {s.hm}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {bookingFormError && (
                      <p className="msg msg-error booking-form-error" role="alert">
                        {bookingFormError}
                      </p>
                    )}

                    <div className="booking-actions">
                      <button
                        type="submit"
                        className="btn btn-pdf booking-actions__btn"
                        disabled={
                          !bookingResolvedHm() ||
                          (bookingFueraGrilla &&
                            bookingManualSlotCheck !== null &&
                            !bookingManualSlotCheck.ok)
                        }
                      >
                        {bookingEditingId ? 'Guardar cambios' : 'Confirmar turno'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-pdf booking-actions__btn"
                        onClick={closeBooking}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn btn-pdf booking-actions__btn"
                        onClick={closeBooking}
                      >
                        Salir
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {tab === 'franja' && (
        <>
          <section className="panel">
            <h2>Franja del turno por médico</h2>
            <p className="panel-hint panel-hint--oneline">
              Cada cuántos minutos se ofrecen turnos (ej. 15 → 8:00, 8:15, 8:30…). Al elegir
              médico en la reserva se muestra su horario del día.
            </p>
            {data.doctors.length === 0 ? (
              <p className="empty-hint">Primero cargá médicos.</p>
            ) : (
              <form onSubmit={submitFranja}>
                <div className="form-grid form-grid--franja-medico">
                  <div className="field">
                    <label htmlFor="f-doc">Médico</label>
                    <select
                      id="f-doc"
                      value={franjaForm.doctorId}
                      onChange={(e) => {
                        const id = e.target.value
                        const doc = doctorById(id)
                        setFranjaForm({
                          doctorId: id,
                          duracionTurnoMinutos: doctorDuracionTurno(doc),
                          tipoAgenda: doc?.tipoAgenda === 'mensual' ? 'mensual' : 'semanal',
                        })
                      }}
                      required
                    >
                      <option value="">Elegir…</option>
                      {data.doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.apellido}, {d.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field field--pill field--franja-tipo">
                    <label htmlFor="f-tipo">Tipo de agenda</label>
                    <div className="pill-select">
                      <select
                        id="f-tipo"
                        value={franjaForm.tipoAgenda}
                        onChange={(e) =>
                          setFranjaForm((f) => ({
                            ...f,
                            tipoAgenda: e.target.value as 'semanal' | 'mensual',
                          }))
                        }
                      >
                        <option value="semanal">Semanal (horarios por día)</option>
                        <option value="mensual">Mensual (fechas puntuales)</option>
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="f-dur">Duración de cada turno</label>
                    <select
                      id="f-dur"
                      value={franjaForm.duracionTurnoMinutos}
                      onChange={(e) =>
                        setFranjaForm((f) => ({
                          ...f,
                          duracionTurnoMinutos: Number(e.target.value),
                        }))
                      }
                    >
                      {DURACION_TURNO_OPCIONES.map((m) => (
                        <option key={m} value={m}>
                          {m} minutos
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">
                    Guardar
                  </button>
                </div>
              </form>
            )}
          </section>
          {franjaForm.doctorId && (
            <p className="panel-hint">
              {franjaForm.tipoAgenda === 'mensual'
                ? 'Este médico solo aparece en la agenda los días cargados en Atención mensual.'
                : 'Configurá los días y horarios en Horarios por médico.'}
            </p>
          )}
        </>
      )}

      {tab === 'mensual' && (
        <>
          <section className="panel">
            <h2>Atención mensual (fechas puntuales)</h2>
            <p className="panel-hint panel-hint--oneline">
              Para médicos que atienden una vez al mes (u otras fechas especiales). Marcá el
              médico como &quot;Mensual&quot; en Franja del turno.
            </p>
            {data.doctors.length === 0 ? (
              <p className="empty-hint">Primero cargá médicos.</p>
            ) : (
              <form onSubmit={submitMensual}>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="m-doc">Médico</label>
                    <select
                      id="m-doc"
                      value={mensualForm.doctorId}
                      onChange={(e) =>
                        setMensualForm((f) => ({ ...f, doctorId: e.target.value }))
                      }
                      required
                    >
                      <option value="">Elegir…</option>
                      {data.doctors
                        .filter((d) => isDoctorAgendaMensual(d))
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.apellido}, {d.nombre}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="m-fecha">Fecha de atención</label>
                    <input
                      id="m-fecha"
                      type="date"
                      value={mensualForm.fecha}
                      onChange={(e) =>
                        setMensualForm((f) => ({ ...f, fecha: e.target.value }))
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="m-ini">Desde</label>
                    <input
                      id="m-ini"
                      type="time"
                      value={mensualForm.horaInicio}
                      onChange={(e) =>
                        setMensualForm((f) => ({ ...f, horaInicio: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="m-fin">Hasta</label>
                    <input
                      id="m-fin"
                      type="time"
                      value={mensualForm.horaFin}
                      onChange={(e) =>
                        setMensualForm((f) => ({ ...f, horaFin: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">
                    Agregar fecha
                  </button>
                </div>
              </form>
            )}
          </section>
          <div className="table-wrap">
            {data.atencionesMensuales.length === 0 ? (
              <p className="empty-hint">No hay fechas de atención mensual cargadas.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Médico</th>
                    <th>Fecha</th>
                    <th>Horario</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.atencionesMensuales]
                    .sort((a, b) => b.fecha.localeCompare(a.fecha))
                    .map((a) => {
                      const d = doctorById(a.doctorId)
                      return (
                        <tr key={a.id}>
                          <td>{d ? `${d.apellido}, ${d.nombre}` : '—'}</td>
                          <td>
                            {format(parseISO(`${a.fecha}T12:00:00`), 'dd/MM/yyyy', {
                              locale: es,
                            })}
                          </td>
                          <td>
                            {a.horaInicio} – {a.horaFin}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-danger"
                              onClick={() => deleteAtencionMensual(a.id)}
                            >
                              Quitar
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'horarios' && (
        <>
          <section className="panel">
            <h2>Agregar franja horaria</h2>
            <p className="panel-hint panel-hint--oneline">
              Para médicos con agenda semanal. Los de atención mensual usan la pestaña Atención
              mensual.
            </p>
            {data.doctors.length === 0 ? (
              <p className="empty-hint">Primero cargá médicos.</p>
            ) : (
              <form onSubmit={submitHor}>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="h-doc">Médico</label>
                    <select
                      id="h-doc"
                      value={horForm.doctorId}
                      onChange={(e) =>
                        setHorForm((f) => ({ ...f, doctorId: e.target.value }))
                      }
                      required
                    >
                      <option value="">Elegir…</option>
                      {data.doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.apellido}, {d.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="h-dia">Día de la semana</label>
                    <select
                      id="h-dia"
                      value={horForm.diaSemana}
                      onChange={(e) =>
                        setHorForm((f) => ({
                          ...f,
                          diaSemana: Number(e.target.value),
                        }))
                      }
                    >
                      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                        <option key={n} value={n}>
                          {diaSemanaLabel(n)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="h-ini">Desde</label>
                    <input
                      id="h-ini"
                      type="time"
                      value={horForm.horaInicio}
                      onChange={(e) =>
                        setHorForm((f) => ({ ...f, horaInicio: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="h-fin">Hasta</label>
                    <input
                      id="h-fin"
                      type="time"
                      value={horForm.horaFin}
                      onChange={(e) =>
                        setHorForm((f) => ({ ...f, horaFin: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">
                    Agregar franja
                  </button>
                </div>
              </form>
            )}
          </section>

          <div className="table-wrap">
            {data.horarios.length === 0 ? (
              <p className="empty-hint">
                Sin horarios: los turnos no se validan contra franjas (solo días
                libres y solapamientos).
              </p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Médico</th>
                    <th>Día</th>
                    <th>Franja</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.horarios.map((h) => {
                    const d = doctorById(h.doctorId)
                    return (
                      <tr key={h.id}>
                        <td>{d ? `${d.apellido}, ${d.nombre}` : '—'}</td>
                        <td>{diaSemanaLabel(h.diaSemana)}</td>
                        <td>
                          {h.horaInicio} – {h.horaFin}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => deleteHorario(h.id)}
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'libres' && (
        <>
          <section className="panel">
            <h2>Días que no atiende</h2>
            <p className="panel-hint panel-hint--oneline">
              Marcá los días sin atención (ej. lunes y martes); el médico no aparecerá en la agenda esos días.
            </p>
            {data.doctors.length === 0 ? (
              <p className="empty-hint">Primero cargá médicos.</p>
            ) : (
              <form onSubmit={submitLib}>
                <div className="form-grid form-grid--dias-libres">
                  <div className="field field--dias-libres-medico">
                    <label htmlFor="l-doc">Médico</label>
                    <select
                      id="l-doc"
                      value={libForm.doctorId}
                      onChange={(e) =>
                        setLibForm((f) => ({
                          ...f,
                          doctorId: e.target.value,
                          diasSemana: [],
                        }))
                      }
                      required
                    >
                      <option value="">Elegir…</option>
                      {data.doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.apellido}, {d.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field field--dias-libres-dias">
                    <span className="field-label-block">Días sin atención</span>
                    <div className="dias-libres-picks" role="group" aria-label="Días de la semana">
                      {DIAS_SEMANA_FORM.map((n) => {
                        const ya =
                          libForm.doctorId &&
                          data.diasLibres.some(
                            (d) =>
                              d.doctorId === libForm.doctorId &&
                              d.diaSemana === n,
                          )
                        return (
                          <label
                            key={n}
                            className={`dias-libres-pick${ya ? ' dias-libres-pick--saved' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={libForm.diasSemana.includes(n)}
                              disabled={!libForm.doctorId || !!ya}
                              onChange={() => toggleLibDia(n)}
                            />
                            <span>{diaSemanaLabelLargo(n)}</span>
                          </label>
                        )
                      })}
                    </div>
                    {libForm.doctorId && (
                      <p className="dias-libres-picks__hint">
                        Los días ya guardados aparecen atenuados. Marcá otros y
                        pulsá Guardar.
                      </p>
                    )}
                  </div>
                </div>
                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      !libForm.doctorId || libForm.diasSemana.length === 0
                    }
                  >
                    Guardar días
                  </button>
                </div>
              </form>
            )}
          </section>

          <div className="table-wrap">
            {data.diasLibres.length === 0 ? (
              <p className="empty-hint">
                No hay días de la semana marcados como libres.
              </p>
            ) : (
              <table className="data data--dias-libres">
                <thead>
                  <tr>
                    <th>Médico</th>
                    <th>Días sin atención</th>
                  </tr>
                </thead>
                <tbody>
                  {diasLibresPorMedico.map((row) => (
                    <tr key={row.doctorId}>
                      <td className="dias-libres-lista__medico">{row.nombre}</td>
                      <td>
                        <span className="dias-libres-lista-linea">
                          {row.dias.map((d, i) => (
                            <span key={d.id} className="dias-libres-lista-item">
                              {i > 0 && (
                                <span className="dias-libres-lista-sep">, </span>
                              )}
                              <span>{diaSemanaLabelLargo(d.diaSemana)}</span>
                              <button
                                type="button"
                                className="dias-libres-lista-quitar"
                                onClick={() => deleteDiaLibre(d.id)}
                                aria-label={`Quitar ${diaSemanaLabelLargo(d.diaSemana)}`}
                                title="Quitar día"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {medicosEspModalOpen && (
        <AgendaMedicosEspecialidadesModal
          rows={medicosEspecialidadesRows}
          data={data}
          onClose={() => setMedicosEspModalOpen(false)}
        />
      )}

      {agendaPdfPreview && (
        <PdfPreviewModal
          title={agendaPdfPreview.title}
          url={agendaPdfPreview.url}
          filename={
            agendaPdfPreview.showFilename === false
              ? undefined
              : agendaPdfPreview.filename
          }
          onClose={closeAgendaPdfPreview}
          onDownload={() => void handleAgendaPdfDownload()}
        />
      )}

      {citaToDelete && (() => {
        const pac = patientById(citaToDelete.patientId)
        const doc = doctorById(citaToDelete.doctorId)
        const pagosVinculados = data.payments.filter(
          (p) => p.citaId === citaToDelete.id,
        )
        const montoTotal = pagosVinculados.reduce((s, p) => s + p.monto, 0)
        return (
          <EliminarPagoModal
            title={
              pagosVinculados.length > 0 && montoTotal > 0
                ? 'Eliminar pago'
                : 'Eliminar turno'
            }
            fechaIso={citaToDelete.fechaHora}
            montoTotal={montoTotal > 0 ? montoTotal : null}
            pacienteLabel={
              pac ? `${pac.apellido}, ${pac.nombre}` : '—'
            }
            medicoLabel={
              doc ? `${doc.apellido}, ${doc.nombre}` : '—'
            }
            onClose={() => setCitaToDelete(null)}
            onConfirm={(motivo, notasOtros) => {
              archiveCitaEliminada(citaToDelete.id, motivo, notasOtros)
              if (bookingEditingId === citaToDelete.id) closeBooking()
              setCitaToDelete(null)
            }}
          />
        )
      })()}
    </div>
  )
}
