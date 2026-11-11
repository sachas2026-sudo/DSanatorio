import React from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  IconPrinter,
  IconTrash,
  IconWhatsApp,
} from '../../../shared/components/icons'
import { useConfirm } from '../../../context/ConfirmContext'
import type {
  AdherenteAfiliado,
  Afiliado,
  CuotaMensual,
  FormaPago,
  Patient,
  PlanAfiliado,
} from '../../../types'
import {
  MESES,
  useDetalleContratante,
  type AdherenteDetalleItem,
} from './useDetalleContratante'
import './detalle-contratante.css'

export interface DetalleContratanteCuotasProps {
  afiliado?: Afiliado
  paciente?: Patient
  plan?: PlanAfiliado
  cuotas?: CuotaMensual[]
  adherentesDetalle?: AdherenteDetalleItem[]
  onVolver?: () => void
  onCobrarCuota?: (cuota: CuotaMensual) => Promise<void> | void
  onAnularCuota?: (cuota: CuotaMensual) => Promise<void> | void
  onChangeMedioPago?: (cuota: CuotaMensual, medio: FormaPago) => Promise<void> | void
  onSuspenderReactivar?: (afiliado: Afiliado) => Promise<void> | void
  onDarDeBaja?: (afiliado: Afiliado) => Promise<void> | void
  onQuitarAdherente?: (patientId: string) => Promise<void> | void
  onCambiarCobertura?: () => void
  onPdfContratante?: () => void
  onPdfComprobante?: (cuota: CuotaMensual, nombreMes: string) => void
  onImprimirComprobante?: (cuota: CuotaMensual, nombreMes: string) => void
  onWhatsAppComprobante?: (cuota: CuotaMensual, nombreMes: string) => void
}

