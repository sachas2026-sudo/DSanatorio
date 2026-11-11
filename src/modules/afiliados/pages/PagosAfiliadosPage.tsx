import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type jsPDF from 'jspdf'
import { useAppState } from '../../../context/AppStateContext'
import { useAuth } from '../../../context/AuthContext'
import { PdfPreviewModal } from '../../../shared/components/PdfPreviewModal'
import { clientApi, clientApiErrorMessage, ensureApiOk } from '../../../lib/clientApi'
import { isClientMode } from '../../../lib/appMode'
import { pdfBlobUrl, savePdfFile } from '../../../lib/doctorPaymentsPdf'
import { preloadReciboLogo, formatNroRecibo } from '../../../lib/reciboPdf'
import {
  construirCobroLocal,
  formatearMonto,
  listarPagosAfiliados,
  nombrePeriodo,
  prepararTablaPagosAfiliados,
  type FiltroPlanPagosAfiliados,
  type OrdenPagosAfiliados,
  type CuotaPendienteAfiliado,
  type DeudorAfiliado,
  type ListadoPagosAfiliados,
  type SeleccionCuota,
} from '../../../lib/pagosAfiliados'
import { buildPagosAfiliadosComprobantePdf } from '../../../lib/pagosAfiliadosComprobantePdf'
import type { CuotaMensual, FormaPago } from '../../../types'
import '../../../shared/styles/pages.css'
import './AfiliadosModern.css'
import './PagosAfiliados.css'

const FORMAS_PAGO: Array<{ value: FormaPago; label: string }> = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'mercadopago', label: 'Mercado Pago' },
  { value: 'debito', label: 'Débito' },
]

const LISTADO_VACIO: ListadoPagosAfiliados = {
  deudores: [],
  totalAdeudado: 0,
  cantidad: 0,
  sinDeuda: false,
}

type ConfirmacionPago = {
  deudor: DeudorAfiliado
  cuotas: CuotaMensual[]
}

function claveCuota(cuota: Pick<CuotaPendienteAfiliado, 'anio' | 'mes'>): string {
  return `${cuota.anio}:${cuota.mes}`
}

function Lupa() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.4-3.4" />
    </svg>
  )
}

