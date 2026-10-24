import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { EliminarPagoModal } from '../components/EliminarPagoModal'
import { IconActionButton, IconEdit, IconTrash } from '../components/icons'
import { PendientesPagosModal } from '../components/PendientesPagosModal'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
import { useConfirm } from '../context/ConfirmContext'
import { format, isWithinInterval, parseISO, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAuth } from '../context/AuthContext'
import { useAppState } from '../context/AppStateContext'
import {
  canUsePagosPeriodFilters,
  getCurrentUserDisplayName,
  getExportTurnoLabel,
  getUserDisplayNameForShift,
  resolveUserRealName,
} from '../lib/auth'
import { getTurnoFromFecha } from '../lib/dayTurnos'
import { medicosActivos, pacientesActivos } from '../lib/activo'
import {
  canExportPagosDetallePacientes,
  canExportPagosGerencia,
  canExportPagosGerenciaExcel,
  canViewDoctorPorcentaje,
  canViewPagosPendientes,
  EXPORT_DENIED_MESSAGE,
} from '../lib/exportPermissions'

import {
  buildAllDoctorsPaymentsPdf,
  buildDoctorPaymentsPdf,
  formatCobranzasDoctorHeaderTitle,
  formatCobranzasTodosMedicosHeaderTitle,
  pdfBlobUrl,
  savePdfFile,
  type AllDoctorsPdfScope,
} from '../lib/doctorPaymentsPdf'

import { formatMonto } from '../lib/formatMonto'
import {
  computeDoctorPorcentajeSettlement,
  pdfGeneratedLabel,
  resolvePaymentPorcentaje,
  sumPagosNetTotalByDoctor,
} from '../lib/pagosPdfLayout'

import { preloadPdfHeaderBanner } from '../lib/pdfHeaderBanner'
import { dateRangeBounds, periodBounds, type Periodo } from '../lib/periodBounds'
import {
  buildPagosGerenciaWorkbook,
  gerenciaExcelFilename,
  savePagosGerenciaExcelFile,
} from '../lib/pagosGerenciaExcel'
import {
  appendPagosGerenciaExcelLog,
  saveLastPagosGerenciaExcelExportForRange,
} from '../lib/pagosGerenciaExcelLog'
import { motivoConsultaFromNotas } from '../lib/motivoConsulta'
import { parseMontoInput, PAYMENT_METODOS } from '../lib/paymentInput'
import type jsPDF from 'jspdf'
import type { Payment } from '../types'
import './pages.css'
import '../modules/pagos/pages/PagosModern.css'

type ResumenMedicoScope = 'dia' | 'mes' | 'anio'
type PdfMedicoFiltro = 'rango' | 'mes' | 'anio'
export type PdfTurnoFiltro = 'todos' | 'manana' | 'tarde' | 'noche'

const PDF_MEDICO_TODOS = '__todos__'

