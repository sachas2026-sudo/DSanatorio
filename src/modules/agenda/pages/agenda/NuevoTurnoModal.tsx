import React, { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { AppointmentEstado, Doctor, ObraSocialCatalog, Patient } from '../../../../types'
import { formatPesosAr, parsePesosAr } from '../../../../lib/obrasSocialesCatalog'
import { formatMontoFieldInput, PAYMENT_METODOS } from '../../../../lib/paymentInput'
import { APP_DISPLAY_NAME } from '../../../../lib/pdfBranding'
import { IconPlus } from '../../../../shared/components/icons'
import { doctorDuracionTurno } from '../../../../lib/doctorAgenda'
import { AGENDA_ESTADOS } from '../../../../lib/agendaDisplay'
import { patientMatchesPickerQuery, patientPickerLineLegacy } from '../../../../lib/dniLabels'
import { MOTIVO_CONSULTA_2_NINGUNO } from '../../../../lib/motivoConsulta'
import {
  calcularMontoSugerido,
  normalizeOsName,
} from '../../../../lib/turnoMonto'
import {
  buscarAfiliacionYPlanPaciente,
  calcularConsumoAfiliadoMes,
  validarCupoPlanParaTurno,
} from '../../../../lib/consumoAfiliados'
import { esContratanteSuspendido } from '../../../../lib/contratantesMovimientos'
import { afiliadoTieneCuotasImpagas } from '../../../../lib/cobertura'
import { useAppState } from '../../../../context/AppStateContext'
import './nuevo-turno-modal.css'

export interface NuevoTurnoModalProps {
  bookingDate: Date | null
  bookingEditingId: string | null
  bookingDoctorId: string
  setBookingDoctorId: (id: string) => void
  bookingPatientId: string
  setBookingPatientId: (id: string) => void
  bookingPatientQuery: string
  setBookingPatientQuery: (query: string) => void
  bookingPatientPickerOpen: boolean
  setBookingPatientPickerOpen: (open: boolean) => void
  bookingSlotHm: string | null
  setBookingSlotHm: (hm: string | null) => void
  bookingManualHm: string
  setBookingManualHm: (hm: string) => void
  bookingFueraGrilla: boolean
  setBookingFueraGrilla: (fuera: boolean) => void
  bookingDuracion: number
  setBookingDuracion: (dur: number) => void
  bookingCobertura: string
  setBookingCobertura: (cob: string) => void
  bookingMonto: string
  setBookingMonto: (monto: string) => void
  bookingMonto2: string
  setBookingMonto2: (monto: string) => void
  bookingMetodo: string
  setBookingMetodo: (metodo: string) => void
  bookingMetodo2: string
  setBookingMetodo2: (metodo: string) => void
  bookingEstado: AppointmentEstado | 'pagado'
  setBookingEstado: (est: AppointmentEstado | 'pagado') => void
  bookingMotivoConsulta: string
  setBookingMotivoConsulta: (motivo: string) => void
  bookingMotivoConsulta2: string
  setBookingMotivoConsulta2: (motivo: string) => void
  bookingMotivoOtro: string
  setBookingMotivoOtro: (motivo: string) => void
  bookingMotivoOtro2: string
  setBookingMotivoOtro2: (motivo: string) => void
  bookingFormError: string | null
  bookingScheduleHint: string | null
  bookingDoctors: Doctor[]
  pacientesOperativos: Patient[]
  bookingSlots: Array<{ hm: string; available: boolean; reason?: string }>
  bookingManualSlotCheck: { ok: boolean; message?: string } | null
  bookingTotalMonto: number
  bookingMetodosIguales: boolean
  bookingPaymentId: string | null
  bookingPaymentId2: string | null
  obrasSocialesCatalog: ObraSocialCatalog[]
  saveObraSocialCatalog: (item: ObraSocialCatalog) => Promise<unknown>
  motivosConsultaOpciones: string[]
  openMotivosConsultaModal: (setter: (m: string) => void) => void
  onClose: () => void
  onResetForm: () => void
  onSubmitBooking: (e: React.FormEvent) => void
  onOpenNewPatient: (initialDni: string) => void
  applyPatientSelection: (patient: Patient) => void
  doctorById: (id: string) => Doctor | undefined
  bookingResolvedHm: () => string | null
}

export function NuevoTurnoModal({
  bookingDate,
  bookingEditingId,
  bookingDoctorId,
  setBookingDoctorId,
  bookingPatientId,
  setBookingPatientId,
  bookingPatientQuery,
  setBookingPatientQuery,
  bookingPatientPickerOpen,
  setBookingPatientPickerOpen,
  bookingSlotHm,
  setBookingSlotHm,
  bookingManualHm,
  setBookingManualHm,
  bookingFueraGrilla,
  setBookingFueraGrilla,
  bookingDuracion,
  setBookingDuracion,
  bookingCobertura,
  setBookingCobertura,
  bookingMonto,
  setBookingMonto,
  bookingMonto2,
  setBookingMonto2,
  bookingMetodo,
  setBookingMetodo,
  bookingMetodo2,
  setBookingMetodo2,
  bookingEstado,
  setBookingEstado,
  bookingMotivoConsulta,
  setBookingMotivoConsulta,
  bookingMotivoConsulta2,
  setBookingMotivoConsulta2,
  bookingMotivoOtro,
  setBookingMotivoOtro,
  bookingMotivoOtro2,
  setBookingMotivoOtro2,
  bookingFormError,
  bookingScheduleHint,
  bookingDoctors,
  pacientesOperativos,
  bookingSlots,
  bookingManualSlotCheck,
  bookingTotalMonto,
  bookingMetodosIguales,
  bookingPaymentId,
  bookingPaymentId2,
  obrasSocialesCatalog,
  saveObraSocialCatalog,
  motivosConsultaOpciones,
  openMotivosConsultaModal,
  onClose,
  onResetForm,
  onSubmitBooking,
  onOpenNewPatient,
  applyPatientSelection,
  doctorById,
  bookingResolvedHm,
}: NuevoTurnoModalProps) {
  const { data } = useAppState()

  // Afiliación y plan del paciente (titular o adherente)
  const infoAfiliacion = useMemo(() => {
    if (!bookingPatientId) return null
    return buscarAfiliacionYPlanPaciente(
      bookingPatientId,
      data.afiliados ?? [],
      data.planesAfiliados ?? [],
    )
  }, [bookingPatientId, data.afiliados, data.planesAfiliados])

  // Mapa de coberturas activas por paciente para el buscador
  const pacienteCoberturaMap = useMemo(() => {
    const map = new Map<string, string>()
    const afiliados = data.afiliados ?? []
    const planes = data.planesAfiliados ?? []
    if (afiliados.length === 0 || planes.length === 0) return map

    for (const p of pacientesOperativos) {
      const info = buscarAfiliacionYPlanPaciente(p.id, afiliados, planes)
      if (info) {
        map.set(p.id, info.plan.nombre)
      }
    }
    return map
  }, [pacientesOperativos, data.afiliados, data.planesAfiliados])

  // Nombre del mes de la fecha del turno
  const mesNombre = useMemo(() => {
    if (!bookingDate) return 'este mes'
    const m = format(bookingDate, 'MMMM', { locale: es })
    return m.charAt(0).toUpperCase() + m.slice(1)
  }, [bookingDate])

  // Consumo del mes para la fecha del turno seleccionado (para validación de cupo, excluye el actual al editar)
  const consumoMes = useMemo(() => {
    if (!bookingPatientId || !infoAfiliacion || !bookingDate) return null
    return calcularConsumoAfiliadoMes({
      patientId: bookingPatientId,
      anio: bookingDate.getFullYear(),
      mes: bookingDate.getMonth() + 1,
      plan: infoAfiliacion.plan,
      appointments: data.appointments ?? [],
      excludeAppointmentId: bookingEditingId ?? undefined,
      ordenesMedicas: data.ordenesMedicas ?? [],
    })
  }, [bookingPatientId, infoAfiliacion, bookingDate, data.appointments, data.ordenesMedicas, bookingEditingId])

  // Consumo real total del mes (incluye todos los turnos agendados para mostrar la disponibilidad real)
  const consumoMesReal = useMemo(() => {
    if (!bookingPatientId || !infoAfiliacion || !bookingDate) return null
    return calcularConsumoAfiliadoMes({
      patientId: bookingPatientId,
      anio: bookingDate.getFullYear(),
      mes: bookingDate.getMonth() + 1,
      plan: infoAfiliacion.plan,
      appointments: data.appointments ?? [],
      ordenesMedicas: data.ordenesMedicas ?? [],
    })
  }, [bookingPatientId, infoAfiliacion, bookingDate, data.appointments, data.ordenesMedicas])

  // Verificación de si el contratante está suspendido (titular o adherente)
  const afiliadoSuspendido = useMemo(() => {
    if (!infoAfiliacion) return false
    return esContratanteSuspendido(infoAfiliacion.afiliado)
  }, [infoAfiliacion])

  // Verificación de si el afiliado registra cuotas impagas (no está al día)
  const afiliadoEnMora = useMemo(() => {
    if (!infoAfiliacion) return false
    const hoyRef = new Date()
    const fechaEval = bookingDate && bookingDate > hoyRef ? bookingDate : hoyRef
    return afiliadoTieneCuotasImpagas(
      infoAfiliacion.afiliado,
      data.cuotasAfiliados ?? [],
      fechaEval,
    )
  }, [infoAfiliacion, data.cuotasAfiliados, bookingDate])

  // Validación de cupo y estado al día según motivo(s) elegidos
  const validacionCupo = useMemo(() => {
    if (!consumoMes || !infoAfiliacion) return { permitido: true, esDeuda: false }
    const esPlan = normalizeOsName(bookingCobertura) === normalizeOsName(infoAfiliacion.plan.nombre)
    if (!esPlan) return { permitido: true, esDeuda: false }

    if (afiliadoSuspendido) {
      return {
        permitido: false,
        esDeuda: true,
        motivoBloqueo: 'Contratante suspendido',
      }
    }

    if (afiliadoEnMora) {
      return {
        permitido: false,
        esDeuda: true,
        motivoBloqueo:
          'El afiliado no está al día con sus cuotas mensuales (registra deuda pendiente en Afiliados).',
      }
    }

    const m1 = bookingMotivoConsulta === 'Otro' ? bookingMotivoOtro : bookingMotivoConsulta
    const m2 = bookingMotivoConsulta2 === 'Otro' ? bookingMotivoOtro2 : bookingMotivoConsulta2
    return { ...validarCupoPlanParaTurno(consumoMes, m1, m2), esDeuda: false }
  }, [
    consumoMes,
    infoAfiliacion,
    afiliadoSuspendido,
    afiliadoEnMora,
    bookingCobertura,
    bookingMotivoConsulta,
    bookingMotivoOtro,
    bookingMotivoConsulta2,
    bookingMotivoOtro2,
  ])

  // Detección de cobertura Individual o Familiar (Plan de salud propio sin abono en consulta)
  const isPlanCobertura = useMemo(() => {
    const norm = normalizeOsName(bookingCobertura)
    if (!norm) return false
    if (
      norm.includes('individual') ||
      norm.includes('individa') ||
      norm.includes('familiar')
    ) {
      return true
    }
    if (infoAfiliacion && normalizeOsName(infoAfiliacion.plan.nombre) === norm) {
      return true
    }
    return false
  }, [bookingCobertura, infoAfiliacion])

  // Opciones para Motivo 1 y 2, garantizando que si el turno ya tiene un motivo guardado figure en la lista
  const opcionesMotivo1 = useMemo(() => {
    const list = [...motivosConsultaOpciones]
    if (bookingMotivoConsulta && bookingMotivoConsulta !== 'Otro' && !list.includes(bookingMotivoConsulta)) {
      list.unshift(bookingMotivoConsulta)
    }
    return list
  }, [motivosConsultaOpciones, bookingMotivoConsulta])

  const opcionesMotivo2 = useMemo(() => {
    const list = [...motivosConsultaOpciones]
    if (
      bookingMotivoConsulta2 &&
      bookingMotivoConsulta2 !== 'Otro' &&
      bookingMotivoConsulta2 !== MOTIVO_CONSULTA_2_NINGUNO &&
      !list.includes(bookingMotivoConsulta2)
    ) {
      list.unshift(bookingMotivoConsulta2)
    }
    return list
  }, [motivosConsultaOpciones, bookingMotivoConsulta2])

  // Aviso informativo de afiliación para el paciente seleccionado (titular o adherente)
  const afiliacionAviso = useMemo(() => {
    if (!bookingPatientId || !infoAfiliacion) return null
    const { afiliado, plan, esAdherente } = infoAfiliacion
    const patients = data.patients ?? []
    const titular = patients.find((p) => p.id === afiliado.patientId)
    const titularNombre = titular ? `${titular.apellido}, ${titular.nombre}` : 'Titular'
    const adh = esAdherente
      ? afiliado.adherentes?.find((x) => x.patientId === bookingPatientId)
      : null
    const relacion = adh?.relacion || 'Adherente'

    const infoConsumo = consumoMesReal ?? consumoMes
    let cupoTexto = ''
    if (infoConsumo) {
      const {
        consultasRestantes,
        consultasCupo,
        consultasAgotadas,
        prestacionesRestantes,
        prestacionesCupo,
        prestacionesAgotadas,
      } = infoConsumo

      const consPart =
        consultasCupo > 0
          ? consultasAgotadas
            ? `0/${consultasCupo} Consultas disp.`
            : `${consultasRestantes}/${consultasCupo} Consultas disp.`
          : 'Consultas sin límite'

      const prestPart =
        prestacionesCupo > 0
          ? prestacionesAgotadas
            ? `0/${prestacionesCupo} Prestaciones disp.`
            : `${prestacionesRestantes}/${prestacionesCupo} Prestaciones disp.`
          : 'Prestaciones sin límite'

      cupoTexto = `Disponibles: ${consPart} · ${prestPart}`
    } else {
      cupoTexto = `${plan.cupoConsultas || 0} Consultas  · ${plan.prestacionesPorMes || 0} Prestaciones`
    }

    const cobLabel = plan.nombre.toLowerCase().startsWith('plan ')
      ? plan.nombre.replace(/^plan\s+/i, 'Cobertura ')
      : plan.nombre.toLowerCase().startsWith('cobertura ')
        ? plan.nombre
        : `Cobertura ${plan.nombre}`

    const moraPrefix = afiliadoSuspendido
      ? 'Contratante suspendido · '
      : afiliadoEnMora
        ? 'DEUDOR (Cuota impaga) · '
        : ''
    const isWarning = Boolean(
      afiliadoSuspendido ||
        afiliadoEnMora ||
        (infoConsumo?.consultasAgotadas && infoConsumo?.prestacionesAgotadas),
    )

    if (esAdherente) {
      return {
        tipo: 'adherente' as const,
        planNombre: plan.nombre,
        titularNombre,
        relacion,
        texto: `${moraPrefix}${cobLabel} ( ${cupoTexto} ) · Adherente de ${titularNombre} · ${relacion}`,
        agotado: isWarning,
      }
    }

    return {
      tipo: 'titular' as const,
      planNombre: plan.nombre,
      texto: `${moraPrefix}${cobLabel} ( ${cupoTexto} )`,
      agotado: isWarning,
    }
  }, [bookingPatientId, infoAfiliacion, afiliadoSuspendido, afiliadoEnMora, data.patients, consumoMesReal, consumoMes])

  // Las pastillas arrancan ocultas por debajo de 1180px de ancho de ventana
  const [sidePillsOpen, setSidePillsOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1180 : true,
  )

  // Flag para rastrear si el usuario editó el monto manualmente (Regla 5)
  const [usuarioEditoManualmente, setUsuarioEditoManualmente] = useState(false)

  // Estado local para los inputs de Plus de cada obra social en la pastilla lateral
  const [plusInputs, setPlusInputs] = useState<Record<string, string>>({})
  const saveTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Limpiar timers al desmontar
  useEffect(() => {
    return () => {
      Object.values(saveTimeoutRef.current).forEach((t) => clearTimeout(t))
    }
  }, [])

  // Sincronizar inputs de Plus cuando cambia el catálogo de obras sociales
  useEffect(() => {
    setPlusInputs((prev) => {
      const next = { ...prev }
      obrasSocialesCatalog.forEach((os) => {
        if (next[os.nombre] === undefined) {
          next[os.nombre] = os.plus > 0 ? formatPesosAr(os.plus) : ''
        }
      })
      return next
    })
  }, [obrasSocialesCatalog])

  // Médico seleccionado
  const selectedDoctor = useMemo(() => {
    return doctorById(bookingDoctorId)
  }, [bookingDoctorId, doctorById])

  // Cálculo del monto automático / sugerido según las 5 reglas
  const montoSugerido = useMemo(() => {
    return calcularMontoSugerido({
      doctor: selectedDoctor,
      cobertura: bookingCobertura,
      obrasSocialesCatalog,
      montoActualInput: bookingMonto,
      usuarioEditoManualmente,
    })
  }, [selectedDoctor, bookingCobertura, obrasSocialesCatalog, bookingMonto, usuarioEditoManualmente])

  // Fecha con formato "Viernes 6 de Noviembre"
  const fechaFormateada = useMemo(() => {
    if (!bookingDate) return ''
    return format(bookingDate, "EEEE d 'de' MMMM", { locale: es })
      .split(' ')
      .map((w) => (w.toLowerCase() === 'de' ? 'de' : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
  }, [bookingDate])

  // Lista de opciones para el selector de Cobertura
  const opcionesCobertura = useMemo(() => {
    const list: string[] = ['Particular']
    const set = new Set<string>(['particular'])

    obrasSocialesCatalog
      .filter((o) => !o.suspendida)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
      .forEach((o) => {
        const norm = normalizeOsName(o.nombre)
        if (!set.has(norm)) {
          set.add(norm)
          list.push(o.nombre)
        }
      })

    // Asegurar que la cobertura actual esté en la lista aunque sea custom o suspendida
    if (bookingCobertura && !set.has(normalizeOsName(bookingCobertura))) {
      list.push(bookingCobertura)
    }

    return list
  }, [obrasSocialesCatalog, bookingCobertura])

  // Manejo del cambio de médico
  const handleDoctorChange = (docId: string) => {
    setBookingDoctorId(docId)
    setBookingSlotHm(null)
    setBookingManualHm('')
    const doc = doctorById(docId)
    if (doc && !bookingFueraGrilla) {
      setBookingDuracion(doctorDuracionTurno(doc))
    }
    if (!bookingEditingId && doc) {
      const res = calcularMontoSugerido({
        doctor: doc,
        cobertura: bookingCobertura,
        obrasSocialesCatalog,
        montoActualInput: '',
        usuarioEditoManualmente: false,
      })
      if (!usuarioEditoManualmente) {
        if (res.montoCalculado !== null && res.montoCalculado > 0) {
          setBookingMonto(res.montoCalculadoFormateado)
        } else {
          setBookingMonto('')
        }
      }
    }
  }

  // Manejo de cambio de cobertura
  const handleCoberturaChange = (newCob: string) => {
    setBookingCobertura(newCob)
    setUsuarioEditoManualmente(false)
    if (!bookingEditingId && selectedDoctor) {
      const res = calcularMontoSugerido({
        doctor: selectedDoctor,
        cobertura: newCob,
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

  // Manejo de edición manual de monto (Regla 5)
  const handleMonto1Change = (raw: string) => {
    setUsuarioEditoManualmente(true)
    setBookingMonto(formatMontoFieldInput(raw))
  }

  // Botón "Usar sugerido"
  const handleUsarSugerido = () => {
    if (montoSugerido.sugeridoParaBoton !== null) {
      setBookingMonto(formatPesosAr(montoSugerido.sugeridoParaBoton))
      setUsuarioEditoManualmente(false)
    }
  }

  // Edición de Plus en la pastilla lateral con retardo (Regla 3)
  const handlePlusInputChange = (os: ObraSocialCatalog, rawValue: string) => {
    const formatted = formatMontoFieldInput(rawValue)
    setPlusInputs((prev) => ({ ...prev, [os.nombre]: formatted }))

    const nuevoPlus = parsePesosAr(formatted)

    // Recalcular monto en vivo si coincide con la cobertura actual del turno
    if (
      normalizeOsName(os.nombre) === normalizeOsName(bookingCobertura) &&
      !usuarioEditoManualmente &&
      !bookingEditingId
    ) {
      if (selectedDoctor) {
        const atiende = selectedDoctor.obrasSociales?.some(
          (o) => normalizeOsName(typeof o === 'string' ? o : o.nombre) === normalizeOsName(os.nombre),
        ) || (selectedDoctor.obraSocial && normalizeOsName(selectedDoctor.obraSocial) === normalizeOsName(os.nombre))

        if (atiende) {
          if (nuevoPlus > 0) {
            setBookingMonto(formatPesosAr(nuevoPlus))
          } else {
            setBookingMonto('')
          }
        }
      }
    }

    // Debounce guardado en base de datos
    if (saveTimeoutRef.current[os.nombre]) {
      clearTimeout(saveTimeoutRef.current[os.nombre])
    }
    saveTimeoutRef.current[os.nombre] = setTimeout(async () => {
      await saveObraSocialCatalog({
        ...os,
        plus: nuevoPlus,
      })
    }, 350)
  }

  // Selección de paciente desde el buscador
  const handleSelectPatient = (pac: Patient) => {
    applyPatientSelection(pac)
    setUsuarioEditoManualmente(false)

    // Cobertura automática con la OS que tiene el paciente cargada en Pacientes (o Particular si no tiene)
    const pacOs = (pac.obraSocial || '').trim()
    const canonicalMatch = pacOs
      ? obrasSocialesCatalog.find((o) => normalizeOsName(o.nombre) === normalizeOsName(pacOs))?.nombre
      : null
    const nuevaCob = canonicalMatch || pacOs || 'Particular'
    setBookingCobertura(nuevaCob)

    if (!bookingEditingId && selectedDoctor) {
      const res = calcularMontoSugerido({
        doctor: selectedDoctor,
        cobertura: nuevaCob,
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

  // Médicos ordenados para la pastilla lateral
  const medicosOrdenados = useMemo(() => {
    return [...bookingDoctors].sort((a, b) =>
      `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
        sensitivity: 'base',
      }),
    )
  }, [bookingDoctors])

  return (
    <div
      className="nt-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nt-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="nt-layout-wrap" onMouseDown={(e) => e.stopPropagation()}>
        {/* Modal Principal (854px = 534px + 320px) */}
        <div className="nt-modal">
          {/* Encabezado */}
          <div className="nt-header" id="nt-title">
            <div className="nt-header__brand">
              <div className="nt-header__logo">C</div>
              <div className="nt-header__titles">
                <div className="nt-header__title">{APP_DISPLAY_NAME || 'Centro Medico'}</div>
                <div className="nt-header__subtitle">
                  {bookingEditingId ? 'Modificar turno' : 'Nuevo turno'}
                </div>
              </div>
            </div>
            {fechaFormateada && <div className="nt-header__date">{fechaFormateada}</div>}
          </div>

          <form onSubmit={onSubmitBooking} noValidate style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Cuerpo de dos columnas: Formulario (534px) y Horario (320px) */}
            <div className="nt-body">
              {/* Columna Izquierda: Formulario */}
              <div className="nt-col-form">
                {/* 1. Médico y badge de horario */}
                <div className="nt-row-medico">
                  <div className="nt-field">
                    <label className="nt-field__label" htmlFor="nt-doc">
                      Médico
                    </label>
                    <select
                      id="nt-doc"
                      className="nt-select"
                      value={bookingDoctorId}
                      onChange={(e) => handleDoctorChange(e.target.value)}
                      required
                      disabled={bookingDoctors.length === 0}
                    >
                      <option value="">
                        {bookingDoctors.length === 0 ? 'Sin médicos ese día' : 'Elegir…'}
                      </option>
                      {bookingDoctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.apellido}, {d.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2. Paciente buscador y botón "+ Nuevo paciente" */}
                <div className="nt-field">
                  <label className="nt-field__label" htmlFor="nt-pac">
                    Paciente
                  </label>
                  <div className="nt-row-paciente">
                    <div className="nt-paciente-search-wrap">
                      <input
                        id="nt-pac"
                        name="sanatorio-agenda-paciente"
                        className="nt-input"
                        style={{ width: '100%' }}
                        autoComplete="off"
                        value={bookingPatientQuery}
                        onChange={(e) => {
                          const q = e.target.value
                          setBookingPatientQuery(q)
                          setBookingPatientPickerOpen(true)
                          if (bookingPatientId) setBookingPatientId('')
                          const trimmed = q.trim()
                          if (!trimmed) return
                          const matches = pacientesOperativos.filter((p) =>
                            patientMatchesPickerQuery(p, trimmed),
                          )
                          const unique = matches.length === 1 ? matches[0]! : null
                          const isNumeric = /^\d+$/.test(trimmed)
                          const shouldAutoPick =
                            Boolean(unique) &&
                            (isNumeric ? trimmed.length >= 2 : trimmed.length >= 4)
                          if (unique && shouldAutoPick) {
                            handleSelectPatient(unique)
                          }
                        }}
                        onFocus={() => setBookingPatientPickerOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          e.stopPropagation()
                          const q = bookingPatientQuery.trim()
                          if (!q) return
                          const matches = pacientesOperativos.filter((p) =>
                            patientMatchesPickerQuery(p, q),
                          )
                          const pick = matches[0]
                          if (!pick) {
                            if (/^\d+$/.test(q)) {
                              onOpenNewPatient(q)
                            }
                            return
                          }
                          handleSelectPatient(pick)
                        }}
                        onBlur={() => {
                          window.setTimeout(() => {
                            setBookingPatientPickerOpen(false)
                            const q = bookingPatientQuery.trim()
                            if (!q) return
                            const matches = pacientesOperativos.filter((p) =>
                              patientMatchesPickerQuery(p, q),
                            )
                            if (matches.length === 1) {
                              handleSelectPatient(matches[0]!)
                            }
                          }, 150)
                        }}
                        placeholder="Buscar por DNI o apellido…"
                      />
                      {bookingPatientPickerOpen && (
                        <div className="nt-paciente-menu">
                          {(bookingPatientQuery.trim()
                            ? pacientesOperativos.filter((p) =>
                                patientMatchesPickerQuery(p, bookingPatientQuery.trim()),
                              )
                            : pacientesOperativos
                          ).map((p) => {
                            const cob = pacienteCoberturaMap.get(p.id)
                            const hasOs = Boolean(p.obraSocial && p.obraSocial.trim())
                            const osIgualCob =
                              hasOs &&
                              cob &&
                              normalizeOsName(p.obraSocial!) === normalizeOsName(cob)
                            return (
                              <button
                                type="button"
                                key={p.id}
                                className="nt-paciente-menu__item"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSelectPatient(p)}
                              >
                                <span>
                                  {patientPickerLineLegacy(p.dni, p.apellido, p.nombre) ||
                                    `${p.apellido}, ${p.nombre}`}
                                </span>
                                <div className="nt-paciente-menu__badges">
                                  {hasOs && (
                                    <span className="nt-paciente-menu__os">{p.obraSocial}</span>
                                  )}
                                  {cob && !osIgualCob && (
                                    <span className="nt-paciente-menu__cobertura">{cob}</span>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="nt-btn-new-paciente"
                      onClick={() => {
                        const raw = bookingPatientQuery.trim()
                        onOpenNewPatient(raw && /^\d{6,}$/.test(raw) ? raw : '')
                      }}
                    >
                      + Nuevo paciente
                    </button>
                  </div>
                  {afiliacionAviso && (
                    <div
                      style={{
                        marginTop: '0.45rem',
                        padding: '0.4rem 0.65rem',
                        borderRadius: '6px',
                        background: afiliacionAviso.agotado ? '#fef3c7' : '#eff6ff',
                        border: `1px solid ${afiliacionAviso.agotado ? '#fde68a' : '#bfdbfe'}`,
                        color: afiliacionAviso.agotado ? '#92400e' : '#1d4ed8',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                      }}
                    >
                      {afiliacionAviso.agotado && (
                        <span style={{ fontSize: '1rem', lineHeight: 1 }} aria-hidden="true">
                          ⚠️
                        </span>
                      )}
                      <span>{afiliacionAviso.texto}</span>
                    </div>
                  )}
                </div>

                {/* 3. Cobertura */}
                <div className="nt-field">
                  <label className="nt-field__label" htmlFor="nt-cobertura">
                    Cobertura
                  </label>
                  <select
                    id="nt-cobertura"
                    className="nt-select"
                    value={bookingCobertura}
                    onChange={(e) => handleCoberturaChange(e.target.value)}
                  >
                    {opcionesCobertura.map((cob) => (
                      <option key={cob} value={cob}>
                        {cob}
                      </option>
                    ))}
                  </select>
                  {!validacionCupo.permitido && (
                    <div
                      style={{
                        marginTop: '0.45rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#b91c1c',
                        fontSize: '0.81rem',
                        fontWeight: 600,
                        lineHeight: 1.35,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.2rem' }}>
                        <span aria-hidden="true">⚠️</span>
                        <span>
                          {'esDeuda' in validacionCupo && validacionCupo.esDeuda
                            ? 'Cobertura inhabilitada por falta de pago'
                            : 'Tope mensual del plan alcanzado'}
                        </span>
                      </div>
                      <div style={{ fontWeight: 500, fontSize: '0.78rem' }}>{validacionCupo.motivoBloqueo}</div>
                      <div style={{ fontSize: '0.74rem', color: '#7f1d1d', marginTop: '0.25rem' }}>
                        Podés agendar el turno cambiando la cobertura a <strong>Particular</strong> o seleccionando otra obra social.
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Sección PAGO (OPCIONAL) */}
                <div className="nt-pago-box">
                  <div className="nt-field__label" style={{ color: 'var(--nt-text-dark)' }}>
                    PAGO (OPCIONAL)
                  </div>
                  <div className="nt-pago-grid">
                    <div className="nt-field">
                      <label className="nt-field__label" htmlFor="nt-monto">
                        Monto
                      </label>
                      <div className="nt-monto-wrap">
                        <span className="nt-monto-prefix">$</span>
                        <input
                          id="nt-monto"
                          className="nt-input nt-monto-input"
                          style={{ width: '100%' }}
                          inputMode="numeric"
                          placeholder="0"
                          value={bookingMonto}
                          onChange={(e) => handleMonto1Change(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="nt-field">
                      <label className="nt-field__label" htmlFor="nt-metodo">
                        Método
                      </label>
                      <select
                        id="nt-metodo"
                        className="nt-select"
                        value={bookingMetodo}
                        onChange={(e) => setBookingMetodo(e.target.value)}
                      >
                        {PAYMENT_METODOS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                        <option value="Trasf. Gerencia">Trasf. Gerencia</option>
                      </select>
                    </div>
                    <div className="nt-field">
                      <label className="nt-field__label" htmlFor="nt-estado">
                        Estado
                      </label>
                      <select
                        id="nt-estado"
                        className="nt-select"
                        value={bookingEstado}
                        onChange={(e) =>
                          setBookingEstado(e.target.value as AppointmentEstado | 'pagado')
                        }
                      >
                        <option value="programado">Programado</option>
                        <option value="pagado">Pagado</option>
                        {bookingEstado === 'atendido' && <option value="atendido">Atendido</option>}
                        {bookingEstado === 'cancelado' && <option value="cancelado">Cancelado</option>}
                      </select>
                    </div>
                  </div>

                  {/* Aviso del monto con botón "Usar sugerido" si aplica */}
                  {montoSugerido.avisoTexto &&
                    !montoSugerido.avisoTexto.toLowerCase().includes('calcular el monto') && (
                    <div className={`nt-monto-notice nt-monto-notice--${montoSugerido.avisoTipo}`}>
                      <span>{montoSugerido.avisoTexto}</span>
                      {montoSugerido.mostrarBotonUsarSugerido &&
                        montoSugerido.sugeridoParaBoton !== null && (
                          <button
                            type="button"
                            className="nt-btn-usar-sugerido"
                            onClick={handleUsarSugerido}
                          >
                            Usar sugerido ($ {formatPesosAr(montoSugerido.sugeridoParaBoton)})
                          </button>
                        )}
                    </div>
                  )}

                  {/* Fila Monto (2), Método (2) y Total Monto */}
                  <div className="nt-pago-secundario">
                    <div className="nt-field">
                      <label className="nt-field__label" htmlFor="nt-monto-2">
                        Monto (2)
                      </label>
                      <div className="nt-monto-wrap">
                        <span className="nt-monto-prefix">$</span>
                        <input
                          id="nt-monto-2"
                          className="nt-input nt-monto-input"
                          style={{ width: '100%' }}
                          inputMode="numeric"
                          placeholder="0"
                          value={bookingMonto2}
                          onChange={(e) => setBookingMonto2(formatMontoFieldInput(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="nt-field">
                      <label className="nt-field__label" htmlFor="nt-metodo-2">
                        Método (2)
                      </label>
                      <select
                        id="nt-metodo-2"
                        className="nt-select"
                        value={bookingMetodo2}
                        onChange={(e) => setBookingMetodo2(e.target.value)}
                      >
                        {PAYMENT_METODOS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                        <option value="Trasf. Gerencia">Trasf. Gerencia</option>
                      </select>
                    </div>
                    <div className="nt-total-badge">
                      <span className="nt-total-badge__label">Total Monto</span>
                      <span className="nt-total-badge__val">
                        $ {formatPesosAr(bookingTotalMonto)}
                      </span>
                    </div>
                  </div>

                  {bookingMetodosIguales && (
                    <p
                      style={{
                        color: 'var(--nt-danger)',
                        fontSize: '11px',
                        fontWeight: 700,
                        margin: '2px 0 0',
                      }}
                      role="status"
                    >
                      Método y Método (2) son iguales. Elegí formas de pago distintas para cada monto.
                    </p>
                  )}
                </div>

                {/* 5. Motivo Consulta y Prestación */}
                <div className="nt-row-motivos">
                  <div className="nt-field">
                    <label className="nt-field__label" htmlFor="nt-motivo-1">
                      Motivo Consulta
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <select
                        id="nt-motivo-1"
                        className="nt-select"
                        style={{ flex: 1, minWidth: 0 }}
                        value={bookingMotivoConsulta}
                        onChange={(e) => setBookingMotivoConsulta(e.target.value)}
                      >
                        {opcionesMotivo1.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="booking-btn-add-motivo"
                        aria-label="Agregar motivo"
                        onClick={() => openMotivosConsultaModal(setBookingMotivoConsulta)}
                      >
                        <IconPlus />
                      </button>
                    </div>
                    {bookingMotivoConsulta === 'Otro' && (
                      <input
                        className="nt-input"
                        placeholder="Especificar motivo"
                        value={bookingMotivoOtro}
                        onChange={(e) => setBookingMotivoOtro(e.target.value)}
                      />
                    )}
                  </div>

                  <div className="nt-field">
                    <label className="nt-field__label" htmlFor="nt-motivo-2">
                      Prestación
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <select
                        id="nt-motivo-2"
                        className="nt-select"
                        style={{ flex: 1, minWidth: 0 }}
                        value={bookingMotivoConsulta2}
                        onChange={(e) => {
                          setBookingMotivoConsulta2(e.target.value)
                          if (e.target.value !== 'Otro') setBookingMotivoOtro2('')
                        }}
                      >
                        <option value={MOTIVO_CONSULTA_2_NINGUNO}>Sin motivo 2</option>
                        {opcionesMotivo2.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="booking-btn-add-motivo"
                        aria-label="Agregar motivo"
                        onClick={() => openMotivosConsultaModal(setBookingMotivoConsulta2)}
                      >
                        <IconPlus />
                      </button>
                    </div>
                    {bookingMotivoConsulta2 === 'Otro' && (
                      <input
                        className="nt-input"
                        placeholder="Especificar motivo"
                        value={bookingMotivoOtro2}
                        onChange={(e) => setBookingMotivoOtro2(e.target.value)}
                      />
                    )}
                  </div>
                </div>

                {bookingFormError && (
                  <p
                    style={{
                      color: 'var(--nt-danger)',
                      fontSize: '12px',
                      fontWeight: 700,
                      margin: 0,
                    }}
                    role="alert"
                  >
                    {bookingFormError}
                  </p>
                )}
              </div>

              {/* Columna Derecha: Panel HORARIO (320px definido por --horario-w, fondo #f1f5fd, borde izquierdo) */}
              <div className="nt-col-horario">
                {/* Encabezado del panel con botón cuadrado ">" */}
                <div className="nt-horario-head">
                  <h3 className="nt-horario-head__title">HORARIO</h3>
                  <button
                    type="button"
                    className={`nt-btn-toggle-side${sidePillsOpen ? '' : ' nt-btn-toggle-side--closed'}`}
                    aria-expanded={sidePillsOpen}
                    aria-label={
                      sidePillsOpen
                        ? 'Ocultar obras sociales y médicos'
                        : 'Mostrar obras sociales y médicos'
                    }
                    title={
                      sidePillsOpen
                        ? 'Ocultar obras sociales y médicos'
                        : 'Mostrar obras sociales y médicos'
                    }
                    onClick={() => setSidePillsOpen((prev) => !prev)}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>

                {/* Fila Hora + Duración: grid de 2 columnas iguales */}
                <div className="nt-row-hora-dur">
                  <div className="nt-field">
                    <label className="nt-field__label" htmlFor="nt-hora">
                      Hora
                    </label>
                    <input
                      id="nt-hora"
                      type={bookingFueraGrilla ? 'time' : 'text'}
                      className={`nt-input ${
                        bookingFueraGrilla ? 'nt-input-hora-editable' : 'nt-input-hora-readonly'
                      }`}
                      value={bookingFueraGrilla ? bookingManualHm : (bookingSlotHm ?? '')}
                      onChange={(e) => {
                        if (bookingFueraGrilla) {
                          setBookingManualHm(e.target.value)
                        }
                      }}
                      readOnly={!bookingFueraGrilla}
                      placeholder="--:--"
                    />
                  </div>
                  <div className="nt-field">
                    <label className="nt-field__label" htmlFor="nt-duracion">
                      Duración
                    </label>
                    <select
                      id="nt-duracion"
                      className="nt-select"
                      value={bookingDuracion}
                      onChange={(e) => setBookingDuracion(Number(e.target.value))}
                    >
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={45}>45 min</option>
                      <option value={60}>60 min</option>
                    </select>
                  </div>
                </div>

                {/* Interruptor "Urgencia / fuera de grilla (hora manual)": tarjeta amarilla clicable */}
                <div
                  className={`nt-urgencia-card${bookingFueraGrilla ? ' nt-urgencia-card--active' : ''}`}
                  role="switch"
                  aria-checked={bookingFueraGrilla}
                  tabIndex={0}
                  onClick={() => {
                    const nextVal = !bookingFueraGrilla
                    setBookingFueraGrilla(nextVal)
                    if (nextVal) {
                      if (!bookingManualHm && bookingSlotHm) {
                        setBookingManualHm(bookingSlotHm)
                      }
                      setBookingSlotHm(null)
                    } else {
                      setBookingManualHm('')
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault()
                      const nextVal = !bookingFueraGrilla
                      setBookingFueraGrilla(nextVal)
                      if (nextVal) {
                        if (!bookingManualHm && bookingSlotHm) {
                          setBookingManualHm(bookingSlotHm)
                        }
                        setBookingSlotHm(null)
                      } else {
                        setBookingManualHm('')
                      }
                    }
                  }}
                >
                  <span className="nt-urgencia-card__label">
                    Urgencia / fuera de grilla (hora manual)
                  </span>
                  <span
                    className={`nt-urgencia-card__badge ${
                      bookingFueraGrilla
                        ? 'nt-urgencia-card__badge--on'
                        : 'nt-urgencia-card__badge--off'
                    }`}
                  >
                    {bookingFueraGrilla ? 'ON' : 'OFF'}
                  </span>
                </div>

                {/* Mensaje de disponibilidad (12 px) */}
                {bookingManualSlotCheck && !bookingManualSlotCheck.ok ? (
                  <p
                    style={{
                      color: 'var(--nt-danger)',
                      fontSize: '11px',
                      fontWeight: 700,
                      margin: 0,
                    }}
                  >
                    {bookingManualSlotCheck.message}
                  </p>
                ) : null}

                {/* Grilla de turnos (3 columnas) */}
                <div className="nt-slots-grid">
                  {!bookingDoctorId ? (
                    <div className="nt-horario-empty-hint">
                      Elegí un médico para ver los horarios.
                    </div>
                  ) : bookingSlots.length === 0 ? (
                    <div className="nt-horario-empty-hint">
                      No hay horarios disponibles para esta fecha.
                    </div>
                  ) : (
                    bookingSlots.map((s) => {
                      const isSelected = !bookingFueraGrilla && bookingSlotHm === s.hm
                      return (
                        <button
                          key={s.hm}
                          type="button"
                          className={`nt-slot-btn${isSelected ? ' nt-slot-btn--selected' : ''}`}
                          disabled={!bookingFueraGrilla && !s.available}
                          aria-pressed={isSelected}
                          title={s.available ? 'Disponible' : (s.reason || 'Ocupado')}
                          onClick={() => {
                            if (bookingFueraGrilla) {
                              setBookingManualHm(s.hm)
                            } else {
                              if (!s.available) return
                              setBookingSlotHm(s.hm)
                            }
                          }}
                        >
                          {s.hm}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Pie del modal */}
            <div className="nt-footer">
              <div className="nt-footer-status-wrap">
                {bookingEstado === 'pagado' ||
                (bookingTotalMonto > 0 && bookingEstado !== 'cancelado') ||
                Boolean(bookingPaymentId || bookingPaymentId2) ? (
                  <span className="nt-footer-status nt-footer-status--pagado">PAGO REGISTRADO</span>
                ) : isPlanCobertura ? (
                  <span className="nt-footer-status nt-footer-status--cobertura">
                    Cobertura sin abono
                  </span>
                ) : !bookingMonto.trim() && !bookingMonto2.trim() ? (
                  <span className="nt-footer-status nt-footer-status--programado">
                    DEBE ABONAR AL SER ATENDIDO
                  </span>
                ) : null}
              </div>

              <div className="nt-footer-actions">
                <button type="button" className="nt-btn-cancel" onClick={onResetForm}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="nt-btn-confirm"
                  disabled={
                    !bookingResolvedHm() ||
                    (bookingFueraGrilla &&
                      bookingManualSlotCheck !== null &&
                      !bookingManualSlotCheck.ok)
                  }
                >
                  {bookingEditingId ? 'Guardar cambios' : 'Confirmar turno'}
                </button>
                <button type="button" className="nt-btn-close" onClick={onClose}>
                  Salir
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Columna Lateral: Dos Pastillas (236px) */}
        <div className={`nt-col-side${sidePillsOpen ? '' : ' nt-col-side--hidden'}`}>
          {/* Pastilla 1: OBRAS SOCIALES · COLUMNA PLUS (EDITABLE) */}
          <div className="nt-side-pill">
            <div className="nt-side-pill__head">
              <h3 className="nt-side-pill__title">OBRAS SOCIALES · COLUMNA PLUS (EDITABLE)</h3>
              <div className="nt-side-pill__sub">PLUS CONFIGURABLE</div>
            </div>
            <div className="nt-side-pill__body">
              {obrasSocialesCatalog.map((os) => {
                const inputValue =
                  plusInputs[os.nombre] !== undefined
                    ? plusInputs[os.nombre]
                    : os.plus > 0
                    ? formatPesosAr(os.plus)
                    : ''

                return (
                  <div key={os.nombre} className="nt-pill-os-row">
                    <span className="nt-pill-os-name" title={os.nombre}>
                      {os.nombre}
                    </span>
                    <div className="nt-pill-os-input-wrap">
                      <span className="nt-pill-os-prefix">$</span>
                      <input
                        className="nt-pill-os-input"
                        inputMode="numeric"
                        placeholder="0"
                        value={inputValue}
                        onChange={(e) => handlePlusInputChange(os, e.target.value)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="nt-side-pill__footer">
              Cambiá un Plus y mirá cómo se actualiza el Monto del turno.
            </div>
          </div>

          {/* Pastilla 2: MÉDICOS Y SUS COBERTURAS */}
          <div className="nt-side-pill">
            <div className="nt-side-pill__head">
              <h3 className="nt-side-pill__title">MÉDICOS Y SUS COBERTURAS</h3>
              <div className="nt-side-pill__sub">OBRAS SOCIALES QUE ATIENDEN</div>
            </div>
            <div className="nt-side-pill__body">
              {medicosOrdenados.map((doc) => {
                const coberturasList: string[] = []
                if (Array.isArray(doc.obrasSociales) && doc.obrasSociales.length > 0) {
                  doc.obrasSociales.forEach((os) => {
                    const nombre = typeof os === 'string' ? os : os.nombre
                    if (nombre && nombre.trim()) coberturasList.push(nombre.trim())
                  })
                } else if (doc.obraSocial && doc.obraSocial.trim()) {
                  coberturasList.push(doc.obraSocial.trim())
                }

                const partVal = Math.round(Number(doc.particular || 0))
                if (partVal > 0) {
                  coberturasList.push(`Particular $ ${formatPesosAr(partVal)}`)
                } else if (coberturasList.length === 0) {
                  coberturasList.push('Particular (sin arancel)')
                }

                const resumen = coberturasList.join(' · ')

                return (
                  <div key={doc.id} className="nt-pill-med-item">
                    <div className="nt-pill-med-name">
                      {doc.apellido}, {doc.nombre}
                    </div>
                    <div className="nt-pill-med-coberturas">{resumen}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