export const DetalleContratanteCuotas: React.FC<DetalleContratanteCuotasProps> = ({
  afiliado: propAfiliado,
  paciente: propPaciente,
  plan: propPlan,
  cuotas: propCuotas,
  adherentesDetalle: propAdherentes,
  onVolver,
  onCobrarCuota,
  onAnularCuota,
  onChangeMedioPago,
  onSuspenderReactivar,
  onDarDeBaja,
  onQuitarAdherente,
  onCambiarCobertura,
  onPdfContratante,
  onPdfComprobante,
  onImprimirComprobante,
  onWhatsAppComprobante,
}) => {
  const { confirm } = useConfirm()

  const {
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
    adherentes,
    handleCobrar,
    handleAnular,
    handleMedioPagoChange,
    handleSuspenderOReactivar,
    handleDarDeBaja,
    handleQuitarAdherente,
  } = useDetalleContratante({
    afiliado: propAfiliado,
    paciente: propPaciente,
    plan: propPlan,
    cuotas: propCuotas,
    adherentesDetalle: propAdherentes,
    onCobrarCuota,
    onAnularCuota,
    onChangeMedioPago,
    onSuspenderReactivar,
    onDarDeBaja,
    onQuitarAdherente,
    confirmFn: confirm,
  })

  // Formato de fecha de pago amigable
  const formatearFechaPago = (fechaStr: string | null | undefined): string => {
    if (!fechaStr) return '—'
    try {
      const d = parseISO(fechaStr)
      return format(d, "d 'de' MMMM yyyy", { locale: es })
    } catch {
      return fechaStr
    }
  }

  // Normalizar medio de pago para el select
  const normalizarFormaPago = (forma: FormaPago | null | undefined): string => {
    if (!forma) return 'efectivo'
    const lower = forma.toLowerCase()
    if (lower === 'transferencia') return 'transferencia'
    if (lower === 'tarjeta' || lower === 'debito' || lower === 'credito') return 'tarjeta'
    return 'efectivo'
  }

  return (
    <div className="dc-container">
      {/* 1. Tarjeta superior */}
      <section className="dc-card-top" aria-label="Información y KPIs del contratante">
        {/* Fila 1: Nombre, DNI, Estado y Selector de año */}
        <div className="dc-top-row1">
          {onVolver && (
            <button
              type="button"
              className="dc-btn"
              onClick={onVolver}
              style={{ padding: '5px 10px', marginRight: 4 }}
              title="Volver al listado"
              aria-label="Volver"
            >
              ← Volver
            </button>
          )}

          <h2 className="dc-title">
            {paciente.apellido ? `${paciente.apellido}, ` : ''}
            {paciente.nombre || 'Contratante'}
          </h2>

          <span className="dc-dni-text">
            DNI {paciente.dni || '—'}
          </span>

          <span
            className="dc-badge"
            style={{
              color: estadoBadge.style.color,
              backgroundColor: estadoBadge.style.background,
            }}
          >
            {estadoBadge.label}
          </span>

          {/* Selector de año a la derecha */}
          <div className="dc-year-selector" role="group" aria-label="Selector de año">
            <button
              type="button"
              className="dc-year-btn"
              onClick={() => setSelectedYear((y) => y - 1)}
              title="Año anterior"
              aria-label="Año anterior"
            >
              ◀
            </button>
            <span className="dc-year-val">{selectedYear}</span>
            <button
              type="button"
              className="dc-year-btn"
              onClick={() => setSelectedYear((y) => y + 1)}
              title="Año siguiente"
              aria-label="Año siguiente"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Fila 2: 4 KPIs */}
        <div className="dc-kpis-row">
          {/* Pagadas */}
          <div className="dc-kpi-item dc-kpi-item--celeste">
            <span className="dc-kpi-label">PAGADAS</span>
            <span className="dc-kpi-val">{kpis.pagadas}</span>
          </div>

          {/* Pendientes */}
          <div className="dc-kpi-item dc-kpi-item--celeste">
            <span className="dc-kpi-label">PENDIENTES</span>
            <span className="dc-kpi-val">{kpis.pendientes}</span>
          </div>

          {/* Adeudado */}
          <div className="dc-kpi-item dc-kpi-item--adeudado">
            <span className="dc-kpi-label">ADEUDADO</span>
            <span className="dc-kpi-val">
              ${kpis.adeudado.toLocaleString('es-AR')}
            </span>
          </div>

          {/* Cobrado */}
          <div className="dc-kpi-item dc-kpi-item--cobrado">
            <span className="dc-kpi-label">COBRADO</span>
            <span className="dc-kpi-val">
              ${kpis.cobrado.toLocaleString('es-AR')}
            </span>
          </div>
        </div>
      </section>

      {/* 2. Tarjeta con tres pestañas */}
      <section className="dc-card-tabs" aria-label="Detalle de cuotas, adherentes y cobertura">
        {/* Barra de solapas */}
        <div className="dc-tabs-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cuotas'}
            className={`dc-tab-btn ${activeTab === 'cuotas' ? 'dc-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('cuotas')}
          >
            Cuotas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'adherentes'}
            className={`dc-tab-btn ${activeTab === 'adherentes' ? 'dc-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('adherentes')}
          >
            Adherentes ({adherentes.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cobertura'}
            className={`dc-tab-btn ${activeTab === 'cobertura' ? 'dc-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('cobertura')}
          >
            Cobertura
          </button>
        </div>

        {/* ─── Pestaña "Cuotas" ─── */}
        {activeTab === 'cuotas' && (
          <div role="tabpanel">
            {cuotasDelAnio.length === 0 ? (
              <div className="dc-empty-table">
                Sin cuotas en {selectedYear}
              </div>
            ) : (
              <div className="dc-table-responsive">
                <table className="dc-table">
                  <thead>
                    <tr>
                      <th scope="col">Mes</th>
                      <th scope="col">Importe</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Fecha de pago</th>
                      <th scope="col">Medio de pago</th>
                      <th scope="col">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuotasDelAnio.map((cuota) => {
                      const nombreMes = MESES[cuota.mes - 1] || `Mes ${cuota.mes}`
                      const isPagada = cuota.estado === 'pagado'

                      return (
                        <tr key={cuota.id}>
                          <td className="dc-mes-title">{nombreMes}</td>
                          <td className="dc-importe">
                            ${(cuota.monto || plan.precio).toLocaleString('es-AR')}
                          </td>
                          <td>
                            <span
                              className="dc-badge"
                              style={{
                                color: isPagada ? '#15803d' : '#b45309',
                                backgroundColor: isPagada ? '#d3f2dd' : '#fdeccb',
                              }}
                            >
                              {isPagada ? 'Pagado' : 'Pendiente'}
                            </span>
                          </td>
                          <td>
                            {isPagada ? formatearFechaPago(cuota.fechaPago) : '—'}
                          </td>
                          <td>
                            <select
                              className="dc-select-medio"
                              value={normalizarFormaPago(cuota.formaPago)}
                              aria-label={`Medio de pago de ${nombreMes}`}
                              onChange={(e) =>
                                handleMedioPagoChange(
                                  cuota,
                                  e.target.value as FormaPago,
                                )
                              }
                            >
                              <option value="efectivo">Efectivo</option>
                              <option value="transferencia">Transferencia</option>
                              <option value="tarjeta">Tarjeta</option>
                            </select>
                          </td>
                          <td>
                            <div className="dc-actions-cell">
                              {isPagada ? (
                                <>
                                  <button
                                    type="button"
                                    className="dc-btn dc-btn--anular"
                                    onClick={() => handleAnular(cuota)}
                                  >
                                    Anular
                                  </button>
                                  <button
                                    type="button"
                                    className="dc-btn dc-btn--pdf"
                                    onClick={() =>
                                      onPdfComprobante
                                        ? onPdfComprobante(cuota, nombreMes)
                                        : alert(`Generar PDF cuota ${nombreMes}`)
                                    }
                                  >
                                    PDF
                                  </button>
                                  <button
                                    type="button"
                                    className="dc-btn dc-btn--icon dc-btn--print"
                                    title="Imprimir comprobante"
                                    aria-label="Imprimir comprobante"
                                    onClick={() =>
                                      onImprimirComprobante
                                        ? onImprimirComprobante(cuota, nombreMes)
                                        : alert(`Imprimir cuota ${nombreMes}`)
                                    }
                                  >
                                    <IconPrinter />
                                  </button>
                                  <button
                                    type="button"
                                    className="dc-btn dc-btn--icon dc-btn--wsp"
                                    title="Enviar por WhatsApp"
                                    aria-label="Enviar por WhatsApp"
                                    onClick={() =>
                                      onWhatsAppComprobante
                                        ? onWhatsAppComprobante(cuota, nombreMes)
                                        : alert(`WhatsApp cuota ${nombreMes}`)
                                    }
                                  >
                                    <IconWhatsApp />
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="dc-btn dc-btn--primary"
                                  onClick={() => handleCobrar(cuota)}
                                >
                                  Cobrar
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── Pestaña "Adherentes (N)" ─── */}
        {activeTab === 'adherentes' && (
          <div role="tabpanel">
            {adherentes.length === 0 ? (
              <div className="dc-empty-table">
                No tiene adherentes registrados en este grupo familiar.
              </div>
            ) : (
              <div className="dc-adherentes-grid">
                {adherentes.map((item) => {
                  const p = item.paciente
                  const nombreCompleto = p
                    ? `${p.apellido}, ${p.nombre}`
                    : 'Adherente'

                  return (
                    <div
                      key={item.adherente.patientId}
                      className="dc-adherente-card"
                    >
                      <div className="dc-adh-head">
                        <span className="dc-adh-nombre">{nombreCompleto}</span>
                        <button
                          type="button"
                          className="dc-btn dc-btn--icon dc-btn--danger"
                          title={`Eliminar ${nombreCompleto}`}
                          aria-label={`Eliminar adherente ${nombreCompleto}`}
                          onClick={() =>
                            handleQuitarAdherente(
                              item.adherente.patientId,
                              nombreCompleto,
                            )
                          }
                        >
                          <IconTrash />
                        </button>
                      </div>

                      <div className="dc-adh-sub">
                        DNI {p?.dni || '—'} · Nac. {p?.fechaNacimiento || '—'}
                      </div>

                      <div className="dc-adh-relacion-wrap">
                        <span
                          className="dc-badge"
                          style={{
                            background: '#e0f4f8',
                            color: '#0891b2',
                            fontSize: '11px',
                          }}
                        >
                          {item.adherente.relacion || 'Adherente'}
                        </span>
                      </div>

                      <div className="dc-adh-uso">
                        Uso este mes: {item.consultasUsadas}/{item.cupoConsultas || 3} cons. ·{' '}
                        {item.prestacionesUsadas}/{item.cupoPrestaciones || 3} prest. ·{' '}
                        {item.ordenesCount} órdenes
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Pestaña "Cobertura" ─── */}
        {activeTab === 'cobertura' && (
          <div role="tabpanel" className="dc-cobertura-info">
            {/* Datos en fila */}
            <div className="dc-cobertura-datos-row">
              <div className="dc-cobertura-col">
                <span className="dc-cobertura-label">Cobertura</span>
                <span className="dc-cobertura-val">
                  {plan.nombre} · ${plan.precio.toLocaleString('es-AR')}/mes
                </span>
              </div>

              <div className="dc-cobertura-col">
                <span className="dc-cobertura-label">Fecha contrato</span>
                <span className="dc-cobertura-val">
                  {fechaContratoFormateada}
                </span>
              </div>

              <div className="dc-cobertura-col">
                <span className="dc-cobertura-label">Por integrante</span>
                <span className="dc-cobertura-val">
                  {plan.cupoConsultas || 3} cons. y {plan.prestacionesPorMes || 3} prest./mes
                </span>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="dc-cobertura-actions-row">
              <button
                type="button"
                className="dc-btn"
                onClick={() =>
                  onCambiarCobertura
                    ? onCambiarCobertura()
                    : alert('Cambiar cobertura')
                }
              >
                Cambiar cobertura
              </button>

              <button
                type="button"
                className="dc-btn"
                onClick={handleSuspenderOReactivar}
              >
                {isSuspendido ? 'Reactivar' : 'Suspender'}
              </button>

              <button
                type="button"
                className="dc-btn dc-btn--danger"
                onClick={handleDarDeBaja}
              >
                Dar de baja
              </button>

              <button
                type="button"
                className="dc-btn"
                onClick={() =>
                  onPdfContratante
                    ? onPdfContratante()
                    : alert('Generar PDF contratante')
                }
              >
                PDF contratante
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Toast breve de 2 segundos centrado abajo */}
      {toastMessage && (
        <div className="dc-toast" role="status">
          {toastMessage}
        </div>
      )}
    </div>
  )
}

