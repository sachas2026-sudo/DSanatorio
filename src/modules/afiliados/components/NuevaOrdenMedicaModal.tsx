import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAppState } from '../../../context/AppStateContext'
import { useAuth } from '../../../context/AuthContext'
import type { OrdenMedica, Patient, TipoOrdenMedica } from '../../../types'
import {
  agruparPrestaciones,
  normalizePrestacionKey,
  generarSiguienteNumeroOrden,
} from '../../../lib/prestacionesCatalog'
import { calcularConsumoAfiliadoMes } from '../../../lib/consumoAfiliados'
import { esContratanteDadoDeBaja, esContratanteSuspendido } from '../../../lib/contratantesMovimientos'
import { medicosActivos } from '../../../lib/activo'
import { buildOrdenMedicaPdf, buildOrdenMedicaHtml } from '../../../lib/ordenMedicaPdf'
import { pdfBlobUrl, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { PrestacionesModal } from './PrestacionesModal'
import type jsPDF from 'jspdf'
import '../pages/AfiliadosModern.css'

interface Props {
  onClose: () => void
  afiliadoSeleccionadoId?: string | null // patientId preseleccionado
  onPreviewPdf: (preview: {
    url: string
    filename: string
    title: string
    doc: jsPDF
    hidePrint?: boolean
  }) => void
}

interface OpcionAfiliado {
  patientId: string
  afiliadoId: string
  apellido: string
  nombre: string
  dni: string
  planId: string
  planNombre: string
  esAdherente: boolean
  relacion?: string
  suspendido: boolean
  dadoDeBaja: boolean
}

export function NuevaOrdenMedicaModal({
  onClose,
  afiliadoSeleccionadoId,
  onPreviewPdf,
}: Props) {
  const {
    data,
    prestacionesAfiliados,
    ordenesMedicas,
    emitirOrdenMedica,
  } = useAppState()
  const { session } = useAuth()

  // Lista unificada de afiliados elegibles (titulares y adherentes)
  const listaAfiliados = useMemo<OpcionAfiliado[]>(() => {
    const list: OpcionAfiliado[] = []
    const planes = data.planesAfiliados ?? []
    const patients = data.patients ?? []
    const afiliados = (data.afiliados ?? []).filter((a) => !esContratanteDadoDeBaja(a))

    for (const a of afiliados) {
      const plan = planes.find((p) => p.id === a.planId)
      const planNombre = plan?.nombre || 'Plan de Afiliado'
      const suspendido = esContratanteSuspendido(a)
      const dadoDeBaja = esContratanteDadoDeBaja(a)

      // 1. Titular
      const titularPac = patients.find((p) => p.id === a.patientId)
      if (titularPac) {
        list.push({
          patientId: titularPac.id,
          afiliadoId: a.id,
          apellido: titularPac.apellido,
          nombre: titularPac.nombre,
          dni: titularPac.dni || '',
          planId: a.planId,
          planNombre,
          esAdherente: false,
          suspendido,
          dadoDeBaja,
        })
      }

      // 2. Adherentes
      if (Array.isArray(a.adherentes)) {
        for (const adh of a.adherentes) {
          const adhPac = patients.find((p) => p.id === adh.patientId)
          if (adhPac) {
            list.push({
              patientId: adhPac.id,
              afiliadoId: a.id,
              apellido: adhPac.apellido,
              nombre: adhPac.nombre,
              dni: adhPac.dni || '',
              planId: a.planId,
              planNombre,
              esAdherente: true,
              relacion: adh.relacion || 'Adherente',
              suspendido,
              dadoDeBaja,
            })
          }
        }
      }
    }

    return list.sort((a, b) => a.apellido.localeCompare(b.apellido, 'es'))
  }, [data.afiliados, data.planesAfiliados, data.patients])

  // Estado del formulario
  const [selectedPatientId, setSelectedPatientId] = useState<string>(() => {
    return afiliadoSeleccionadoId || ''
  })

  // Sincronizar si cambia el paciente preseleccionado desde afuera
  useEffect(() => {
    if (afiliadoSeleccionadoId) {
      setSelectedPatientId(afiliadoSeleccionadoId)
    }
  }, [afiliadoSeleccionadoId])
  const [tipo, setTipo] = useState<TipoOrdenMedica>('consulta')
  const [prestacionElegida, setPrestacionElegida] = useState<string>('')
  const [medicoId, setMedicoId] = useState<string>('')
  const [fecha, setFecha] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [observaciones, setObservaciones] = useState<string>('')

  // Médicos activos ordenados alfabéticamente (base de médicos del menú Médicos)
  const medicosDisponibles = useMemo(() => {
    return [...medicosActivos(data.doctors ?? [])].sort((a, b) =>
      `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es', {
        sensitivity: 'base',
      }),
    )
  }, [data.doctors])

  const medicoSeleccionado = useMemo(() => {
    if (!medicoId) return null
    return (data.doctors ?? []).find((d) => d.id === medicoId) ?? null
  }, [data.doctors, medicoId])

  const medicoNombre = useMemo(() => {
    if (!medicoSeleccionado) return undefined
    const ap = medicoSeleccionado.apellido ? `${medicoSeleccionado.apellido}, ` : ''
    const esp = medicoSeleccionado.especialidad ? ` (${medicoSeleccionado.especialidad})` : ''
    return `${ap}${medicoSeleccionado.nombre}${esp}`
  }, [medicoSeleccionado])

  // Modal secundario de prestaciones (engranaje)
  const [modalPrestacionesOpen, setModalPrestacionesOpen] = useState(false)

  // Estado de confirmación de orden emitida
  const [ordenEmitida, setOrdenEmitida] = useState<OrdenMedica | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Cerrar con Escape (si no está abierto el modal de prestaciones)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !modalPrestacionesOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, modalPrestacionesOpen])

  // Afiliado actualmente seleccionado en el form
  const afiliadoActual = useMemo(() => {
    return listaAfiliados.find((x) => x.patientId === selectedPatientId) ?? null
  }, [listaAfiliados, selectedPatientId])

  // Consumo de consultas del afiliado actual para el mes de la orden
  const consumoInfo = useMemo(() => {
    if (!afiliadoActual) return null
    const plan = (data.planesAfiliados ?? []).find((p) => p.id === afiliadoActual.planId)
    if (!plan) return null

    let fechaObj = new Date()
    try {
      if (fecha) {
        const parts = fecha.split('-').map(Number)
        if (parts.length === 3) {
          fechaObj = new Date(parts[0], parts[1] - 1, parts[2])
        }
      }
    } catch {
      // fallback hoy
    }

    const consumo = calcularConsumoAfiliadoMes({
      patientId: afiliadoActual.patientId,
      anio: fechaObj.getFullYear(),
      mes: fechaObj.getMonth() + 1,
      plan,
      appointments: data.appointments ?? [],
      ordenesMedicas: ordenesMedicas ?? [],
    })

    return {
      plan,
      consumo,
      textoConsultas:
        plan.cupoConsultas > 0
          ? `${consumo.consultasUsadas} de ${plan.cupoConsultas}`
          : `${consumo.consultasUsadas} (sin límite)`,
      textoPrestaciones:
        (plan.prestacionesPorMes ?? 0) > 0
          ? `${consumo.prestacionesUsadas} de ${plan.prestacionesPorMes}`
          : `${consumo.prestacionesUsadas} (sin límite)`,
    }
  }, [afiliadoActual, data.planesAfiliados, data.appointments, ordenesMedicas, fecha])

  // Prestaciones activas agrupadas por categoría
  const prestacionesAgrupadas = useMemo(() => {
    const list = prestacionesAfiliados.filter((p) => p.activa)
    return agruparPrestaciones(list, true)
  }, [prestacionesAfiliados])

  // Validación de habilitación
  const puedeEmitir = useMemo(() => {
    if (!selectedPatientId) return false
    if (afiliadoActual?.suspendido || afiliadoActual?.dadoDeBaja) return false
    if (tipo === 'prestacion' && !prestacionElegida.trim()) return false
    return true
  }, [selectedPatientId, afiliadoActual, tipo, prestacionElegida])

  // Helper para generar PDF (sea en vista previa o ya emitida)
  function generarPdf(ordenParaPdf?: OrdenMedica) {
    if (!afiliadoActual) return null
    const patient = (data.patients ?? []).find((p) => p.id === afiliadoActual.patientId)
    if (!patient) return null

    const ordenFinal: OrdenMedica = ordenParaPdf ?? {
      id: 'preview',
      numero: generarSiguienteNumeroOrden(ordenesMedicas),
      patientId: afiliadoActual.patientId,
      afiliadoId: afiliadoActual.afiliadoId,
      planNombre: afiliadoActual.planNombre,
      tipo,
      prestacionNombre: tipo === 'prestacion' ? prestacionElegida : undefined,
      medicoId: medicoId || undefined,
      medicoNombre,
      fecha: fecha || format(new Date(), 'yyyy-MM-dd'),
      observaciones,
      usuario: session?.displayName || session?.username || 'Administración',
      creadaEn: new Date().toISOString(),
    }

    return buildOrdenMedicaPdf({
      orden: ordenFinal,
      patient,
      centroNombre: 'SANATORIO',
      consumo: consumoInfo
        ? {
            consultasUsadas: consumoInfo.consumo.consultasUsadas,
            consultasCupo: consumoInfo.plan.cupoConsultas,
            prestacionesUsadas: consumoInfo.consumo.prestacionesUsadas,
            prestacionesCupo: consumoInfo.plan.prestacionesPorMes ?? 0,
          }
        : undefined,
    })
  }

  // Vista previa PDF
  function handlePdfClick() {
    setErrorMsg(null)
    const built = generarPdf(ordenEmitida ?? undefined)
    if (!built) return
    onPreviewPdf({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: `Orden Médica ${ordenEmitida?.numero || 'Borrador'}`,
      doc: built.doc,
      hidePrint: true,
    })
  }

  // Imprimir directamente a la impresora predeterminada del sistema (sin vista previa)
  function handleImprimirDirecto() {
    setErrorMsg(null)
    if (!afiliadoActual) return
    const orden = ordenEmitida ?? undefined
    if (!orden) return

    const patientObj = (data.patients ?? []).find((p) => p.id === afiliadoActual.patientId)
    if (!patientObj) return

    const html = buildOrdenMedicaHtml({
      orden,
      patient: patientObj,
      centroNombre: 'SANATORIO',
      consumo: consumoInfo
        ? {
            consultasUsadas: consumoInfo.consumo.consultasUsadas,
            consultasCupo: consumoInfo.plan.cupoConsultas ?? 0,
            prestacionesUsadas: consumoInfo.consumo.prestacionesUsadas,
            prestacionesCupo: consumoInfo.plan.prestacionesPorMes ?? 0,
          }
        : undefined,
    })

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.top = '-10000px'
    iframe.style.left = '-10000px'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = 'none'
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (doc) {
      doc.open()
      doc.write(html)
      doc.close()

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
        } catch (err) {
          console.error('Error al invocar impresión directa:', err)
        } finally {
          setTimeout(() => {
            try {
              document.body.removeChild(iframe)
            } catch {
              // ignore
            }
          }, 30000)
        }
      }, 250)
    }
  }

  // Emitir orden médica
  function handleEmitir() {
    setErrorMsg(null)
    if (!afiliadoActual) {
      setErrorMsg('Seleccioná un contratante o paciente.')
      return
    }
    if (afiliadoActual.dadoDeBaja) {
      setErrorMsg('Contratante dado de baja')
      return
    }
    if (afiliadoActual.suspendido) {
      setErrorMsg('Contratante suspendido')
      return
    }
    if (tipo === 'prestacion' && !prestacionElegida.trim()) {
      setErrorMsg('Seleccioná una prestación médica.')
      return
    }

    const res = emitirOrdenMedica({
      patientId: afiliadoActual.patientId,
      afiliadoId: afiliadoActual.afiliadoId,
      planNombre: afiliadoActual.planNombre,
      tipo,
      prestacionNombre: tipo === 'prestacion' ? prestacionElegida.trim() : undefined,
      medicoId: medicoId || undefined,
      medicoNombre,
      fecha: fecha || format(new Date(), 'yyyy-MM-dd'),
      observaciones: observaciones.trim() || undefined,
      usuario: session?.displayName || session?.username || 'Administración',
    })

    if (res.ok && res.orden) {
      setOrdenEmitida(res.orden)
    } else {
      setErrorMsg(res.error || 'No se pudo emitir la orden médica.')
    }
  }

  // Limpiar para nueva orden conservando el afiliado seleccionado en la tabla
  function handleNuevaOrden() {
    setOrdenEmitida(null)
    setErrorMsg(null)
    setTipo('consulta')
    setPrestacionElegida('')
    setMedicoId('')
    setFecha(format(new Date(), 'yyyy-MM-dd'))
    setObservaciones('')
    if (afiliadoSeleccionadoId) {
      setSelectedPatientId(afiliadoSeleccionadoId)
    }
  }

  return (
    <>
      <div
        className="af-modal-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="af-modal af-modal-dialog"
          style={{ maxWidth: 580, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="nueva-om-title"
        >
          {/* Cabecera */}
          <div className="af-modal__head" style={{ borderBottom: '1px solid var(--border)' }}>
            <div>
              <h2 id="nueva-om-title" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--heading)' }}>
                {ordenEmitida ? 'Orden emitida' : 'Nueva orden médica'}
              </h2>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                {ordenEmitida
                  ? `Comprobante oficial ${ordenEmitida.numero}`
                  : 'Emisión de órdenes para consultas y prácticas'}
              </span>
            </div>
            <button
              type="button"
              className="af-btn af-btn--icon"
              onClick={onClose}
              aria-label="Cerrar modal"
              title="Cerrar (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Mensaje de error */}
          {errorMsg && (
            <div
              style={{
                margin: '0.6rem 1.25rem 0',
                padding: '0.5rem 0.75rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: 600,
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Cuerpo: Formulario o Confirmación */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.1rem 1.25rem' }}>
            {ordenEmitida ? (
              /* ── PANTALLA DE CONFIRMACIÓN TRAS EMITIR ── */
              <div style={{ textAlign: 'center', padding: '1.2rem 0.5rem' }}>
                <div
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: '50%',
                    background: '#ecfdf5',
                    border: '2px solid #a7f3d0',
                    color: '#059669',
                    fontSize: '1.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 1rem',
                  }}
                  aria-hidden="true"
                >
                  ✓
                </div>

                <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#065f46', margin: '0 0 0.35rem' }}>
                  Orden {ordenEmitida.numero} emitida
                </h3>

                <p style={{ fontSize: '0.9rem', color: '#475569', marginBottom: '1.25rem' }}>
                  La orden fue registrada y numerada correlativamente en el sistema.
                </p>

                {/* Resumen */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '0.9rem 1rem',
                    textAlign: 'left',
                    fontSize: '0.86rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.45rem',
                    marginBottom: '1.5rem',
                  }}
                >
                  <div>
                    <span style={{ color: '#64748b' }}>Contratante / Paciente: </span>
                    <strong style={{ color: '#0f172a' }}>
                      {afiliadoActual?.apellido}, {afiliadoActual?.nombre}
                    </strong>
                    {afiliadoActual?.dni && (
                      <span style={{ color: '#64748b', fontSize: '0.8rem' }}> (DNI {afiliadoActual.dni})</span>
                    )}
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Cobertura: </span>
                    <strong style={{ color: '#0284c7' }}>{ordenEmitida.planNombre}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Tipo: </span>
                    <strong>{ordenEmitida.tipo === 'consulta' ? 'Consulta Médica' : 'Prestación'}</strong>
                    {ordenEmitida.tipo === 'prestacion' && ordenEmitida.prestacionNombre && (
                      <span> · {ordenEmitida.prestacionNombre}</span>
                    )}
                  </div>
                  {ordenEmitida.medicoNombre && (
                    <div>
                      <span style={{ color: '#64748b' }}>Pedido del médico: </span>
                      <strong style={{ color: '#0f172a' }}>{ordenEmitida.medicoNombre}</strong>
                    </div>
                  )}
                  <div>
                    <span style={{ color: '#64748b' }}>Fecha: </span>
                    <span>{ordenEmitida.fecha}</span>
                  </div>
                  {ordenEmitida.observaciones && (
                    <div>
                      <span style={{ color: '#64748b' }}>Observaciones: </span>
                      <span style={{ fontStyle: 'italic' }}>{ordenEmitida.observaciones}</span>
                    </div>
                  )}
                </div>

                {/* Botones de la confirmación */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="af-btn af-btn--primary"
                    style={{
                      background: '#0891b2',
                      borderColor: '#0891b2',
                      color: '#ffffff',
                      fontWeight: 700,
                    }}
                    onClick={handleImprimirDirecto}
                    title="Imprimir a la impresora predeterminada del sistema"
                  >
                    Imprimir
                  </button>
                  <button
                    type="button"
                    className="af-btn"
                    style={{ background: '#f0f9ff', borderColor: '#bae6fd', color: '#0284c7' }}
                    onClick={handlePdfClick}
                    title="Ver PDF o descargar comprobante"
                  >
                    Ver PDF
                  </button>
                  <button type="button" className="af-btn" onClick={handleNuevaOrden}>
                    + Nueva orden
                  </button>
                  <button
                    type="button"
                    className="af-btn"
                    style={{ minWidth: 80, justifyContent: 'center' }}
                    onClick={onClose}
                  >
                    Salir
                  </button>
                </div>
              </div>
            ) : (
              /* ── FORMULARIO DE EMISIÓN ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* 1. Contratante / Paciente */}
                <div className="af-field">
                  <label htmlFor="om-afiliado">Contratante / Paciente</label>
                  <select
                    id="om-afiliado"
                    className="af-select"
                    value={selectedPatientId}
                    onChange={(e) => {
                      setSelectedPatientId(e.target.value)
                      if (errorMsg) setErrorMsg(null)
                    }}
                  >
                    <option value="">— Seleccionar contratante o adherente —</option>
                    {listaAfiliados.map((a) => (
                      <option key={`${a.afiliadoId}_${a.patientId}`} value={a.patientId}>
                        {a.apellido}, {a.nombre} {a.dni ? `· DNI ${a.dni}` : ''}{' '}
                        {a.esAdherente ? `(${a.relacion || 'Adherente'})` : '(Titular)'} — {a.planNombre}
                        {a.suspendido ? ' [SUSPENDIDO]' : ''}
                      </option>
                    ))}
                  </select>

                  {afiliadoActual?.suspendido && (
                    <div
                      role="alert"
                      style={{
                        marginTop: '0.45rem',
                        padding: '0.45rem 0.7rem',
                        borderRadius: '6px',
                        background: '#f5f3ff',
                        border: '1px solid #c4b5fd',
                        color: '#5b21b6',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                      }}
                    >
                      Contratante suspendido — No se pueden emitir órdenes médicas mientras dure la suspensión.
                    </div>
                  )}

                  {/* Chip informativo del plan y consultas usadas */}
                  {afiliadoActual && consumoInfo && (
                    <div
                      style={{
                        marginTop: '0.4rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                        fontSize: '0.78rem',
                      }}
                    >
                      <span
                        style={{
                          background: '#e0f2fe',
                          color: '#0369a1',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '6px',
                          fontWeight: 700,
                        }}
                      >
                        {afiliadoActual.planNombre}
                      </span>
                      <span style={{ color: '#475569', fontWeight: 500 }}>
                        Consultas usadas: <strong>{consumoInfo.textoConsultas}</strong>
                      </span>
                      {(consumoInfo.plan.prestacionesPorMes ?? 0) > 0 && (
                        <span style={{ color: '#475569', fontWeight: 500 }}>
                          · Prestaciones: <strong>{consumoInfo.textoPrestaciones}</strong>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. Tipo de orden: Dos tarjetas */}
                <div className="af-field">
                  <label>Tipo de orden</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setTipo('consulta')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setTipo('consulta')
                      }}
                      style={{
                        border: `2px solid ${tipo === 'consulta' ? 'var(--primary)' : '#cbd5e1'}`,
                        background: tipo === 'consulta' ? '#f0fdf4' : '#ffffff',
                        borderRadius: '8px',
                        padding: '0.65rem 0.8rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          color: tipo === 'consulta' ? '#15803d' : '#334155',
                        }}
                      >
                        Consulta
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.15rem' }}>
                        Atención con el profesional
                      </div>
                    </div>

                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setTipo('prestacion')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setTipo('prestacion')
                      }}
                      style={{
                        border: `2px solid ${tipo === 'prestacion' ? 'var(--primary)' : '#cbd5e1'}`,
                        background: tipo === 'prestacion' ? '#f0fdf4' : '#ffffff',
                        borderRadius: '8px',
                        padding: '0.65rem 0.8rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          color: tipo === 'prestacion' ? '#15803d' : '#334155',
                        }}
                      >
                        Prestación
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.15rem' }}>
                        Estudio o práctica puntual
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Prestación (solo si tipo === 'prestacion') */}
                {tipo === 'prestacion' && (
                  <div className="af-field">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <label htmlFor="om-prestacion" style={{ margin: 0 }}>
                        Prestación
                      </label>
                      <button
                        type="button"
                        className="af-btn af-btn--icon"
                        onClick={() => setModalPrestacionesOpen(true)}
                        title="Administrar prestaciones"
                        aria-label="Administrar prestaciones (engranaje)"
                        style={{ padding: '0.2rem 0.35rem', fontSize: '0.95rem' }}
                      >
                        ⚙️
                      </button>
                    </div>

                    {/* Selector de prestaciones */}
                    <select
                      id="om-prestacion"
                      className="af-select"
                      value={prestacionElegida}
                      onChange={(e) => {
                        setPrestacionElegida(e.target.value)
                        if (errorMsg) setErrorMsg(null)
                      }}
                    >
                      <option value="">— Elegir prestación —</option>
                      {[...prestacionesAgrupadas.entries()].map(([grupoNombre, items]) => (
                        <optgroup key={grupoNombre} label={grupoNombre}>
                          {items.map((p) => (
                            <option key={p.id} value={p.nombre}>
                              {p.nombre}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                )}

                {/* 4. Campo Pedido del Médico (disponible tanto en Consulta como en Prestación) */}
                <div className="af-field">
                  <label htmlFor="om-medico">
                    Pedido del Médico <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span>
                  </label>

                  <select
                    id="om-medico"
                    className="af-select"
                    value={medicoId}
                    onChange={(e) => setMedicoId(e.target.value)}
                  >
                    <option value="">— Seleccionar médico —</option>
                    {medicosDisponibles.map((m) => {
                      const ap = m.apellido ? `${m.apellido}, ` : ''
                      const esp = m.especialidad ? ` (${m.especialidad})` : ''
                      return (
                        <option key={m.id} value={m.id}>
                          {ap}{m.nombre}{esp}
                        </option>
                      )
                    })}
                  </select>
                </div>

                {/* 4. Fecha */}
                <div className="af-field">
                  <label htmlFor="om-fecha">Fecha</label>
                  <input
                    id="om-fecha"
                    className="af-input"
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                  />
                </div>

                {/* 5. Observaciones */}
                <div className="af-field">
                  <label htmlFor="om-obs">
                    Observaciones <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span>
                  </label>
                  <textarea
                    id="om-obs"
                    className="af-input af-textarea"
                    rows={3}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      minHeight: 74,
                      resize: 'vertical',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border, #cbd5e1)',
                      fontSize: '0.88rem',
                      fontFamily: 'inherit',
                      lineHeight: 1.4,
                    }}
                    placeholder="Diagnóstico presuntivo, indicaciones clínicas…"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Pie con botones */}
          {!ordenEmitida && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.75rem',
                padding: '1.25rem 1.25rem 1.35rem',
                borderTop: '1px solid var(--border)',
                background: '#ffffff',
              }}
            >
              <button
                type="button"
                className="af-btn"
                style={{ minWidth: 90, justifyContent: 'center' }}
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="af-btn"
                style={{
                  background: '#f0f9ff',
                  borderColor: '#bae6fd',
                  color: '#0284c7',
                  minWidth: 80,
                  justifyContent: 'center',
                }}
                disabled={!puedeEmitir}
                onClick={handlePdfClick}
                title="Ver vista previa de la orden en PDF"
              >
                PDF
              </button>
              <button
                type="button"
                className="af-btn af-btn--primary"
                style={{
                  minWidth: 120,
                  justifyContent: 'center',
                  background: '#0891b2',
                  borderColor: '#0891b2',
                  color: '#ffffff',
                  fontWeight: 600,
                }}
                disabled={!puedeEmitir}
                onClick={handleEmitir}
              >
                Emitir orden
              </button>
              <button
                type="button"
                className="af-btn"
                style={{ minWidth: 80, justifyContent: 'center' }}
                onClick={onClose}
              >
                Salir
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal secundario de administración de prestaciones (engranaje) */}
      {modalPrestacionesOpen && (
        <PrestacionesModal
          onClose={() => setModalPrestacionesOpen(false)}
          prestacionSeleccionada={prestacionElegida}
          onPrestacionEliminada={(nombreEliminado) => {
            if (
              normalizePrestacionKey(prestacionElegida) ===
              normalizePrestacionKey(nombreEliminado)
            ) {
              setPrestacionElegida('')
            }
          }}
        />
      )}
    </>
  )
}
