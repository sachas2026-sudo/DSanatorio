import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { EliminarPagoModal } from '../components/EliminarPagoModal'
import { IconActionButton, IconEdit, IconTrash } from '../../../shared/components/icons'
import { PendientesPagosModal } from '../components/PendientesPagosModal'
import { GerenciaExportLogModal } from '../components/GerenciaExportLogModal'
import { GestionDeudasMedicosModal } from '../components/GestionDeudasMedicosModal'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { useConfirm } from '../../../context/ConfirmContext'
import { format, isWithinInterval, parseISO, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { ResumenCuidarModal } from '../components/ResumenCuidarModal'
import { DistribucionObrasSociales } from '../components/DistribucionObrasSociales'
import { useAuth } from '../../../context/AuthContext'
import { useAppState } from '../../../context/AppStateContext'
import {
  canUsePagosPeriodFilters,
  getCurrentUserDisplayName,
  getExportTurnoLabel,
  getUserDisplayNameForShift,
  resolveUserRealName,
} from '../../../lib/auth'
import { getTurnoFromFecha } from '../../../lib/dayTurnos'
import { medicosActivos, pacientesActivos } from '../../../lib/activo'
import {
  canExportPagosDetallePacientes,
  canExportPagosGerencia,
  canExportPagosGerenciaExcel,
  canViewDoctorPorcentaje,
  canViewPagosPendientes,
  EXPORT_DENIED_MESSAGE,
} from '../../../lib/exportPermissions'

import {
  buildAllDoctorsPaymentsPdf,
  buildDoctorPaymentsPdf,
  formatCobranzasDoctorHeaderTitle,
  formatCobranzasTodosMedicosHeaderTitle,
  pdfBlobUrl,
  savePdfFile,
} from '../../../lib/doctorPaymentsPdf'

import { buildPagosResumenEjecutivoPdf } from '../../../lib/pagosResumenEjecutivoPdf'
import { buildPagosPendientesPdf } from '../../../lib/pagosPendientesPdf'
import {
  buildObraSocialListadoPdf,
  buildMotivosListadoPdf,
  type ObraSocialListadoPdfRow,
  buildResumenCuidarPdf,
} from '../../../lib/resumenCuidarPdf'
import { DNI_MED_LABEL, DNI_PAC_LABEL } from '../../../lib/dniLabels'
import {
  joinMotivosConsulta,
  mergeMotivosConsulta,
  motivoConsultaFromNotas,
} from '../../../lib/motivoConsulta'
import {
  buildPagosGerenciaWorkbook,
  formatUserFilenameSlug,
  gerenciaExcelFilename,
  savePagosGerenciaExcelFile,
  workbookToXlsxBytes,
} from '../../../lib/pagosGerenciaExcel'
import {
  formatLastPagosGerenciaExcelExport,
  formatLastPagosGerenciaExcelExportRangeLabel,
  formatPagosGerenciaExcelExportRangeLabel,
  readLastPagosGerenciaExcelExportRecord,
  saveLastPagosGerenciaExcelExportForRange,
} from '../../../lib/pagosGerenciaExcelLastExport'
import {
  appendPagosGerenciaExcelLog,
  readPagosGerenciaExcelLog,
  type PagosGerenciaExcelLogRecord,
} from '../../../lib/pagosGerenciaExcelLog'
import { formatMonto } from '../../../lib/formatMonto'
import { patientObraSocial } from '../../../lib/patientObraSocial'
import { buildDistribucionObrasSocialesPdf } from '../../../lib/distribucionObrasSocialesPdf'
import {
  buildDistribucionObrasSocialesWorkbook,
  distribucionObrasSocialesExcelFilename,
} from '../../../lib/distribucionObrasSocialesExcel'
import { exportDistribucionPdf } from '../../../lib/exportDistribucionPdf'
import {
  buildDistribucionFilas,
  consolidarPorMedico,
  repartoDeFila,
  textoFechaColumna,
  PCT_CUIDAR_POR_DEFECTO,
  type DistribucionModo,
} from '../../../lib/distribucionObrasSocialesFilas'
import { buildDoctorDebtPdfRows } from '../../../lib/doctorDebtPdfTable'
import { computePagosMesConDescuentos } from '../../../lib/cobranzasMes'
import {
  computeDoctorPorcentajeSettlement,
  computeEfectivoAEntregar,
  pdfGeneratedLabel,
  resolvePaymentPorcentaje,
  sumPagosNetTotalByDoctor,
} from '../../../lib/pagosPdfLayout'
import { sonTodosTransferencia } from '../../../lib/paymentPorcentaje'
import { buildDebtRows } from '../../../lib/doctorDebts'

import { preloadPdfHeaderBanner } from '../../../lib/pdfHeaderBanner'
import { preloadPdfLogo } from '../../../lib/pdfLogo'
import { dateRangeBounds, periodBounds, type Periodo } from '../../../lib/periodBounds'
import { parseMontoInput, PAYMENT_METODOS } from '../../../lib/paymentInput'
import type jsPDF from 'jspdf'
import type { Appointment, Payment } from '../../../types'
import '../../../shared/styles/pages.css'
import './PagosModern.css'

type ResumenMedicoScope = 'dia' | 'mes' | 'anio'
type PdfMedicoFiltro = 'rango' | 'mes' | 'anio'
export type PdfTurnoFiltro = 'todos' | 'manana' | 'tarde' | 'noche'

const PDF_MEDICO_TODOS = '__todos__'

/**
 * Medios de pago que ofrece el filtro de la pestaña "Pagos a Médicos".
 * Efectivo y Transferencia son los dos que maneja la distribución entre obras
 * sociales; abajo se suman los demás que haya cargados en la base.
 */
const METODOS_FILTRO = ['Efectivo', 'Transferencia'] as const

function getSemanaMesRange(d: Date = new Date()): { desde: string; hasta: string } {
  const y = d.getFullYear()
  const m = d.getMonth()
  const day = d.getDate()
  const lastDayOfMonth = new Date(y, m + 1, 0).getDate()

  let startDay = 1
  let endDay = 7

  if (day <= 7) {
    startDay = 1
    endDay = Math.min(7, lastDayOfMonth)
  } else if (day <= 14) {
    startDay = 8
    endDay = Math.min(14, lastDayOfMonth)
  } else if (day <= 21) {
    startDay = 15
    endDay = Math.min(21, lastDayOfMonth)
  } else if (day <= 28) {
    startDay = 22
    endDay = Math.min(28, lastDayOfMonth)
  } else {
    startDay = 29
    endDay = lastDayOfMonth
  }

  const desde = format(new Date(y, m, startDay), 'yyyy-MM-dd')
  const hasta = format(new Date(y, m, endDay), 'yyyy-MM-dd')
  return { desde, hasta }
}

/** Limpia un motivo de consulta: descarta el sector ("Urgencia — ") y deja
 *  el valor real ("Consulta", "Ecografía", ...). */
function cleanMotivo(value: string): string {
  if (!value) return value
  const parts = value.split(/[—–—–]/)
  if (parts.length > 1) {
    return parts.pop()!.trim()
  }
  return value.trim()
}

/** Motivos que se muestran para un pago: los del turno (motivo 1 + motivo 2) o,
 *  si el pago no tiene turno, la nota del pago. */
function motivosConsultaDePago(
  appt: Appointment | undefined,
  notasPago: string,
  motivosCustom: string[],
): string[] {
  if (!appt) {
    const n = notasPago.trim()
    return n ? [cleanMotivo(n)] : []
  }
  const motivos: string[] = []
  for (const texto of [appt.notas ?? '', appt.motivoConsulta2 ?? '']) {
    const { motivo, otroDetalle } = motivoConsultaFromNotas(texto, motivosCustom)
    const limpio = cleanMotivo(motivo === 'Otro' ? (otroDetalle || '') : motivo)
    if (!limpio || motivos.includes(limpio)) continue
    motivos.push(limpio)
  }
  return motivos
}

/** Motivo 1 + motivo 2 del turno, para listados y reportes. */
function motivoConsultaRowLabel(
  appt: Appointment | undefined,
  notasPago: string,
  motivosCustom: string[],
): string {
  const motivos = motivosConsultaDePago(appt, notasPago, motivosCustom)
  return joinMotivosConsulta(motivos[0] ?? '—', motivos[1])
}

export function PagosPage() {
  const { role, session } = useAuth()
  const puedeFiltrarMesAnio = canUsePagosPeriodFilters(role)
  const puedeExportGerencia = canExportPagosGerencia(role)
  const puedeExportGerenciaExcel = canExportPagosGerenciaExcel(role)
  const puedeExportDetalle = canExportPagosDetallePacientes(role)
  const esPagosSecretaria = role === 'secretaria'
  const muestraResumenPdf = puedeExportDetalle
  const muestraExportarPagos = puedeExportGerencia || puedeExportGerenciaExcel
  const puedeVerPorcentaje = canViewDoctorPorcentaje(role)
  const puedeVerPendientes = canViewPagosPendientes(role)

  const {
    data,
    upsertPayment,
    deletePayment,
    archivePagoCancelado,
    registrarPagoDeudaMedico,
    patientById,
    doctorById,
  } = useAppState()
  const { confirm } = useConfirm()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingId2, setEditingId2] = useState<string | null>(null)
  const [pendientesOpen, setPendientesOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [resumenCuidarOpen, setResumenCuidarOpen] = useState(false)
  const [gestionDeudasOpen, setGestionDeudasOpen] = useState(false)
  const [tabListado, setTabListado] = useState<'medicos' | 'obrasSociales'>('medicos')
  /** Dentro de Obras Sociales: listado de turnos o distribución por médico. */
  const [vistaOS, setVistaOS] = useState<'listado' | 'distribucion'>('listado')
  // Resumen = una fila por médico + motivo. Completo = una fila por consulta.
  const [distribucionModo, setDistribucionModo] = useState<DistribucionModo>('resumen')
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const datePickerRef = useRef<HTMLDivElement | null>(null)

  const [form, setForm] = useState(() => ({
    patientId: '',
    doctorId: '',
    citaId: '',
    monto: '',
    monto2: '',
    fechaLocal: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    metodo: 'Efectivo',
    metodo2: 'Transferencia',
    notas: '',
  }))

  const pacientesParaAlta = useMemo(() => {
    const list = pacientesActivos(data.patients)
    if (!form.patientId || list.some((p) => p.id === form.patientId)) return list
    const cur = data.patients.find((p) => p.id === form.patientId)
    return cur ? [...list, cur] : list
  }, [data.patients, form.patientId])

  const medicosParaAlta = useMemo(() => {
    const list = medicosActivos(data.doctors)
    if (!form.doctorId || list.some((d) => d.id === form.doctorId)) return list
    const cur = data.doctors.find((d) => d.id === form.doctorId)
    return cur ? [...list, cur] : list
  }, [data.doctors, form.doctorId])

  const medicosOrdenadosParaPdf = useMemo(
    () =>
      [...data.doctors].sort((a, b) =>
        `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
          sensitivity: 'base',
        }),
      ),
    [data.doctors],
  )

  const [pdfMedicoId, setPdfMedicoId] = useState(PDF_MEDICO_TODOS)
  const [pdfMesRef, setPdfMesRef] = useState(() => format(new Date(), 'yyyy-MM'))
  const [pdfAnioRef, setPdfAnioRef] = useState(() => format(new Date(), 'yyyy'))

  const [excelDesdeRef, setExcelDesdeRef] = useState(() => getSemanaMesRange().desde)
  const [excelHastaRef, setExcelHastaRef] = useState(() => getSemanaMesRange().hasta)
  const [gerenciaExcelExportVersion, setGerenciaExcelExportVersion] = useState(0)
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)
  const [exportandoFacOsExcel, setExportandoFacOsExcel] = useState(false)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null)
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfMedicoFiltro, setPdfMedicoFiltro] = useState<PdfMedicoFiltro>('rango')
  const [pdfObraSocial, setPdfObraSocial] = useState<string>('')
  /**
   * Filtro de medio de pago. Sólo vive en la pestaña "Pagos a Médicos": en la
   * de Obras Sociales se ve el de obra social en su lugar.
   */
  const [pdfMetodo, setPdfMetodo] = useState<string>('')
  const [pdfMotivo, setPdfMotivo] = useState<string>('')
  const [pdfTurnoFiltro, setPdfTurnoFiltro] = useState<PdfTurnoFiltro>(() => {
    if (session?.turno === 'Tarde') return 'tarde'
    if (session?.turno === 'Mañana') return 'manana'
    return 'todos'
  })
  const [registrarPagoOpen, setRegistrarPagoOpen] = useState(false)
  const registrarPagoPanelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setDatePickerOpen(false)
      }
    }
    if (datePickerOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [datePickerOpen])

  const citasOpts = useMemo(() => {
    const doc = form.doctorId
    const pac = form.patientId
    if (!doc || !pac) return []
    return data.appointments.filter(
      (c) => c.doctorId === doc && c.patientId === pac && c.estado !== 'cancelado',
    )
  }, [data.appointments, form.doctorId, form.patientId])

  function resetForm() {
    setEditingId(null)
    setEditingId2(null)
    setForm({
      patientId: '',
      doctorId: '',
      citaId: '',
      monto: '',
      monto2: '',
      fechaLocal: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      metodo: 'Efectivo',
      metodo2: 'Transferencia',
      notas: '',
    })
    setRegistrarPagoOpen(false)
  }

  function toggleRegistrarPagoSecretaria() {
    if (registrarPagoOpen && !editingId) {
      resetForm()
      return
    }
    setRegistrarPagoOpen(true)
    requestAnimationFrame(() => {
      registrarPagoPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    })
  }

  const exportResumenBounds = useMemo(
    () => dateRangeBounds(excelDesdeRef, excelHastaRef),
    [excelDesdeRef, excelHastaRef],
  )

  /**
   * Obras sociales que se pueden filtrar.
   *
   * Se arma con lo que ya se usó (paciente, override del turno, override del
   * pago) más los planes activos del Sanatorio: un plan recién creado todavía
   * no tiene pagos ni overrides, pero tiene que poder elegirse desde el
   * listado de arriba igual que cualquier otra cobertura.
   */
  const obrasSocialesDisponibles = useMemo(() => {
    const s = new Set<string>()
    for (const p of data.patients) {
      if (p.obraSocial && p.obraSocial.trim()) {
        s.add(p.obraSocial.trim())
      }
    }
    for (const a of data.appointments) {
      if (a.obraSocialOverride && a.obraSocialOverride.trim()) {
        s.add(a.obraSocialOverride.trim())
      }
    }
    for (const pay of data.payments) {
      if (pay.obraSocialOverride && pay.obraSocialOverride.trim()) {
        s.add(pay.obraSocialOverride.trim())
      }
    }
    for (const plan of data.planesAfiliados ?? []) {
      if (plan.nombre && plan.nombre.trim()) {
        s.add(plan.nombre.trim())
      }
    }
    s.add('Particular')
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  }, [data.patients, data.appointments, data.payments, data.planesAfiliados])

  /**
 * Medios de pago que hay cargados en la base. Se ofrecen Efectivo y
 * Transferencia siempre, más los demás que ya se usen, para no llenar el
 * desplegable de opciones que no devuelven nada.
 */
const mediosPagoDisponibles = useMemo(() => {
    const usados = new Set<string>()
    for (const p of data.payments) {
      const m = p.metodo?.trim()
      // Los turnos sin pago que se agregan para los planes no traen medio real.
      if (m && m !== '—') usados.add(m)
    }
    const lista: string[] = [...METODOS_FILTRO]
    for (const m of usados) {
      if (!lista.includes(m)) lista.push(m)
    }
    return lista
  }, [data.payments])

  /**
   * Obra social efectiva de un pago: override del pago, del turno o del
   * paciente.
   *
   * Del paciente se usa `patientObraSocial` porque el plan activo del Sanatorio
   * funciona como cobertura: sin esto, el pago de un afiliado a "Plan Plus"
   * se imputaba a la obra social que tuviera cargada en la ficha y elegir el
   * plan en el filtro no traía nada.
   */
  const obraSocialDePago = useCallback(
    (p: Payment) => {
      const appt = p.citaId
        ? data.appointments.find(a => a.id === p.citaId)
        : undefined
      const pac = patientById(p.patientId)
      return (
        p.obraSocialOverride ||
        appt?.obraSocialOverride ||
        patientObraSocial(pac, data.afiliados, data.planesAfiliados) ||
        'Particular'
      )
    },
    [data.appointments, data.afiliados, data.planesAfiliados, patientById],
  )

  /** Motivos de consulta de un pago: sale de las notas del turno, o de las
 *  notas del pago si no hay turno. Se muestra solo el motivo (sin el
 *  sector "Urgencia —", que es ruido para el listado).
 *
 *  Vuelve una lista porque la distribución por obra social muestra cada
 *  motivo en su propia fila, en vez de juntarlos con " + ". */
  const motivosDePago = useCallback(
    (p: Payment) => {
      const appt = p.citaId
        ? data.appointments.find(a => a.id === p.citaId)
        : undefined
      const motivos = motivosConsultaDePago(appt, p.notas ?? '', data.motivosConsultaCustom ?? [])
      return motivos.length ? motivos : ['—']
    },
    [data.appointments, data.motivosConsultaCustom],
  )

  /**
 * Cada filtro de la barra se usa sólo en la pestaña donde está visible:
 * "Medio de Pago" en Pagos a Médicos y "Obra Social" en Obras Sociales.
 */
const pdfMetodoEnPestana = tabListado === 'medicos' ? pdfMetodo : ''
const pdfObraSocialEnPestana = tabListado === 'obrasSociales' ? pdfObraSocial : ''

const hayFiltrosActivos =
    pdfMedicoId !== PDF_MEDICO_TODOS ||
    pdfObraSocialEnPestana !== '' ||
    pdfMetodoEnPestana !== '' ||
    pdfMotivo !== '' ||
    pdfTurnoFiltro !== 'todos'

  function resetearFiltros() {
    setPdfMedicoId(PDF_MEDICO_TODOS)
    setPdfObraSocial('')
    setPdfMetodo('')
    setPdfMotivo('')
    setPdfTurnoFiltro('todos')
  }

  const motivosDisponibles = useMemo(() => {
    return mergeMotivosConsulta(data.motivosConsultaCustom ?? [])
  }, [data.motivosConsultaCustom])

  const rawPdfMedicoBounds = useMemo(() => {
    if (pdfMedicoFiltro === 'mes') {
      const [y, m] = pdfMesRef.split('-').map(Number)
      return periodBounds('mes', new Date(y, (m ?? 1) - 1, 1, 12, 0, 0))
    }
    if (pdfMedicoFiltro === 'anio') {
      return periodBounds('anio', new Date(Number(pdfAnioRef), 0, 1, 12, 0, 0))
    }
    return exportResumenBounds
  }, [pdfMedicoFiltro, pdfMesRef, pdfAnioRef, exportResumenBounds])

  const pdfMedicoBounds = useMemo(() => {
    if (pdfTurnoFiltro === 'todos') return rawPdfMedicoBounds
    const suffix =
      pdfTurnoFiltro === 'manana'
        ? ' (Turno Mañana)'
        : pdfTurnoFiltro === 'tarde'
          ? ' (Turno Tarde)'
          : ' (Turno Noche)'
    return {
      ...rawPdfMedicoBounds,
      label: `${rawPdfMedicoBounds.label}${suffix}`,
    }
  }, [rawPdfMedicoBounds, pdfTurnoFiltro])

  const bounds = pdfMedicoBounds

  // Calculate previous period (same date range of previous month) for comparison trend badges
  const prevPeriodBounds = useMemo(() => {
    const prevStart = subMonths(bounds.start, 1)
    const prevEnd = subMonths(bounds.end, 1)
    const fmt = (d: Date) => format(d, 'dd-MM-yy')
    const label =
      fmt(prevStart) === fmt(prevEnd)
        ? fmt(prevStart)
        : `${fmt(prevStart)} - ${fmt(prevEnd)}`
    return {
      start: prevStart,
      end: prevEnd,
      label,
    }
  }, [bounds])

  const pagosEnPeriodo = useMemo(() => {
    const filtered = data.payments.filter((p) => {
      if (pdfMedicoId !== PDF_MEDICO_TODOS && p.doctorId !== pdfMedicoId) {
        return false
      }
      if (pdfObraSocialEnPestana && obraSocialDePago(p) !== pdfObraSocialEnPestana) {
        return false
      }
      if (pdfMetodoEnPestana && p.metodo.trim() !== pdfMetodoEnPestana) {
        return false
      }
      if (pdfMotivo) {
        const appt = p.citaId ? data.appointments.find((a) => a.id === p.citaId) : undefined
        const motivos = motivosConsultaDePago(
          appt,
          p.notas ?? '',
          data.motivosConsultaCustom ?? [],
        )
        if (!motivos.includes(pdfMotivo)) {
          return false
        }
      }
      const t = parseISO(p.fecha)
      if (!isWithinInterval(t, { start: bounds.start, end: bounds.end })) {
        return false
      }
      if (pdfTurnoFiltro !== 'todos') {
        const mins = t.getHours() * 60 + t.getMinutes()
        const esManana = mins < 810
        if (pdfTurnoFiltro === 'manana' && !esManana) return false
        if (pdfTurnoFiltro === 'tarde' && esManana) return false
      }
      return true
    })

    // If a plan is selected in Obra Social filter, also include turnos/appointments
    // that have that plan but may not have payments yet
    const result = [...filtered]
    if (pdfObraSocialEnPestana && pdfObraSocialEnPestana !== 'Particular') {
      // Check if the selected obra social is a plan name
      const planMatches = data.planesAfiliados?.find((p) => p.nombre === pdfObraSocial)
      if (planMatches) {
        // Add turnos that have this plan assigned but no payment yet
        const planAppointments = data.appointments.filter((a) => {
          const os = a.obraSocialOverride || patientById(a.patientId)?.obraSocial?.trim() || 'Particular'
          return os === pdfObraSocialEnPestana
        })
        // Turnos without payments: create dummy payment-like objects
        for (const apt of planAppointments) {
          // Check if there's already a payment for this cita
          const hasPayment = filtered.some(p => p.citaId === apt.id)
          if (!hasPayment) {
            result.push({
              id: `turno-${apt.id}`,
              patientId: apt.patientId,
              doctorId: apt.doctorId,
              citaId: apt.id,
                monto: 0,
                fecha: apt.fechaHora || '',
                metodo: '—',
                notas: '',
                porcentajeAplicado: 0,
                obraSocialOverride: pdfObraSocialEnPestana,
              })
          }
        }
      }
    }

    return result
  }, [
    data.payments,
    data.appointments,
    data.motivosConsultaCustom,
    bounds,
    pdfMedicoId,
    pdfObraSocialEnPestana,
    pdfMetodoEnPestana,
    pdfMotivo,
    pdfTurnoFiltro,
    obraSocialDePago,
    data.planesAfiliados,
    patientById,
  ])

  const pagosPrevPeriodo = useMemo(() => {
    return data.payments.filter((p) => {
      if (pdfMedicoId !== PDF_MEDICO_TODOS && p.doctorId !== pdfMedicoId) {
        return false
      }
      if (pdfObraSocialEnPestana && obraSocialDePago(p) !== pdfObraSocialEnPestana) {
        return false
      }
      if (pdfMetodoEnPestana && p.metodo.trim() !== pdfMetodoEnPestana) {
        return false
      }
      if (pdfMotivo) {
        const appt = p.citaId ? data.appointments.find((a) => a.id === p.citaId) : undefined
        const motivos = motivosConsultaDePago(
          appt,
          p.notas ?? '',
          data.motivosConsultaCustom ?? [],
        )
        if (!motivos.includes(pdfMotivo)) {
          return false
        }
      }
      const t = parseISO(p.fecha)
      if (!isWithinInterval(t, { start: prevPeriodBounds.start, end: prevPeriodBounds.end })) {
        return false
      }
      if (pdfTurnoFiltro !== 'todos') {
        const mins = t.getHours() * 60 + t.getMinutes()
        const esManana = mins < 810
        if (pdfTurnoFiltro === 'manana' && !esManana) return false
        if (pdfTurnoFiltro === 'tarde' && esManana) return false
      }
      return true
    })
  }, [
    data.payments,
    data.appointments,
    data.motivosConsultaCustom,
    prevPeriodBounds,
    pdfMedicoId,
    pdfObraSocialEnPestana,
    pdfMetodoEnPestana,
    pdfMotivo,
    pdfTurnoFiltro,
    obraSocialDePago,
  ])

  const pagosAnioActual = useMemo(() => {
    const startYear = new Date(new Date().getFullYear(), 0, 1, 0, 0, 0, 0)
    const endYear = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59, 999)
    return data.payments.filter((p) => {
      const t = parseISO(p.fecha)
      return isWithinInterval(t, { start: startYear, end: endYear })
    })
  }, [data.payments])

  const pendientesRows = useMemo(() => {
    const pagosConMonto = data.payments.filter((p) => p.monto > 0)
    const paidCitaIds = new Set(
      pagosConMonto.map((p) => p.citaId).filter((id): id is string => Boolean(id)),
    )
    const paidDayKeys = new Set(
      pagosConMonto.map((p) => {
        const day = format(parseISO(p.fecha), 'yyyy-MM-dd')
        return `${p.patientId}__${p.doctorId}__${day}`
      }),
    )

    const out: {
      id: string
      fechaHora: string
      patientId: string
      doctorId: string
      patientLabel: string
      doctorLabel: string
    }[] = []

    for (const c of data.appointments) {
      if (c.estado === 'cancelado') continue
      const t = parseISO(c.fechaHora)
      if (!isWithinInterval(t, { start: bounds.start, end: bounds.end })) continue
      if (paidCitaIds.has(c.id)) continue
      const key = `${c.patientId}__${c.doctorId}__${format(t, 'yyyy-MM-dd')}`
      if (paidDayKeys.has(key)) continue
      const p = patientById(c.patientId)
      const d = doctorById(c.doctorId)
      out.push({
        id: c.id,
        fechaHora: c.fechaHora,
        patientId: c.patientId,
        doctorId: c.doctorId,
        patientLabel: p ? `${p.apellido}, ${p.nombre}` : '—',
        doctorLabel: d ? `${d.apellido}, ${d.nombre}` : '—',
      })
    }
    return out.sort((a, b) => parseISO(b.fechaHora).getTime() - parseISO(a.fechaHora).getTime())
  }, [data.appointments, data.payments, bounds, patientById, doctorById])

  const usuarioAsignadoTurno = useMemo(() => {
    return getUserDisplayNameForShift(pdfTurnoFiltro, getCurrentUserDisplayName())
  }, [pdfTurnoFiltro])

  const pagosListado = useMemo(() => {
    return [...pagosEnPeriodo].sort(
      (a, b) => parseISO(a.fecha).getTime() - parseISO(b.fecha).getTime(),
    )
  }, [pagosEnPeriodo])

  // Si todo el listado entró por transferencia, "% Cuidar" va a mostrar
  // "Negativo" en vez del importe. Se evalúa sobre las filas ya filtradas, así
  // que si el filtro deja algún pago en efectivo vuelve a mostrar importes.
  const listadoTodosTransferencia = useMemo(
    () => sonTodosTransferencia(pagosListado),
    [pagosListado],
  )

  // Citas del período que NUNCA recibieron un cobro (sin Payment con monto > 0).
  // Es lo que el usuario venía pidiendo "abajo de la tabla principal": la
  // contracara del listado de cobros, filtrada por el médico/obra social /
  // rango que se usa arriba. Omite el filtro de motivo porque la cita no tiene
  // cobro que lo registre.
  const pendientesDePago = useMemo(() => {
    const hasPaid = (appt: (typeof data.appointments)[number]) =>
      (data.payments ?? []).some((p) => p.citaId === appt.id && Number(p.monto) > 0)

    return (data.appointments ?? [])
      .filter((a) => {
        const t = parseISO(a.fechaHora)
        if (!isWithinInterval(t, { start: bounds.start, end: bounds.end })) return false
        if (pdfMedicoId !== PDF_MEDICO_TODOS && a.doctorId !== pdfMedicoId) return false
        if (pdfObraSocial) {
          const pac = patientById(a.patientId)
          const os = a.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
          if (os !== pdfObraSocial) return false
        }
        if (hasPaid(a)) return false
        if (a.estado === 'cancelado') return false
        return true
      })
      .sort(
        (a, b) => parseISO(a.fechaHora).getTime() - parseISO(b.fechaHora).getTime(),
      )
  }, [
    data.appointments,
    data.payments,
    pdfMedicoId,
    pdfObraSocial,
    bounds.start,
    bounds.end,
  ])

  // Mapa de deudas por médico por clave doctor__fecha, para cruzar el "%
  // Cuidar" negativo del listado con lo que ya pagó en "Gestión de Deudas
  // por Médico" y pintarlo en verde si canceló la deuda de esa fecha.
  const debtsByKey = useMemo(() => {
    if (!listadoTodosTransferencia) return new Map()
    const debts = buildDebtRows(
      pagosEnPeriodo,
      data.pagosDeudasMedicos ?? [],
      data.doctors,
    )
    return new Map(debts.map((row) => [row.key, row]))
  }, [listadoTodosTransferencia, pagosEnPeriodo, data.pagosDeudasMedicos, data.doctors])

  // Mapa sin filtro: para la columna "P.Deuda" del listado, que muestra lo que
  // el médico abonó (si hay deuda asociada), independientemente de si todo el
  // listado fue por transferencia.
  const allDebtsByKey = useMemo(() => {
    const debts = buildDebtRows(
      pagosEnPeriodo,
      data.pagosDeudasMedicos ?? [],
      data.doctors,
    )
    return new Map(debts.map((row) => [row.key, row]))
  }, [pagosEnPeriodo, data.pagosDeudasMedicos, data.doctors])

  // Total de lo que los médicos pagaron (deudas canceladas/saldadas parcial),
  // respetando los filtros: se suma una vez por (médico, fecha) para no
  // duplicar cuando hay dos pagos sobre la misma deuda.
  const totalPagadoDeDeudas = useMemo(() => {
    const visto = new Set<string>()
    let total = 0
    for (const p of pagosListado) {
      const key = `${p.doctorId}__${p.fecha.slice(0, 10)}`
      if (visto.has(key)) continue
      visto.add(key)
      const deuda = allDebtsByKey.get(key)
      if (deuda) total += deuda.pagado
    }
    return total
  }, [pagosListado, allDebtsByKey])

  const totalPeriodo = useMemo(
    () => pagosEnPeriodo.reduce((s, p) => s + p.monto, 0),
    [pagosEnPeriodo],
  )

  const totalPeriodoMedico = useMemo(
    () =>
      sumPagosNetTotalByDoctor(pagosEnPeriodo, (doctorId) =>
        data.doctors.find((d) => d.id === doctorId)?.porcentaje,
      ),
    [pagosEnPeriodo, data.doctors],
  )

  const totalPeriodoCuidar = totalPeriodo - totalPeriodoMedico

  const totalPeriodoTransferencias = useMemo(
    () =>
      pagosEnPeriodo.reduce(
        (s, p) =>
          s + (p.metodo.trim().toLowerCase() === 'transferencia' ? p.monto : 0),
        0,
      ),
    [pagosEnPeriodo],
  )

  const totalPrevPeriodo = useMemo(
    () => pagosPrevPeriodo.reduce((s, p) => s + p.monto, 0),
    [pagosPrevPeriodo],
  )

  const totalPrevPeriodoMedico = useMemo(
    () =>
      sumPagosNetTotalByDoctor(pagosPrevPeriodo, (doctorId) =>
        data.doctors.find((d) => d.id === doctorId)?.porcentaje,
      ),
    [pagosPrevPeriodo, data.doctors],
  )

  const totalPrevPeriodoCuidar = totalPrevPeriodo - totalPrevPeriodoMedico

  const totalPrevPeriodoTransferencias = useMemo(
    () =>
      pagosPrevPeriodo.reduce(
        (s, p) =>
          s + (p.metodo.trim().toLowerCase() === 'transferencia' ? p.monto : 0),
        0,
      ),
    [pagosPrevPeriodo],
  )

  function calcTrend(curr: number, prev: number) {
    if (prev === 0 && curr === 0) return { pct: '0,0%', isUp: true }
    if (prev === 0) return { pct: '100%', isUp: true }
    const diff = ((curr - prev) / prev) * 100
    const isUp = diff >= 0
    const formatted = `${Math.abs(diff).toFixed(1).replace('.', ',')}%`
    return { pct: formatted, isUp }
  }

  const trendFacturado = useMemo(
    () => calcTrend(totalPeriodo, totalPrevPeriodo),
    [totalPeriodo, totalPrevPeriodo],
  )
  const trendMedico = useMemo(
    () => calcTrend(totalPeriodoMedico, totalPrevPeriodoMedico),
    [totalPeriodoMedico, totalPrevPeriodoMedico],
  )
  const trendCuidar = useMemo(
    () => calcTrend(totalPeriodoCuidar, totalPrevPeriodoCuidar),
    [totalPeriodoCuidar, totalPrevPeriodoCuidar],
  )
  const trendTransferencias = useMemo(
    () => calcTrend(totalPeriodoTransferencias, totalPrevPeriodoTransferencias),
    [totalPeriodoTransferencias, totalPrevPeriodoTransferencias],
  )

  const totalEntregadoMedico = useMemo(
    () => totalPeriodo - totalPeriodoCuidar - totalPeriodoTransferencias,
    [totalPeriodo, totalPeriodoCuidar, totalPeriodoTransferencias],
  )
  const totalPrevPeriodoEntregadoMedico = useMemo(
    () => totalPrevPeriodo - totalPrevPeriodoCuidar - totalPrevPeriodoTransferencias,
    [totalPrevPeriodo, totalPrevPeriodoCuidar, totalPrevPeriodoTransferencias],
  )
  const trendEntregadoMedico = useMemo(
    () => calcTrend(totalEntregadoMedico, totalPrevPeriodoEntregadoMedico),
    [totalEntregadoMedico, totalPrevPeriodoEntregadoMedico],
  )

  const deudaMedicosConCuidar = useMemo(() => {
    const porMedico = new Map<string, { neto: number; transferencias: number }>()
    for (const pago of pagosEnPeriodo) {
      const doctor = doctorById(pago.doctorId)
      const settlement = computeDoctorPorcentajeSettlement(
        pago.monto,
        resolvePaymentPorcentaje(pago, doctor?.porcentaje),
      )
      const actual = porMedico.get(pago.doctorId) ?? { neto: 0, transferencias: 0 }
      actual.neto += settlement.totalGeneral || 0
      if (pago.metodo.trim().toLowerCase() === 'transferencia') {
        actual.transferencias += pago.monto
      }
      porMedico.set(pago.doctorId, actual)
    }
    const medicos = Array.from(porMedico.entries())
      .map(([doctorId, resumen]) => ({
        nombre: (() => {
          const doctor = doctorById(doctorId)
          return doctor ? `${doctor.apellido}, ${doctor.nombre}` : 'Médico sin identificar'
        })(),
        monto: Math.max(
          0,
          -computeEfectivoAEntregar(resumen.neto, resumen.transferencias),
        ),
      }))
      .filter((medico) => medico.monto > 0)
      .sort((a, b) => b.monto - a.monto)

    return {
      total: medicos.reduce((total, medico) => total + medico.monto, 0),
      medicos,
    }
  }, [pagosEnPeriodo, doctorById])

  function setDatePreset(type: 'hoy' | 'ayer' | 'semana' | 'mes' | 'mes-anterior' | 'anio') {
    const now = new Date()
    if (type === 'hoy') {
      const d = format(now, 'yyyy-MM-dd')
      setExcelDesdeRef(d)
      setExcelHastaRef(d)
    } else if (type === 'ayer') {
      const d = format(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
        'yyyy-MM-dd',
      )
      setExcelDesdeRef(d)
      setExcelHastaRef(d)
    } else if (type === 'semana') {
      const { desde, hasta } = getSemanaMesRange(now)
      setExcelDesdeRef(desde)
      setExcelHastaRef(hasta)
    } else if (type === 'mes') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      setExcelDesdeRef(format(first, 'yyyy-MM-dd'))
      setExcelHastaRef(format(last, 'yyyy-MM-dd'))
    } else if (type === 'mes-anterior') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      setExcelDesdeRef(format(first, 'yyyy-MM-dd'))
      setExcelHastaRef(format(last, 'yyyy-MM-dd'))
    } else if (type === 'anio') {
      const first = new Date(now.getFullYear(), 0, 1)
      const last = new Date(now.getFullYear(), 11, 31)
      setExcelDesdeRef(format(first, 'yyyy-MM-dd'))
      setExcelHastaRef(format(last, 'yyyy-MM-dd'))
    }
    setPdfMedicoFiltro('rango')
    setDatePickerOpen(false)
  }

  const resumenMedicoPdfScope = useMemo((): ResumenMedicoScope => {
    if (pdfMedicoFiltro === 'anio') return 'anio'
    if (pdfMedicoFiltro === 'mes') return 'mes'
    return excelDesdeRef === excelHastaRef ? 'dia' : 'mes'
  }, [pdfMedicoFiltro, excelDesdeRef, excelHastaRef])

  const patientLabelForPdf = (id: string) => {
    const p = patientById(id)
    return p ? `${p.apellido}, ${p.nombre}` : '—'
  }

  const obraSocialLabelForPdf = (id: string) => {
    const p = patientById(id)
    return p?.obraSocial?.trim() ?? ''
  }

  const doctorLabelForPdf = (id: string) => {
    const d = doctorById(id)
    return d ? `${d.apellido}, ${d.nombre}` : '—'
  }

  function startEdit(x: Payment) {
    setEditingId(x.id)
    setRegistrarPagoOpen(true)
    const d = parseISO(x.fecha)
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    const siblings = x.citaId
      ? data.payments.filter((p) => p.citaId === x.citaId && p.id !== x.id)
      : []
    const second = siblings[0] ?? null
    setEditingId2(second?.id ?? null)
    setForm({
      patientId: x.patientId,
      doctorId: x.doctorId,
      citaId: x.citaId ?? '',
      monto: String(x.monto),
      monto2: second ? String(second.monto) : '',
      fechaLocal: local,
      metodo: x.metodo,
      metodo2: second?.metodo ?? 'Transferencia',
      notas: x.notas,
    })
    requestAnimationFrame(() => {
      registrarPagoPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const m = parseMontoInput(form.monto)
    const m2 = parseMontoInput(form.monto2)
    if (!form.patientId || !form.doctorId || !form.fechaLocal) return
    if (m <= 0 && m2 <= 0) return
    const fecha = new Date(form.fechaLocal).toISOString()
    const citaId = form.citaId || null

    if (m > 0) {
      upsertPayment({
        id: editingId ?? undefined,
        patientId: form.patientId,
        doctorId: form.doctorId,
        citaId,
        monto: m,
        fecha,
        metodo: form.metodo,
        notas: form.notas,
      })
    } else if (editingId) {
      deletePayment(editingId)
    }

    if (m2 > 0) {
      upsertPayment({
        id: editingId2 ?? undefined,
        patientId: form.patientId,
        doctorId: form.doctorId,
        citaId,
        monto: m2,
        fecha,
        metodo: form.metodo2,
        notas: '',
      })
    } else if (editingId2) {
      deletePayment(editingId2)
    }

    resetForm()
  }

  const puede =
    pacientesActivos(data.patients).length > 0 &&
    medicosActivos(data.doctors).length > 0

  const historiaClinicaByCitaId = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of data.appointments) {
      const n = c.notas?.trim() ?? ''
      if (!n) continue
      map.set(c.id, n)
    }
    return map
  }, [data.appointments])

  const pagosPdfMedico = useMemo(() => {
    if (!pdfMedicoId) return []
    return pagosEnPeriodo.map((p) => {
      const citaId = p.citaId ?? null
      const hc = citaId != null ? historiaClinicaByCitaId.get(citaId) ?? '' : ''
      if (!hc) return p
      return { ...p, notas: hc }
    })
  }, [pagosEnPeriodo, pdfMedicoId, historiaClinicaByCitaId])

  const pagosResumenMedicoPdf = pagosPdfMedico

  function resumenMedicoExportFileStamp() {
    if (pdfMedicoFiltro === 'anio') return pdfAnioRef
    if (pdfMedicoFiltro === 'mes') return pdfMesRef
    return `${excelDesdeRef}_${excelHastaRef}`
  }

  function buildPdfForDoctor(
    doctorId: string,
    payments: Payment[],
    periodLabel: string,
    scope: ResumenMedicoScope,
    fileStamp: string,
  ): { doc: jsPDF; filename: string } | null {
    const doctor = doctorById(doctorId)
    if (!doctor) return null
    const userForPdfShift = getUserDisplayNameForShift(pdfTurnoFiltro, getCurrentUserDisplayName())
    const turnoTextForPdf = getExportTurnoLabel(pdfTurnoFiltro, userForPdfShift, role)
    const currentPdfFooterLabel = pdfGeneratedLabel(userForPdfShift, turnoTextForPdf)
    return buildDoctorPaymentsPdf({
      doctor,
      periodLabel,
      payments,
      patientLabel: patientLabelForPdf,
      obraSocialLabel: obraSocialLabelForPdf,
      scope,
      fileStamp,
      appointmentById: (id) => data.appointments.find((a) => a.id === id),
      footerLabel: currentPdfFooterLabel,
      doctorDebtRows:
        pdfTurnoFiltro === 'todos'
          ? buildDoctorDebtPdfRows(
              payments,
              data.pagosDeudasMedicos ?? [],
              data.doctors,
              doctorId,
            )
          : undefined,
    })
  }

  function buildPagosResumenMedicoPdf(): {
    doc: jsPDF
    filename: string
    title: string
  } | null {
    if (!pdfMedicoId) return null
    const fileStamp = resumenMedicoExportFileStamp()
    const periodLabel = pdfMedicoBounds.label

    if (pdfMedicoId === PDF_MEDICO_TODOS) {
      const doctorDebtRows = pdfTurnoFiltro === 'todos'
        ? buildDoctorDebtPdfRows(pagosResumenMedicoPdf, data.pagosDeudasMedicos ?? [], data.doctors)
        : undefined
      const userForPdfShift = getUserDisplayNameForShift(
        pdfTurnoFiltro,
        getCurrentUserDisplayName(),
      )
      const turnoTextForPdf = getExportTurnoLabel(pdfTurnoFiltro, userForPdfShift, role)
      const currentPdfFooterLabel = pdfGeneratedLabel(userForPdfShift, turnoTextForPdf)
      const built = buildAllDoctorsPaymentsPdf({
        periodLabel,
        payments: pagosResumenMedicoPdf,
        patientLabel: patientLabelForPdf,
        obraSocialLabel: obraSocialLabelForPdf,
        doctorLabel: doctorLabelForPdf,
        doctorPorcentaje: puedeVerPorcentaje
          ? (id) => doctorById(id)?.porcentaje
          : undefined,
        doctorEspecialidad: (id) => doctorById(id)?.especialidad,
        scope: resumenMedicoPdfScope,
        dateFormat: resumenMedicoPdfScope === 'dia' ? 'HH:mm' : 'dd/MM/yyyy',
        dateColumnHeader: resumenMedicoPdfScope === 'dia' ? 'Hora' : 'Fecha',
        fileStamp,
        appointmentById: (id) => data.appointments.find((a) => a.id === id),
        headerTitle: formatCobranzasTodosMedicosHeaderTitle(
          resumenMedicoPdfScope,
          periodLabel,
        ),
        footerLabel: currentPdfFooterLabel,
        doctorDebtRows,
      })
      return {
        doc: built.doc,
        filename: built.filename,
        title: formatCobranzasTodosMedicosHeaderTitle(
          resumenMedicoPdfScope,
          periodLabel,
        ),
      }
    }

    const built = buildPdfForDoctor(
      pdfMedicoId,
      pagosResumenMedicoPdf,
      periodLabel,
      resumenMedicoPdfScope,
      fileStamp,
    )
    if (!built) return null
    const doctor = doctorById(pdfMedicoId)
    if (!doctor) return null
    return {
      doc: built.doc,
      filename: built.filename,
      title: formatCobranzasDoctorHeaderTitle(
        doctor,
        resumenMedicoPdfScope,
        periodLabel,
      ),
    }
  }

  async function handleResumenMedicoPdfPreview() {
    if (!muestraResumenPdf) {
      void confirm({ message: EXPORT_DENIED_MESSAGE })
      return
    }
    if (!pdfMedicoId) return
    try {
      await Promise.all([preloadPdfLogo(), preloadPdfHeaderBanner()])
      const built = buildPagosResumenMedicoPdf()
      if (!built) return
      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: built.title,
      })
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo generar el PDF. Probá de nuevo.',
      })
    }
  }

  async function handleResumenEjecutivoPdfPreview() {
    try {
      await preloadPdfHeaderBanner()
      const userForPdfShift = getUserDisplayNameForShift(pdfTurnoFiltro, getCurrentUserDisplayName())
      const turnoTextForPdf = getExportTurnoLabel(pdfTurnoFiltro, userForPdfShift, role)
      const currentPdfFooterLabel = pdfGeneratedLabel(userForPdfShift, turnoTextForPdf)
      const built = buildPagosResumenEjecutivoPdf({
        payments: pagosEnPeriodo,
        annualPayments: pagosAnioActual,
        periodLabel: bounds.label,
        doctorLabel: (id) => {
          const doctor = doctorById(id)
          return doctor ? `${doctor.apellido}, ${doctor.nombre}` : 'Sin médico'
        },
        doctorPorcentaje: (id) => doctorById(id)?.porcentaje,
        footerLabel: currentPdfFooterLabel,
      })
      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: 'Resumen ejecutivo de cobranzas',
      })
    } catch (err) {
      console.error(err)
      void confirm({ message: 'No se pudo generar el resumen PDF.' })
    }
  }

  /**
   * Arma los datos de la distribución con los filtros de la pantalla.
   *
   * Lo comparten el PDF y el Excel, así las dos salidas no pueden empezar a
   * mostrar números distintos.
   */
  function construirDistribucionDatos() {
    // Las dos salidas llevan las dos proyecciones: el resumen (una fila por
    // médico) y el detalle por consulta.
    const detalle = buildDistribucionFilas({
      pagos: pagosListado,
      doctorById,
      patientById,
      citaById: (id) => data.appointments.find((a) => a.id === id),
      obraSocialDe: obraSocialDePago,
      motivosDe: motivosDePago,
    })
    // Sin % guardado se usa el mismo 30 % por defecto que la tabla de la
    // pantalla. Con 0 el reparto daba cero y todas las celdas de obra social
    // salían vacías en el PDF, mientras la pantalla sí mostraba los importes.
    const pctDePdf = (os: string) =>
      (data.distribucionOSPercentajes ?? []).find(p => p.obraSocial === os)?.porcentaje ??
      PCT_CUIDAR_POR_DEFECTO

    // Obras sociales presentes en el filtro + las que ya tengan % cargado.
    const setObras = new Set<string>()
    // "Particular" no es una obra social: se excluye de las columnas y también
    // de la resta del Total, para que el PDF muestre lo mismo que la pantalla.
    const esParticular = (os: string) => os.trim().toLowerCase() === 'particular'
    for (const f of detalle) for (const o of f.obras) if (!esParticular(o)) setObras.add(o)
    for (const pc of (data.distribucionOSPercentajes ?? [])) {
      if (pc.porcentaje > 0 && !esParticular(pc.obraSocial)) setObras.add(pc.obraSocial)
    }
    const nombresObras = Array.from(setObras).sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base' }),
    )
    const pctDe = pctDePdf

    // Las filas de motivo sin monto se muestran en blanco, igual que en pantalla.
    const fmtMontoCelda = (valor: number) => (valor === 0 ? '' : formatMonto(valor))
    const aPdfRows = (filas: {
      fecha: string
      nombre: string
      paciente: string
      motivo: string
      monto: number
      porObraSocial: Map<string, number>
      total: number
    }[]) =>
      filas.map((f) => ({
        fecha: f.fecha,
        medico: f.nombre,
        paciente: f.paciente,
        motivo: f.motivo,
        monto: fmtMontoCelda(f.monto),
        porObraSocial: nombresObras.map((o) =>
          f.porObraSocial.has(o) ? fmtMontoCelda(f.porObraSocial.get(o) ?? 0) : '',
        ),
        total: fmtMontoCelda(f.total),
      }))

    const pdfRowsResumen = aPdfRows(
      consolidarPorMedico(detalle, pctDe).map((f) => ({
        fecha: textoFechaColumna(f.fecha),
        nombre: f.nombre,
        paciente: f.paciente,
        motivo: f.motivo || '—',
        monto: f.monto,
        porObraSocial: f.porObraSocial,
        total: f.total,
      })),
    )
    const pdfRowsDetalle = aPdfRows(
      detalle.map((f) => {
        const porObraSocial = new Map<string, number>()
        for (const o of f.obras) {
          porObraSocial.set(o, repartoDeFila(f.monto, f.obras, pctDe, o))
        }
        const repartido = [...porObraSocial.values()].reduce((s, v) => s + v, 0)
        return {
          fecha: textoFechaColumna(f.fecha),
          nombre: f.nombre,
          paciente: f.mostrarPaciente ? f.paciente : '',
          motivo: f.motivo || '—',
          monto: f.monto,
          porObraSocial,
          total: f.monto - repartido,
        }
      }),
    )

    const userForPdfShift =
      pdfTurnoFiltro === 'todos'
        ? 'Admi'
        : getUserDisplayNameForShift(pdfTurnoFiltro, getCurrentUserDisplayName())
    const turnoTextForPdf = getExportTurnoLabel(pdfTurnoFiltro, userForPdfShift, role)
    const filterParts: string[] = []
    if (pdfMedicoId !== PDF_MEDICO_TODOS) {
      const doc = doctorById(pdfMedicoId)
      if (doc) filterParts.push(`Médico: ${doc.apellido}, ${doc.nombre}`)
    }
    if (pdfObraSocial) filterParts.push(`Obra Social: ${pdfObraSocial}`)
    if (pdfMotivo) filterParts.push(`Motivo: ${pdfMotivo}`)

    return {
      desde: format(bounds.start, 'yyyy-MM-dd'),
      hasta: format(bounds.end, 'yyyy-MM-dd'),
      filterLabel: filterParts.join(' | '),
      obras: nombresObras.map(o => ({ nombre: o, porcentaje: pctDe(o) })),
      rows: pdfRowsResumen,
      rowsDetalle: pdfRowsDetalle,
      footerLabel: pdfGeneratedLabel(userForPdfShift, turnoTextForPdf),
    }
  }

  /**
   * Genera el PDF de la distribución.
   *
   * La vista previa lleva resumen + detalle; el botón "Exportar PDF" manda sólo
   * el resumen, porque el detalle son decenas de páginas de listado.
   */
  function construirDistribucionPdf(conDetalle: boolean) {
    const { rowsDetalle, ...resto } = construirDistribucionDatos()
    return buildDistribucionObrasSocialesPdf({
      ...resto,
      rowsCompletas: conDetalle ? rowsDetalle : undefined,
    })
  }

  /** Exporta a Excel la misma información que el PDF "Fac Obras Sociales". */
  async function handleExportarFacObrasSocialesExcel() {
    setExportandoFacOsExcel(true)
    try {
      const datos = construirDistribucionDatos()
      const wb = buildDistribucionObrasSocialesWorkbook({
        desde: datos.desde,
        hasta: datos.hasta,
        filterLabel: datos.filterLabel,
        obras: datos.obras,
        rows: datos.rows,
        rowsCompletas: datos.rowsDetalle,
        footerLabel: datos.footerLabel,
      })
      await savePagosGerenciaExcelFile(wb, distribucionObrasSocialesExcelFilename())
    } catch (err) {
      console.error('No se pudo generar el Excel de Fac Obras Sociales:', err)
      void confirm({ message: 'No se pudo generar el Excel de Fac Obras Sociales. Probá de nuevo.' })
    } finally {
      setExportandoFacOsExcel(false)
    }
  }

  /** Vista previa del PDF de la distribución, con resumen y detalle. */
  async function handleDistribucionObrasSocialesPdfPreview() {
    try {
      const built = construirDistribucionPdf(true)

      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: built.title,
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error('No se pudo generar el PDF de Fac Obras Sociales:', err)
      void confirm({ message: `No se pudo generar el PDF de Fac Obras Sociales. Detalle: ${detail}` })
    }
  }

  /**
   * Guarda el PDF de la distribución y devuelve la ruta.
   *
   * Se llama desde el botón de la tabla de distribución, que muestra el
   * resultado con un aviso y un "Abrir".
   */
  async function handleExportarDistribucionPdf(): Promise<string | null> {
    const built = construirDistribucionPdf(false)
    // Nombre con la fecha del reporte, no con la hora: es lo que el usuario
    // reconoce después en la carpeta.
    const nombre = `Distribucion_medico_${format(bounds.start, 'yyyy-MM-dd')}.pdf`
    return await exportDistribucionPdf(built.doc, nombre)
  }

  async function handleObraSocialPdfPreview() {
    try {
      await preloadPdfHeaderBanner()
      const listRows: ObraSocialListadoPdfRow[] = pagosEnPeriodo.map((p) => {
        const pac = patientById(p.patientId)
        const doc = doctorById(p.doctorId)
        const appt = p.citaId
          ? data.appointments.find((a) => a.id === p.citaId)
          : undefined
        const turnoLabel = getTurnoFromFecha(appt?.fechaHora || p.fecha)
        const pacienteLabel = pac ? `${pac.apellido}, ${pac.nombre}` : '—'
        const docLabel = doc ? `${doc.apellido}, ${doc.nombre}` : '—'
        const obraSocial = p.obraSocialOverride || appt?.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
        const motivoConsulta = motivoConsultaRowLabel(
          appt,
          p.notas ?? '',
          data.motivosConsultaCustom ?? [],
        )
        return {
          fecha: format(parseISO(p.fecha), 'dd/MM/yyyy HH:mm', { locale: es }),
          turno: turnoLabel,
          paciente: pacienteLabel,
          medico: docLabel,
          obraSocial,
          motivoConsulta,
          totalOS: '',
          totalCuidar: '',
        }
      })

      const userForPdfShift =
        pdfTurnoFiltro === 'todos'
          ? 'Admi'
          : getUserDisplayNameForShift(
              pdfTurnoFiltro,
              getCurrentUserDisplayName(),
            )
      const turnoTextForPdf = getExportTurnoLabel(pdfTurnoFiltro, userForPdfShift, role)
      const filterParts: string[] = []
      if (pdfMedicoId !== PDF_MEDICO_TODOS) {
        const doc = doctorById(pdfMedicoId)
        if (doc) filterParts.push(`Médico: ${doc.apellido}, ${doc.nombre}`)
      }
      if (pdfObraSocial) filterParts.push(`Obra Social: ${pdfObraSocial}`)
      if (pdfMotivo) filterParts.push(`Motivo: ${pdfMotivo}`)
      const filterLabel = filterParts.join(' | ')

      const built = buildObraSocialListadoPdf(
        format(bounds.start, 'yyyy-MM-dd'),
        format(bounds.end, 'yyyy-MM-dd'),
        filterLabel,
        listRows,
        pdfGeneratedLabel(userForPdfShift, turnoTextForPdf),
        pdfTurnoFiltro === 'manana' ? 'Mañana' : pdfTurnoFiltro === 'tarde' ? 'Tarde' : undefined,
      )

      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: built.title,
      })
    } catch (err) {
      console.error(err)
      void confirm({ message: 'No se pudo generar el PDF de Obra Social.' })
    }
  }

async function handlePendientesPdfPreview() {
    if (pendientesDePago.length === 0) return
    try {
      await preloadPdfHeaderBanner()
      const payloadRows = pendientesDePago.map((a) => {
        const pac = patientById(a.patientId)
        const docDoctor = doctorById(a.doctorId)
        const os = a.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
        return {
          fecha: format(parseISO(a.fechaHora), 'dd/MM/yyyy HH:mm', { locale: es }),
          paciente: pac ? `${pac.apellido}, ${pac.nombre}` : '—',
          medico: docDoctor ? `${docDoctor.apellido}, ${docDoctor.nombre}` : '—',
          especialidad: docDoctor?.especialidad || '—',
          obraSocial: os,
        }
      })
      const userForPdfShift = getUserDisplayNameForShift(pdfTurnoFiltro, getCurrentUserDisplayName())
      const turnoTextForPdf = getExportTurnoLabel(pdfTurnoFiltro, userForPdfShift, role)
      const currentPdfFooterLabel = pdfGeneratedLabel(userForPdfShift, turnoTextForPdf)
      const built = buildPagosPendientesPdf(
        format(bounds.start, 'yyyy-MM-dd'),
        format(bounds.end, 'yyyy-MM-dd'),
        'Todos los médicos',
        payloadRows,
        currentPdfFooterLabel,
        pdfTurnoFiltro === 'manana' ? 'Mañana' : pdfTurnoFiltro === 'tarde' ? 'Tarde' : undefined,
      )
      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({ url: pdfBlobUrl(built.doc), filename: built.filename, title: built.title })
    } catch (err) {
      console.error(err)
      void confirm({ message: 'No se pudo generar el PDF de pendientes.' })
    }
  }

  async function handleMotivosPdfPreview() {
    try {
      await preloadPdfHeaderBanner()
      const listRows: ObraSocialListadoPdfRow[] = pagosEnPeriodo.map((p) => {
        const pac = patientById(p.patientId)
        const doc = doctorById(p.doctorId)
        const appt = p.citaId
          ? data.appointments.find((a) => a.id === p.citaId)
          : undefined
        const turnoLabel = getTurnoFromFecha(appt?.fechaHora || p.fecha)
        const pacienteLabel = pac ? `${pac.apellido}, ${pac.nombre}` : '—'
        const docLabel = doc ? `${doc.apellido}, ${doc.nombre}` : '—'
        const obraSocial = p.obraSocialOverride || appt?.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
        const motivoConsulta = motivoConsultaRowLabel(
          appt,
          p.notas ?? '',
          data.motivosConsultaCustom ?? [],
        )
        return {
          fecha: format(parseISO(p.fecha), 'dd/MM/yyyy HH:mm', { locale: es }),
          turno: turnoLabel,
          paciente: pacienteLabel,
          medico: docLabel,
          obraSocial,
          motivoConsulta,
          totalOS: '',
          totalCuidar: '',
        }
      })

      const userForPdfShift =
        pdfTurnoFiltro === 'todos'
          ? 'Admi'
          : getUserDisplayNameForShift(
              pdfTurnoFiltro,
              getCurrentUserDisplayName(),
            )
      const turnoTextForPdf = getExportTurnoLabel(pdfTurnoFiltro, userForPdfShift, role)
      const filterParts: string[] = []
      if (pdfMedicoId !== PDF_MEDICO_TODOS) {
        const doc = doctorById(pdfMedicoId)
        if (doc) filterParts.push(`Médico: ${doc.apellido}, ${doc.nombre}`)
      }
      if (pdfObraSocial) filterParts.push(`Obra Social: ${pdfObraSocial}`)
      if (pdfMotivo) filterParts.push(`Motivo: ${pdfMotivo}`)
      const filterLabel = filterParts.join(' | ')

      const built = buildMotivosListadoPdf(
        format(bounds.start, 'yyyy-MM-dd'),
        format(bounds.end, 'yyyy-MM-dd'),
        filterLabel,
        listRows,
        pdfGeneratedLabel(userForPdfShift, turnoTextForPdf),
        pdfTurnoFiltro === 'manana' ? 'Mañana' : pdfTurnoFiltro === 'tarde' ? 'Tarde' : undefined,
      )

      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: built.title,
      })
    } catch (err) {
      console.error(err)
      void confirm({ message: 'No se pudo generar el PDF de Motivos.' })
    }
  }

  async function handleResumenCuidarPdfPreview() {
    try {
      await preloadPdfHeaderBanner()
      const byDayAndTurno = new Map<
        string,
        { day: string; turno: string; facturado: number; cuidar: number; transferencias: number; medico: number; cantidad: number }
      >()

      for (const p of pagosEnPeriodo) {
        const day = format(parseISO(p.fecha), 'yyyy-MM-dd')
        const appt = p.citaId ? data.appointments.find((a) => a.id === p.citaId) : undefined
        const turno = getTurnoFromFecha(appt?.fechaHora || p.fecha)
        const key = `${day}__${turno}`

        const doctor = doctorById(p.doctorId)
        const pct = resolvePaymentPorcentaje(p, doctor?.porcentaje)
        const s = computeDoctorPorcentajeSettlement(p.monto, pct)

        const cuidar = s.totalPorcentaje || 0
        const transferencias = p.metodo.trim().toLowerCase() === 'transferencia' ? p.monto : 0
        const medico = computeEfectivoAEntregar(s.totalGeneral || 0, transferencias)
        const facturado = p.monto

        const existing = byDayAndTurno.get(key) ?? {
          day,
          turno,
          facturado: 0,
          cuidar: 0,
          transferencias: 0,
          medico: 0,
          cantidad: 0,
        }
        existing.facturado += facturado
        existing.cuidar += cuidar
        existing.transferencias += transferencias
        existing.medico += medico
        existing.cantidad += 1
        byDayAndTurno.set(key, existing)
      }

      const turnoOrder: Record<string, number> = { Mañana: 1, Tarde: 2, Noche: 3 }
      const rowList = Array.from(byDayAndTurno.values()).sort((a, b) => {
        const cmp = a.day.localeCompare(b.day)
        if (cmp !== 0) return cmp
        return (turnoOrder[a.turno] ?? 9) - (turnoOrder[b.turno] ?? 9)
      })

      const medicoLabel =
        pdfMedicoId && pdfMedicoId !== PDF_MEDICO_TODOS
          ? `${doctorById(pdfMedicoId)?.apellido}, ${doctorById(pdfMedicoId)?.nombre}`
          : 'Todos los médicos'

      const userForPdfShift = getUserDisplayNameForShift(pdfTurnoFiltro, getCurrentUserDisplayName())
      const turnoTextForPdf = getExportTurnoLabel(pdfTurnoFiltro, userForPdfShift, role)
      const currentPdfFooterLabel = pdfGeneratedLabel(userForPdfShift, turnoTextForPdf)

      const turnoLabel =
        pdfTurnoFiltro === 'manana'
          ? 'Mañana'
          : pdfTurnoFiltro === 'tarde'
            ? 'Tarde'
            : pdfTurnoFiltro === 'noche'
              ? 'Noche'
              : undefined

      const built = buildResumenCuidarPdf(
        format(bounds.start, 'yyyy-MM-dd'),
        format(bounds.end, 'yyyy-MM-dd'),
        medicoLabel,
        rowList,
        rowList.reduce(
          (totales, row) => ({
            facturado: totales.facturado + row.facturado,
            transferencias: totales.transferencias + row.transferencias,
            medico: totales.medico + row.medico,
            cuidar: totales.cuidar + row.cuidar,
          }),
          { facturado: 0, transferencias: 0, medico: 0, cuidar: 0 },
        ),
        currentPdfFooterLabel,
        turnoLabel,
        {
          todosTransferencia: sonTodosTransferencia(pagosEnPeriodo),
          ...(pdfTurnoFiltro === 'todos'
            ? {
                doctorDebtRows: buildDoctorDebtPdfRows(
                  pagosEnPeriodo,
                  data.pagosDeudasMedicos ?? [],
                  data.doctors,
                  pdfMedicoId === PDF_MEDICO_TODOS ? undefined : pdfMedicoId,
                ),
                doctorDebtLabel: medicoLabel,
              }
            : {}),
        },
      )

      pdfDocRef.current = built.doc
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
      setPdfPreview({
        url: pdfBlobUrl(built.doc),
        filename: built.filename,
        title: built.title,
      })
    } catch (err) {
      console.error(err)
      void confirm({ message: 'No se pudo generar el resumen PDF.' })
    }
  }

  async function handlePdfDownload() {
    const doc = pdfDocRef.current
    const filename = pdfPreview?.filename
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

  function closePdfPreview() {
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview(null)
    pdfDocRef.current = null
  }

  async function handleExportGerenciaExcel() {
    if (!puedeExportGerenciaExcel && !puedeExportGerencia) {
      void confirm({ message: EXPORT_DENIED_MESSAGE })
      return
    }
    try {
      const fileStamp = `${format(bounds.start, 'yyyyMMdd')}-${format(bounds.end, 'yyyyMMdd')}`
      const isTodosTurnos = !pdfTurnoFiltro || pdfTurnoFiltro === 'todos'
      const userShift = isTodosTurnos
        ? ''
        : getUserDisplayNameForShift(pdfTurnoFiltro, getCurrentUserDisplayName())
      const exportUser = isTodosTurnos ? 'Admi' : (userShift || 'Admi')
      const shiftText = getExportTurnoLabel(pdfTurnoFiltro, exportUser, role)
      const filename = gerenciaExcelFilename(fileStamp, exportUser)

      const { start, end } = bounds
      const pagosExcel = pagosEnPeriodo
      const pagosCanceladosExcel = (data.pagosCancelados ?? []).filter((r) => {
        if (
          pdfMedicoId !== PDF_MEDICO_TODOS &&
          r.payment.doctorId !== pdfMedicoId
        ) {
          return false
        }
        if (pdfObraSocial && obraSocialDePago(r.payment) !== pdfObraSocial) {
          return false
        }
        const when = parseISO(r.payment.fecha)
        if (!isWithinInterval(when, { start, end })) return false
        if (pdfTurnoFiltro !== 'todos') {
          const mins = when.getHours() * 60 + when.getMinutes()
          const esManana = mins < 810
          if (pdfTurnoFiltro === 'manana' && !esManana) return false
          if (pdfTurnoFiltro === 'tarde' && esManana) return false
        }
        return true
      })

      const wb = buildPagosGerenciaWorkbook({
        payments: pagosExcel,
        pagosCancelados: pagosCanceladosExcel,
        pagosDeudasMedicos: data.pagosDeudasMedicos ?? [],
        patientById: (id: string) => data.patients.find((p) => p.id === id),
        doctorById: (id: string) => data.doctors.find((d) => d.id === id),
        appointmentById: (id: string) => data.appointments.find((a) => a.id === id),
        motivosConsultaCustom: data.motivosConsultaCustom ?? [],
        periodLabel: bounds.label,
        userLabel: isTodosTurnos ? '' : userShift,
        shiftLabel: shiftText,
        exportUserDisplayName: exportUser,
        todosTransferencia: sonTodosTransferencia(pagosExcel),
      })

      const saved = await savePagosGerenciaExcelFile(wb, filename)
      if (saved) {
        const exportedAt = new Date().toISOString()
        saveLastPagosGerenciaExcelExportForRange(
          format(bounds.start, 'yyyy-MM-dd'),
          format(bounds.end, 'yyyy-MM-dd'),
          exportedAt,
        )

        const totalEfectivo = pagosExcel
          .filter((p) => (p.metodo || '').toLowerCase().includes('efectivo'))
          .reduce((s, p) => s + p.monto, 0)
        const totalCuidar = pagosExcel.reduce((sum, p) => {
          const doctor = doctorById(p.doctorId)
          const pct = resolvePaymentPorcentaje(p, doctor?.porcentaje)
          const s = computeDoctorPorcentajeSettlement(p.monto, pct)
          return sum + (s.totalPorcentaje || 0)
        }, 0)

        appendPagosGerenciaExcelLog({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fechaExportacion: exportedAt,
          usuario: exportUser,
          turno: shiftText,
          montoEfectivo: totalEfectivo,
          montoCuidar: totalCuidar,
        })
        setGerenciaExcelExportVersion((v) => v + 1)

        try {
          const fileBytes = workbookToXlsxBytes(wb)
          if (isTauri()) {
            const { invoke } = await import('@tauri-apps/api/core')
            let binary = ''
            const bytes = new Uint8Array(fileBytes)
            const len = bytes.byteLength
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(bytes[i])
            }
            const fileBase64 = btoa(binary)
            const customExportFolder = data?.settings?.carpetaExportarGoogleDrive?.trim() || 'Exportar'
            const customRoot = data?.settings?.rutaGoogleDriveCustom?.trim() || null
            const disabled = data?.settings?.googleDriveDeshabilitado === true

            await invoke<boolean>('save_to_local_google_drive', {
              fileBase64,
              folderName: customExportFolder,
              filename,
              customRoot,
              disabled,
            })
          }
        } catch (driveError) {
          console.error('Error guardando en Google Drive local:', driveError)
        }
      }
    } catch (err) {
      console.error(err)
      void confirm({ message: 'No se pudo exportar el archivo de Gerencia.' })
    }
  }

  const dateRangeDisplay = `${format(bounds.start, 'dd/MM/yyyy')} - ${format(bounds.end, 'dd/MM/yyyy')}`

  const mostrarAcciones = Boolean(data.settings?.mostrarAccionesEnListaPagos)

  return (
    <div className="page--pagos-modern">
      {/* Top Header */}
      <header className="pagos-modern-header">
        <div className="pagos-modern-header__left">
          <h1 className="pagos-modern-header__title">PAGOS DE CONSULTAS</h1>
        </div>

        {/* Date Range Selector Pill */}
        <div className="pagos-date-pill-container" ref={datePickerRef}>
          <button
            type="button"
            className={`pagos-date-pill-btn${datePickerOpen ? ' is-active' : ''}`}
            onClick={() => setDatePickerOpen(!datePickerOpen)}
            aria-label="Seleccionar rango de fechas"
          >
            <span className="pagos-date-pill-btn__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <span>{dateRangeDisplay}</span>
            <span className="pagos-date-pill-btn__chevron">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>

          {datePickerOpen && (
            <div className="pagos-date-popover">
              <div className="pagos-date-popover__presets">
                <button type="button" className="pagos-date-popover__preset-btn" onClick={() => setDatePreset('hoy')}>
                  Hoy
                </button>
                <button type="button" className="pagos-date-popover__preset-btn" onClick={() => setDatePreset('ayer')}>
                  Ayer
                </button>
                <button type="button" className="pagos-date-popover__preset-btn" onClick={() => setDatePreset('semana')}>
                  Esta semana
                </button>
                <button type="button" className="pagos-date-popover__preset-btn" onClick={() => setDatePreset('mes')}>
                  Este mes
                </button>
                <button type="button" className="pagos-date-popover__preset-btn" onClick={() => setDatePreset('mes-anterior')}>
                  Mes anterior
                </button>
                <button type="button" className="pagos-date-popover__preset-btn" onClick={() => setDatePreset('anio')}>
                  Este año
                </button>
              </div>

              <div className="pagos-date-popover__inputs">
                <div className="pagos-date-popover__field">
                  <label htmlFor="pagos-desde-input">Desde</label>
                  <input
                    id="pagos-desde-input"
                    type="date"
                    value={excelDesdeRef}
                    onChange={(e) => {
                      setExcelDesdeRef(e.target.value)
                      setPdfMedicoFiltro('rango')
                    }}
                  />
                </div>
                <div className="pagos-date-popover__field">
                  <label htmlFor="pagos-hasta-input">Hasta</label>
                  <input
                    id="pagos-hasta-input"
                    type="date"
                    value={excelHastaRef}
                    onChange={(e) => {
                      setExcelHastaRef(e.target.value)
                      setPdfMedicoFiltro('rango')
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="pagos-date-popover__apply-btn"
                  onClick={() => setDatePickerOpen(false)}
                >
                  Listo
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Metric Cards */}
      <section className="pagos-metrics-grid">
        {/* Card 1: Total Facturado */}
        <div className="pagos-metric-card">
          <div className="pagos-metric-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <circle cx="12" cy="14" r="3" />
              <path d="M12 12.5v3" />
            </svg>
          </div>
          <div className="pagos-metric-content">
            <span className="pagos-metric-label">Total Facturado</span>
            <span className="pagos-metric-value">{formatMonto(totalPeriodo)}</span>
          </div>
        </div>

        {/* Card 2: Total Médico */}
        <div className="pagos-metric-card">
          <div className="pagos-metric-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="pagos-metric-content">
            <span className="pagos-metric-label">Total Médico</span>
            <span className="pagos-metric-value">{formatMonto(totalPeriodoMedico)}</span>
          </div>
        </div>

        {/* Card 3: Total Cuidar */}
        <div className="pagos-metric-card">
          <div className="pagos-metric-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="10" y1="11" x2="14" y2="11" />
            </svg>
          </div>
          <div className="pagos-metric-content">
            <span className="pagos-metric-label">Total Cuidar</span>
            <span className="pagos-metric-value">{formatMonto(totalPeriodoCuidar)}</span>
          </div>
        </div>

        {/* Card 4: Total Transferencias */}
        <div className="pagos-metric-card">
          <div className="pagos-metric-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3l4 4-4 4" />
              <path d="M3 7h18" />
              <path d="M7 21l-4-4 4-4" />
              <path d="M21 17H3" />
            </svg>
          </div>
          <div className="pagos-metric-content">
            <span className="pagos-metric-label">Total Transferencias</span>
            <span className="pagos-metric-value">{formatMonto(totalPeriodoTransferencias)}</span>
          </div>
        </div>

        {/* Card 5: Total Entregar al Medico */}
        <div className="pagos-metric-card pagos-metric-card--entregar">
          <div className="pagos-metric-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="12" cy="12" r="2" />
              <path d="M6 12h.01M18 12h.01" />
            </svg>
          </div>
          <div className="pagos-metric-content">
            <span className="pagos-metric-label">Total Entregar al Medico</span>
            <span className="pagos-metric-value">{formatMonto(listadoTodosTransferencia ? 0 : totalEntregadoMedico)}</span>
          </div>
        </div>

        {/* Card 6: Deuda del Médico */}
        <div className="pagos-metric-card pagos-metric-card--deuda">
          <div className="pagos-metric-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h18v12H3z" />
              <path d="M3 11h18" />
              <path d="M7 16h3" />
            </svg>
          </div>
          <div className="pagos-metric-content">
            <span className="pagos-metric-label">Deuda del Médico</span>
            <span className="pagos-metric-value" style={{ color: deudaMedicosConCuidar.total > 0 ? '#b45309' : undefined }}>
              {formatMonto(deudaMedicosConCuidar.total)}
            </span>
            {deudaMedicosConCuidar.medicos.length > 0 ? (
              <div
                className={`pagos-deuda-medicos ${deudaMedicosConCuidar.medicos.length > 2 ? 'pagos-deuda-medicos--compact' : ''}`}
                title="Médicos con deuda pendiente con Cuidar"
              >
                {deudaMedicosConCuidar.medicos.slice(0, 2).map((medico, index) => (
                  <span key={medico.nombre}>
                    {medico.nombre}: {formatMonto(medico.monto)}
                    {index === 1 && deudaMedicosConCuidar.medicos.length > 2 && (
                      <> · + {deudaMedicosConCuidar.medicos.length - 2} más</>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <div className="pagos-metric-trend">
                <span className="pagos-metric-trend-period">Sin deuda pendiente</span>
              </div>
            )}
          </div>
        </div>

      </section>

      {/* Filters Bar */}
      <section className="pagos-filters-card">
        {/* Médico filter */}
        <div className="pagos-filter-group">
          <label htmlFor="pagos-filter-doc">Médico</label>
          <div className="pagos-filter-select-wrap">
            <span className="pagos-filter-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <select
              id="pagos-filter-doc"
              value={pdfMedicoId}
              onChange={(e) => setPdfMedicoId(e.target.value)}
            >
              <option value={PDF_MEDICO_TODOS}>Todos los médicos</option>
              {medicosOrdenadosParaPdf.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.apellido}, {d.nombre}
                </option>
              ))}
            </select>
            <span className="pagos-filter-chevron">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </div>

        {/* Cada pestaña muestra un filtro distinto en este lugar: en "Pagos a
            Médicos" el medio de pago, en "Obras Sociales" la obra social. */}
        {tabListado === 'obrasSociales' && (
          <>
            <div className="pagos-filter-group">
              <label htmlFor="pagos-filter-os">Obra Social</label>
              <div className="pagos-filter-select-wrap">
                <span className="pagos-filter-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </span>
                <select
                  id="pagos-filter-os"
                  value={pdfObraSocial}
                  onChange={(e) => setPdfObraSocial(e.target.value)}
                >
                  <option value="">Todas las obras sociales</option>
                  {obrasSocialesDisponibles.map((os) => (
                    <option key={os} value={os}>
                      {os}
                    </option>
                  ))}
                </select>
                <span className="pagos-filter-chevron">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </div>
            </div>

            {/* Misma información que el PDF "Fac Obras Sociales": resumen por
                médico y detalle por consulta, en dos hojas. */}
            <div className="pagos-filter-group">
              <label htmlFor="pagos-btn-export-fac-os">Exportar</label>
              <div className="pagos-filter-select-wrap">
                <span className="pagos-filter-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </span>
                <button
                  id="pagos-btn-export-fac-os"
                  type="button"
                  className="pagos-filter-select-btn"
                  onClick={() => void handleExportarFacObrasSocialesExcel()}
                  disabled={exportandoFacOsExcel}
                  title="Exportar a Excel la misma información que el PDF Fac Obras Sociales"
                >
                  {exportandoFacOsExcel ? 'Exportando...' : 'Exportar a Excel'}
                </button>
              </div>
            </div>
          </>
        )}

        {tabListado === 'medicos' && (
          <div className="pagos-filter-group">
            <label htmlFor="pagos-filter-metodo">Medio de Pago</label>
            <div className="pagos-filter-select-wrap">
              <span className="pagos-filter-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </span>
              <select
                id="pagos-filter-metodo"
                value={pdfMetodo}
                onChange={(e) => setPdfMetodo(e.target.value)}
              >
                <option value="">Todos los medios de pago</option>
                {METODOS_FILTRO.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="pagos-filter-chevron">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </div>
        )}

        {/* Turno filter */}
        <div className="pagos-filter-group">
          <label htmlFor="pagos-filter-turno">Turno</label>
          <div className="pagos-filter-select-wrap">
            <span className="pagos-filter-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </span>
            <select
              id="pagos-filter-turno"
              value={pdfTurnoFiltro}
              onChange={(e) => setPdfTurnoFiltro(e.target.value as PdfTurnoFiltro)}
            >
              <option value="todos">Todos los turnos</option>
              <option value="manana">Turno Mañana</option>
              <option value="tarde">Turno Tarde</option>
            </select>
            <span className="pagos-filter-chevron">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </div>

        {/* PDF selector dropdown */}
        <div className="pagos-filter-group">
          <label htmlFor="pagos-filter-pdf">PDF</label>
          <div className="pagos-filter-select-wrap">
            <span className="pagos-filter-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>
            <select
              id="pagos-filter-pdf"
              value=""
              onChange={(e) => {
                const opt = e.target.value
                if (opt === 'medico') void handleResumenMedicoPdfPreview()
                else if (opt === 'resumen') void handleResumenEjecutivoPdfPreview()
                else if (opt === 'cuidar') void handleResumenCuidarPdfPreview()
                else if (opt === 'obra-social') void handleObraSocialPdfPreview()
                else if (opt === 'fac-obras-sociales') void handleDistribucionObrasSocialesPdfPreview()
                else if (opt === 'motivos') void handleMotivosPdfPreview()
                else if (opt === 'pendientes') void handlePendientesPdfPreview()
              }}
            >
              <option value="" disabled>Seleccionar PDF...</option>
              {muestraResumenPdf && <option value="medico">PDF Médico</option>}
              {role === 'admin' && <option value="resumen">PDF Resumen</option>}
              <option value="cuidar">PDF Cuidar</option>
              <option value="obra-social">PDF Obra Social</option>
              <option value="fac-obras-sociales">Fac Obras Sociales</option>
              <option value="motivos">PDF Motivos</option>
              <option value="pendientes">PDF Pendientes</option>
            </select>
            <span className="pagos-filter-chevron">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </div>

        {/* Registrar selector dropdown OR Motivos filter dropdown */}
        {tabListado === 'medicos' ? (
          <div className="pagos-filter-group">
            <label htmlFor="pagos-filter-registrar">Registrar</label>
            <div className="pagos-filter-select-wrap">
              <span className="pagos-filter-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </span>
              <select
                id="pagos-filter-registrar"
                value=""
                onChange={(e) => {
                  const opt = e.target.value
                  if (opt === 'pago') toggleRegistrarPagoSecretaria()
                  else if (opt === 'pendientes') setPendientesOpen(true)
                  else if (opt === 'deudas') setGestionDeudasOpen(true)
                }}
              >
                <option value="" disabled>Seleccionar...</option>
                <option value="pago">+ Pago</option>
                {puedeVerPendientes && (
                  <option value="pendientes">
                    Pendientes ({pendientesRows.length})
                  </option>
                )}
                <option value="deudas">Deudas médicos</option>
              </select>
              <span className="pagos-filter-chevron">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </div>
        ) : (
          <div className="pagos-filter-group">
            <label htmlFor="pagos-filter-motivo">Motivos</label>
            <div className="pagos-filter-select-wrap">
              <span className="pagos-filter-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </span>
              <select
                id="pagos-filter-motivo"
                value={pdfMotivo}
                onChange={(e) => setPdfMotivo(e.target.value)}
              >
                <option value="">Todos los motivos</option>
                {motivosDisponibles.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="pagos-filter-chevron">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </div>
        )}

        {/* Quick Actions (Secretaria: Exportar a Gerencia) */}
        {role !== 'admin' && muestraExportarPagos && (
          <div className="pagos-filter-group">
            <label htmlFor="pagos-btn-export-gerencia">Exportar</label>
            <div className="pagos-filter-select-wrap">
              <span className="pagos-filter-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </span>
              <button
                id="pagos-btn-export-gerencia"
                type="button"
                className="pagos-filter-select-btn"
                onClick={() => void handleExportGerenciaExcel()}
                title="Exportar archivo Excel a Gerencia"
              >
                Exportar a Gerencia
              </button>
            </div>
          </div>
        )}

        {/* Option B: Limpiar Filtros button */}
        {hayFiltrosActivos && (
          <div style={{ flex: '0 0 auto', alignSelf: 'flex-end', marginBottom: '2px', marginTop: '-52px' }}>
            <button
              type="button"
              onClick={resetearFiltros}
              style={{
                height: '34px',
                padding: '0 10px',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#e11d48',
                backgroundColor: '#fff1f2',
                border: '1px solid #fecdd3',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
                transform: 'translateY(-4px)',
              }}
              title="Restablecer todos los filtros"
            >
              <span>Limpiar filtros</span>
            </button>
          </div>
        )}
      </section>

      {/* Registrar / Editar Pago Form Panel */}
      {(registrarPagoOpen || editingId) && (
        <section ref={registrarPagoPanelRef} className="pagos-form-card">
          <div className="pagos-form-header">
            <h2 className="pagos-form-title">{editingId ? 'Editar pago' : 'Registrar pago'}</h2>
            <button type="button" className="pagos-form-close-btn" onClick={resetForm} title="Cerrar">
              ✕
            </button>
          </div>
          {!puede ? (
            <p className="empty-hint">Necesitás pacientes y médicos cargados.</p>
          ) : (
            <form onSubmit={submit} className="pagos-compact-form">
              <div className="pagos-form-row">
                <div className="pagos-form-field" style={{ flex: '1.3', minWidth: '150px' }}>
                  <label htmlFor="pay-pac">Paciente *</label>
                  <select
                    id="pay-pac"
                    value={form.patientId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, patientId: e.target.value, citaId: '' }))
                    }
                    required
                  >
                    <option value="">Elegir paciente…</option>
                    {pacientesParaAlta.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.apellido}, {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pagos-form-field" style={{ flex: '1.3', minWidth: '150px' }}>
                  <label htmlFor="pay-doc">Médico *</label>
                  <select
                    id="pay-doc"
                    value={form.doctorId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, doctorId: e.target.value, citaId: '' }))
                    }
                    required
                  >
                    <option value="">Elegir médico…</option>
                    {medicosParaAlta.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.apellido}, {d.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pagos-form-field" style={{ flex: '1', minWidth: '120px' }}>
                  <label htmlFor="pay-cita">Turno (opcional)</label>
                  <select
                    id="pay-cita"
                    value={form.citaId}
                    onChange={(e) => setForm((f) => ({ ...f, citaId: e.target.value }))}
                  >
                    <option value="">Sin vincular</option>
                    {citasOpts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {format(parseISO(c.fechaHora), 'd MMM HH:mm', { locale: es })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pagos-form-field" style={{ flex: '1.1', minWidth: '135px' }}>
                  <label htmlFor="pay-fecha">Fecha y hora *</label>
                  <input
                    id="pay-fecha"
                    type="datetime-local"
                    value={form.fechaLocal}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, fechaLocal: e.target.value }))
                    }
                    required
                  />
                </div>
              </div>

              <div className="pagos-form-row">
                <div className="pagos-form-field" style={{ flex: '0.85', minWidth: '85px' }}>
                  <label htmlFor="pay-monto">Monto *</label>
                  <input
                    id="pay-monto"
                    inputMode="decimal"
                    placeholder="$ 0"
                    value={form.monto}
                    onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                    required
                  />
                </div>

                <div className="pagos-form-field" style={{ flex: '1.05', minWidth: '110px' }}>
                  <label htmlFor="pay-met">Forma de Pago</label>
                  <select
                    id="pay-met"
                    value={form.metodo}
                    onChange={(e) => setForm((f) => ({ ...f, metodo: e.target.value }))}
                  >
                    {PAYMENT_METODOS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pagos-form-field" style={{ flex: '0.85', minWidth: '85px' }}>
                  <label htmlFor="pay-monto-2">Monto (2)</label>
                  <input
                    id="pay-monto-2"
                    inputMode="decimal"
                    placeholder="$ 0"
                    value={form.monto2}
                    onChange={(e) => setForm((f) => ({ ...f, monto2: e.target.value }))}
                  />
                </div>

                <div className="pagos-form-field" style={{ flex: '1.05', minWidth: '110px' }}>
                  <label htmlFor="pay-met-2">Forma (2)</label>
                  <select
                    id="pay-met-2"
                    value={form.metodo2}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, metodo2: e.target.value }))
                    }
                  >
                    {PAYMENT_METODOS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pagos-form-field" style={{ flex: '1.25', minWidth: '125px' }}>
                  <label htmlFor="pay-notas">Notas (opcional)</label>
                  <input
                    id="pay-notas"
                    type="text"
                    placeholder="Observaciones..."
                    value={form.notas}
                    onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                  />
                </div>

                <div className="pagos-form-buttons">
                  <button type="button" className="pagos-btn-form-cancel" onClick={resetForm}>
                    Cancelar
                  </button>
                  <button type="submit" className="pagos-btn-form-submit">
                    {editingId ? 'Guardar' : 'Registrar pago'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Nav Tab Buttons (Médicos / Obras Sociales) */}
      <div className="pagos-table-nav-buttons">
        <button
          type="button"
          className={`pagos-btn-subnav ${tabListado === 'medicos' ? 'pagos-btn-subnav--active' : ''}`}
          onClick={() => {
            setTabListado('medicos')
            setPdfMotivo('')
          }}
          title="Ver listado de pagos a médicos"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
          </svg>
          <span>Pagos a Médicos</span>
        </button>
        {role === 'admin' && (
          <>
            <button
              type="button"
              className={`pagos-btn-subnav ${tabListado === 'obrasSociales' ? 'pagos-btn-subnav--ingroup' : ''}`}
              onClick={() => {
                setTabListado('obrasSociales')
                setPdfMotivo('')
              }}
              title="Ver listado por obras sociales"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
              <span>Obras Sociales</span>
            </button>

            {/* Selector de vista, a la derecha del botón "Obras Sociales" */}
            {tabListado === 'obrasSociales' && (
              <>
                <button
                  type="button"
                  className={`pagos-btn-subnav ${vistaOS === 'listado' ? 'pagos-btn-subnav--selected' : 'pagos-btn-subnav--ingroup'}`}
                  onClick={() => setVistaOS('listado')}
                  title="Ver listado de obras sociales"
                  aria-pressed={vistaOS === 'listado'}
                >
                  {vistaOS === 'listado' && (
                    <span className="pagos-btn-subnav__check" aria-hidden="true">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                  <span>Listado de turnos</span>
                </button>
                <button
                  type="button"
                  className={`pagos-btn-subnav ${vistaOS === 'distribucion' ? 'pagos-btn-subnav--selected' : 'pagos-btn-subnav--ingroup'}`}
                  onClick={() => setVistaOS('distribucion')}
                  title="Ver distribución por médico"
                  aria-pressed={vistaOS === 'distribucion'}
                >
                  {vistaOS === 'distribucion' && (
                    <span className="pagos-btn-subnav__check" aria-hidden="true">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="20" x2="12" y2="10" />
                    <line x1="18" y1="20" x2="18" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="16" />
                  </svg>
                  <span>Distribución por médico (%)</span>
                </button>

                {/* Atajo al filtro de obra social de arriba: comparte estado con
                    `pdfObraSocial`, así los dos selectores quedan siempre iguales. */}
                <label className="pagos-os-shortfilter">
                  <span className="pagos-os-shortfilter__label">Obra Social</span>
                  <select
                    className="pagos-os-shortfilter__select"
                    value={pdfObraSocial}
                    onChange={e => setPdfObraSocial(e.target.value)}
                  >
                    <option value="">Todas</option>
                    {obrasSocialesDisponibles.map(os => (
                      <option key={os} value={os}>{os}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </>
        )}
      </div>

      {/* Vista de distribución por médico: reemplaza el listado en esa pestaña */}
      {tabListado === 'obrasSociales' && vistaOS === 'distribucion' ? (
        <DistribucionObrasSociales
          pagos={pagosListado}
          doctorById={doctorById}
          obraSocialDe={obraSocialDePago}
          motivosDe={motivosDePago}
          modo={distribucionModo}
          onModoChange={setDistribucionModo}
          onExportarPdf={handleExportarDistribucionPdf}
        />
      ) : (
        <section className="pagos-table-card">
        <div className="pagos-table-header">
          <h2 className="pagos-table-title">
            {tabListado === 'medicos' ? 'LISTADO DE PAGOS' : 'LISTADO DE OBRAS SOCIALES'}
            {usuarioAsignadoTurno ? ` - ${usuarioAsignadoTurno}` : ''}
          </h2>
          <span className="pagos-table-count-badge">
            {tabListado === 'medicos'
              ? `${pagosListado.length} pago${pagosListado.length === 1 ? '' : 's'}`
              : `${pagosListado.length} Obra${pagosListado.length === 1 ? ' Social' : 's Sociales'}`}
          </span>
        </div>

        <div
          className={`pagos-table-wrap ${
            tabListado === 'medicos' ? 'pagos-table-wrap--listado' : 'pagos-table-wrap--obras'
          }`}
        >
          {pagosListado.length === 0 ? (
            <p className="empty-hint" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              {data.payments.length === 0
                ? 'No hay pagos registrados.'
                : `No hay pagos en ${bounds.label}.`}
            </p>
          ) : (
            <table className="pagos-table">
              <thead>
                {tabListado === 'medicos' ? (
                  <tr>
                    <th>Fecha</th>
                    <th>Turno</th>
                    <th>Paciente</th>
                    <th>Médico</th>
                    <th>Especialidad</th>
                    <th>Obra Social</th>
                    <th>Porcentaje</th>
                    <th>Forma Pago</th>
                    <th className="text-right">Total Facturado</th>
                    <th className="text-right">Total Médico</th>
                    <th className="text-right">% Cuidar</th>
                    <th className="text-right">P.Deuda</th>
                    <th>Registrado</th>
                    {mostrarAcciones && <th className="text-right">Acciones</th>}
                  </tr>
                ) : (
                  <tr>
                    <th>Fecha</th>
                    <th>Turno</th>
                    <th>Paciente</th>
                    <th>Médico</th>
                    <th>Especialidad</th>
                    <th>Obra Social</th>
                    <th>Motivo Consulta</th>
                    {pdfObraSocial && (data.planesAfiliados ?? []).some((pl) => pl.nombre === pdfObraSocial) ? (
                      <th className="text-right">Total Consultas</th>
                    ) : (
                      <>
                        <th className="text-right">Total OS</th>
                        <th className="text-right">Total Cuidar</th>
                      </>
                    )}
                    {mostrarAcciones && <th className="text-right">Acciones</th>}
                  </tr>
                )}
              </thead>
              <tbody>
                {pagosListado.map((p) => {
                  const pac = patientById(p.patientId)
                  const doc = doctorById(p.doctorId)
                  const appt = p.citaId
                    ? data.appointments.find((a) => a.id === p.citaId)
                    : undefined
                  const turnoLabel = getTurnoFromFecha(appt?.fechaHora || p.fecha)
                  const pacienteLabel = pac
                    ? `${pac.apellido}, ${pac.nombre}`
                    : '—'
                  const pct = resolvePaymentPorcentaje(p, doc?.porcentaje)
                  const s = computeDoctorPorcentajeSettlement(p.monto, pct)
                  const montoCuidar = s.totalPorcentaje || 0
                  // Todo el listado por transferencia: lo que se le separa al
                  // médico sale del lado del centro, así que va en negativo.
                  const cuidarPctLabel = formatMonto(
                    listadoTodosTransferencia ? -montoCuidar : montoCuidar,
                  )

                  // Sólo cuando el valor fue negativo (deuda del médico con Cuidar)
                  // y la deuda de esa fecha quedó completamente saldada, pintamos
                  // en verde y mostramos en el tooltip la fecha y el monto del pago
                  // que el médico hizo para cancelarla.
                  const deudaKey = `${p.doctorId}__${p.fecha.slice(0, 10)}`
                  const deudaRelacionada = listadoTodosTransferencia
                    ? debtsByKey.get(deudaKey)
                    : undefined
                  const deudaPagadaEnCompleto = !!deudaRelacionada && deudaRelacionada.saldo === 0
                  const pagoQueCancelo = deudaPagadaEnCompleto
                    ? (data.pagosDeudasMedicos ?? [])
                        .filter((dp) => dp.deudaKey === deudaKey)
                        .sort((a, b) => (a.fecha > b.fecha ? -1 : 1))[0]
                    : undefined
                  const cuidarTooltip = pagoQueCancelo
                    ? [
                        `Pagado el ${format(parseISO(pagoQueCancelo.fecha), 'dd/MM/yyyy', { locale: es })}`,
                        formatMonto(pagoQueCancelo.monto),
                        pagoQueCancelo.metodo || '—',
                        pagoQueCancelo.nroComprobante?.trim() ? `#${pagoQueCancelo.nroComprobante.trim()}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : undefined

                  const usuarioRegistrado = resolveUserRealName(
                    p.registradoPor ||
                      getUserDisplayNameForShift(turnoLabel, getCurrentUserDisplayName()),
                    turnoLabel,
                  )
                  const usuarioModificado = p.modificadoPor
                    ? resolveUserRealName(p.modificadoPor, turnoLabel)
                    : null

                  if (tabListado === 'obrasSociales') {
                    const motivoLabel = motivoConsultaRowLabel(
                      appt,
                      p.notas ?? '',
                      data.motivosConsultaCustom ?? [],
                    )

                    return (
                      <tr key={p.id}>
                        <td>
                          {format(parseISO(p.fecha), 'd MMM yyyy HH:mm', { locale: es })}
                        </td>
                        <td>{turnoLabel}</td>
                        <td className="pagos-table-paciente-name">{pacienteLabel}</td>
                        <td>{doc ? `${doc.apellido}, ${doc.nombre}` : '—'}</td>
                        <td>{doc?.especialidad || '—'}</td>
                        <td>{p.obraSocialOverride || appt?.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'}</td>
                        <td>{motivoLabel}</td>
                        {pdfObraSocial && (data.planesAfiliados ?? []).some((pl) => pl.nombre === pdfObraSocial) ? (
                          <td className="text-right">
                            {(() => {
                              const afi = (data.afiliados ?? []).find(
                                (a) => a.patientId === p.patientId && a.activo,
                              )
                              const plan = afi
                                ? (data.planesAfiliados ?? []).find((pl) => pl.id === afi.planId)
                                : undefined
                              if (!plan) return '—'
                              const d = parseISO(p.fecha)
                              const cuota = (data.cuotasAfiliados ?? []).find(
                                (c) =>
                                  c.afiliadoId === afi!.id &&
                                  c.anio === d.getFullYear() &&
                                  c.mes === d.getMonth() + 1,
                              )
                              const usos = (cuota?.usos ?? 0) + (p.monto === 0 ? 1 : 0)
                              if (plan.cupoConsultas > 0) {
                                return `${usos}/${plan.cupoConsultas}`
                              }
                              return `${usos}`
                            })()}
                          </td>
                        ) : (
                          <>
                            <td className="text-right"></td>
                            <td className="text-right"></td>
                          </>
                        )}
                        {mostrarAcciones && (
                          <td className="text-right">
                            <div className="pagos-table-actions-cell">
                              <button
                                type="button"
                                className="pagos-table-action-btn"
                                title="Editar pago"
                                onClick={() => startEdit(p)}
                              >
                                <IconEdit />
                              </button>
                              <button
                                type="button"
                                className="pagos-table-action-btn pagos-table-action-btn--delete"
                                title="Eliminar pago"
                                onClick={() => setPaymentToDelete(p)}
                              >
                                <IconTrash />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  }

                  return (
                    <tr key={p.id}>
                      <td>
                        {format(parseISO(p.fecha), 'd MMM yyyy HH:mm', { locale: es })}
                      </td>
                      <td>{turnoLabel}</td>
                      <td className="pagos-table-paciente-name">{pacienteLabel}</td>
                      <td>{doc ? `${doc.apellido}, ${doc.nombre}` : '—'}</td>
                      <td>{doc?.especialidad || '—'}</td>
                      <td>{p.obraSocialOverride || appt?.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'}</td>
                      <td>{pct}%</td>
                      <td>{p.metodo || '—'}</td>
                      <td className="text-right" style={{ fontWeight: 600 }}>
                        {formatMonto(p.monto)}
                      </td>
                      <td className="text-right">{formatMonto(s.totalGeneral || 0)}</td>
                      <td
                        className={`text-right${deudaPagadaEnCompleto ? ' pagos-table__cuidar-pagado' : ''}`}
                        title={cuidarTooltip}
                        style={{ cursor: cuidarTooltip ? 'help' : undefined }}
                      >
                        {cuidarPctLabel}
                        </td>
                        <td className="text-right">
                          {formatMonto(listadoTodosTransferencia ? -montoCuidar : montoCuidar)}
                      </td>
                      <td>
                        <span style={{ fontWeight: 500, color: '#334155' }}>
                          {usuarioRegistrado}
                        </span>
                        {usuarioModificado && (
                          <span
                            style={{ color: '#d97706', fontSize: '0.72rem', marginLeft: '6px' }}
                            title={`Editado por: ${usuarioModificado}${p.modificadoEn ? ` (${format(parseISO(p.modificadoEn), 'd MMM HH:mm', { locale: es })})` : ''}`}
                          >
                            (edit: {usuarioModificado})
                          </span>
                        )}
                      </td>
                      {mostrarAcciones && (
                        <td className="text-right">
                          <div className="pagos-table-actions-cell">
                            <button
                              type="button"
                              className="pagos-table-action-btn"
                              title="Editar pago"
                              onClick={() => startEdit(p)}
                            >
                              <IconEdit />
                            </button>
                            <button
                              type="button"
                              className="pagos-table-action-btn pagos-table-action-btn--delete"
                              title="Eliminar pago"
                              onClick={() => setPaymentToDelete(p)}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                {tabListado === 'medicos' ? (
                  <tr>
                    {/* 8 columnas antes de los importes: Fecha, Turno,
                        Paciente, Médico, Especialidad, Obra Social,
                        Porcentaje y Forma Pago. Con 7 los importes corrían una
                        columna a la izquierda. */}
                    <td colSpan={8}>TOTALES ({pagosListado.length} pagos)</td>
                    <td className="text-right" style={{ color: '#0284c7' }}>
                      {formatMonto(totalPeriodo)}
                    </td>
                    <td className="text-right">{formatMonto(totalPeriodoMedico)}</td>
                    <td className="text-right">
                      {formatMonto(listadoTodosTransferencia ? -totalPeriodoCuidar : totalPeriodoCuidar)}
                    </td>
                    <td className="text-right">{formatMonto(totalPagadoDeDeudas)}</td>
                    <td colSpan={mostrarAcciones ? 2 : 1}></td>
                  </tr>
                ) : (
                  <tr>
                    {/* 7 columnas antes de los importes: Fecha, Turno,
                        Paciente, Médico, Especialidad, Obra Social y Motivo
                        Consulta. Con 6 la celda de acciones caía una columna
                        antes. */}
                    <td colSpan={7}>TOTALES</td>
                    <td className="text-right"></td>
                    <td className="text-right"></td>
                    {mostrarAcciones && <td></td>}
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      </section>
      )}

      {tabListado === 'medicos' && pendientesDePago.length > 0 && (
        <section className="pagos-table-card pagos-pendientes-card">
          <div className="pagos-table-header">
            <div className="pagos-table-header-left">
              <div>
                <h3 className="pagos-table-title">
                  Pagos pendientes de recepción ({pendientesDePago.length})
                </h3>
                <span className="pagos-table-desc">
                  Turnos del período que todavía no tienen un cobro registrado,
                  bajo los mismos filtros de arriba.
                </span>
              </div>
            </div>
          </div>
          <div className="pagos-table-wrap pagos-table-wrap--scroll pagos-table-wrap--pendientes">
            <table className="pagos-table">
              <thead>
                <tr>
                  <th>Fecha / Hora</th>
                  <th>Paciente</th>
                  <th>Médico</th>
                  <th>Especialidad</th>
                  <th>Obra Social</th>
                  <th className="text-right">Cobrar</th>
                </tr>
              </thead>
              <tbody>
                {pendientesDePago.map((a) => {
                  const pac = patientById(a.patientId)
                  const doc = doctorById(a.doctorId)
                  const os = a.obraSocialOverride || pac?.obraSocial?.trim() || 'Particular'
                  return (
                    <tr key={a.id}>
                      <td>{format(parseISO(a.fechaHora), 'dd-MM-yy HH:mm', { locale: es })}</td>
                      <td className="pagos-table-paciente-name">{pac ? `${pac.apellido}, ${pac.nombre}` : '—'}</td>
                      <td>{doc ? `${doc.apellido}, ${doc.nombre}` : '—'}</td>
                      <td>{doc?.especialidad || '—'}</td>
                      <td>{os}</td>
                      <td className="text-right pagos-table__pendiente-cobro">—</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>TOTAL PENDIENTES ({pendientesDePago.length})</td>
                  <td className="text-right">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* Modals */}
      {pendientesOpen && (
        <PendientesPagosModal
          title={`Pendientes — ${bounds.label}`}
          rows={pendientesRows}
          onClose={() => setPendientesOpen(false)}
        />
      )}

      {gestionDeudasOpen && (
        <GestionDeudasMedicosModal
          payments={data.payments}
          debtPayments={data.pagosDeudasMedicos ?? []}
          doctors={data.doctors}
          onRegisterPayment={registrarPagoDeudaMedico}
          onClose={() => setGestionDeudasOpen(false)}
        />
      )}

      {resumenCuidarOpen && (
        <ResumenCuidarModal
          payments={data.payments}
          doctors={data.doctors}
          onClose={() => setResumenCuidarOpen(false)}
        />
      )}

      {pdfPreview && (
        <PdfPreviewModal
          title={pdfPreview.title}
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          onClose={closePdfPreview}
          onDownload={() => void handlePdfDownload()}
        />
      )}

      {paymentToDelete && (
        <EliminarPagoModal
          title="Eliminar pago"
          fechaIso={paymentToDelete.fecha}
          montoTotal={paymentToDelete.monto}
          pacienteLabel={
            patientById(paymentToDelete.patientId)
              ? `${patientById(paymentToDelete.patientId)!.apellido}, ${patientById(paymentToDelete.patientId)!.nombre}`
              : '—'
          }
          medicoLabel={
            doctorById(paymentToDelete.doctorId)
              ? `${doctorById(paymentToDelete.doctorId)!.apellido}, ${doctorById(paymentToDelete.doctorId)!.nombre}`
              : '—'
          }
          onClose={() => setPaymentToDelete(null)}
          onConfirm={(motivo, notasOtros) => {
            archivePagoCancelado(paymentToDelete.id, motivo, notasOtros)
            if (editingId === paymentToDelete.id) resetForm()
            setPaymentToDelete(null)
          }}
        />
      )}

      {logOpen && <GerenciaExportLogModal onClose={() => setLogOpen(false)} />}
    </div>
  )
}