export function PagosPage() {
  const { role, session } = useAuth()
  const puedeExportDetalle = canExportPagosDetallePacientes(role)
  const muestraResumenPdf = puedeExportDetalle
  const puedeVerPorcentaje = canViewDoctorPorcentaje(role)
  const puedeVerPendientes = canViewPagosPendientes(role)

  const [tabListado, setTabListado] = useState<'medicos' | 'obrasSociales'>('medicos')

  const {
    data,
    upsertPayment,
    deletePayment,
    archivePagoCancelado,
    patientById,
    doctorById,
  } = useAppState()
  const { confirm } = useConfirm()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingId2, setEditingId2] = useState<string | null>(null)
  const [pendientesOpen, setPendientesOpen] = useState(false)
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

  const [excelDesdeRef, setExcelDesdeRef] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [excelHastaRef, setExcelHastaRef] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null)
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfMedicoFiltro, setPdfMedicoFiltro] = useState<PdfMedicoFiltro>('rango')
  const [pdfObraSocial, setPdfObraSocial] = useState<string>('')
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

  const obrasSocialesDisponibles = useMemo(() => {
    const s = new Set<string>()
    for (const p of data.patients) {
      if (p.obraSocial && p.obraSocial.trim()) {
        s.add(p.obraSocial.trim())
      }
    }
    return Array.from(s).sort()
  }, [data.patients])

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
    return data.payments.filter((p) => {
      if (pdfMedicoId !== PDF_MEDICO_TODOS && p.doctorId !== pdfMedicoId) {
        return false
      }
      if (pdfObraSocial) {
        const pac = patientById(p.patientId)
        if (!pac || pac.obraSocial?.trim() !== pdfObraSocial) {
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
  }, [data.payments, bounds, pdfMedicoId, pdfObraSocial, pdfTurnoFiltro, patientById])

  const pagosPrevPeriodo = useMemo(() => {
    return data.payments.filter((p) => {
      if (pdfMedicoId !== PDF_MEDICO_TODOS && p.doctorId !== pdfMedicoId) {
        return false
      }
      if (pdfObraSocial) {
        const pac = patientById(p.patientId)
        if (!pac || pac.obraSocial?.trim() !== pdfObraSocial) {
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
  }, [data.payments, prevPeriodBounds, pdfMedicoId, pdfObraSocial, pdfTurnoFiltro, patientById])

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
  const totalPeriodoTransferencias = useMemo(
    () =>
      pagosEnPeriodo.reduce(
        (s, p) =>
          s + (p.metodo.trim().toLowerCase() === 'transferencia' ? p.monto : 0),
        0,
      ),
    [pagosEnPeriodo],
  )

  const totalPrevPeriodoTransferencias = useMemo(
    () =>
      pagosPrevPeriodo.reduce(
        (s, p) =>
          s + (p.metodo.trim().toLowerCase() === 'transferencia' ? p.monto : 0),
        0,
      ),
    [pagosPrevPeriodo],
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

  const motivosConsultaPeriodo = useMemo(() => {
    const counts = new Map<string, number>()
    for (const appt of data.appointments) {
      if (appt.estado === 'cancelado') continue
      const t = parseISO(appt.fechaHora)
      if (isNaN(t.getTime())) continue
      if (!isWithinInterval(t, { start: bounds.start, end: bounds.end })) continue
      const mot = motivoConsultaFromNotas(appt.notas ?? '', data.motivosConsultaCustom ?? []).motivo
      counts.set(mot, (counts.get(mot) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([nombre, cantidad]) => ({ nombre, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'))
  }, [data.appointments, data.motivosConsultaCustom, bounds])

  const totalMotivosPeriodo = useMemo(
    () => motivosConsultaPeriodo.reduce((s, m) => s + m.cantidad, 0),
    [motivosConsultaPeriodo],
  )

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
      const day = now.getDay()
      const diffToMon = (day === 0 ? -6 : 1) - day
      const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon)
      const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)
      setExcelDesdeRef(format(mon, 'yyyy-MM-dd'))
      setExcelHastaRef(format(sun, 'yyyy-MM-dd'))
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
        if (pdfObraSocial) {
          const pac = patientById(r.payment.patientId)
          if (!pac || pac.obraSocial?.trim() !== pdfObraSocial) {
            return false
          }
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
        periodLabel: bounds.label,
        userLabel: isTodosTurnos ? '' : userShift,
        shiftLabel: shiftText,
        exportUserDisplayName: exportUser,
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

  const puede =
    pacientesActivos(data.patients).length > 0 &&
    medicosActivos(data.doctors).length > 0

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
                  <label htmlFor="pagos-desde-input-leg">Desde</label>
                  <input
                    id="pagos-desde-input-leg"
                    type="date"
                    value={excelDesdeRef}
                    onChange={(e) => {
                      setExcelDesdeRef(e.target.value)
                      setPdfMedicoFiltro('rango')
                    }}
                  />
                </div>
                <div className="pagos-date-popover__field">
                  <label htmlFor="pagos-hasta-input-leg">Hasta</label>
                  <input
                    id="pagos-hasta-input-leg"
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

      {/* 3 Metric Cards */}
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

        {/* Card 4: Total Cuidar */}
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

        {/* Card 5: Total Transferencias */}
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
            <span className="pagos-metric-value">{formatMonto(totalEntregadoMedico)}</span>
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

        {/* Card 5: Gráfico de Motivos de Consulta */}
        <div className="pagos-metric-card pagos-metric-card--chart">
          <div className="pagos-chart-header">
            <span className="pagos-chart-title">Motivos Consulta</span>
            <span className="pagos-chart-legend-count">
              {totalMotivosPeriodo} turno{totalMotivosPeriodo === 1 ? '' : 's'}
            </span>
          </div>
          {motivosConsultaPeriodo.length === 0 ? (
            <div className="pagos-chart-empty">Sin turnos en el período</div>
          ) : (
            (() => {
              const topMotivos = motivosConsultaPeriodo.slice(0, 3)
              const maxCount = Math.max(...topMotivos.map((m) => m.cantidad), 1)
              const colors = ['#6366f1', '#0d9488', '#ec4899']
              const chartH = 26
              const count = topMotivos.length
              const barW = 26
              const gap = 20
              const totalW = count * barW + (count - 1) * gap
              const startX = Math.max(10, Math.floor((160 - totalW) / 2))

              return (
                <svg
                  className="pagos-chart-svg"
                  viewBox="0 0 160 40"
                  role="img"
                  aria-label="Gráfico de motivos de consulta"
                >
                  <line x1="0" y1="30" x2="160" y2="30" stroke="#e2e8f0" strokeWidth="1" />
                  {topMotivos.map((m, i) => {
                    const h = Math.max(m.cantidad > 0 ? 3 : 0, (m.cantidad / maxCount) * chartH)
                    const x = startX + i * (barW + gap)
                    const color = colors[i % colors.length]
                    const labelShort =
                      m.nombre.length > 6 ? `${m.nombre.slice(0, 5)}.` : m.nombre
                    return (
                      <g key={m.nombre}>
                        <title>{`${m.nombre}: ${m.cantidad} turno${m.cantidad === 1 ? '' : 's'} (${totalMotivosPeriodo > 0 ? Math.round((m.cantidad / totalMotivosPeriodo) * 100) : 0}%)`}</title>
                        <rect
                          x={x}
                          y={30 - h}
                          width={barW}
                          height={h}
                          fill={color}
                          rx="3"
                        />
                        <text
                          x={x + barW / 2}
                          y={28 - h > 7 ? 28 - h : 7}
                          textAnchor="middle"
                          fontSize="6.5"
                          fill="#475569"
                          fontWeight="700"
                        >
                          {m.cantidad}
                        </text>
                        <text
                          x={x + barW / 2}
                          y="38"
                          textAnchor="middle"
                          fontSize="7"
                          fill="#64748b"
                          fontWeight="600"
                        >
                          {labelShort}
                        </text>
                      </g>
                    )
                  })}
                </svg>
              )
            })()
          )}
        </div>
      </section>

      {/* Filters Bar */}
      <section className="pagos-filters-card">
        {/* Médico filter */}
        <div className="pagos-filter-group">
          <label htmlFor="pagos-filter-doc-leg">Médico</label>
          <div className="pagos-filter-select-wrap">
            <span className="pagos-filter-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <select
              id="pagos-filter-doc-leg"
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

        {/* Obra Social filter */}
        <div className="pagos-filter-group">
          <label htmlFor="pagos-filter-os-leg">Obra Social</label>
          <div className="pagos-filter-select-wrap">
            <span className="pagos-filter-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <select
              id="pagos-filter-os-leg"
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

        {/* Turno filter */}
        <div className="pagos-filter-group">
          <label htmlFor="pagos-filter-turno-leg">Turno</label>
          <div className="pagos-filter-select-wrap">
            <span className="pagos-filter-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </span>
            <select
              id="pagos-filter-turno-leg"
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

        {/* Filter & Quick Actions */}
        <div className="pagos-filter-actions">
          {role === 'admin' ? (
            <button
              type="button"
              className="pagos-btn-history"
              onClick={() => setLogOpen(true)}
              title="Registro e historial de exportaciones a gerencia"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Historial de Exportación</span>
            </button>
          ) : (
            <button
              type="button"
              className="pagos-btn-export"
              onClick={() => void handleExportGerenciaExcel()}
              title="Exportar archivo Excel a Gerencia"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Exportar a Gerencia</span>
            </button>
          )}

          <button
            type="button"
            className="pagos-btn-action pagos-btn-action--primary"
            onClick={toggleRegistrarPagoSecretaria}
            title={registrarPagoOpen ? 'Ocultar formulario de pago' : 'Registrar nuevo pago'}
          >
            + Pago
          </button>

          {puedeVerPendientes && (
            <button
              type="button"
              className={`pagos-btn-action ${pendientesRows.length > 0 ? 'pagos-btn-action--warning' : 'pagos-btn-action--secondary'}`}
              onClick={() => setPendientesOpen(true)}
              title={`Pacientes atendidos sin pago — ${bounds.label}`}
            >
              <span>Pendientes ({pendientesRows.length})</span>
            </button>
          )}
        </div>
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
                  <label htmlFor="pay-pac-leg">Paciente *</label>
                  <select
                    id="pay-pac-leg"
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
                  <label htmlFor="pay-doc-leg">Médico *</label>
                  <select
                    id="pay-doc-leg"
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
                  <label htmlFor="pay-cita-leg">Turno (opcional)</label>
                  <select
                    id="pay-cita-leg"
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
                  <label htmlFor="pay-fecha-leg">Fecha y hora *</label>
                  <input
                    id="pay-fecha-leg"
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
                  <label htmlFor="pay-monto-leg">Monto *</label>
                  <input
                    id="pay-monto-leg"
                    inputMode="decimal"
                    placeholder="$ 0"
                    value={form.monto}
                    onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                    required
                  />
                </div>

                <div className="pagos-form-field" style={{ flex: '1.05', minWidth: '110px' }}>
                  <label htmlFor="pay-met-leg">Forma de Pago</label>
                  <select
                    id="pay-met-leg"
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
                  <label htmlFor="pay-monto-2-leg">Monto (2)</label>
                  <input
                    id="pay-monto-2-leg"
                    inputMode="decimal"
                    placeholder="$ 0"
                    value={form.monto2}
                    onChange={(e) => setForm((f) => ({ ...f, monto2: e.target.value }))}
                  />
                </div>

                <div className="pagos-form-field" style={{ flex: '1.05', minWidth: '110px' }}>
                  <label htmlFor="pay-met-2-leg">Forma (2)</label>
                  <select
                    id="pay-met-2-leg"
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
                  <label htmlFor="pay-notas-leg">Notas (opcional)</label>
                  <input
                    id="pay-notas-leg"
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
          onClick={() => setTabListado('medicos')}
          title="Ver listado de pagos a médicos"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
          </svg>
          <span>Pagos a Médicos</span>
        </button>
        {role === 'admin' && (
          <button
            type="button"
            className={`pagos-btn-subnav ${tabListado === 'obrasSociales' ? 'pagos-btn-subnav--active' : ''}`}
            onClick={() => setTabListado('obrasSociales')}
            title="Ver listado por obras sociales"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
            <span>Obras Sociales</span>
          </button>
        )}
      </div>

      {/* "LISTADO DE PAGOS" Table */}
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

        <div className="pagos-table-wrap">
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
                    <th>Obra Social</th>
                    <th>Porcentaje</th>
                    <th>Forma Pago</th>
                    <th className="text-right">Total Facturado</th>
                    <th className="text-right">Total Médico</th>
                    <th className="text-right">% Cuidar</th>
                    <th>Registrado Por</th>
                    {mostrarAcciones && <th className="text-right">Acciones</th>}
                  </tr>
                ) : (
                  <tr>
                    <th>Fecha</th>
                    <th>Turno</th>
                    <th>Paciente</th>
                    <th>Médico</th>
                    <th>Obra Social</th>
                    <th className="text-right">Total OS</th>
                    <th className="text-right">Total Cuidar</th>
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
                  const cuidarPctLabel = formatMonto(montoCuidar)

                  const usuarioRegistrado = resolveUserRealName(
                    p.registradoPor ||
                      getUserDisplayNameForShift(turnoLabel, getCurrentUserDisplayName()),
                    turnoLabel,
                  )
                  const usuarioModificado = p.modificadoPor
                    ? resolveUserRealName(p.modificadoPor, turnoLabel)
                    : null

                  if (tabListado === 'obrasSociales') {
                    return (
                      <tr key={p.id}>
                        <td>
                          {format(parseISO(p.fecha), 'd MMM yyyy HH:mm', { locale: es })}
                        </td>
                        <td>{turnoLabel}</td>
                        <td className="pagos-table-paciente-name">{pacienteLabel}</td>
                        <td>{doc ? `${doc.apellido}, ${doc.nombre}` : '—'}</td>
                        <td>{pac?.obraSocial?.trim() || 'Particular'}</td>
                        <td className="text-right" style={{ color: '#94a3b8' }}>—</td>
                        <td className="text-right" style={{ color: '#94a3b8' }}>—</td>
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
                      <td>{pac?.obraSocial?.trim() || 'Particular'}</td>
                      <td>{pct}%</td>
                      <td>{p.metodo || '—'}</td>
                      <td className="text-right" style={{ fontWeight: 600 }}>
                        {formatMonto(p.monto)}
                      </td>
                      <td className="text-right">{formatMonto(s.totalGeneral || 0)}</td>
                      <td className="text-right">{cuidarPctLabel}</td>
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
                    <td colSpan={7}>TOTALES ({pagosListado.length} pagos)</td>
                    <td className="text-right" style={{ color: '#0284c7' }}>
                      {formatMonto(totalPeriodo)}
                    </td>
                    <td className="text-right">{formatMonto(totalPeriodoMedico)}</td>
                    <td className="text-right">{formatMonto(totalPeriodoCuidar)}</td>
                    <td colSpan={mostrarAcciones ? 2 : 1}></td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={5}>TOTALES ({pagosListado.length} pagos)</td>
                    <td className="text-right" style={{ color: '#94a3b8' }}>—</td>
                    <td className="text-right" style={{ color: '#94a3b8' }}>—</td>
                    {mostrarAcciones && <td></td>}
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      </section>

      {/* Modals */}
      {pendientesOpen && (
        <PendientesPagosModal
          title={`Pendientes — ${bounds.label}`}
          rows={pendientesRows}
          onClose={() => setPendientesOpen(false)}
        />
      )}

      {pdfPreview && (
        <PdfPreviewModal
          title={pdfPreview.title}
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          onClose={() => {
            if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
            setPdfPreview(null)
          }}
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
    </div>
  )
}
