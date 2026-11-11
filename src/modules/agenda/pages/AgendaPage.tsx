// Vista de Agenda y Turnos
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addWeeks,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfWeek,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  IconActionButton,
  IconCancelDay,
  IconEdit,
  IconPlus,
  IconRestoreDay,
  IconWhatsApp,
} from '../../../shared/components/icons'
import { AgendaMedicosEspecialidadesModal } from '../components/AgendaMedicosEspecialidadesModal'
import { MedicosDiaModal } from '../components/MedicosDiaModal'
import { ReprogramarTurnoWhatsAppModal } from './agenda/ReprogramarTurnoWhatsAppModal'
import { EliminarPagoModal } from '../../pagos/components/EliminarPagoModal'
import { MotivosConsultaModal } from '../../pacientes/components/MotivosConsultaModal'
import { ObrasSocialesModal } from '../../pacientes/components/ObrasSocialesModal'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { NuevoTurnoModal } from './agenda/NuevoTurnoModal'
import { calcularMontoSugerido, normalizeOsName } from '../../../lib/turnoMonto'
import {
  buscarAfiliacionYPlanPaciente,
  calcularConsumoAfiliadoMes,
  validarCupoPlanParaTurno,
} from '../../../lib/consumoAfiliados'
import { esContratanteSuspendido } from '../../../lib/contratantesMovimientos'
import { formatMonto } from '../../../lib/formatMonto'
import { formatAppError, logAppError } from '../../../lib/persistAlert'
import { APP_DISPLAY_NAME } from '../../../lib/pdfBranding'
import { preloadPdfHeaderBanner } from '../../../lib/pdfHeaderBanner'
import { preloadPdfLogo } from '../../../lib/pdfLogo'
import { useAuth } from '../../../context/AuthContext'
import {
  canSendClinicalEmailExport,
  canViewDoctorPorcentaje,
  EXPORT_DENIED_MESSAGE,
} from '../../../lib/exportPermissions'
import { useAppState } from '../../../context/AppStateContext'
import { useConfirm } from '../../../context/ConfirmContext'
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
} from '../../../lib/agendaEmail'
import { isTauri } from '@tauri-apps/api/core'
import {
  buildAgendaWeekPdf,
  collectAgendaDayRows,
  collectAgendaMonthRows,
  collectAgendaWeekRows,
  type AgendaPdfScope,
  type AgendaWeekPdfRow,
} from '../../../lib/agendaWeekPdf'
import {
  agendaTurnosPdfPreviewTitle,
  buildAgendaTurnosPdf,
  collectAgendaTurnosPdfDays,
} from '../../../lib/agendaTurnosPdf'
import {
  agendaWhatsAppPacientesPdfPreviewTitle,
  buildAgendaWhatsAppPacientesPdf,
  collectAgendaWhatsAppPacientesDays,
} from '../../../lib/agendaWhatsAppPacientesPdf'
import { pdfBlobUrl, pdfToBase64, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { buildAgendaMedicoLibresPdf } from '../../../lib/agendaMedicoPdf'
import type jsPDF from 'jspdf'
import {
  validateAppointmentSlot,
  eachAgendaWeekDay,
  isAgendaWorkingDay,
} from '../../../lib/agendaRules'
import { groupDiasLibresByDoctor } from '../../../lib/diasLibres'
import {
  getTurnoFromFecha,
  medicoGroupsCitasDelDia,
  splitCitasMananaTarde,
} from '../../../lib/dayTurnos'
import {
  buildMedicosEspecialidadesRows,
  URGENCIA_DURACION_DEFAULT,
  URGENCIA_DURACION_OPCIONES,
  doctorDuracionTurno,
  isDoctorAgendaMensual,
} from '../../../lib/doctorAgenda'
import {
  combineDateAndTimeLocal,
  generateSlotsForDay,
  turnosLibresMedicoDia,
  type TurnosLibresMedicoDia,
  normalizeHmInput,
  isDoctorAvailableOnDate,
  planDoctorDay,
} from '../../../lib/weekSlots'
import { isMedicoActivo, medicosActivos, pacientesActivos } from '../../../lib/activo'
import {
  afiliadoTieneCuotasImpagas,
  COBERTURA_PARTICULAR,
  coberturaGuardada,
  coberturaInicial,
  contextoCoberturaDe,
  opcionesCobertura,
} from '../../../lib/cobertura'
import {
  patientMatchesPickerQuery,
  patientPickerLineLegacy,
} from '../../../lib/dniLabels'
import type {
  Afiliado,
  Appointment,
  AppointmentEstado,
  CoberturaTipo,
  Doctor,
  Patient,
  PlanAfiliado,
} from '../../../types'
import { createId } from '../../../lib/id'
import {
  AGENDA_COMPACT_ESTADO_THRESHOLD,
  AGENDA_ESTADOS,
  dayCitaEstadoParts,
  formatDayCitaEstado,
  splitMedicoPillLabel,
} from '../../../lib/agendaDisplay'
import {
  MOTIVO_CONSULTA_2_NINGUNO,
  MOTIVO_CONSULTA_DEFAULT,
  joinMotivosConsulta,
  motivoConsulta2Texto,
  motivoConsultaFromNotas,
  notasFromMotivoConsulta,
} from '../../../lib/motivoConsulta'
import {
  formatMontoFieldInput,
  parseMontoInput,
  PAYMENT_METODOS,
} from '../../../lib/paymentInput'
import {
  AgendaFranjaTab,
  AgendaHorariosTab,
  AgendaLibresTab,
  AgendaMensualTab,
} from './agenda/AgendaConfigTabs'
import { AgendaPageHeader, type AgendaTab } from './agenda/AgendaPageHeader'
import {
  AgendaTurnosDayNavNext,
  AgendaTurnosDayNavPrev,
  AgendaTurnosWeekNav,
} from './agenda/AgendaTurnosWeekNav'
import { AgendaWeekCalendar } from './agenda/AgendaWeekCalendar'
import { AgendaMedicoModal } from './agenda/AgendaMedicoModal'
import { AgendaManualModal, type AgendaManualSubmitPayload } from './agenda/AgendaManualModal'
import { AtencionSinTurnoModal } from './agenda/AtencionSinTurnoModal'
import { QuickPacienteModal } from './agenda/QuickPacienteModal'
import {
  buildMedicoAgendaMessage,
  buildTurnoReminderMessageFromCita,
  buildTurnoReprogramacionMessage,
  buildWhatsAppSendUrl,
  fechaCalendarioTurnoAgenda,
  markWhatsAppRecordatorioEnviado,
  openWhatsAppSecuencial,
  openWhatsAppWebUrl,
} from '../../../lib/whatsapp'
import '../../../shared/styles/pages.css'
type Tab = AgendaTab

function resolveDoctorCoverageMonto(
  doc: Doctor | undefined | null,
  coberturaTipo: CoberturaTipo,
  obraSocialNombre?: string | null,
): number {
  if (!doc) return 0
  if (coberturaTipo === 'particular') {
    if (doc.particular != null && doc.particular > 0) {
      return doc.particular
    }
    if (doc.valor != null && doc.valor > 0) {
      return doc.valor
    }
    return 0
  }
  if (coberturaTipo === 'obraSocial') {
    const osClean = (obraSocialNombre ?? '').trim().toLowerCase()
    if (osClean && doc.obrasSociales) {
      const match = doc.obrasSociales.find(
        (o) => o.nombre.trim().toLowerCase() === osClean,
      )
      if (match && match.monto > 0) {
        return match.monto
      }
    }
    if (doc.valor != null && doc.valor > 0) {
      return doc.valor
    }
    return 0
  }
  return 0
}

export function AgendaPage() {
  const { role, session } = useAuth()
  const puedeVerPorcentaje = canViewDoctorPorcentaje(role)
  const puedeEnviarCorreo = canSendClinicalEmailExport(role)
  const {
    data,
    upsertPatient,
    upsertAppointment,
    archiveCitaCancelada,
    upsertHorario,
    deleteHorario,
    deleteHorariosForDoctor,
    upsertDiaLibre,
    deleteDiaLibre,
    upsertAtencionMensual,
    deleteAtencionMensual,
    upsertDoctor,
    upsertCuotaMensual,
    upsertPayment,
    deletePayment,
    saveAtencionSinTurnoListado,
    deleteAtencionSinTurnoListado,
    patientById,
    doctorById,
    localidadesOpciones,
    obrasSocialesOpciones,
    motivosConsultaOpciones,
    addMotivoConsultaCustom,
    removeMotivoConsultaCustom,
    renameMotivoConsultaCustom,
    addObraSocialCustom,
    removeObraSocialCustom,
    renameObraSocialCustom,
    obrasSocialesCatalog,
    saveObraSocialCatalog,
  } = useAppState()
  const { confirm } = useConfirm()
  const pacientesOperativos = useMemo(
    () => pacientesActivos(data.patients),
    [data.patients],
  )
  const medicosOperativos = useMemo(
    () =>
      [...medicosActivos(data.doctors)].sort((a, b) =>
        `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
          sensitivity: 'base',
        }),
      ),
    [data.doctors],
  )
  const [tab, setTab] = useState<Tab>('turnos')
  const [osModalOpen, setOsModalOpen] = useState(false)
  const [agendaMedicoOpen, setAgendaMedicoOpen] = useState(false)
  const [atencionSinTurnoOpen, setAtencionSinTurnoOpen] = useState(false)
  const [agendaMedicoDoctorId, setAgendaMedicoDoctorId] = useState('')
  const [closeAgendaMedicoAfterBooking, setCloseAgendaMedicoAfterBooking] =
    useState(false)
  const [medicosEspModalOpen, setMedicosEspModalOpen] = useState(false)
  const [medicosDiaModalOpen, setMedicosDiaModalOpen] = useState(false)
  const [reprogramarWa, setReprogramarWa] = useState<{
    doctorId: string
    doctorName: string
    citas: Appointment[]
  } | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [citaToCancel, setCitaToCancel] = useState<Appointment | null>(null)
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
    useState<AgendaPdfScope>('day')
  const [agendaExportDoctorId, setAgendaExportDoctorId] = useState('')
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingEditingId, setBookingEditingId] = useState<string | null>(null)
  const [bookingDate, setBookingDate] = useState<Date | null>(null)
  const [bookingDoctorId, setBookingDoctorId] = useState('')
  const [bookingPatientId, setBookingPatientId] = useState('')
  const [bookingPatientQuery, setBookingPatientQuery] = useState('')
  const [bookingPatientObraSocial, setBookingPatientObraSocial] = useState('')
  /**
   * Con qué se factura el turno: la obra social del paciente, su plan de
   * afiliado, o particular. Sigue siendo un único dato —`obraSocialOverride`—
   * igual que antes; lo que cambia es que ahora hay tres valores posibles
   * en vez de dos.
   */
  const [bookingCobertura, setBookingCobertura] = useState<string>('Particular')
  const [bookingPatientPickerOpen, setBookingPatientPickerOpen] = useState(false)
  const obrasSocialesDisponibles = useMemo(() => {
    const s = new Set<string>()
    for (const p of data.patients) {
      if (p.obraSocial && p.obraSocial.trim()) {
        s.add(p.obraSocial.trim())
      }
    }
    return Array.from(s).sort()
  }, [data.patients])
  const bookingSelectedPatient = useMemo(() => {
    if (bookingPatientId) {
      return patientById(bookingPatientId)
    }
    const q = bookingPatientQuery.trim()
    if (!q) return null
    const matches = pacientesOperativos.filter((p) =>
      patientMatchesPickerQuery(p, q),
    )
    return matches.length === 1 ? matches[0] : null
  }, [bookingPatientId, bookingPatientQuery, patientById, pacientesOperativos])
  /** Contexto de cobertura del paciente elegido: obra social, plan y si el plan está al día. */
  const bookingCtxCobertura = useMemo(
    () =>
      contextoCoberturaDe(
        bookingSelectedPatient,
        data.afiliados ?? [],
        data.planesAfiliados ?? [],
        data.cuotasAfiliados ?? [],
      ),
    [bookingSelectedPatient, data.afiliados, data.planesAfiliados, data.cuotasAfiliados],
  )
  /** Opciones del selector: obra social (si tiene), plan (si tiene, con su motivo si no puede) y particular. */
  const bookingOpcionesCobertura = useMemo(
    () => opcionesCobertura(bookingCtxCobertura),
    [bookingCtxCobertura],
  )
  /**
   * Cobertura elegida. Mapea tanto coberturas del catálogo (strings con el nombre)
   * como el tipo particular/plan para compatibilidad hacia atrás.
   */
  const bookingCoberturaActual = useMemo(() => {
    const sel = bookingOpcionesCobertura.find(
      (o) =>
        normalizeOsName(o.valor) === normalizeOsName(bookingCobertura) ||
        o.tipo === bookingCobertura,
    )
    if (sel && !sel.disabled) return sel
    return {
      tipo: (normalizeOsName(bookingCobertura) === 'particular'
        ? 'particular'
        : 'obraSocial') as CoberturaTipo,
      valor: bookingCobertura,
      label: bookingCobertura,
      disabled: false,
    }
  }, [bookingOpcionesCobertura, bookingCobertura])
  /** Por qué el plan está deshabilitado, para mostrarlo debajo del selector. */
  const bookingPlanMotivo = useMemo(() => {
    const op = bookingOpcionesCobertura.find((o) => o.tipo === 'plan')
    return op?.disabled ? (op.motivo ?? '') : ''
  }, [bookingOpcionesCobertura])
  const [quickPacienteOpen, setQuickPacienteOpen] = useState(false)
  const [quickPacienteInitialDni, setQuickPacienteInitialDni] = useState<string>('')
  const [bookingDuracion, setBookingDuracion] = useState(30)
  const [bookingEstado, setBookingEstado] = useState<AppointmentEstado | 'pagado'>('programado')
  const [bookingMotivoConsulta, setBookingMotivoConsulta] = useState<string>(
    MOTIVO_CONSULTA_DEFAULT,
  )
  const [bookingMotivoOtro, setBookingMotivoOtro] = useState('')
  const [bookingMotivoConsulta2, setBookingMotivoConsulta2] = useState<string>(
    MOTIVO_CONSULTA_2_NINGUNO,
  )
  const [bookingMotivoOtro2, setBookingMotivoOtro2] = useState('')
  const [motivosConsultaModalOpen, setMotivosConsultaModalOpen] = useState(false)
  const motivosConsultaOnAddedRef = useRef<((nombre: string) => void) | null>(
    null,
  )
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
  const [citaActionsOpenId, setCitaActionsOpenId] = useState<string | null>(null)
  const citaNameClickTimerRef = useRef<number | null>(null)
  const bookingTotalMonto = useMemo(() => {
    return parseMontoInput(bookingMonto) + parseMontoInput(bookingMonto2)
  }, [bookingMonto, bookingMonto2])
  const bookingMetodosIguales = useMemo(
    () => bookingMetodo === bookingMetodo2,
    [bookingMetodo, bookingMetodo2],
  )
  const resolveBookingPatientId = useCallback((): string | null => {
    if (bookingPatientId) return bookingPatientId
    const q = bookingPatientQuery.trim()
    if (!q) return null
    const matches = pacientesOperativos.filter((p) =>
      patientMatchesPickerQuery(p, q),
    )
    if (matches.length === 1) return matches[0]!.id
    return null
  }, [bookingPatientId, bookingPatientQuery, pacientesOperativos])
  const [agendaManualModalOpen, setAgendaManualModalOpen] = useState(false)
  const [citaEditing, setCitaEditing] = useState<string | null>(null)
  const [citaForm, setCitaForm] = useState({
    patientId: '',
    doctorId: '',
    fechaHoraLocal: '',
    duracionMinutos: 30,
    estado: 'programado' as AppointmentEstado,
    motivoConsulta: MOTIVO_CONSULTA_DEFAULT as string,
    motivoOtro: '',
    motivoConsulta2: MOTIVO_CONSULTA_2_NINGUNO as string,
    motivoOtro2: '',
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
      AGENDA_ESTADOS.find((e) => e.value === estado)?.label ?? estado,
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
      const citaMotivos = joinMotivosConsulta(c.notas ?? '', c.motivoConsulta2)
      if (citaMotivos) parts.push(citaMotivos)
      for (const p of paymentsForAppointment(c)) {
        const n = p.notas?.trim()
        if (n && !parts.includes(n)) parts.push(n)
      }
      return parts.length > 0 ? parts.join(' · ') : ''
    },
    [paymentsForAppointment],
  )
  const agendaExportDoctors = useMemo(
    () => medicosOperativos,
    [medicosOperativos],
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
    if (!puedeEnviarCorreo) {
      void confirm({ message: EXPORT_DENIED_MESSAGE })
      return
    }
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
        obraSocialLabel: pdfObraSocialLabel,
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
        fixedMedicoColumnSlots:
          role === 'secretaria' && !agendaExportDoctorId ? 5 : undefined,
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
  async function handleAgendaWhatsAppPacientesPdfPreview() {
    const resolved = resolveAgendaExport()
    if (!resolved.ok) {
      void confirm({ message: resolved.message })
      return
    }
    const { periodLabel, fileStamp, scope } = resolved.data
    try {
      await Promise.all([preloadPdfLogo(), preloadPdfHeaderBanner()])
      const days = collectAgendaWhatsAppPacientesDays({
        scope,
        data,
        weekCursor,
        selectedDay: selectedWeekDay,
        weekDays,
        doctorFilterId: agendaExportDoctorId || undefined,
        patientLabel: pdfPatientLabel,
        doctorLabel,
      })
      const built = buildAgendaWhatsAppPacientesPdf({
        scope,
        periodLabel,
        days,
        fileStamp,
        singleDoctorLabel: agendaPdfSingleDoctorLabel,
      })
      showAgendaPdfPreview(
        built,
        agendaWhatsAppPacientesPdfPreviewTitle(scope, periodLabel),
        { showFilename: false },
      )
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo generar el PDF de WhatsApp pacientes. Probá de nuevo.',
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
  const citasPorMedicoDia = useMemo(() => {
    if (!selectedWeekDay) return []
    return medicoGroupsCitasDelDia({
      citas: citasDelDia,
      selectedDay: selectedWeekDay,
      data,
      doctorLabel,
    })
  }, [selectedWeekDay, citasDelDia, data, doctorLabel])
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
    for (const d of medicosOperativos) {
      const info = turnosLibresMedicoDia(d.id, selectedWeekDay, data)
      if (info) map.set(d.id, info)
    }
    return map
  }, [selectedWeekDay, data, medicosOperativos])
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
    if (!bookingFueraGrilla) return null
    const hm = normalizeHmInput(bookingManualHm)
    if (!hm) {
      if (bookingManualHm.trim()) {
        return {
          ok: false as const,
          message: 'Hora inválida. Usá formato HH:MM (ej. 09:15).',
        }
      }
      return null
    }
    // En urgencia (fuera de grilla) permitimos horario aunque esté fuera de rango
    // o se solape; la advertencia de solape se maneja al confirmar.
    return { ok: true as const }
  }, [bookingFueraGrilla, bookingManualHm])
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
    if (!bookingDate) return null
    if (!bookingDoctorId) {
      return null
    }
    const doc = doctorById(bookingDoctorId)
    const plan = planDoctorDay(bookingDoctorId, bookingDate, data)
    if (plan.kind !== 'slots' || plan.ranges.length === 0) {
      if (isDoctorAgendaMensual(doc)) {
        return 'Sin atención configurada este día. Revisá la pestaña Atención mensual.'
      }
      return 'Sin franja horaria este día.'
    }
    return null
  }, [bookingDoctorId, bookingDate, data, doctorById])
  const bookingDoctors = useMemo(() => {
    const list = !bookingDate
      ? medicosOperativos
      : data.doctors.filter((d) => {
          if (!isMedicoActivo(d) && d.id !== bookingDoctorId) return false
          if (bookingEditingId && d.id === bookingDoctorId) return true
          return isDoctorAvailableOnDate(d.id, bookingDate, data)
        })
    return [...list].sort((a, b) =>
      `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
        sensitivity: 'base',
      }),
    )
  }, [bookingDate, data, bookingEditingId, bookingDoctorId, medicosOperativos])
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
  function goToToday() {
    let target = startOfDay(new Date())
    if (target.getDay() === 0) target = addDays(target, 1)
    setWeekCursor(startOfWeek(target, { weekStartsOn: 1 }))
    setSelectedWeekDay(target)
  }
  function goAdjacentDay(delta: -1 | 1) {
    if (selectedDayIndex < 0) return
    if (delta === 1) {
      const nextInWeek = weekDays[selectedDayIndex + 1]
      if (nextInWeek) {
        setSelectedWeekDay(nextInWeek)
        return
      }
      const nextWeek = addWeeks(weekCursor, 1)
      setWeekCursor(nextWeek)
      const first = eachAgendaWeekDay(nextWeek)[0]
      if (first) setSelectedWeekDay(first)
      return
    }
    const prevInWeek = weekDays[selectedDayIndex - 1]
    if (prevInWeek) {
      setSelectedWeekDay(prevInWeek)
      return
    }
    const prevWeek = addWeeks(weekCursor, -1)
    setWeekCursor(prevWeek)
    const days = eachAgendaWeekDay(prevWeek)
    const last = days[days.length - 1]
    if (last) setSelectedWeekDay(last)
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
  function resetBookingMotivo() {
    setBookingMotivoConsulta(MOTIVO_CONSULTA_DEFAULT)
    setBookingMotivoOtro('')
    setBookingMotivoConsulta2(MOTIVO_CONSULTA_2_NINGUNO)
    setBookingMotivoOtro2('')
  }
  function buildBookingMotivo2(): string {
    return motivoConsulta2Texto(
      bookingMotivoConsulta2,
      bookingMotivoOtro2,
      data.motivosConsultaCustom,
    )
  }
  function buildBookingNotas(): string {
    let n = notasFromMotivoConsulta(
      bookingMotivoConsulta,
      bookingMotivoOtro,
      data.motivosConsultaCustom,
    )
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
    if (secretariaNoPuedeModificarDia(day)) {
      setMsg({ type: 'err', text: 'Secretaría no tiene permiso para agendar turnos en esta fecha.' })
      return
    }
    setMsg(null)
    setBookingFormError(null)
    setBookingEditingId(null)
    setCitaEditing(null)
    setSelectedWeekDay(day)
    setBookingDate(day)
    setBookingPatientId('')
    setBookingPatientQuery('')
    setBookingPatientObraSocial('')
    setBookingCobertura('Particular')
    setBookingPatientPickerOpen(false)
    setBookingSlotHm(null)
    setBookingFueraGrilla(false)
    setBookingManualHm('')
    resetBookingMotivo()
    resetBookingPayment()
    setBookingEstado('programado')
    setBookingDuracion(30)
    const disponibles = medicosOperativos.filter((d) =>
      isDoctorAvailableOnDate(d.id, day, data),
    )
    if (disponibles.length === 1) {
      setBookingDoctorId(disponibles[0]!.id)
      const res = calcularMontoSugerido({
        doctor: disponibles[0],
        cobertura: 'Particular',
        obrasSocialesCatalog,
      })
      if (res.montoCalculado !== null && res.montoCalculado > 0) {
        setBookingMonto(res.montoCalculadoFormateado)
      } else {
        setBookingMonto('')
      }
    } else {
      setBookingDoctorId('')
    }
    setBookingOpen(true)
  }
  function openBookingAtSlot(doctorId: string, hm: string) {
    if (!selectedWeekDay || !puedeAgenda) return
    if (secretariaNoPuedeModificarDia(selectedWeekDay)) {
      setMsg({ type: 'err', text: 'Secretaría no tiene permiso para agendar turnos en esta fecha.' })
      return
    }
    setMsg(null)
    setBookingFormError(null)
    setBookingEditingId(null)
    setCitaEditing(null)
    setBookingDate(selectedWeekDay)
    setBookingDoctorId(doctorId)
    setBookingPatientId('')
    setBookingPatientQuery('')
    setBookingPatientObraSocial('')
    setBookingCobertura('Particular')
    setBookingPatientPickerOpen(false)
    setBookingSlotHm(hm)
    setBookingFueraGrilla(false)
    setBookingManualHm('')
    resetBookingMotivo()
    resetBookingPayment()
    setBookingEstado('programado')
    const doc = doctorById(doctorId)
    setBookingDuracion(doc ? doctorDuracionTurno(doc) : 30)
    const res = calcularMontoSugerido({
      doctor: doc,
      cobertura: 'Particular',
      obrasSocialesCatalog,
    })
    if (res.montoCalculado !== null && res.montoCalculado > 0) {
      setBookingMonto(res.montoCalculadoFormateado)
    } else {
      setBookingMonto('')
    }
    setBookingOpen(true)
  }
  function openBookingAtSlotOnDay(doctorId: string, day: Date, hm: string) {
    if (!puedeAgenda) return
    if (secretariaNoPuedeModificarDia(day)) {
      setMsg({ type: 'err', text: 'Secretaría no tiene permiso para agendar turnos en esta fecha.' })
      return
    }
    setSelectedWeekDay(day)
    setWeekCursor(startOfWeek(day, { weekStartsOn: 1 }))
    setMsg(null)
    setBookingFormError(null)
    setBookingEditingId(null)
    setCitaEditing(null)
    setBookingDate(day)
    setBookingDoctorId(doctorId)
    setBookingPatientId('')
    setBookingPatientQuery('')
    setBookingPatientObraSocial('')
    setBookingCobertura('Particular')
    setBookingPatientPickerOpen(false)
    setBookingSlotHm(hm)
    setBookingFueraGrilla(false)
    setBookingManualHm('')
    resetBookingMotivo()
    resetBookingPayment()
    setBookingEstado('programado')
    const doc = doctorById(doctorId)
    setBookingDuracion(doc ? doctorDuracionTurno(doc) : 30)
    const res = calcularMontoSugerido({
      doctor: doc,
      cobertura: 'Particular',
      obrasSocialesCatalog,
    })
    if (res.montoCalculado !== null && res.montoCalculado > 0) {
      setBookingMonto(res.montoCalculadoFormateado)
    } else {
      setBookingMonto('')
    }
    setBookingOpen(true)
  }
  function applyPatientSelection(p: Patient) {
    setBookingPatientId(p.id)
    setBookingPatientQuery(
      patientPickerLineLegacy(p.dni, p.apellido, p.nombre) || `${p.apellido}, ${p.nombre}`,
    )
    setBookingPatientPickerOpen(false)

    // Cobertura automática con la OS que tiene el paciente cargada en Pacientes (o Particular si no tiene)
    const pacOs = (p.obraSocial || '').trim()
    const canonicalMatch = pacOs
      ? obrasSocialesCatalog.find((o) => normalizeOsName(o.nombre) === normalizeOsName(pacOs))?.nombre
      : null
    const targetCob = canonicalMatch || pacOs || 'Particular'
    setBookingCobertura(targetCob)

    if (!bookingEditingId && bookingDoctorId) {
      const doc = doctorById(bookingDoctorId)
      const res = calcularMontoSugerido({
        doctor: doc,
        cobertura: targetCob,
        obrasSocialesCatalog,
        montoActualInput: '',
        usuarioEditoManualmente: false,
      })
      if (res.montoCalculado !== null && res.montoCalculado > 0) {
        setBookingMonto(res.montoCalculadoFormateado)
      } else {
        setBookingMonto('')
      }
    }
  }
  function openBookingForEdit(c: Appointment) {
    if (secretariaNoPuedeModificarCita(c)) {
      if (secretariaNoPuedeModificarDia(parseISO(c.fechaHora))) {
        setMsg({ type: 'err', text: 'Secretaría no tiene permiso para modificar turnos en esta fecha.' })
      } else {
        setMsg({ type: 'err', text: 'No tiene permiso para modificar turnos de otro usuario o turno.' })
      }
      return
    }
    if (turnoFueraDeLaSemana(c)) {
      setMsg({ type: 'err', text: 'Solo se pueden editar turnos de la semana seleccionada.' })
      return
    }
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
    setBookingPatientQuery(
      p ? patientPickerLineLegacy(p.dni, p.apellido, p.nombre) : '',
    )
    setBookingPatientObraSocial(p?.obraSocial ?? '')
    const cobGuardada = (c.obraSocialOverride || p?.obraSocial || 'Particular').trim()
    setBookingCobertura(cobGuardada || 'Particular')
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
    const notasSinUrgencia = c.notas
      .replace(/^Urgencia\s*[—–-]\s*/i, '')
      .replace(/^Urgencia$/i, '')
      .trim()
    const parsedMotivo = motivoConsultaFromNotas(
      notasSinUrgencia,
      data.motivosConsultaCustom,
    )
    setBookingMotivoConsulta(parsedMotivo.motivo)
    setBookingMotivoOtro(parsedMotivo.otroDetalle)
    const parsedMotivo2 = motivoConsultaFromNotas(
      (c.motivoConsulta2 ?? '').trim(),
      data.motivosConsultaCustom,
    )
    setBookingMotivoConsulta2(
      c.motivoConsulta2?.trim() ? parsedMotivo2.motivo : MOTIVO_CONSULTA_2_NINGUNO,
    )
    setBookingMotivoOtro2(parsedMotivo2.otroDetalle)
    loadBookingPayment(c.id)
    setBookingOpen(true)
  }
  function openMotivosConsultaModal(onAdded: (nombre: string) => void) {
    motivosConsultaOnAddedRef.current = onAdded
    setMotivosConsultaModalOpen(true)
  }
  function closeMotivosConsultaModal() {
    setMotivosConsultaModalOpen(false)
    motivosConsultaOnAddedRef.current = null
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
    setBookingCobertura('Particular')
    setBookingFormError(null)
    resetBookingMotivo()
    resetBookingPayment()
    setBookingPatientPickerOpen(false)
  }
  function resetBookingForm() {
    if (bookingEditingId) {
      const original = data.appointments.find((c) => c.id === bookingEditingId)
      if (original) {
        openBookingForEdit(original)
        return
      }
    }
    setBookingPatientId('')
    setBookingPatientQuery('')
    setBookingPatientObraSocial('')
    setBookingCobertura('Particular')
    setBookingPatientPickerOpen(false)
    setBookingSlotHm(null)
    setBookingFueraGrilla(false)
    setBookingManualHm('')
    resetBookingMotivo()
    resetBookingPayment()
    setBookingEstado('programado')
    if (bookingDoctorId) {
      const doc = doctorById(bookingDoctorId)
      const res = calcularMontoSugerido({
        doctor: doc,
        cobertura: 'Particular',
        obrasSocialesCatalog,
      })
      if (res.montoCalculado !== null && res.montoCalculado > 0) {
        setBookingMonto(res.montoCalculadoFormateado)
      } else {
        setBookingMonto('')
      }
    }
  }
  function resetCita() {
    setCitaEditing(null)
    setCitaForm({
      patientId: '',
      doctorId: '',
      fechaHoraLocal: '',
      duracionMinutos: 30,
      estado: 'programado',
      motivoConsulta: MOTIVO_CONSULTA_DEFAULT as string,
      motivoOtro: '',
      motivoConsulta2: MOTIVO_CONSULTA_2_NINGUNO as string,
      motivoOtro2: '',
    })
  }
  function submitCita(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (citaEditing) {
      const original = data.appointments.find((c) => c.id === citaEditing)
      if (original && noPuedeEditarCita(original)) {
        setMsg({ type: 'err', text: 'Solo se pueden editar turnos de la semana seleccionada.' })
        return
      }
    }
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
      notas: notasFromMotivoConsulta(
        citaForm.motivoConsulta,
        citaForm.motivoOtro,
        data.motivosConsultaCustom,
      ),
      motivoConsulta2: motivoConsulta2Texto(
        citaForm.motivoConsulta2,
        citaForm.motivoOtro2,
        data.motivosConsultaCustom,
      ),
    })
    setMsg({ type: 'ok', text: 'Turno guardado.' })
    resetCita()
  }
  function handleSaveAgendaManual(payload: AgendaManualSubmitPayload) {
    if (secretariaNoPuedeModificarDia(new Date(payload.fechaHoraLocal))) {
      return {
        ok: false,
        message: 'Secretaría no tiene permiso para agendar turnos en esta fecha.',
      }
    }
    const citaDay = new Date(payload.fechaHoraLocal)
    if (!isAgendaWorkingDay(citaDay)) {
      return { ok: false, message: 'No se atiende los domingos.' }
    }
    const fechaHora = new Date(payload.fechaHoraLocal).toISOString()
    const check = validateAppointmentSlot({
      fechaHora,
      doctorId: payload.doctorId,
      data,
      duracionMinutos: payload.duracionMinutos,
    })
    if (!check.ok) {
      return { ok: false, message: check.message }
    }
    upsertAppointment({
      patientId: payload.patientId,
      doctorId: payload.doctorId,
      fechaHora,
      duracionMinutos: payload.duracionMinutos,
      estado: payload.estado,
      notas: notasFromMotivoConsulta(
        payload.motivoConsulta,
        payload.motivoOtro,
        data.motivosConsultaCustom,
      ),
      motivoConsulta2: motivoConsulta2Texto(
        payload.motivoConsulta2,
        payload.motivoOtro2,
        data.motivosConsultaCustom,
      ),
    })
    setMsg({ type: 'ok', text: 'Turno guardado.' })
    return { ok: true }
  }
  /**
 * Suma una atención a la cuota del mes del turno cubierto por el plan.
 *
 * Si la cuota del mes todavía no existe se crea al vuelo (pendiente, al precio
 * del plan), así un turno agendado nunca queda sin dónde anotarse. El cupo por
 * mes se va a agregar después: hoy sólo se cuenta.
 */
