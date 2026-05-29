import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { EliminarPagoModal } from '../components/EliminarPagoModal'
import { IconActionButton, IconEdit, IconTrash } from '../components/icons'
import { PendientesPagosModal } from '../components/PendientesPagosModal'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
import { useConfirm } from '../context/ConfirmContext'
import { format, isWithinInterval, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAuth } from '../context/AuthContext'
import { useAppState } from '../context/AppStateContext'
import { canUsePagosPeriodFilters } from '../lib/auth'
import {
  buildMailtoUrl,
  isGmailAddress,
  isSmtpAuthError,
  normalizeGmailAppPassword,
  openAgendaEmailDraft,
  openMailtoUrl,
  sendAgendaEmailSmtp,
  validateGmailAppPassword,
} from '../lib/agendaEmail'
import {
  buildAllDoctorsPaymentsPdf,
  buildObraSocialDoctorsPaymentsPdf,
  buildDoctorPaymentsPdf,
  formatCobranzasDoctorHeaderTitle,
  formatCobranzasTodosMedicosHeaderTitle,
  buildGerenciaDoctorsPaymentsPdf,
  pdfBlobUrl,
  pdfToBase64,
  savePdfFile,
  type AllDoctorsPdfScope,
} from '../lib/doctorPaymentsPdf'
import { buildPagosEmailBodyWithPdf } from '../lib/pagosPdfExport'
import {
  buildPagosGerenciaWorkbook,
  gerenciaExcelFilename,
  savePagosGerenciaExcelFile,
} from '../lib/pagosGerenciaExcel'
import { formatMonto } from '../lib/formatMonto'
import { formatAppError, logAppError } from '../lib/persistAlert'
import { preloadPdfHeaderBanner } from '../lib/pdfHeaderBanner'
import { preloadPdfLogo } from '../lib/pdfLogo'
import {
  dateRangeBounds,
  periodBounds,
  type Periodo,
} from '../lib/periodBounds'
import type jsPDF from 'jspdf'
import type { Payment } from '../types'
import './pages.css'

type ResumenMedicoScope = 'dia' | 'mes' | 'anio'

const PDF_MEDICO_TODOS = '__todos__'

const PAYMENT_METODOS = [
  'Efectivo',
  'Tarjeta',
  'Transferencia',
  'Obra social',
  'Otro',
] as const