export function PagosAfiliadosPage() {
  const { data, upsertCuotaMensual } = useAppState()
  const { session } = useAuth()

  const [modoCliente, setModoCliente] = useState<boolean | null>(null)
  const [consulta, setConsulta] = useState('')
  const [planFiltro, setPlanFiltro] = useState<FiltroPlanPagosAfiliados>('todos')
  const [orden, setOrden] = useState<OrdenPagosAfiliados>('nombre-asc')
  const [listado, setListado] = useState<ListadoPagosAfiliados>(LISTADO_VACIO)
  const [cargando, setCargando] = useState(true)
  const [errorPagina, setErrorPagina] = useState('')

  const [deudorCobrando, setDeudorCobrando] = useState<DeudorAfiliado | null>(null)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [formaPago, setFormaPago] = useState<FormaPago>('efectivo')
  const [errorCobro, setErrorCobro] = useState('')
  const [registrando, setRegistrando] = useState(false)
  const [confirmacion, setConfirmacion] = useState<ConfirmacionPago | null>(null)
  const pdfDocRef = useRef<jsPDF | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string; title: string } | null>(null)

  const listadoLocal = useMemo(() => {
    if (!data) return LISTADO_VACIO
    return listarPagosAfiliados({
      afiliados: data.afiliados ?? [],
      planes: data.planesAfiliados ?? [],
      cuotas: data.cuotasAfiliados ?? [],
      patients: data.patients ?? [],
      q: consulta,
    })
  }, [data, consulta])

  useEffect(() => {
    let vivo = true
    void (async () => {
      const cliente = await isClientMode()
      if (!vivo) return
      setModoCliente(cliente)
      if (!cliente) setCargando(false)
    })()
    return () => {
      vivo = false
    }
  }, [])

  const cargarCliente = useCallback(async (q: string, silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const reply = await clientApi<ListadoPagosAfiliados>(
        'GET',
        `/api/pagos-afiliados?q=${encodeURIComponent(q)}`,
      )
      ensureApiOk(reply)
      setListado(reply.body ?? LISTADO_VACIO)
      setErrorPagina('')
    } catch (err) {
      setErrorPagina(err instanceof Error ? err.message : 'No se pudo cargar la deuda.')
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (modoCliente !== true) return
    void cargarCliente('')
  }, [modoCliente, cargarCliente])

  useEffect(() => {
    return () => {
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    }
  }, [pdfPreview])

  const resultado = modoCliente === true ? listado : listadoLocal
  const deudoresVisibles = useMemo(
    () => prepararTablaPagosAfiliados(resultado.deudores, consulta, planFiltro, orden),
    [resultado.deudores, consulta, planFiltro, orden],
  )
  const esperandoModo = modoCliente === null

  function abrirCobro(deudor: DeudorAfiliado) {
    setSeleccion(new Set(deudor.cuotas.map(claveCuota)))
    setFormaPago('efectivo')
    setErrorCobro('')
    setDeudorCobrando(deudor)
  }

  function cerrarCobro() {
    if (registrando) return
    setDeudorCobrando(null)
    setSeleccion(new Set())
    setErrorCobro('')
  }

  function alternarCuota(cuota: CuotaPendienteAfiliado) {
    const clave = claveCuota(cuota)
    setSeleccion((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }

  const cuotasSeleccionadas = useMemo(() => {
    if (!deudorCobrando) return []
    return deudorCobrando.cuotas.filter((c) => seleccion.has(claveCuota(c)))
  }, [deudorCobrando, seleccion])

  const totalSeleccionado = cuotasSeleccionadas.reduce((total, c) => total + c.monto, 0)

  async function registrarPago() {
    if (!deudorCobrando || cuotasSeleccionadas.length === 0 || registrando) return
    setRegistrando(true)
    setErrorCobro('')
    setErrorPagina('')

    const seleccionEnvio: SeleccionCuota[] = cuotasSeleccionadas.map((c) => ({ anio: c.anio, mes: c.mes }))
    const cobradoPor = session?.username || '—'

    try {
      if (modoCliente === true) {
        const reply = await clientApi<{ cuotas: CuotaMensual[]; total: number }>(
          'POST',
          '/api/pagos-afiliados/cobrar',
          {
            afiliadoId: deudorCobrando.afiliadoId,
            cuotas: seleccionEnvio,
            formaPago,
          },
        )
        if (reply.status === 409) {
          const body = reply.body as { error?: string } | null
          setDeudorCobrando(null)
          setSeleccion(new Set())
          setErrorPagina(
            body?.error === 'cuota_ya_pagada'
              ? 'La cuota ya fue pagada'
              : clientApiErrorMessage(reply),
          )
          await cargarCliente(consulta, true)
          return
        }
        ensureApiOk(reply)
        const pagadas = reply.body.cuotas ?? []
        setDeudorCobrando(null)
        setSeleccion(new Set())
        setConfirmacion({ deudor: deudorCobrando, cuotas: pagadas })
        await cargarCliente(consulta, true)
        return
      }

      const afiliado = (data.afiliados ?? []).find((a) => a.id === deudorCobrando.afiliadoId)
      const plan = (data.planesAfiliados ?? []).find((p) => p.id === afiliado?.planId)
      const cobro = construirCobroLocal({
        afiliadoId: deudorCobrando.afiliadoId,
        precioPlan: plan?.precio ?? 0,
        cuotas: data.cuotasAfiliados ?? [],
        seleccion: seleccionEnvio,
        formaPago,
        cobradoPor,
      })
      if (!cobro.ok) {
        setDeudorCobrando(null)
        setSeleccion(new Set())
        setErrorPagina(
          cobro.error === 'cuota_ya_pagada'
            ? 'La cuota ya fue pagada'
            : 'Seleccioná al menos una cuota',
        )
        return
      }
      for (const cuota of cobro.cuotas) upsertCuotaMensual(cuota)
      setDeudorCobrando(null)
      setSeleccion(new Set())
      setConfirmacion({ deudor: deudorCobrando, cuotas: cobro.cuotas })
    } catch (err) {
      setErrorCobro(err instanceof Error ? err.message : 'No se pudo registrar el pago.')
    } finally {
      setRegistrando(false)
    }
  }

  async function verComprobante() {
    if (!confirmacion) return
    await preloadReciboLogo()
    const built = buildPagosAfiliadosComprobantePdf({
      deudor: confirmacion.deudor,
      cuotas: confirmacion.cuotas,
    })
    pdfDocRef.current = built.doc
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview({
      url: pdfBlobUrl(built.doc),
      filename: built.filename,
      title: confirmacion.cuotas.length === 1
        ? `Comprobante de pago - ${nombrePeriodo(confirmacion.cuotas[0]!.anio, confirmacion.cuotas[0]!.mes)}`
        : `Comprobantes de pago (${confirmacion.cuotas.length})`,
    })
    setConfirmacion(null)
  }

  async function descargarComprobante() {
    if (!pdfDocRef.current || !pdfPreview?.filename) return
    await savePdfFile(pdfDocRef.current, pdfPreview.filename)
  }

  function mostrarMensajeVacio() {
    if (esperandoModo || cargando) return 'Cargando deudores…'
    if (resultado.sinDeuda) return 'Sin deuda'
    if (consulta.trim()) return 'No se encontró un contratante con ese nombre o DNI.'
    return 'No hay contratantes con deuda.'
  }

  return (
    <div className="pa-page">
      <header className="pa-head">
        <div>
          <h1>Pagos de afiliados</h1>
        </div>
      </header>

      <section className="pa-toolbar" aria-label="Resumen y búsqueda">
        <div className="pa-stat pa-stat--total">
          <span className="pa-stat__label">Total adeudado</span>
          <strong className="pa-stat__value">{formatearMonto(resultado.totalAdeudado)}</strong>
        </div>
        <div className="pa-stat pa-stat--count">
          <span className="pa-stat__label">Contratantes<br />con deuda</span>
          <strong className="pa-stat__value">{resultado.cantidad}</strong>
        </div>
        <div className="pa-search__wrap">
          <Lupa />
          <input
            type="search"
            className="pa-search__input"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar por nombre o DNI…"
            aria-label="Buscar contratante por nombre o DNI"
            autoFocus
          />
        </div>
      </section>

      <div className="pa-content-card">
        <div className="pa-plan-filters" role="group" aria-label="Filtrar por plan">
          {(['todos', 'individual', 'familiar'] as const).map((plan) => (
            <button
              key={plan}
              type="button"
              className={planFiltro === plan ? 'is-active' : ''}
              onClick={() => setPlanFiltro(plan)}
            >
              {plan === 'todos' ? 'Todos' : plan === 'individual' ? 'Individual' : 'Familiar'}
            </button>
          ))}
        </div>

        <section className="pa-table-card" aria-label="Contratantes con deuda">
          <div className="pa-table-scroll">
          <table className="pa-table">
            <thead>
              <tr>
                <th><button type="button" onClick={() => setOrden(orden === 'nombre-asc' ? 'nombre-desc' : 'nombre-asc')}>Contratantes {orden.startsWith('nombre') ? (orden === 'nombre-asc' ? '↑' : '↓') : '↕'}</button></th>
                <th>DNI</th><th>Plan</th><th>Meses</th>
                <th><button type="button" onClick={() => setOrden(orden === 'deuda-asc' ? 'deuda-desc' : 'deuda-asc')}>Deuda {orden.startsWith('deuda') ? (orden === 'deuda-asc' ? '↑' : '↓') : '↕'}</button></th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {deudoresVisibles.map((deudor) => (
                <tr key={deudor.afiliadoId}>
                  <td className="pa-table__name">{deudor.nombre.toUpperCase()}</td>
                  <td>{deudor.dni}</td>
                  <td>{deudor.cobertura.replace(/^Plan\s+/i, '')}</td>
                  <td>{deudor.cuotas.map((cuota) => `${nombrePeriodo(cuota.anio, cuota.mes).slice(0, 3)} ${String(cuota.anio).slice(2)}`).join(', ')}</td>
                  <td className="pa-table__debt">{formatearMonto(deudor.adeudado)}</td>
                  <td><button type="button" className="pa-cobrar-btn" onClick={() => abrirCobro(deudor)}>Cobrar</button></td>
                </tr>
              ))}
              {deudoresVisibles.length === 0 && <tr><td className="pa-table__empty" colSpan={6}>{esperandoModo || cargando ? 'Cargando deudores…' : 'Sin resultados'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      </div>

      {errorPagina ? (
        <div className="pa-alert" role="alert">
          {errorPagina}
        </div>
      ) : null}

      {deudorCobrando ? (
        <div className="pa-modal-overlay" onClick={cerrarCobro}>
          <div
            className="pa-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pa-cobro-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="pa-modal__title" id="pa-cobro-title">Cobrar cuotas</h2>
            <div className="pa-modal__persona">
              <strong>{deudorCobrando.nombre.toUpperCase()}</strong>
              <span>{deudorCobrando.cobertura} · {formatearMonto(deudorCobrando.cuotas[0]?.monto ?? 0)} por mes</span>
            </div>

            <section className="pa-cuotas" aria-label="Cuotas pendientes">
              <div className="pa-cuotas__head">
                <span>Meses</span>
                <button
                  type="button"
                  onClick={() => setSeleccion(new Set(deudorCobrando.cuotas.map(claveCuota)))}
                >
                  Seleccionar adeudado
                </button>
              </div>
              <div className="pa-cuotas__list">
                {deudorCobrando.cuotas.map((cuota) => {
                  const clave = claveCuota(cuota)
                  const seleccionado = seleccion.has(clave)
                  return (
                    <label key={clave} className={`pa-cuota${seleccionado ? ' pa-cuota--selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={seleccionado}
                        onChange={() => alternarCuota(cuota)}
                        aria-label={`Cobrar ${nombrePeriodo(cuota.anio, cuota.mes)}`}
                      />
                      <span className="pa-cuota__mes">{nombrePeriodo(cuota.anio, cuota.mes)}</span>
                      <span className="pa-cuota__estado">Adeudado</span>
                      <strong className="pa-cuota__monto">{formatearMonto(cuota.monto)}</strong>
                    </label>
                  )
                })}
              </div>
            </section>

            <div className="pa-form-row">
              <label className="pa-field">
                <span>Forma de pago</span>
                <select
                  className="af-input"
                  value={formaPago}
                  onChange={(e) => setFormaPago(e.target.value as FormaPago)}
                >
                  {FORMAS_PAGO.map((forma) => (
                    <option key={forma.value} value={forma.value}>{forma.label}</option>
                  ))}
                </select>
              </label>
              <div className="pa-total" aria-live="polite">
                <span>Total · {cuotasSeleccionadas.length} {cuotasSeleccionadas.length === 1 ? 'mes' : 'meses'}</span>
                <strong>{formatearMonto(totalSeleccionado)}</strong>
              </div>
            </div>

            {errorCobro ? <p className="af-msg" role="alert">{errorCobro}</p> : null}

            <div className="af-modal__foot">
              <button type="button" className="af-btn" onClick={cerrarCobro} disabled={registrando}>
                Cancelar
              </button>
              <button
                type="button"
                className="af-btn af-btn--primary"
                onClick={() => void registrarPago()}
                disabled={cuotasSeleccionadas.length === 0 || registrando}
              >
                {registrando ? 'Registrando…' : 'Registrar pago'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmacion ? (
        <div className="pa-modal-overlay" onClick={() => setConfirmacion(null)}>
          <div
            className="pa-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pa-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="af-modal__title" id="pa-confirm-title">Pago registrado</h2>
            <p className="pa-confirm__lead">
              {confirmacion.deudor.nombre} · {formatearMonto(confirmacion.cuotas.reduce((s, c) => s + c.monto, 0))}
            </p>

            <ul className="pa-confirm__list">
              {confirmacion.cuotas.map((cuota) => (
                <li key={cuota.id}>
                  <span>{nombrePeriodo(cuota.anio, cuota.mes)}</span>
                  <span className="pa-confirm__nro">N° {formatNroRecibo(cuota.id)}</span>
                </li>
              ))}
            </ul>

            <div className="af-modal__foot">
              <button type="button" className="af-btn" onClick={() => setConfirmacion(null)}>
                Cerrar
              </button>
              <button type="button" className="af-btn af-btn--primary" onClick={() => void verComprobante()}>
                Imprimir / descargar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pdfPreview ? (
        <PdfPreviewModal
          title={pdfPreview.title}
          url={pdfPreview.url}
          filename={pdfPreview.filename}
          onClose={() => setPdfPreview(null)}
          onDownload={() => void descargarComprobante()}
        />
      ) : null}
    </div>
  )
}