function registrarAtencionEnCuota(
    afiliado: Afiliado,
    plan: PlanAfiliado | null,
    fechaHoraIso: string,
  ) {
    const fecha = parseISO(fechaHoraIso)
    const mes = fecha.getMonth() + 1
    const anio = fecha.getFullYear()
    const existente = (data.cuotasAfiliados ?? []).find(
      (c) => c.afiliadoId === afiliado.id && c.anio === anio && c.mes === mes,
    )
    if (existente) {
      upsertCuotaMensual({ ...existente, usos: (existente.usos ?? 0) + 1 })
      return
    }
    upsertCuotaMensual({
      afiliadoId: afiliado.id,
      mes,
      anio,
      monto: plan?.precio ?? 0,
      estado: 'pendiente',
      fechaPago: null,
      formaPago: null,
      comprobante: false,
      notas: '',
      usos: 1,
    })
  }
  async function submitBooking(e: React.FormEvent) {
    e.preventDefault()
    setBookingFormError(null)
    if (bookingEditingId) {
      const original = data.appointments.find((c) => c.id === bookingEditingId)
      if (original && noPuedeEditarCita(original)) {
        if (secretariaNoPuedeModificarCita(original)) {
          if (secretariaNoPuedeModificarDia(parseISO(original.fechaHora))) {
            setBookingFormError('Secretaría no tiene permiso para modificar turnos en esta fecha.')
          } else {
            setBookingFormError('No tiene permiso para modificar turnos de otro usuario o turno.')
          }
        } else {
          setBookingFormError('Solo se pueden editar turnos de la semana seleccionada.')
        }
        return
      }
    }
    if (bookingDate && secretariaNoPuedeModificarDia(bookingDate)) {
      setBookingFormError('Secretaría no tiene permiso para agendar turnos en esta fecha.')
      return
    }
    const patientId = resolveBookingPatientId()
    const hm = bookingResolvedHm()
    if (!bookingDate || !bookingDoctorId || !patientId || !hm) {
      if (!patientId) {
        const raw = bookingPatientQuery.trim()
        setQuickPacienteInitialDni(raw && /^\d{6,}$/.test(raw) ? raw : '')
        if (raw) {
          setQuickPacienteOpen(true)
          return
        }
      }
      setBookingFormError(
        !patientId
          ? 'Ingresá un paciente (DNI o apellido) o crealo con “Nuevo paciente”.'
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
    if (!bookingFueraGrilla) {
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
    } else {
      // Urgencia / fuera de grilla:
      // - No validamos contra horarios del médico (puede ser fuera de rango).
      // - Permitimos solape, pero avisamos antes de guardar.
      const start = parseISO(fechaHora)
      const end = new Date(start.getTime() + bookingDuracion * 60_000)
      const overlap = data.appointments.some((c) => {
        if (c.id === (bookingEditingId ?? undefined)) return false
        if (c.doctorId !== bookingDoctorId) return false
        if (c.estado === 'cancelado') return false
        const cs = parseISO(c.fechaHora)
        const ce = new Date(cs.getTime() + c.duracionMinutos * 60_000)
        return start < ce && end > cs
      })
      if (overlap) {
        const ok = await confirm({
          title: 'Turno superpuesto (Urgencia)',
          message:
            'Ya existe otro turno que se superpone con este médico.\n\n¿Querés guardar igual este turno de urgencia?',
          confirmLabel: 'Guardar igual',
          cancelLabel: 'Volver',
        })
        if (!ok) return
      }
    }
    const appointmentId = bookingEditingId ?? createId()
    const { valor: coberturaValor, tipo: coberturaTipo } = bookingCoberturaActual
    // Se guarda siempre el override: al elegir el plan queda el nombre del plan
    // y los informes lo toman como una cobertura más, sin código nuevo.
    const obraSocialOverride = coberturaValor

    // Validar si el turno se intenta cubrir con el plan y el paciente superó el tope del mes
    const infoPlan = buscarAfiliacionYPlanPaciente(
      patientId,
      data.afiliados ?? [],
      data.planesAfiliados ?? [],
    )
    if (
      infoPlan &&
      (coberturaTipo === 'plan' ||
        normalizeOsName(obraSocialOverride) === normalizeOsName(infoPlan.plan.nombre))
    ) {
      const fechaTurno = parseISO(fechaHora)
      const hoyRef = new Date()
      const fechaEvalDeuda = fechaTurno > hoyRef ? fechaTurno : hoyRef
      if (esContratanteSuspendido(infoPlan.afiliado)) {
        setBookingFormError(
          'Contratante suspendido. No se puede usar la cobertura mientras esté suspendido (cambiá la cobertura a Particular u otra obra social).',
        )
        return
      }
      if (
        afiliadoTieneCuotasImpagas(
          infoPlan.afiliado,
          data.cuotasAfiliados ?? [],
          fechaEvalDeuda,
        )
      ) {
        setBookingFormError(
          'El paciente no está al día con la cuota de su cobertura (registra deuda). Regularizá el pago en Afiliados o cambiá la cobertura a Particular u otra obra social.',
        )
        return
      }
      const consumo = calcularConsumoAfiliadoMes({
        patientId,
        anio: fechaTurno.getFullYear(),
        mes: fechaTurno.getMonth() + 1,
        plan: infoPlan.plan,
        appointments: data.appointments ?? [],
        excludeAppointmentId: bookingEditingId ?? undefined,
        ordenesMedicas: data.ordenesMedicas ?? [],
      })
      const check = validarCupoPlanParaTurno(
        consumo,
        buildBookingNotas(),
        buildBookingMotivo2(),
      )
      if (!check.permitido) {
        setBookingFormError(
          check.motivoBloqueo ||
            'El paciente ya alcanzó el tope mensual de su plan. Cambiá la cobertura a Particular u otra obra social.',
        )
        return
      }
    }

    upsertAppointment({
      id: appointmentId,
      patientId,
      doctorId: bookingDoctorId,
      fechaHora,
      duracionMinutos: bookingDuracion,
      estado: (bookingEstado === 'pagado' ? 'programado' : bookingEstado) as AppointmentEstado,
      notas: buildBookingNotas(),
      motivoConsulta2: buildBookingMotivo2(),
      obraSocialOverride,
    })
    // Un turno cubierto por el plan suma una atención a la cuota de ese mes.
    // Sólo al crear el turno: al editarlo no se vuelve a contar.
    // El cupo (2 o 3) todavía no se aplica: por ahora sólo se cuenta.
    if (
      !bookingEditingId &&
      coberturaTipo === 'plan' &&
      bookingCtxCobertura.afiliado
    ) {
      registrarAtencionEnCuota(bookingCtxCobertura.afiliado, bookingCtxCobertura.plan, fechaHora)
    }
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
        obraSocialOverride,
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
        obraSocialOverride,
      })
    } else if (bookingPaymentId2) {
      deletePayment(bookingPaymentId2)
    }
    const doc = doctorById(bookingDoctorId)
    const docNombre = doc ? `${doc.apellido}, ${doc.nombre}` : 'Médico'
    const totalMontoStr = formatMonto(bookingTotalMonto)
    const okText = `${bookingEditingId ? 'Turno modificado' : 'Turno confirmado'}: ${docNombre} · ${hm} hs · ${obraSocialOverride} · Total $ ${totalMontoStr}`
    closeBooking()
    setMsg({ type: 'ok', text: okText })
    if (closeAgendaMedicoAfterBooking) {
      setAgendaMedicoOpen(false)
      setCloseAgendaMedicoAfterBooking(false)
      setTab('turnos')
    }
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
  async function clearDoctorHorarios(doctorId: string) {
    const doc = doctorById(doctorId)
    if (!doc) return
    const ok = await confirm({
      title: 'Quitar franjas',
      message: `¿Quitar todas las franjas de ${doc.apellido}, ${doc.nombre}? Al agendar turnos usará el horario general del sanatorio.`,
      confirmLabel: 'Quitar todas',
    })
    if (!ok) return
    deleteHorariosForDoctor(doctorId)
    setMsg({ type: 'ok', text: 'Franjas quitadas.' })
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
    pacientesOperativos.length > 0 && medicosOperativos.length > 0
  function countTurnosDia(day: Date) {
    return data.appointments.filter((c) => {
      if (c.estado === 'cancelado') return false
      return isSameDay(parseISO(c.fechaHora), day)
    }).length
  }
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
    if (secretariaNoPuedeModificarDia(selectedWeekDay)) {
      setMsg({ type: 'err', text: 'Secretaría no tiene permiso para modificar turnos en esta fecha.' })
      return
    }
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
    if (secretariaNoPuedeModificarDia(selectedWeekDay)) {
      setMsg({ type: 'err', text: 'Secretaría no tiene permiso para modificar turnos en esta fecha.' })
      return
    }
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
    const { manana: citasWaManana, tarde: citasWaTarde } =
      splitCitasMananaTarde(delMedico)
    const mensaje = buildMedicoAgendaMessage({
      medicoLabel,
      fechaLabel,
      manana: turnosLineasAgenda(citasWaManana),
      tarde: turnosLineasAgenda(citasWaTarde),
    })
    if (!buildWhatsAppSendUrl(tel, mensaje)) {
      void confirm({
        message:
          'El teléfono del médico no es válido. Usá formato con código de área (ej. 11 4000-0000).',
      })
      return
    }
    try {
      await openWhatsAppWebUrl(tel, mensaje)
    } catch (err) {
      console.error(err)
      void confirm({
        message:
          'No se pudo abrir WhatsApp. Comprobá que tengas la aplicación de WhatsApp instalada.',
      })
    }
  }