function parseMontoInput(value: string): number {
  const n = Number(String(value).replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

export function PagosPage() {
  const { role } = useAuth()
  const puedeFiltrarMesAnio = canUsePagosPeriodFilters(role)

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

  const [pdfMedicoId, setPdfMedicoId] = useState(PDF_MEDICO_TODOS)
  const [pdfMesRef, setPdfMesRef] = useState(() =>
    format(new Date(), 'yyyy-MM'),
  )
  const [pdfAnioRef, setPdfAnioRef] = useState(() =>
    format(new Date(), 'yyyy'),
  )

  const [excelDesdeRef, setExcelDesdeRef] = useState(() =>
    format(new Date(), 'yyyy-MM-dd'),
  )
  const [excelHastaRef, setExcelHastaRef] = useState(() =>
    format(new Date(), 'yyyy-MM-dd'),
  )
  const [pdfPreview, setPdfPreview] = useState<{
    url: string
    filename: string
    title: string
  } | null>(null)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null)
  const pdfDocRef = useRef<jsPDF | null>(null)
  const correoAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const CORREO_ANIM_MS = 5000

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
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [enviandoCorreo, setEnviandoCorreo] = useState(false)


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
  }

  const exportResumenBounds = useMemo(
    () => dateRangeBounds(excelDesdeRef, excelHastaRef),
    [excelDesdeRef, excelHastaRef],
  )

  const resumenPdfScope = useMemo((): ResumenMedicoScope => {
    return excelDesdeRef === excelHastaRef ? 'dia' : 'mes'
  }, [excelDesdeRef, excelHastaRef])

  const bounds = useMemo(() => {
    if (!puedeFiltrarMesAnio) {
      return exportResumenBounds
    }
    if (periodo === 'mes') {
      const [y, m] = pdfMesRef.split('-').map(Number)
      return periodBounds('mes', new Date(y, (m ?? 1) - 1, 1, 12, 0, 0))
    }
    const y = Number(pdfAnioRef)
    return periodBounds('anio', new Date(y, 0, 1, 12, 0, 0))
  }, [
    puedeFiltrarMesAnio,
    periodo,
    pdfMesRef,
    pdfAnioRef,
    exportResumenBounds,
  ])

  const pagosEnPeriodo = useMemo(() => {
    return data.payments.filter((p) => {
      const t = parseISO(p.fecha)
      return isWithinInterval(t, { start: bounds.start, end: bounds.end })
    })
  }, [data.payments, bounds])

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

    const out: { id: string; fechaHora: string; patientLabel: string; doctorLabel: string }[] =
      []
    for (const c of data.appointments) {
      if (c.estado === 'cancelado') continue
      const t = parseISO(c.fechaHora)
      if (!isWithinInterval(t, { start: bounds.start, end: bounds.end })) continue
      if (paidCitaIds.has(c.id)) continue
      const key = `${c.patientId}__${c.doctorId}__${format(t, 'yyyy-MM-dd')}`
      if (paidDayKeys.has(key)) {
        // Si el pago se registró sin vincular citaId, lo tomamos como pagado por día.
        continue
      }
      const p = patientById(c.patientId)
      const d = doctorById(c.doctorId)
      out.push({
        id: c.id,
        fechaHora: c.fechaHora,
        patientLabel: p ? `${p.apellido}, ${p.nombre}` : '—',
        doctorLabel: d ? `${d.apellido}, ${d.nombre}` : '—',
      })
    }
    return out.sort((a, b) => parseISO(b.fechaHora).getTime() - parseISO(a.fechaHora).getTime())
  }, [data.appointments, data.payments, bounds, patientById, doctorById])

  const listadoBounds = bounds

  const pagosListado = useMemo(() => {
    return data.payments
      .filter((p) => {
        const t = parseISO(p.fecha)
        return isWithinInterval(t, {
          start: listadoBounds.start,
          end: listadoBounds.end,
        })
      })
      .sort((a, b) => parseISO(b.fecha).getTime() - parseISO(a.fecha).getTime())
  }, [data.payments, listadoBounds])

  const totalPeriodo = useMemo(
    () => pagosEnPeriodo.reduce((s, p) => s + p.monto, 0),
    [pagosEnPeriodo],
  )

  const porMedico = useMemo(() => {
    const map = new Map<string, number>()
    const obraSocialByDoctor = new Map<string, Set<string>>()
    for (const p of pagosEnPeriodo) {
      map.set(p.doctorId, (map.get(p.doctorId) ?? 0) + p.monto)
      const os = patientById(p.patientId)?.obraSocial?.trim()
      if (os) {
        const set = obraSocialByDoctor.get(p.doctorId) ?? new Set<string>()
        set.add(os)
        obraSocialByDoctor.set(p.doctorId, set)
      }
    }
    return [...map.entries()]
      .map(([doctorId, monto]) => ({
        doctorId,
        monto,
        obraSocial:
          (obraSocialByDoctor.get(doctorId)?.size ?? 0) === 0
            ? '—'
            : (obraSocialByDoctor.get(doctorId)?.size ?? 0) === 1
              ? [...obraSocialByDoctor.get(doctorId)!][0]
              : 'Varias',
        nombre: doctorById(doctorId)
          ? `${doctorById(doctorId)!.apellido}, ${doctorById(doctorId)!.nombre}`
          : '—',
      }))
      .sort((a, b) => b.monto - a.monto)
  }, [pagosEnPeriodo, doctorById, patientById])

  const porMedicoColumnas = useMemo(() => {
    const cols = puedeFiltrarMesAnio ? 2 : 3
    if (porMedico.length === 0) return [] as typeof porMedico[]
    if (porMedico.length <= 1) return [porMedico]
    const chunk = Math.ceil(porMedico.length / cols)
    return Array.from({ length: cols }, (_, i) =>
      porMedico.slice(i * chunk, (i + 1) * chunk),
    )
  }, [porMedico, puedeFiltrarMesAnio])

  const porMedicoColumnasSecretaria = useMemo(() => {
    const cols = 3
    const out = Array.from({ length: cols }, () => [] as typeof porMedico)
    for (let i = 0; i < porMedico.length; i++) {
      out[i % cols]!.push(porMedico[i]!)
    }
    return out
  }, [porMedico])

  const hoyBounds = useMemo(() => periodBounds('dia', new Date()), [])

  const pagosHoy = useMemo(() => {
    return data.payments.filter((p) => {
      const t = parseISO(p.fecha)
      return isWithinInterval(t, {
        start: hoyBounds.start,
        end: hoyBounds.end,
      })
    })
  }, [data.payments, hoyBounds])

  const totalHoy = useMemo(
    () => pagosHoy.reduce((s, p) => s + p.monto, 0),
    [pagosHoy],
  )

  const mesActualBounds = useMemo(() => periodBounds('mes', new Date()), [])

  const pagosMesActual = useMemo(() => {
    return data.payments.filter((p) => {
      const t = parseISO(p.fecha)
      return isWithinInterval(t, {
        start: mesActualBounds.start,
        end: mesActualBounds.end,
      })
    })
  }, [data.payments, mesActualBounds])

  const totalMesActual = useMemo(
    () => pagosMesActual.reduce((s, p) => s + p.monto, 0),
    [pagosMesActual],
  )

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
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const m = parseMontoInput(form.monto)
    const m2 = parseMontoInput(form.monto2)
    if (!form.patientId || !form.doctorId || !form.fechaLocal) {
      return
    }
    if (m <= 0 && m2 <= 0) {
      return
    }
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

  const puede = data.patients.length > 0 && data.doctors.length > 0

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
    return data.payments
      .filter((p) => {
        if (pdfMedicoId !== PDF_MEDICO_TODOS && p.doctorId !== pdfMedicoId) {
          return false
        }
        const t = parseISO(p.fecha)
        return isWithinInterval(t, {
          start: exportResumenBounds.start,
          end: exportResumenBounds.end,
        })
      })
      .map((p) => {
        const citaId = p.citaId ?? null
        const hc =
          citaId != null ? historiaClinicaByCitaId.get(citaId) ?? '' : ''
        if (!hc) return p
        // Para PDF: preferir Historia Clínica del turno (Agenda) sobre notas del pago.
        return { ...p, notas: hc }
      })
  }, [data.payments, pdfMedicoId, exportResumenBounds, historiaClinicaByCitaId])

  useEffect(() => {
    return () => {
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    }
  }, [pdfPreview?.url])

  useEffect(() => {
    return () => {
      if (correoAnimTimerRef.current) {
        clearTimeout(correoAnimTimerRef.current)
      }
    }
  }, [])

  function closePdfPreview() {
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview(null)
    pdfDocRef.current = null
  }

  function buildPdfForDoctor(
    doctorId: string,
    payments: Payment[],
    periodLabel: string,
    scope: AllDoctorsPdfScope,
    fileStamp?: string,
  ) {
    const doctor = doctorById(doctorId)
    if (!doctor) return null
    return buildDoctorPaymentsPdf({
      doctor,
      periodLabel,
      payments,
      patientLabel: patientLabelForPdf,
      obraSocialLabel: obraSocialLabelForPdf,
      scope,
      fileStamp,
    })
  }

  function resumenExportFileStamp(): string {
    const desdeKey = excelDesdeRef.replace(/-/g, '')
    const hastaKey = excelHastaRef.replace(/-/g, '')
    return desdeKey && hastaKey ? `${desdeKey}-${hastaKey}` : ''
  }

  function medicoPdfLabel(medicoId: string): string {
    if (medicoId === PDF_MEDICO_TODOS) return 'Todos los médicos'
    const d = doctorById(medicoId)
    return d ? `${d.apellido}, ${d.nombre}` : '—'
  }

  function doctorFileSlug(doctorId: string): string | undefined {
    const d = doctorById(doctorId)
    if (!d) return undefined
    return `${d.apellido}-${d.nombre}`
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
  }

  function gerenciaPdfScopeOpts(scope: AllDoctorsPdfScope) {
    if (scope === 'dia') {
      return {
        dateColumnHeader: 'Hora',
        emptyMessage: 'No hay pagos registrados en este día.',
      }
    }
    return {
      dateColumnHeader: 'Fecha',
      emptyMessage: 'No hay pagos registrados en el período.',
    }
  }

  function buildPagosGerenciaPdf(): {
    doc: jsPDF
    filename: string
    title: string
  } | null {
    if (!pdfMedicoId) return null
    const fileStamp = resumenExportFileStamp()
    const periodLabel = exportResumenBounds.label
    const medicoLabel = medicoPdfLabel(pdfMedicoId)
    const periodMetaExtra = [`Médico: ${medicoLabel}`]
    const doctor = doctorById(pdfMedicoId)
    if (doctor?.especialidad) {
      periodMetaExtra.push(doctor.especialidad)
    }
    const built = buildGerenciaDoctorsPaymentsPdf({
      periodLabel,
      payments: pagosPdfMedico,
      doctorLabel: doctorLabelForPdf,
      obraSocialLabel: obraSocialLabelForPdf,
      scope: resumenPdfScope,
      fileStamp,
      withDoctorChart: pdfMedicoId === PDF_MEDICO_TODOS,
      periodMetaExtra,
      filenameSuffix:
        pdfMedicoId === PDF_MEDICO_TODOS
          ? 'todos'
          : doctorFileSlug(pdfMedicoId),
      ...gerenciaPdfScopeOpts(resumenPdfScope),
    })
    return {
      doc: built.doc,
      filename: built.filename,
      title: `Resumen Gerencia — ${medicoLabel} — ${periodLabel}`,
    }
  }

  async function handleGerenciaExcelExport() {
    if (!pdfMedicoId) return
    try {
      const { start, end } = exportResumenBounds
      const pagosExcel = data.payments.filter((p) => {
        if (pdfMedicoId !== PDF_MEDICO_TODOS && p.doctorId !== pdfMedicoId) {
          return false
        }
        const when = parseISO(p.fecha)
        return isWithinInterval(when, { start, end })
      })
      const wb = buildPagosGerenciaWorkbook({
        payments: pagosExcel,
        patientById,
        doctorById,
        appointmentById: (id) => data.appointments.find((a) => a.id === id),
      })
      const suffix =
        pdfMedicoId === PDF_MEDICO_TODOS
          ? 'todos'
          : (doctorFileSlug(pdfMedicoId) ?? 'medico')
      const desdeKey = excelDesdeRef.replace(/-/g, '')
      const hastaKey = excelHastaRef.replace(/-/g, '')
      const periodKey = desdeKey && hastaKey ? `${desdeKey}-${hastaKey}` : ''
      const filename = periodKey
        ? `${periodKey}_Pagos.xlsx`
        : gerenciaExcelFilename(format(new Date(), 'yyyyMMdd'), suffix)
      await savePagosGerenciaExcelFile(wb, filename)
    } catch (err) {
      console.error(err)
      void confirm({
        message: 'No se pudo exportar el Excel de Gerencia. Probá de nuevo.',
      })
    }
  }

  function allDoctorsPdfScopeOpts(scope: AllDoctorsPdfScope) {
    if (scope === 'dia') {
      return {
        dateFormat: 'HH:mm',
        dateColumnHeader: 'Hora',
        emptyMessage: 'No hay pagos registrados en este día.',
        totalLabel: 'Total del día',
        filenamePrefix: 'cobranzas-todos-dia',
        withDoctorChart: true,
      }
    }
    return {
      dateFormat: 'd MMM yyyy HH:mm',
      dateColumnHeader: 'Fecha',
      emptyMessage: 'No hay pagos registrados en el período.',
      totalLabel: 'Total del período',
      filenamePrefix: 'cobranzas-todos-rango',
      withDoctorChart: true,
    }
  }

  function buildPagosResumenMedicoPdf(): {
    doc: jsPDF
    filename: string
    title: string
  } | null {
    if (!pdfMedicoId) return null
    const fileStamp = resumenExportFileStamp()
    const periodLabel = exportResumenBounds.label

    if (pdfMedicoId === PDF_MEDICO_TODOS) {
      const built = buildAllDoctorsPaymentsPdf({
        periodLabel,
        payments: pagosPdfMedico,
        patientLabel: patientLabelForPdf,
        obraSocialLabel: obraSocialLabelForPdf,
        doctorLabel: doctorLabelForPdf,
        doctorPorcentaje: (id) => doctorById(id)?.porcentaje,
        doctorEspecialidad: (id) => doctorById(id)?.especialidad,
        scope: resumenPdfScope,
        fileStamp,
        headerTitle: formatCobranzasTodosMedicosHeaderTitle(
          resumenPdfScope,
          periodLabel,
        ),
        ...allDoctorsPdfScopeOpts(resumenPdfScope),
      })
      return {
        doc: built.doc,
        filename: built.filename,
        title: formatCobranzasTodosMedicosHeaderTitle(
          resumenPdfScope,
          periodLabel,
        ),
      }
    }

    const built = buildPdfForDoctor(
      pdfMedicoId,
      pagosPdfMedico,
      periodLabel,
      resumenPdfScope,
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
        resumenPdfScope,
        periodLabel,
      ),
    }
  }

  function buildPagosResumenObraSocialPdf(): {
    doc: jsPDF
    filename: string
    title: string
  } | null {
    if (!pdfMedicoId) return null
    const fileStamp = resumenExportFileStamp()
    const periodLabel = exportResumenBounds.label

    const built = buildObraSocialDoctorsPaymentsPdf({
      periodLabel,
      payments: pagosPdfMedico,
      patientLabel: patientLabelForPdf,
      obraSocialLabel: obraSocialLabelForPdf,
      doctorLabel: doctorLabelForPdf,
      doctorPorcentaje: (id) => doctorById(id)?.porcentaje,
      doctorEspecialidad: (id) => doctorById(id)?.especialidad,
      scope: resumenPdfScope,
      fileStamp,
      dateColumnHeader: resumenPdfScope === 'dia' ? 'Hora' : 'Fecha',
    })

    return {
      doc: built.doc,
      filename: built.filename,
      title: `Cobranzas - Obra Social - ${periodLabel}`,
    }
  }

  async function handleResumenMedicoPdfPreview() {
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

  async function handleResumenObraSocialPdfPreview() {
    if (!pdfMedicoId) return
    try {
      await Promise.all([preloadPdfLogo(), preloadPdfHeaderBanner()])
      const built = buildPagosResumenObraSocialPdf()
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
        message: 'No se pudo generar el PDF por Obra Social. Probá de nuevo.',
      })
    }
  }

  function setPeriodoVentana(p: Periodo) {
    if (!puedeFiltrarMesAnio || p === 'dia') return
    setPeriodo(p)
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

  async function handleEnviarCorreoPagos() {
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
    if (!pdfMedicoId) {
      void confirm({
        message: 'Seleccioná un médico (o Todos) antes de enviar el correo.',
      })
      return
    }

    const medicoLabel = medicoPdfLabel(pdfMedicoId)
    const totalGerencia = pagosPdfMedico.reduce((s, p) => s + p.monto, 0)

    startCorreoAnim()
    try {
      await preloadPdfHeaderBanner()
      let pdfBuilt
      try {
        pdfBuilt = buildPagosGerenciaPdf()
      } catch (err) {
        console.error(err)
        stopCorreoAnimNow()
        void confirm({
          message: 'No se pudo generar el PDF para el correo. Probá de nuevo.',
        })
        return
      }
      if (!pdfBuilt) {
        stopCorreoAnimNow()
        void confirm({
          message: 'No se pudo generar el PDF para el correo. Probá de nuevo.',
        })
        return
      }

      const subject = `Pagos de consultas — Resumen Gerencia — ${exportResumenBounds.label} — ${medicoLabel}`
      const body = buildPagosEmailBodyWithPdf({
        periodo: resumenPdfScope,
        periodLabel: exportResumenBounds.label,
        pdfFilename: pdfBuilt.filename,
        totalCobrado: formatMonto(totalGerencia),
        cantidadPagos: pagosPdfMedico.length,
        gerencia: true,
        filtroMedicoLabel: medicoLabel,
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
              message: `No se pudo enviar automáticamente.\n\nSe abrió un borrador en su programa de correo (desde ${origen} hacia ${to}). Revisalo y pulsá Enviar.\n\nPara envío automático con Gmail: contraseña de aplicación de 16 caracteres en Configuración → Clave.`,
            })
            return
          } catch (draftErr) {
            console.error(draftErr)
          }
        }
        void confirm({ message: text })
      }
    } catch (err) {
      logAppError('Envío correo pagos', err)
      stopCorreoAnimNow()
      void confirm({
        message: formatAppError(
          err,
          'No se pudo enviar el correo. Probá de nuevo.',
        ),
      })
    }
  }

  return (
    <div
      className={`page page--pagos${puedeFiltrarMesAnio ? ' page--pagos-admi' : ' page--pagos-secretaria'}`}
    >
      <header className="page-header">
        <h1>Pagos de consultas</h1>
      </header>

      <section className="panel panel--resumen">
        <div className="resumen-header">
          <h2>Resumen</h2>
        </div>
        <div className="resumen-pdf-pills resumen-pdf-pills--line">
          {!puedeFiltrarMesAnio && (
            <div className="pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--filter resumen-pdf-pill--medico">
              <span className="resumen-pdf-pill__scope resumen-pdf-pill__scope--static">
                Médico
              </span>
              <div className="field field--pill pdf-export-pill__field">
                <div className="pill-select">
                  <select
                    id="pdf-doc"
                    aria-label="Médico"
                    value={pdfMedicoId}
                    onChange={(e) => setPdfMedicoId(e.target.value)}
                    disabled={data.doctors.length === 0}
                  >
                    <option value="">— Seleccionar —</option>
                    <option value={PDF_MEDICO_TODOS}>Todos</option>
                    {data.doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.apellido}, {d.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
          <div className="pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--filter">
            <span className="resumen-pdf-pill__scope resumen-pdf-pill__scope--static">
              Resumen por Médico
            </span>
            <div className="field field--pill pdf-export-pill__field">
              <button
                type="button"
                className="btn btn-pdf btn-pdf--mini"
                disabled={!pdfMedicoId}
                title={`Detalle con pacientes — ${exportResumenBounds.label} (médico seleccionado)`}
                onClick={handleResumenMedicoPdfPreview}
              >
                PDF
              </button>
            </div>
          </div>
          <div className="pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--filter">
            <span className="resumen-pdf-pill__scope resumen-pdf-pill__scope--static">
              Desde
            </span>
            <div className="field field--pill pdf-export-pill__field field--pdf-fecha">
              <input
                id="excel-desde"
                type="date"
                aria-label="Desde"
                value={excelDesdeRef}
                onChange={(e) => setExcelDesdeRef(e.target.value)}
              />
            </div>
          </div>
          <div className="pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--filter">
            <span className="resumen-pdf-pill__scope resumen-pdf-pill__scope--static">
              Hasta
            </span>
            <div className="field field--pill pdf-export-pill__field field--pdf-fecha">
              <input
                id="excel-hasta"
                type="date"
                aria-label="Hasta"
                value={excelHastaRef}
                onChange={(e) => setExcelHastaRef(e.target.value)}
              />
            </div>
          </div>
          {puedeFiltrarMesAnio && (
            <div
              className={`pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--filter${periodo === 'mes' ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="resumen-pdf-pill__scope"
                onClick={() => setPeriodoVentana('mes')}
              >
                Por Mes
              </button>
              <div className="field field--pill pdf-export-pill__field field--pdf-mes">
                <input
                  id="pdf-mes"
                  type="month"
                  aria-label="Mes"
                  value={pdfMesRef}
                  onChange={(e) => {
                    setPdfMesRef(e.target.value)
                    setPeriodoVentana('mes')
                  }}
                  onFocus={() => setPeriodoVentana('mes')}
                />
              </div>
            </div>
          )}
          {puedeFiltrarMesAnio && (
            <div
              className={`pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--filter${periodo === 'anio' ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="resumen-pdf-pill__scope"
                onClick={() => setPeriodoVentana('anio')}
              >
                Por Año
              </button>
              <div className="field field--pill pdf-export-pill__field field--pdf-anio">
                <input
                  id="pdf-anio"
                  type="number"
                  aria-label="Año"
                  min={2000}
                  max={2100}
                  value={pdfAnioRef}
                  onChange={(e) => {
                    setPdfAnioRef(e.target.value)
                    setPeriodoVentana('anio')
                  }}
                  onFocus={() => setPeriodoVentana('anio')}
                />
              </div>
            </div>
          )}
          {puedeFiltrarMesAnio && (
            <div className="pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--filter resumen-pdf-pill--medico">
              <span className="resumen-pdf-pill__scope resumen-pdf-pill__scope--static">
                Médico
              </span>
              <div className="field field--pill pdf-export-pill__field">
                <div className="pill-select">
                  <select
                    id="pdf-doc"
                    aria-label="Médico"
                    value={pdfMedicoId}
                    onChange={(e) => setPdfMedicoId(e.target.value)}
                    disabled={data.doctors.length === 0}
                  >
                    <option value="">— Seleccionar —</option>
                    <option value={PDF_MEDICO_TODOS}>Todos</option>
                    {data.doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.apellido}, {d.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
          <div className="pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--export">
            <span className="resumen-pdf-pill__scope resumen-pdf-pill__scope--static">
              Exportar
            </span>
            <div className="resumen-pdf-pill__actions-row">
              <button
                type="button"
                className={`btn btn-email btn-email--compact${enviandoCorreo ? ' btn-email--sending' : ''}`}
                disabled={enviandoCorreo || !pdfMedicoId}
                aria-busy={enviandoCorreo}
                onClick={() => void handleEnviarCorreoPagos()}
              >
                {enviandoCorreo ? (
                  <>
                    <span className="btn-email__spinner" aria-hidden />
                    <span className="btn-email__label btn-email__label--sending">
                      Enviando…
                    </span>
                  </>
                ) : (
                  <>
                    <span className="btn-email__icon" aria-hidden>
                      @
                    </span>
                    <span className="btn-email__label">Correo</span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-pdf"
                disabled={!pdfMedicoId}
                title={`PDF organizado por Obra Social y Médico — ${exportResumenBounds.label}`}
                onClick={handleResumenObraSocialPdfPreview}
              >
                <span className="btn-pdf__icon" aria-hidden>
                  PDF
                </span>
                Obra Social
              </button>
              <button
                type="button"
                className="btn btn-excel btn-excel--gerencia"
                disabled={!pdfMedicoId}
                title={`Excel crudo (todos los datos) — ${exportResumenBounds.label} y médico seleccionado`}
                onClick={() => void handleGerenciaExcelExport()}
              >
                <span className="btn-excel__icon" aria-hidden>
                  XLS
                </span>
                Gerencia
              </button>
            </div>
          </div>
          <div className="pdf-export-pill resumen-pdf-pill resumen-pdf-pill--inline resumen-pdf-pill--pendientes">
            <span className="resumen-pdf-pill__scope resumen-pdf-pill__scope--static">
              Pendientes
            </span>
            <div className="resumen-pdf-pill__actions-row">
              <button
                type="button"
                className="btn btn-pendientes"
                onClick={() => setPendientesOpen(true)}
                title={`Pacientes atendidos sin pago — ${bounds.label}`}
              >
                Ver ({pendientesRows.length})
              </button>
            </div>
          </div>
        </div>
        <div className="resumen-ventana-row">
          <p className="resumen-ventana">
            Ventana: <strong>{bounds.label}</strong>
          </p>
          {!puedeFiltrarMesAnio && (
            <p className="resumen-ventana">
              Cantidad de pagos: <strong>{pagosEnPeriodo.length}</strong>
            </p>
          )}
          {!puedeFiltrarMesAnio && (
            <p className="resumen-ventana resumen-ventana--total">
              Total cobrado:{' '}
              <strong>{formatMonto(totalPeriodo)}</strong>
            </p>
          )}
          {puedeFiltrarMesAnio && pdfMedicoId && (
            <p className="resumen-pdf-hint">
              Exportaciones (PDF, Excel, correo) usan{' '}
              <strong>{exportResumenBounds.label}</strong>
              {' y '}
              <strong>{medicoPdfLabel(pdfMedicoId)}</strong>
              {' — '}
              {pagosPdfMedico.length === 0
                ? 'sin cobranzas en ese período.'
                : `${pagosPdfMedico.length} pago${pagosPdfMedico.length === 1 ? '' : 's'} en el período (Gerencia sin pacientes; Vista previa con pacientes).`}
            </p>
          )}
        </div>

      {pendientesOpen && (
        <PendientesPagosModal
          title={`Pendientes — ${bounds.label}`}
          rows={pendientesRows}
          onClose={() => setPendientesOpen(false)}
        />
      )}
        <div className="summary-cards summary-cards--pagos-line">
          {puedeFiltrarMesAnio && (
            <div className="summary-card">
              <div className="label">Total cobrado</div>
              <div className="value">
                {formatMonto(totalPeriodo)}
              </div>
            </div>
          )}
          {puedeFiltrarMesAnio && (
            <div className="summary-card">
              <div className="label">Cantidad de pagos</div>
              <div className="value">{pagosEnPeriodo.length}</div>
            </div>
          )}
          {puedeFiltrarMesAnio && (
            <div className="summary-card summary-card--pagos-periodo">
              <div className="summary-card__headline">
                <span className="label">Pagos del Día</span>
                <span className="value">{pagosHoy.length}</span>
              </div>
              <p className="summary-card__sub">
                {formatMonto(totalHoy)}{' '}
                hoy
              </p>
            </div>
          )}
          {puedeFiltrarMesAnio && (
            <div className="summary-card summary-card--pagos-periodo">
              <div className="summary-card__headline">
                <span className="label">Pagos del Mes</span>
                <span className="value">{pagosMesActual.length}</span>
              </div>
              <p className="summary-card__sub">
                {formatMonto(totalMesActual)}{' '}
                mes actual
              </p>
            </div>
          )}
        </div>
        {puedeFiltrarMesAnio && porMedico.length > 0 && (
          <div
            className={`pagos-por-medico-grid${porMedico.length < 2 ? ' pagos-por-medico-grid--single' : ''}`}
          >
            {porMedicoColumnas.map((columna, colIdx) =>
              columna.length === 0 ? null : (
                <div
                  key={colIdx}
                  className="table-wrap table-wrap--scroll pagos-por-medico-col"
                >
                  <div className="table-list__scroll pagos-por-medico-col__scroll">
                    <table className="data data--pagos-medico">
                      <thead>
                        <tr>
                          <th>Médico</th>
                          <th>Monto</th>
                          <th>Obra social</th>
                        </tr>
                      </thead>
                      <tbody>
                        {columna.map((row) => (
                          <tr key={row.doctorId}>
                            <td>{row.nombre}</td>
                            <td className="pagos-por-medico-monto">
                              {row.monto.toLocaleString('es-AR', {
                                style: 'currency',
                                currency: 'ARS',
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td>{row.obraSocial}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      <section className="panel panel--pagos-registrar">
        <h2>{editingId ? 'Editar pago' : 'Registrar pago'}</h2>
        {!puede ? (
          <p className="empty-hint">Necesitás pacientes y médicos cargados.</p>
        ) : (
          <form onSubmit={submit}>
            <div className="form-grid form-grid--pay">
              <div className="field">
                <label htmlFor="pay-pac">Paciente</label>
                <select
                  id="pay-pac"
                  value={form.patientId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, patientId: e.target.value, citaId: '' }))
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
                <label htmlFor="pay-doc">Médico</label>
                <select
                  id="pay-doc"
                  value={form.doctorId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, doctorId: e.target.value, citaId: '' }))
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
              <div className="form-grid__pay-monto-row">
                <div className="field">
                  <label htmlFor="pay-monto">Monto</label>
                  <input
                    id="pay-monto"
                    inputMode="decimal"
                    value={form.monto}
                    onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="pay-met">Forma de Pago</label>
                  <select
                    id="pay-met"
                    value={form.metodo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, metodo: e.target.value }))
                    }
                  >
                    {PAYMENT_METODOS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pay-monto-2">Monto (2)</label>
                  <input
                    id="pay-monto-2"
                    inputMode="decimal"
                    placeholder="0"
                    value={form.monto2}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, monto2: e.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="pay-met-2">Forma de Pago (2)</label>
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
                <div className="field">
                  <label htmlFor="pay-fecha">Fecha y hora del pago</label>
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
              <div className="form-grid__pay-met-notas">
                <div className="field field--notas-inline">
                  <label htmlFor="pay-notas">Notas</label>
                  <textarea
                    id="pay-notas"
                    rows={1}
                    value={form.notas}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, notas: e.target.value }))
                    }
                  />
                </div>
                <div className="field field--pay-submit field--pay-submit-inline">
                  <button type="submit" className="btn btn-primary">
                    {editingId ? 'Guardar pago' : 'Registrar pago'}
                  </button>
                </div>
              </div>
            </div>
            <div className="form-actions">
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={resetForm}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        )}
      </section>

      {!puedeFiltrarMesAnio && porMedico.length > 0 && (
        <section className="panel panel--pagos-por-medico">
          <h2>Pagos por médico</h2>
          <div className="pagos-por-medico-grid pagos-por-medico-grid--secretaria">
            {porMedicoColumnasSecretaria.map((columna, colIdx) =>
              columna.length === 0 ? null : (
                <div
                  key={colIdx}
                  className="table-wrap table-wrap--scroll pagos-por-medico-col"
                >
                  <div className="table-list__scroll pagos-por-medico-col__scroll">
                    <table className="data data--pagos-medico data--pagos-medico-inline">
                      <thead>
                        <tr>
                          <th>
                            Médico
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {columna.map((row) => (
                          <tr key={row.doctorId}>
                            <td>
                              <span className="pagos-por-medico-inline">
                                <span className="pagos-por-medico-inline__nombre">
                                  {row.nombre}
                                </span>
                                <span className="pagos-por-medico-inline__monto">
                                  {row.monto.toLocaleString('es-AR', {
                                    style: 'currency',
                                    currency: 'ARS',
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      )}

      <section className="panel panel--pagos-listado">
        <h2>Listado de pagos</h2>
        <p className="pagos-listado-periodo">
          Ventana: <strong>{listadoBounds.label}</strong>
        </p>
        <div className="table-wrap table-wrap--scroll">
          <div className="table-list__scroll">
        {pagosListado.length === 0 ? (
          <p className="empty-hint">
            {data.payments.length === 0
              ? 'No hay pagos registrados.'
              : `No hay pagos en ${listadoBounds.label}.`}
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Paciente</th>
                <th>Obra social</th>
                <th>Médico</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagosListado.map((p) => {
                const pac = patientById(p.patientId)
                const doc = doctorById(p.doctorId)
                const pacienteLabel = pac
                  ? `${pac.apellido}, ${pac.nombre}`
                  : '—'
                return (
                  <tr key={p.id}>
                    <td>
                      {format(parseISO(p.fecha), 'd MMM yyyy HH:mm', { locale: es })}
                    </td>
                    <td className="pagos-cobro-cell">
                      <span className="pagos-cobro-line">
                        <span className="pagos-cobro-paciente">{pacienteLabel}</span>
                        <span className="pagos-cobro-monto">
                          {formatMonto(p.monto)}
                          {p.metodo ? ` · ${p.metodo}` : ''}
                        </span>
                      </span>
                    </td>
                    <td>
                      {pac?.obraSocial ? (
                        <span className="obra-pill">{pac.obraSocial}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{doc ? `${doc.apellido}, ${doc.nombre}` : '—'}</td>
                    <td>
                      <div className="row-actions">
                        <IconActionButton
                          variant="edit"
                          label="Editar pago"
                          onClick={() => startEdit(p)}
                        >
                          <IconEdit />
                        </IconActionButton>
                        <IconActionButton
                          variant="delete"
                          label="Eliminar pago"
                          onClick={() => setPaymentToDelete(p)}
                        >
                          <IconTrash />
                        </IconActionButton>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
          </div>
        </div>
      </section>

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
    </div>
  )
}
