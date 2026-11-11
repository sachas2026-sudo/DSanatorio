import { useCallback, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import type {
  AdherenteAfiliado,
  Afiliado,
  CuotaMensual,
  FormaPago,
  Patient,
  PlanAfiliado,
} from '../../../types'

export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

export interface AdherenteDetalleItem {
  adherente: AdherenteAfiliado
  paciente?: Patient
  consultasUsadas: number
  cupoConsultas: number
  prestacionesUsadas: number
  cupoPrestaciones: number
  ordenesCount: number
}

export interface UseDetalleContratanteOptions {
  afiliado?: Afiliado
  paciente?: Patient
  plan?: PlanAfiliado
  cuotas?: CuotaMensual[]
  adherentesDetalle?: AdherenteDetalleItem[]
  onCobrarCuota?: (cuota: CuotaMensual) => Promise<void> | void
  onAnularCuota?: (cuota: CuotaMensual) => Promise<void> | void
  onChangeMedioPago?: (cuota: CuotaMensual, medio: FormaPago) => Promise<void> | void
  onSuspenderReactivar?: (afiliado: Afiliado) => Promise<void> | void
  onDarDeBaja?: (afiliado: Afiliado) => Promise<void> | void
  onQuitarAdherente?: (patientId: string) => Promise<void> | void
  confirmFn?: (options: { title?: string; message: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>
}

// Datos de ejemplo por defecto (según especificación)
const DEFAULT_SAMPLE_AFILIADO: Afiliado = {
  id: 'sample-afiliado-sawallisch',
  patientId: 'sample-pac-sawallisch',
  planId: 'plan-familiar',
  fechaInicio: '2026-11-09',
  activo: true,
  adherentes: [
    {
      patientId: 'sample-pac-ramirez',
      relacion: 'Hijo/a',
      fechaAlta: '2026-11-09',
    },
  ],
}

const DEFAULT_SAMPLE_PACIENTE: Patient = {
  id: 'sample-pac-sawallisch',
  apellido: 'SAWALLISCH',
  nombre: 'LUIS ALBERTO',
  dni: '62',
  obraSocial: 'Familiar',
  fechaNacimiento: '1975-04-12',
}

const DEFAULT_SAMPLE_PLAN: PlanAfiliado = {
  id: 'plan-familiar',
  nombre: 'Familiar',
  tipo: 'familiar',
  precio: 70000,
  descripcion: 'Plan Familiar Cuidar',
  activo: true,
  cupoConsultas: 3,
  prestacionesPorMes: 3,
  maxAdherentes: 4,
}

const DEFAULT_SAMPLE_ADHERENTES: AdherenteDetalleItem[] = [
  {
    adherente: {
      patientId: 'sample-pac-ramirez',
      relacion: 'Hijo/a',
      fechaAlta: '2026-11-09',
    },
    paciente: {
      id: 'sample-pac-ramirez',
      apellido: 'ramirez',
      nombre: 'sonia',
      dni: '33333333',
      fechaNacimiento: '2000-12-12',
      obraSocial: 'Familiar',
    },
    consultasUsadas: 0,
    cupoConsultas: 3,
    prestacionesUsadas: 0,
    cupoPrestaciones: 3,
    ordenesCount: 0,
  },
]

const DEFAULT_SAMPLE_CUOTAS: CuotaMensual[] = [
  {
    id: 'cuota-2026-11',
    afiliadoId: 'sample-afiliado-sawallisch',
    mes: 11,
    anio: 2026,
    monto: 70000,
    estado: 'pagado',
    fechaPago: '2026-11-10',
    formaPago: 'efectivo',
    comprobante: true,
    notas: '',
    usos: 0,
  },
  {
    id: 'cuota-2026-12',
    afiliadoId: 'sample-afiliado-sawallisch',
    mes: 12,
    anio: 2026,
    monto: 70000,
    estado: 'pagado',
    fechaPago: '2026-11-10',
    formaPago: 'efectivo',
    comprobante: true,
    notas: '',
    usos: 0,
  },
]

export function useDetalleContratante(options: UseDetalleContratanteOptions = {}) {
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    return new Date().getFullYear()
  })

  const [activeTab, setActiveTab] = useState<'cuotas' | 'adherentes' | 'cobertura'>('cuotas')
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Afiliado, paciente y plan (con fallback a datos de ejemplo)
  const [localAfiliado, setLocalAfiliado] = useState<Afiliado>(
    options.afiliado ?? DEFAULT_SAMPLE_AFILIADO,
  )
  const paciente = options.paciente ?? DEFAULT_SAMPLE_PACIENTE
  const plan = options.plan ?? DEFAULT_SAMPLE_PLAN

  // Sincronizar si cambian los props externos
  const afiliado = options.afiliado ?? localAfiliado

  // Lista local de cuotas
  const [localCuotas, setLocalCuotas] = useState<CuotaMensual[]>(() => {
    return options.cuotas && options.cuotas.length > 0
      ? options.cuotas
      : DEFAULT_SAMPLE_CUOTAS
  })

  // Lista local de adherentes
  const [localAdherentes, setLocalAdherentes] = useState<AdherenteDetalleItem[]>(() => {
    return options.adherentesDetalle && options.adherentesDetalle.length > 0
      ? options.adherentesDetalle
      : DEFAULT_SAMPLE_ADHERENTES
  })

  // Toast auto-dismiss de 2 segundos
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    window.setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur))
    }, 2000)
  }, [])

  // Confirmación
  const askConfirm = useCallback(
    async (message: string, title?: string, confirmLabel?: string) => {
      if (options.confirmFn) {
        return await options.confirmFn({
          title,
          message,
          confirmLabel: confirmLabel ?? 'Confirmar',
          cancelLabel: 'Cancelar',
        })
      }
      return window.confirm(message)
    },
    [options.confirmFn],
  )

  // Mes de inicio de la contratación (1-12). Si no hay fecha se asume mes 1.
  const inicioContrato = useMemo(() => {
    if (!afiliado.fechaInicio) return { anio: 0, mes: 1 }
    try {
      const d = parseISO(afiliado.fechaInicio)
      return { anio: d.getFullYear(), mes: d.getMonth() + 1 }
    } catch {
      return { anio: 0, mes: 1 }
    }
  }, [afiliado.fechaInicio])

  // Cuotas del año seleccionado, ocultando meses anteriores a la contratación
  const cuotasDelAnio = useMemo(() => {
    const list = options.cuotas ?? localCuotas
    return list
      .filter((c) => {
        if (c.afiliadoId !== afiliado.id || c.anio !== selectedYear) return false
        // Si el año seleccionado es el año de inicio, solo mostrar desde el mes de inicio
        if (inicioContrato.anio === selectedYear && c.mes < inicioContrato.mes) return false
        return true
      })
      .sort((a, b) => a.mes - b.mes)
  }, [options.cuotas, localCuotas, afiliado.id, selectedYear, inicioContrato])

  // KPIs del año seleccionado
  const kpis = useMemo(() => {
    const pagadas = cuotasDelAnio.filter((c) => c.estado === 'pagado').length
    const pendientes = cuotasDelAnio.filter((c) => c.estado !== 'pagado').length
    const cobrado = cuotasDelAnio
      .filter((c) => c.estado === 'pagado')
      .reduce((sum, c) => sum + (c.monto || 0), 0)
    const adeudado = cuotasDelAnio
      .filter((c) => c.estado !== 'pagado')
      .reduce((sum, c) => sum + (c.monto || 0), 0)

    return { pagadas, pendientes, cobrado, adeudado }
  }, [cuotasDelAnio])

  // Estado del contratante
  const isSuspendido = Boolean(
    afiliado.suspension?.activa ||
      (afiliado.suspension?.desde && !afiliado.suspension?.hasta) ||
      (afiliado.suspension?.desde &&
        afiliado.suspension.hasta &&
        format(new Date(), 'yyyy-MM-dd') >= afiliado.suspension.desde &&
        format(new Date(), 'yyyy-MM-dd') <= afiliado.suspension.hasta),
  )

  const estadoBadge = useMemo(() => {
    if (isSuspendido) {
      return {
        label: 'Suspendido',
        type: 'suspendido' as const,
        style: { color: '#b45309', background: '#fdeccb' },
      }
    }
    if (kpis.pendientes > 0) {
      return {
        label: `Debe ${kpis.pendientes}`,
        type: 'deudor' as const,
        style: { color: '#b45309', background: '#fdeccb' },
      }
    }
    return {
      label: 'Al día',
      type: 'al_dia' as const,
      style: { color: '#15803d', background: '#d3f2dd' },
    }
  }, [isSuspendido, kpis.pendientes])

  // Formato de fecha contrato: "9-11-26"
  const fechaContratoFormateada = useMemo(() => {
    if (!afiliado.fechaInicio) return '—'
    try {
      const d = parseISO(afiliado.fechaInicio)
      return format(d, 'd-M-yy')
    } catch {
      return afiliado.fechaInicio
    }
  }, [afiliado.fechaInicio])

  // Acciones sobre cuotas
  const handleCobrar = useCallback(
    async (cuota: CuotaMensual) => {
      const hoyStr = format(new Date(), 'yyyy-MM-dd')
      const updated: CuotaMensual = {
        ...cuota,
        estado: 'pagado',
        fechaPago: hoyStr,
        formaPago: cuota.formaPago || 'efectivo',
      }

      if (options.onCobrarCuota) {
        await options.onCobrarCuota(updated)
      } else {
        setLocalCuotas((prev) =>
          prev.map((c) => (c.id === cuota.id ? updated : c)),
        )
      }

      const mesNombre = MESES[cuota.mes - 1] || `Mes ${cuota.mes}`
      showToast(`Cuota de ${mesNombre} cobrada`)
    },
    [options.onCobrarCuota, showToast],
  )

  const handleAnular = useCallback(
    async (cuota: CuotaMensual) => {
      const mesNombre = MESES[cuota.mes - 1] || `Mes ${cuota.mes}`
      const ok = await askConfirm(
        `¿Querés anular el pago de la cuota de ${mesNombre}? Pasará a estado pendiente.`,
        'Anular pago de cuota',
        'Anular pago',
      )
      if (!ok) return

      const updated: CuotaMensual = {
        ...cuota,
        estado: 'pendiente',
        fechaPago: null,
      }

      if (options.onAnularCuota) {
        await options.onAnularCuota(updated)
      } else {
        setLocalCuotas((prev) =>
          prev.map((c) => (c.id === cuota.id ? updated : c)),
        )
      }

      showToast(`Cuota de ${mesNombre} pasada a pendiente`)
    },
    [askConfirm, options.onAnularCuota, showToast],
  )

  const handleMedioPagoChange = useCallback(
    async (cuota: CuotaMensual, nuevoMedio: FormaPago) => {
      const updated: CuotaMensual = {
        ...cuota,
        formaPago: nuevoMedio,
      }

      if (options.onChangeMedioPago) {
        await options.onChangeMedioPago(cuota, nuevoMedio)
      } else {
        setLocalCuotas((prev) =>
          prev.map((c) => (c.id === cuota.id ? updated : c)),
        )
      }
    },
    [options.onChangeMedioPago],
  )

  const handleSuspenderOReactivar = useCallback(async () => {
    if (options.onSuspenderReactivar) {
      await options.onSuspenderReactivar(afiliado)
    } else {
      setLocalAfiliado((prev) => ({
        ...prev,
        suspension: isSuspendido
          ? undefined
          : {
              desde: format(new Date(), 'yyyy-MM-dd'),
              motivo: 'A pedido del contratante',
              activa: true,
            },
      }))
    }
    showToast(isSuspendido ? 'Contratante reactivado' : 'Contratante suspendido')
  }, [afiliado, isSuspendido, options.onSuspenderReactivar, showToast])

  const handleDarDeBaja = useCallback(async () => {
    const ok = await askConfirm(
      '¿Dar de baja a este contratante? Se terminará la cobertura y se conservará el historial.',
      'Dar de baja contratante',
      'Dar de baja',
    )
    if (!ok) return

    if (options.onDarDeBaja) {
      await options.onDarDeBaja(afiliado)
    } else {
      setLocalAfiliado((prev) => ({
        ...prev,
        activo: false,
        baja: {
          fecha: format(new Date(), 'yyyy-MM-dd'),
          motivo: 'A pedido del contratante',
        },
      }))
    }
    showToast('Contratante dado de baja')
  }, [afiliado, askConfirm, options.onDarDeBaja, showToast])

  const handleQuitarAdherente = useCallback(
    async (patientId: string, nombreCompleto: string) => {
      const ok = await askConfirm(
        `¿Quitar a ${nombreCompleto} de los adherentes? Se restaurará su obra social anterior.`,
        'Quitar adherente',
        'Quitar',
      )
      if (!ok) return

      if (options.onQuitarAdherente) {
        await options.onQuitarAdherente(patientId)
      } else {
        setLocalAdherentes((prev) =>
          prev.filter((item) => item.adherente.patientId !== patientId),
        )
      }
      showToast(`${nombreCompleto} quitado de adherentes`)
    },
    [askConfirm, options.onQuitarAdherente, showToast],
  )

  return {
    selectedYear,
    setSelectedYear,
    activeTab,
    setActiveTab,
    toastMessage,
    afiliado,
    paciente,
    plan,
    cuotasDelAnio,
    kpis,
    isSuspendido,
    estadoBadge,
    fechaContratoFormateada,
    adherentes: options.adherentesDetalle ?? localAdherentes,
    handleCobrar,
    handleAnular,
    handleMedioPagoChange,
    handleSuspenderOReactivar,
    handleDarDeBaja,
    handleQuitarAdherente,
  }
}