function prepareTurnoWhatsApp(
  c: Appointment,
): 
  | { ok: true; tel: string; mensaje: string; nombre: string }
  | { ok: false; tel: string; mensaje: string; nombre: string; message: string } {
    const patient = patientById(c.patientId)
    const nombre = patient ? `${patient.apellido}, ${patient.nombre}` : '—'
    const tel = patient?.telefono?.trim() ?? ''
    const doctor = doctorById(c.doctorId)
    const mensaje = buildTurnoReminderMessageFromCita({
      fechaHoraIso: c.fechaHora,
      especialidad: doctor?.especialidad,
      medicoApellido: doctor?.apellido,
      medicoNombre: doctor?.nombre,
    })
    if (!tel) {
      return {
        ok: false,
        tel,
        mensaje,
        nombre,
        message:
          'El paciente no tiene teléfono cargado. Agregalo en Pacientes para enviar WhatsApp.',
      }
    }
    if (!buildWhatsAppSendUrl(tel, mensaje)) {
      return {
        ok: false,
        tel,
        mensaje,
        nombre,
        message:
          'El teléfono del paciente no es válido. Usá formato con código de área (ej. 11 4000-0000).',
      }
    }
    return { ok: true, tel, mensaje, nombre }
  }
  function prepareTurnoReprogramacionWhatsApp(
    c: Appointment,
    reprogramacion: { fechaNueva: Date; horaNueva: string },
  ):
    | { ok: true; tel: string; mensaje: string; nombre: string }
    | { ok: false; message: string; nombre: string } {
    const patient = patientById(c.patientId)
    const nombre = patient ? `${patient.apellido}, ${patient.nombre}` : '—'
    const tel = patient?.telefono?.trim() ?? ''
    if (!tel) {
      return {
        ok: false,
        nombre,
        message:
          'El paciente no tiene teléfono cargado. Agregalo en Pacientes para enviar WhatsApp.',
      }
    }
    const doctor = doctorById(c.doctorId)
    const origen = fechaCalendarioTurnoAgenda(c.fechaHora)
    const mensaje = buildTurnoReprogramacionMessage({
      fechaTurnoOriginal: origen,
      fechaTurnoNueva: reprogramacion.fechaNueva,
      horaNueva: reprogramacion.horaNueva,
      medicoApellido: doctor?.apellido ?? '—',
      medicoNombre: doctor?.nombre ?? '',
    })
    if (!buildWhatsAppSendUrl(tel, mensaje)) {
      return {
        ok: false,
        nombre,
        message:
          'El teléfono del paciente no es válido. Usá formato con código de área (ej. 11 4000-0000).',
      }
    }
    return { ok: true, tel, mensaje, nombre }
  }
  function openReprogramarWhatsAppModal(
    doctorId: string,
    doctorName: string,
    citas: Appointment[],
  ) {
    const canceladas = citas.filter((c) => c.estado === 'cancelado')
    if (canceladas.length === 0) {
      void confirm({
        message:
          'No hay turnos cancelados en este listado para avisar reprogramación.',
      })
      return
    }
    setReprogramarWa({ doctorId, doctorName, citas: canceladas })
  }
  async function confirmReprogramarWhatsApp(
    fechaNuevaIso: string,
    horaNueva: string,
  ) {
    if (!reprogramarWa) return
    const { doctorId, doctorName, citas } = reprogramarWa
    setReprogramarWa(null)
    const [y, m, d] = fechaNuevaIso.split('-').map(Number)
    const fechaNueva = new Date(y!, m! - 1, d!, 12, 0, 0)
    const reprogramacion = { fechaNueva, horaNueva }
    const listos: {
      cita: Appointment
      tel: string
      mensaje: string
      nombre: string
    }[] = []
    const sinTelefono: string[] = []
    const telInvalido: string[] = []
    for (const c of citas) {
      const prep = prepareTurnoReprogramacionWhatsApp(c, reprogramacion)
      if (prep.ok) {
        listos.push({
          cita: c,
          tel: prep.tel,
          mensaje: prep.mensaje,
          nombre: prep.nombre,
        })
      } else if (prep.message.includes('no tiene teléfono')) {
        sinTelefono.push(prep.nombre)
      } else {
        telInvalido.push(prep.nombre)
      }
    }
    if (listos.length === 0) {
      void confirm({
        message:
          'Ningún paciente de la lista tiene teléfono válido para WhatsApp.\n\nRevisá los teléfonos en Pacientes.',
      })
      return
    }
    const doctor = doctorById(doctorId)
    const medicoLabel = doctor ? `${doctor.apellido}, ${doctor.nombre}` : 'médico'
    let confirmMsg = `Se abrirá WhatsApp de a un paciente (${listos.length} en total) con el aviso de reprogramación de ${medicoLabel}.\n\nDespués de cada mensaje, la app preguntará si querés continuar con el siguiente.`
    if (sinTelefono.length > 0) {
      confirmMsg += `\n\nSin teléfono (${sinTelefono.length}): ${sinTelefono.slice(0, 4).join('; ')}${sinTelefono.length > 4 ? '…' : ''}`
    }
    if (telInvalido.length > 0) {
      confirmMsg += `\n\nTeléfono inválido (${telInvalido.length}): ${telInvalido.slice(0, 4).join('; ')}${telInvalido.length > 4 ? '…' : ''}`
    }
    const ok = await confirm({
      title: 'WhatsApp reprogramación',
      message: confirmMsg,
      confirmLabel: 'Abrir WhatsApp',
    })
    if (!ok) return
    const sent = await openWhatsAppSecuencial({
      items: listos,
      confirm,
      onItemError: (item, err) => {
        console.error(err)
        void confirm({
          message: `No se pudo abrir WhatsApp para ${item.nombre}.`,
        })
      },
    })
    if (sent > 0) {
      setMsg({
        type: 'ok',
        text: `WhatsApp de reprogramación abierto para ${doctorName} (${sent} paciente${sent === 1 ? '' : 's'}).`,
      })
    }
  }
  function openReprogramarWhatsAppMedico(
    doctorId: string,
    doctorName: string,
    citas: Appointment[],
  ) {
    openReprogramarWhatsAppModal(doctorId, doctorName, citas)
  }
  async function openWhatsAppTurno(c: Appointment) {
    if (c.estado === 'cancelado') {
      const doctor = doctorById(c.doctorId)
      const doctorName = doctor
        ? `${doctor.apellido}, ${doctor.nombre}`
        : 'médico'
      openReprogramarWhatsAppModal(c.doctorId, doctorName, [c])
      return
    }
    const prep = prepareTurnoWhatsApp(c)
    if (!prep.ok) {
      void confirm({ message: prep.message })
      // Continuar intentando abrir WhatsApp para que muestre su propio error
    }
    try {
      await openWhatsAppWebUrl(prep.tel, prep.mensaje)
      upsertAppointment(markWhatsAppRecordatorioEnviado(c))
    } catch (err) {
      console.error(err)
      void confirm({
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo abrir WhatsApp. Comprobá que tengas la aplicación de WhatsApp instalada.',
      })
    }
  }
  async function openWhatsAppPacientesMedico(
    doctorId: string,
    citas: Appointment[],
  ) {
    const activas = citas.filter((c) => c.estado !== 'cancelado')
    if (activas.length === 0) {
      void confirm({
        message: 'No hay turnos activos en este listado para enviar recordatorio.',
      })
      return
    }
    const listos: {
      cita: Appointment
      tel: string
      mensaje: string
      nombre: string
    }[] = []
    const sinTelefono: string[] = []
    const telInvalido: string[] = []
    for (const c of activas) {
      const prep = prepareTurnoWhatsApp(c)
      if (prep.ok) {
        listos.push({
          cita: c,
          tel: prep.tel,
          mensaje: prep.mensaje,
          nombre: prep.nombre,
        })
      } else if (prep.message.includes('no tiene teléfono')) {
        sinTelefono.push(prep.nombre)
      } else {
        telInvalido.push(prep.nombre)
      }
    }
    if (listos.length === 0) {
      void confirm({
        message:
          'Ningún paciente de la lista tiene teléfono válido para WhatsApp.\n\nRevisá los teléfonos en Pacientes.',
      })
      return
    }
    const doctor = doctorById(doctorId)
    const medicoLabel = doctor ? `${doctor.apellido}, ${doctor.nombre}` : 'médico'
    let confirmMsg = `Se abrirá WhatsApp de a un paciente (${listos.length} en total) con el recordatorio de turno de ${medicoLabel}.\n\nDespués de cada mensaje, la app preguntará si querés continuar con el siguiente.`
    if (sinTelefono.length > 0) {
      confirmMsg += `\n\nSin teléfono (${sinTelefono.length}): ${sinTelefono.slice(0, 4).join('; ')}${sinTelefono.length > 4 ? '…' : ''}`
    }
    if (telInvalido.length > 0) {
      confirmMsg += `\n\nTeléfono inválido (${telInvalido.length}): ${telInvalido.slice(0, 4).join('; ')}${telInvalido.length > 4 ? '…' : ''}`
    }
    const ok = await confirm({
      title: 'WhatsApp a pacientes',
      message: confirmMsg,
      confirmLabel: 'Abrir WhatsApp',
    })
    if (!ok) return
    await openWhatsAppSecuencial({
      items: listos,
      confirm,
      onItemSent: (i) => {
        upsertAppointment(markWhatsAppRecordatorioEnviado(listos[i]!.cita))
      },
      onItemError: (item, err) => {
        console.error(err)
        void confirm({
          message: `No se pudo abrir WhatsApp para ${item.nombre}.`,
        })
      },
      open: openWhatsAppWebUrl,
    })
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
  function isCitaPagada(c: Appointment): boolean {
    const t = parseISO(c.fechaHora)
    return (
      pagadoCitaIds.has(c.id) ||
      pagadoDayKeys.has(
        `${c.patientId}__${c.doctorId}__${format(t, 'yyyy-MM-dd')}`,
      )
    )
  }
  function secretariaNoPuedeModificarCita(c: Appointment): boolean {
    if (role !== 'secretaria') return false
    if (secretariaNoPuedeModificarDia(parseISO(c.fechaHora))) return true
    if (!data.settings.secretariaPuedeModificarTurnosOtrosUsuarios) {
      const currentUsername = session?.username?.trim().toLowerCase()
      const currentDisplayName = session?.displayName?.trim().toLowerCase()
      const creadoPor = c.creadoPor?.trim().toLowerCase()
      if (creadoPor) {
        if (creadoPor !== currentUsername && creadoPor !== currentDisplayName) {
          return true
        }
      } else if (session?.turno) {
        const turnoCita = getTurnoFromFecha(c.fechaHora)
        if (turnoCita !== '—' && turnoCita.toLowerCase() !== session.turno.trim().toLowerCase()) {
          return true
        }
      }
    }
    return false
  }
  function secretariaNoPuedeModificarDia(day: Date): boolean {
    if (role !== 'secretaria') return false
    const d = startOfDay(day)
    const inicioSemanaActual = startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 })
    if (d >= inicioSemanaActual) {
      return false
    }
    if (data.settings.secretariaPuedeModificarMesActual) {
      return !isSameMonth(d, new Date())
    }
    return true
  }
  function turnoFueraDeLaSemana(c: Appointment): boolean {
    const day = parseISO(c.fechaHora)
    return !weekDays.some((weekDay) => isSameDay(day, weekDay))
  }
  function noPuedeEditarCita(c: Appointment): boolean {
    return turnoFueraDeLaSemana(c) || secretariaNoPuedeModificarCita(c)
  }
  async function handleCancelCita(c: Appointment) {
    if (c.estado === 'cancelado') return
    if (secretariaNoPuedeModificarCita(c)) {
      if (secretariaNoPuedeModificarDia(parseISO(c.fechaHora))) {
        setMsg({ type: 'err', text: 'Secretaría no tiene permiso para modificar turnos en esta fecha.' })
      } else {
        setMsg({ type: 'err', text: 'No tiene permiso para cancelar turnos de otro usuario o turno.' })
      }
      return
    }
    if (!isCitaPagada(c)) {
      const pac = patientById(c.patientId)
      const doc = doctorById(c.doctorId)
      const hora = format(parseISO(c.fechaHora), 'HH:mm', { locale: es })
      const ok = await confirm({
        message: `¿Cancelar el turno de ${hora}${pac ? ` — ${pac.apellido}, ${pac.nombre}` : ''}${doc ? ` (${doc.apellido})` : ''}?\n\nNo aparecerá en los PDF de la agenda.`,
        confirmLabel: 'Cancelar turno',
        cancelLabel: 'Volver',
      })
      if (!ok) return
      upsertAppointment({ ...c, estado: 'cancelado' })
      if (bookingEditingId === c.id) closeBooking()
      if (citaActionsOpenId === c.id) setCitaActionsOpenId(null)
      return
    }
    setCitaToCancel(c)
  }
  function handleCitaNameClick(c: Appointment) {
    if (citaNameClickTimerRef.current !== null) {
      window.clearTimeout(citaNameClickTimerRef.current)
    }
    citaNameClickTimerRef.current = window.setTimeout(() => {
      citaNameClickTimerRef.current = null
      setCitaActionsOpenId((prev) => (prev === c.id ? null : c.id))
    }, 250)
  }
  function handleCitaNameDoubleClick(c: Appointment) {
    if (citaNameClickTimerRef.current !== null) {
      window.clearTimeout(citaNameClickTimerRef.current)
      citaNameClickTimerRef.current = null
    }
    if (noPuedeEditarCita(c)) {
      if (secretariaNoPuedeModificarCita(c)) {
        if (secretariaNoPuedeModificarDia(parseISO(c.fechaHora))) {
          setMsg({ type: 'err', text: 'Secretaría no tiene permiso para modificar turnos en esta fecha.' })
        } else {
          setMsg({ type: 'err', text: 'No tiene permiso para modificar turnos de otro usuario o turno.' })
        }
      } else {
        setMsg({ type: 'err', text: 'Solo se pueden editar turnos de la semana seleccionada.' })
      }
      return
    }
    openBookingForEdit(c)
  }
  function renderDayCitaRow(c: Appointment, secondary: string, compactEstado = false) {
    const isPagado = isCitaPagada(c)
    const estadoLabel = formatDayCitaEstado(c, isPagado, compactEstado)
    const estadoTitle = compactEstado
      ? dayCitaEstadoParts(c, isPagado).join(' - ')
      : undefined
    const actionsOpen = citaActionsOpenId === c.id
    const p = patientById(c.patientId)
    const motivosText = joinMotivosConsulta(c.notas ?? '', c.motivoConsulta2)
    const cobText = c.obraSocialOverride || p?.obraSocial || 'Particular'
    const whoTitle = `${secondary} (${cobText}${motivosText ? ` · ${motivosText}` : ''}) · Click: mostrar u ocultar acciones · Doble click: editar`
    return (
      <li
        key={c.id}
        tabIndex={0}
        className={`day-cita${bookingOpen && bookingEditingId === c.id ? ' day-cita--active' : ''}${actionsOpen ? ' day-cita--actions-open' : ''}`}
      >
        <div className="day-cita__main">
          <div className="day-cita__primary">
            <span className="day-cita__time">
              {format(parseISO(c.fechaHora), 'HH:mm', { locale: es })}
            </span>
            <span className="day-cita__sep">-</span>
            <span
              className="day-cita__who day-cita__who--tap"
              title={whoTitle}
              onClick={() => handleCitaNameClick(c)}
              onDoubleClick={() => handleCitaNameDoubleClick(c)}
            >
              {secondary}
            </span>
          </div>
          {estadoLabel ? (
            <span className="day-cita__estado" title={estadoTitle}>
              {estadoLabel}
            </span>
          ) : null}
        </div>
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          <IconActionButton
            variant={c.estado === 'cancelado' ? 'whatsapp-bulk' : 'whatsapp'}
            label={
              c.estado === 'cancelado'
                ? `WhatsApp reprogramación — ${secondary}`
                : `WhatsApp ${secondary}`
            }
            onClick={() => void openWhatsAppTurno(c)}
          >
            <IconWhatsApp />
          </IconActionButton>
          <IconActionButton
            variant="edit"
            label={`Editar turno — ${secondary}`}
            disabled={noPuedeEditarCita(c)}
            onClick={() => openBookingForEdit(c)}
          >
            <IconEdit />
          </IconActionButton>
          {c.estado !== 'cancelado' && (
            <IconActionButton
              variant="cancel"
              label={`Cancelar turno — ${secondary}`}
              disabled={secretariaNoPuedeModificarCita(c)}
              onClick={() => void handleCancelCita(c)}
            >
              <IconCancelDay />
            </IconActionButton>
          )}
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
      <div className="day-pill__group-actions" onClick={(e) => e.stopPropagation()}>
        <IconActionButton
          variant="whatsapp"
          label={`WhatsApp al médico — ${g.label}`}
          onClick={() => void openWhatsAppMedico(g.key)}
        >
          <IconWhatsApp />
        </IconActionButton>
        {g.citas.some((c) => c.estado !== 'cancelado') && (
          <IconActionButton
            variant="whatsapp-bulk"
            label={`WhatsApp recordatorio a todos los pacientes — ${g.label}`}
            onClick={() => void openWhatsAppPacientesMedico(g.key, g.citas)}
          >
            <IconWhatsApp />
          </IconActionButton>
        )}
        {(turnosActivosPorMedicoDia.get(g.key) ?? 0) > 0 && (
          <IconActionButton
            variant="cancel"
            label={`Cancelar turnos del día — ${g.label}`}
            disabled={selectedWeekDay ? secretariaNoPuedeModificarDia(selectedWeekDay) : false}
            onClick={() => void cancelDoctorDayTurns(g.key, g.label)}
          >
            <IconCancelDay />
          </IconActionButton>
        )}
        {(turnosCanceladosPorMedicoDia.get(g.key) ?? 0) > 0 && (
          <IconActionButton
            variant="whatsapp-bulk"
            label={`WhatsApp reprogramación a pacientes — ${g.label}`}
            onClick={() =>
              openReprogramarWhatsAppMedico(g.key, g.label, g.citas)
            }
          >
            <IconWhatsApp />
          </IconActionButton>
        )}
        {(turnosCanceladosPorMedicoDia.get(g.key) ?? 0) > 0 && (
          <IconActionButton
            variant="restore"
            label={`Restaurar turnos cancelados — ${g.label}`}
            disabled={selectedWeekDay ? secretariaNoPuedeModificarDia(selectedWeekDay) : false}
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
            <div
              className="day-pill__libres-horas-panel"
              role="group"
              aria-label="Horarios libres; clic para agendar"
            >
              {libresHorasVisibles.length > 0 ? (
                <div className="day-pill__libres-horas-list">
                  {libresHorasVisibles.map((hm) => (
                    <button
                      key={hm}
                      type="button"
                      className="day-pill__libres-hora-btn"
                      title={`Agendar turno a las ${hm}`}
                      onClick={() => openBookingAtSlot(g.key, hm)}
                    >
                      {hm}
                    </button>
                  ))}
                </div>
              ) : (
                'Sin horarios libres en esta franja.'
              )}
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
      <AgendaPageHeader
        tab={tab}
        onTabChange={setTab}
        onOpenAgendaMedico={() => {
          setAgendaMedicoOpen(true)
        }}
        onOpenAtencionSinTurno={() => setAtencionSinTurnoOpen(true)}
        onOpenEspecialidades={() => setMedicosEspModalOpen(true)}
        onOpenMedicosDia={() => setMedicosDiaModalOpen(true)}
        agendaExportDoctors={agendaExportDoctors}
        agendaExportDoctorId={agendaExportDoctorId}
        onExportDoctorIdChange={setAgendaExportDoctorId}
        agendaExportScope={agendaExportScope}
        onExportScopeChange={setAgendaExportScope}
        onTurnosPdf={() => void handleAgendaTurnosPdfPreview()}
        onWhatsAppPacientesPdf={() => void handleAgendaWhatsAppPacientesPdfPreview()}
        onPreviewPdf={handleAgendaPdfPreview}
        puedeEnviarCorreo={puedeEnviarCorreo}
        enviandoCorreo={enviandoCorreo}
        onEnviarCorreo={() => void handleEnviarCorreoAgenda()}
        onOpenObraSocial={() => setOsModalOpen(true)}
        onOpenAgendaManual={() => setAgendaManualModalOpen(true)}
      />
      {agendaManualModalOpen && (
        <AgendaManualModal
          puedeAgenda={puedeAgenda}
          pacientesOperativos={pacientesOperativos}
          medicosOperativos={medicosOperativos}
          doctorById={doctorById}
          doctorDuracionTurno={doctorDuracionTurno}
          motivosConsultaOpciones={motivosConsultaOpciones}
          openMotivosConsultaModal={openMotivosConsultaModal}
          defaultDate={selectedWeekDay}
          onClose={() => setAgendaManualModalOpen(false)}
          onSave={handleSaveAgendaManual}
        />
      )}
      {atencionSinTurnoOpen && (
        <AtencionSinTurnoModal
          doctors={medicosOperativos}
          patients={pacientesOperativos}
          patientById={patientById}
          listados={data.atencionesSinTurno}
          puedeVerPorcentaje={puedeVerPorcentaje}
          onClose={() => setAtencionSinTurnoOpen(false)}
          onSave={({ doctorId, entries, fecha }) => {
            saveAtencionSinTurnoListado({
              doctorId,
              fecha,
              filas: entries.map((e) => ({
                patientId: e.patientId,
                monto: e.monto,
              })),
            })
            setMsg({
              type: 'ok',
              text:
                entries.length === 1
                  ? 'Listado sin turno guardado.'
                  : `Guardados ${entries.length} registros sin turno.`,
            })
          }}
          onDelete={({ doctorId, fecha }) => {
            deleteAtencionSinTurnoListado({ doctorId, fecha })
            setMsg({
              type: 'ok',
              text: 'Listado de atención sin turno eliminado.',
            })
          }}
          onSaveError={(message) => {
            void confirm({ message })
          }}
          onPdfPreview={(payload) => {
            agendaPdfDocRef.current = payload.doc
            if (agendaPdfPreview?.url) URL.revokeObjectURL(agendaPdfPreview.url)
            setAgendaPdfPreview({
              url: payload.url,
              filename: payload.filename,
              title: payload.title,
            })
          }}
          onPdfError={(message) => {
            void confirm({ message })
          }}
        />
      )}
      {agendaMedicoOpen && (
        <AgendaMedicoModal
          data={data}
          doctors={medicosOperativos}
          doctorId={agendaMedicoDoctorId}
          onDoctorIdChange={setAgendaMedicoDoctorId}
          weekDays={weekDays}
          weekLabel={weekLabel ?? ''}
          onPrevWeek={() => setWeekCursor((d) => addWeeks(d, -1))}
          onNextWeek={() => setWeekCursor((d) => addWeeks(d, 1))}
          onPdf={async () => {
            const doc = doctorById(agendaMedicoDoctorId)
            if (!doc) return
            try {
              await Promise.all([preloadPdfLogo(), preloadPdfHeaderBanner()])
              const built = buildAgendaMedicoLibresPdf({
                data,
                doctor: doc,
                weekDays,
                weekLabel: weekLabel ?? '',
              })
              showAgendaPdfPreview(built, built.title, { showFilename: false })
            } catch (err) {
              console.error(err)
              void confirm({
                message: 'No se pudo generar el PDF. Probá de nuevo.',
              })
            }
          }}
          onPickSlot={(doctorId, day, hm) => {
            setCloseAgendaMedicoAfterBooking(true)
            openBookingAtSlotOnDay(doctorId, day, hm)
          }}
          onClose={() => {
            setAgendaMedicoOpen(false)
            setCloseAgendaMedicoAfterBooking(false)
          }}
        />
      )}
      {msg?.type === 'err' && (
        <div className="msg msg-error">
          {msg.text}
        </div>
      )}
      {tab === 'turnos' && (
        <div className="agenda-turnos-layout">
          <section className="panel panel--day-list panel--day-list-scroll panel--day-list-unified">
            <AgendaWeekCalendar
              weekDays={weekDays}
              selectedWeekDay={selectedWeekDay}
              onSelectDay={setSelectedWeekDay}
              onOpenBooking={openBooking}
              countTurnosDia={countTurnosDia}
            />
            <div className="day-list__head">
              <AgendaTurnosWeekNav
                setWeekCursor={setWeekCursor}
                onGoToday={goToToday}
              />
              <div className="day-list__day-nav">
                {selectedWeekDay && (
                  <AgendaTurnosDayNavPrev goAdjacentDay={goAdjacentDay} />
                )}
                <h2 className="day-list__title">
                  {selectedWeekDay
                    ? format(selectedWeekDay, "EEEE d 'de' MMMM", {
                        locale: es,
                      }).toLocaleUpperCase('es')
                    : 'SELECCIONÁ UN DÍA'}
                </h2>
                {selectedWeekDay && (
                  <AgendaTurnosDayNavNext goAdjacentDay={goAdjacentDay} />
                )}
              </div>
              <div className="day-list__toolbar-actions">
                {weekLabel ? (
                  <p className="day-list__week-range week-toolbar__range">
                    SEMANA {weekLabel}
                  </p>
                ) : null}
              </div>
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
            <>
              {quickPacienteOpen && (
                <QuickPacienteModal
                  initial={{ dni: quickPacienteInitialDni }}
                  existingPatients={data.patients}
                  localidadesOpciones={localidadesOpciones}
                  obrasSocialesOpciones={obrasSocialesOpciones}
                  onSave={(pac) => {
                    const id = createId()
                    const createdPatient: Patient = {
                      id,
                      apellido: pac.apellido,
                      nombre: pac.nombre,
                      dni: pac.dni,
                      telefono: pac.telefono,
                      email: pac.email,
                      domicilio: '',
                      localidad: pac.localidad,
                      fechaNacimiento: '',
                      obraSocial: pac.obraSocial,
                      notas: '',
                      activo: true,
                    }
                    upsertPatient(createdPatient)
                    applyPatientSelection(createdPatient)
                    setQuickPacienteOpen(false)
                    setQuickPacienteInitialDni('')
                  }}
                  onClose={() => {
                    setQuickPacienteOpen(false)
                  }}
                />
              )}
              <NuevoTurnoModal
                bookingDate={bookingDate}
                bookingEditingId={bookingEditingId}
                bookingDoctorId={bookingDoctorId}
                setBookingDoctorId={setBookingDoctorId}
                bookingPatientId={bookingPatientId}
                setBookingPatientId={setBookingPatientId}
                bookingPatientQuery={bookingPatientQuery}
                setBookingPatientQuery={setBookingPatientQuery}
                bookingPatientPickerOpen={bookingPatientPickerOpen}
                setBookingPatientPickerOpen={setBookingPatientPickerOpen}
                bookingSlotHm={bookingSlotHm}
                setBookingSlotHm={setBookingSlotHm}
                bookingManualHm={bookingManualHm}
                setBookingManualHm={setBookingManualHm}
                bookingFueraGrilla={bookingFueraGrilla}
                setBookingFueraGrilla={setBookingFueraGrilla}
                bookingDuracion={bookingDuracion}
                setBookingDuracion={setBookingDuracion}
                bookingCobertura={bookingCobertura}
                setBookingCobertura={setBookingCobertura}
                bookingMonto={bookingMonto}
                setBookingMonto={setBookingMonto}
                bookingMonto2={bookingMonto2}
                setBookingMonto2={setBookingMonto2}
                bookingMetodo={bookingMetodo}
                setBookingMetodo={setBookingMetodo}
                bookingMetodo2={bookingMetodo2}
                setBookingMetodo2={setBookingMetodo2}
                bookingEstado={bookingEstado}
                setBookingEstado={setBookingEstado}
                bookingMotivoConsulta={bookingMotivoConsulta}
                setBookingMotivoConsulta={setBookingMotivoConsulta}
                bookingMotivoConsulta2={bookingMotivoConsulta2}
                setBookingMotivoConsulta2={setBookingMotivoConsulta2}
                bookingMotivoOtro={bookingMotivoOtro}
                setBookingMotivoOtro={setBookingMotivoOtro}
                bookingMotivoOtro2={bookingMotivoOtro2}
                setBookingMotivoOtro2={setBookingMotivoOtro2}
                bookingFormError={bookingFormError}
                bookingScheduleHint={bookingScheduleHint}
                bookingDoctors={bookingDoctors}
                pacientesOperativos={pacientesOperativos}
                bookingSlots={bookingSlots}
                bookingManualSlotCheck={bookingManualSlotCheck}
                bookingTotalMonto={bookingTotalMonto}
                bookingMetodosIguales={bookingMetodosIguales}
                bookingPaymentId={bookingPaymentId}
                bookingPaymentId2={bookingPaymentId2}
                obrasSocialesCatalog={obrasSocialesCatalog}
                saveObraSocialCatalog={saveObraSocialCatalog}
                motivosConsultaOpciones={motivosConsultaOpciones}
                openMotivosConsultaModal={openMotivosConsultaModal}
                onClose={closeBooking}
                onResetForm={resetBookingForm}
                onSubmitBooking={submitBooking}
                onOpenNewPatient={(initialDni) => {
                  setQuickPacienteInitialDni(initialDni)
                  setQuickPacienteOpen(true)
                }}
                applyPatientSelection={applyPatientSelection}
                doctorById={doctorById}
                bookingResolvedHm={bookingResolvedHm}
              />
            </>
          )}
        </div>
      )}
      {tab === 'franja' && (
        <AgendaFranjaTab
          data={data}
          doctorById={doctorById}
          franjaForm={franjaForm}
          setFranjaForm={setFranjaForm}
          onSubmit={submitFranja}
          onClose={() => setTab('turnos')}
        />
      )}
      {tab === 'mensual' && (
        <AgendaMensualTab
          data={data}
          doctorById={doctorById}
          mensualForm={mensualForm}
          setMensualForm={setMensualForm}
          onSubmit={submitMensual}
          onDelete={deleteAtencionMensual}
        />
      )}
      {tab === 'horarios' && (
        <AgendaHorariosTab
          data={data}
          doctorById={doctorById}
          horForm={horForm}
          setHorForm={setHorForm}
          onSubmit={submitHor}
          onDelete={deleteHorario}
          onClearDoctorHorarios={clearDoctorHorarios}
          onOpenMensual={() => setTab('mensual')}
          onClose={() => setTab('turnos')}
        />
      )}
      {tab === 'libres' && (
        <AgendaLibresTab
          data={data}
          libForm={libForm}
          setLibForm={setLibForm}
          diasLibresPorMedico={diasLibresPorMedico}
          onSubmit={submitLib}
          onToggleDia={toggleLibDia}
          onDeleteDia={deleteDiaLibre}
          onClose={() => setTab('turnos')}
        />
      )}
      {reprogramarWa && (
        <ReprogramarTurnoWhatsAppModal
          doctorName={reprogramarWa.doctorName}
          turnoCount={reprogramarWa.citas.length}
          horaSugerida={format(
            parseISO(reprogramarWa.citas[0]!.fechaHora),
            'HH:mm',
            { locale: es },
          )}
          onClose={() => setReprogramarWa(null)}
          onConfirm={(fechaNueva, horaNueva) =>
            void confirmReprogramarWhatsApp(fechaNueva, horaNueva)
          }
        />
      )}
      {medicosEspModalOpen && (
        <AgendaMedicosEspecialidadesModal
          rows={medicosEspecialidadesRows}
          data={data}
          onClose={() => setMedicosEspModalOpen(false)}
        />
      )}
      {medicosDiaModalOpen && (
        <MedicosDiaModal
          isOpen={medicosDiaModalOpen}
          onClose={() => setMedicosDiaModalOpen(false)}
          doctors={selectedWeekDay ? data.doctors.filter((d) => isDoctorAvailableOnDate(d.id, selectedWeekDay, data)) : []}
          selectedDate={selectedWeekDay}
        />
      )}
      {motivosConsultaModalOpen && (
        <MotivosConsultaModal
          custom={data.motivosConsultaCustom}
          onClose={closeMotivosConsultaModal}
          onAdd={addMotivoConsultaCustom}
          onRemove={removeMotivoConsultaCustom}
          onRename={renameMotivoConsultaCustom}
          onAdded={(nombre) => motivosConsultaOnAddedRef.current?.(nombre)}
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
      {citaToCancel && (() => {
        const pac = patientById(citaToCancel.patientId)
        const doc = doctorById(citaToCancel.doctorId)
        const pagosVinculados = data.payments.filter(
          (p) => p.citaId === citaToCancel.id,
        )
        const montoTotal = pagosVinculados.reduce((s, p) => s + p.monto, 0)
        return (
          <EliminarPagoModal
            title={
              pagosVinculados.length > 0 && montoTotal > 0
                ? 'Cancelar pago'
                : 'Cancelar turno'
            }
            fechaIso={citaToCancel.fechaHora}
            montoTotal={montoTotal > 0 ? montoTotal : null}
            pacienteLabel={
              pac ? `${pac.apellido}, ${pac.nombre}` : '—'
            }
            medicoLabel={
              doc ? `${doc.apellido}, ${doc.nombre}` : '—'
            }
            onClose={() => setCitaToCancel(null)}
            onConfirm={(motivo, notasOtros) => {
              archiveCitaCancelada(citaToCancel.id, motivo, notasOtros)
              if (bookingEditingId === citaToCancel.id) closeBooking()
              setCitaToCancel(null)
            }}
          />
        )
      })()}
      {osModalOpen && (
        <ObrasSocialesModal
          custom={data.obrasSocialesCustom}
          onClose={() => setOsModalOpen(false)}
          onAdd={addObraSocialCustom}
          onRemove={removeObraSocialCustom}
          onRename={renameObraSocialCustom}
        />
      )}
    </div>
  )
}
