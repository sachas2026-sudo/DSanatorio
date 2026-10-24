import { useCallback, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useAppState } from '../../../context/AppStateContext'
import { useConfirm } from '../../../context/ConfirmContext'
import { abrirArchivo } from '../../../lib/exportDistribucionPdf'
import { formatMonto } from '../../../lib/formatMonto'
import {
  buildDistribucionFilas,
  consolidarPorMedico,
  repartoDeFila,
  textoFechaColumna,
  textoMotivosResumen,
  textoPeriodoMedico,
  PCT_CUIDAR_POR_DEFECTO,
  type DistribucionModo,
} from '../../../lib/distribucionObrasSocialesFilas'
import type { Doctor, Payment } from '../../../types'
import './distribucion-os.css'

type Props = {
  /** Pagos del listado/filtro actual: de acá salen médicos, montos y obras sociales. */
  pagos: Payment[]
  doctorById: (id: string) => Doctor | undefined
  /** Obra social efectiva de un pago (override si tiene, si no la del paciente). */
  obraSocialDe: (p: Payment) => string
  /** Motivos de consulta de un pago, ya resueltos a texto. Si el turno tiene
   *  motivo 1 y motivo 2, llegan los dos y cada uno va en su propia fila. */
  motivosDe: (p: Payment) => string[]
  /** "resumen" agrupa por médico + motivo; "completo" muestra cada consulta. */
  modo: DistribucionModo
  onModoChange: (modo: DistribucionModo) => void
  /**
   * Guarda el PDF de la vista RESUMEN y devuelve la ruta final.
   *
   * El PDF es siempre en RESUMEN, aunque la pantalla esté en COMPLETO: el
   * detalle por consulta son decenas de páginas que no son un reporte, son un
   * listado. Va como prop y no como import directo para que el componente no
   * conozca los filtros ni el período, que son de la pantalla padre.
   */
  onExportarPdf: () => Promise<string | null>
}

/** Cómo se muestran las filas de la tabla, sea cual sea la vista. */
type FilaView = {
  /** Id del médico: agrupa visualmente las filas de un mismo médico. */
  id: string
  nombre: string
  /** Fecha del pago, o el rango de fechas del médico en RESUMEN. */
  fecha: string
  fechaTitle: string
  paciente: string
  mostrarPaciente: boolean
  especialidad: string
  motivo: string
  /** Tooltip de la celda de motivo (en RESUMEN, todos los motivos). */
  motivoTitle: string
  monto: number
  porObraSocial: Map<string, number>
  total: number
}

/**
 * Distribución por médico · Obras Sociales.
 *
 * No tiene lista propia: las filas salen de los pagos del listado filtrado y
 * las columnas son las obras sociales presentes en ese mismo listado. Cada
 * celda es Monto × % / 100, o "—" si esa obra social no aplica.
 */
/** Formato de motivo: primera letra mayúscula, resto minúscula.
 *  No intenta adivinar tildes: si "PRESUROMETRIA" llega sin tilde, queda
 *  "Presurometria" y el dato se corrige en la base. */
function titleCaseMotivo(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

export function DistribucionObrasSociales({
  pagos,
  doctorById,
  obraSocialDe,
  motivosDe,
  modo,
  onModoChange,
  onExportarPdf,
}: Props) {
  const { data, setDistribucionOSPorcentaje } = useAppState()
  const { confirm } = useConfirm()

  const porcentajes = useMemo(
    () => data.distribucionOSPercentajes ?? [],
    [data.distribucionOSPercentajes],
  )

  /**
   * Nombres de los planes de afiliados, ya normalizados para comparar.
   *
   * Un plan no es una obra social: es una suscripción. Por eso no tiene columna
   * en esta tabla ni recibe % de reparto. Se lo reconoce por el nombre, que es
   * como la Agenda lo guarda en `obraSocialOverride`.
   */
  const nombresDePlan = useMemo(
    () =>
      new Set(
        (data.planesAfiliados ?? [])
          .filter((p) => p.activo)
          .map((p) => p.nombre.trim().toLowerCase())
          .filter(Boolean),
      ),
    [data.planesAfiliados],
  )

  const esPlan = useCallback(
    (obraSocial: string): boolean => nombresDePlan.has(obraSocial.trim().toLowerCase()),
    [nombresDePlan],
  )

  /** Filas de DETALLE: una por pago y motivo. Es la fuente de las dos vistas. */
  const detalle = useMemo(() => {
    const pacientesPorId = new Map((data.patients ?? []).map((x) => [x.id, x]))
    const citasPorId = new Map((data.appointments ?? []).map((x) => [x.id, x]))
    return buildDistribucionFilas({
      pagos,
      doctorById,
      patientById: (id) => pacientesPorId.get(id),
      citaById: (id) => citasPorId.get(id),
      // Un plan se devuelve como cobertura vacía: el pago sigue sumando al
      // Monto de su fila, pero sin obras no hay reparto, así que ese importe
      // queda entero en el Total en vez de desaparecer de la tabla.
      obraSocialDe: (p) => (esPlan(obraSocialDe(p)) ? '' : obraSocialDe(p)),
      motivosDe,
    })
  }, [pagos, doctorById, obraSocialDe, motivosDe, esPlan, data.patients, data.appointments])

  /**
   * RESUMEN consolida el detalle en una fila por médico; COMPLETO lo muestra
   * tal cual. Los totales salen siempre del detalle, así que una vista y otra
   * dan exactamente el mismo número.
   */
  const resumenFilas = useMemo(
    () => consolidarPorMedico(detalle, pctDe),
    // pctDe sólo lee `porcentajes`, que ya está en la lista de deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detalle, porcentajes],
  )

  /** Las dos vistas, proyectadas a la misma forma: el render no sabe cuál es. */
  const filas = useMemo<FilaView[]>(() => {
    if (modo === 'resumen') {
      return resumenFilas.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        fecha: textoFechaColumna(f.fecha),
        fechaTitle: textoPeriodoMedico(f.fechaDesde, f.fechaHasta),
        paciente: f.paciente,
        mostrarPaciente: true,
        especialidad: f.especialidad,
        motivo: f.motivo,
        motivoTitle: textoMotivosResumen(f, formatMonto),
        monto: f.monto,
        porObraSocial: f.porObraSocial,
        total: f.total,
      }))
    }
    return detalle.map((f) => {
      // Mismo reparto que la consolidada: fila por fila, no el total por %.
      const porObraSocial = new Map<string, number>()
      for (const o of f.obras) {
        porObraSocial.set(o, repartoDeFila(f.monto, f.obras, pctDe, o))
      }
      const repartido = [...porObraSocial.values()].reduce((s, v) => s + v, 0)
      return {
        id: f.id,
        nombre: f.nombre,
        fecha: textoFechaColumna(f.fecha),
        fechaTitle: textoFechaColumna(f.fecha),
        paciente: f.paciente,
        mostrarPaciente: f.mostrarPaciente,
        especialidad: f.especialidad,
        motivo: f.motivo,
        motivoTitle: f.motivo,
        monto: f.monto,
        porObraSocial,
        total: f.monto - repartido,
      }
    })
    // pctDe sólo lee `porcentajes`, que ya está en la lista de deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, resumenFilas, detalle, porcentajes])

  const doctorRanks = useMemo(() => {
    const map = new Map<string, number>()
    let n = 0
    for (const f of filas) {
      if (!map.has(f.id)) map.set(f.id, n++)
    }
    return map
  }, [filas])

  /**
   * "Particular" no es una obra social: es lo que paga el paciente de su
   * bolsillo. No se reparte y por eso no tiene columna, y tampoco se resta del
   * Total: lo que no entra en el reparto queda entero en la columna Total.
   */
  const esParticular = (obraSocial: string): boolean =>
    obraSocial.trim().toLowerCase() === 'particular'

  /**
   * Planes activos. Entran como columna aunque no tengan pagos en el período:
   * si sólo aparecieran con movimiento, no se les podría cargar el % ni ver el
   * cupo hasta que alguien se atendiera con ese plan.
   */
  const planesActivos = useMemo(
    () => (data.planesAfiliados ?? []).filter((p) => p.activo),
    [data.planesAfiliados],
  )

  /**
 * Mes de referencia de las atenciones.
 *
 * Sale del filtro de fechas si tiene pagos; si está vacío se recurre al último
 * mes con pagos en toda la base, y sólo si tampoco hay ninguno, el mes en curso.
 * Antes tomaba el mes en curso cuando el filtro estaba vacío y por eso las
 * tarjetas no quadraban con el contador `usos`, que nunca depende del filtro.
 */
  const mesRef = useMemo(() => {
    const ultimoMes = (lista: readonly Payment[]): number | null => {
      let max: number | null = null
      for (const p of lista) {
        const d = fechaDePago(p.fecha)
        if (!d) continue
        const clave = d.getFullYear() * 12 + d.getMonth()
        if (max === null || clave > max) max = clave
      }
      return max
    }
    const max = ultimoMes(pagos) ?? ultimoMes(data.payments ?? [])
    const d = max === null ? new Date() : new Date(Math.floor(max / 12), max % 12, 1)
    return { anio: d.getFullYear(), mes: d.getMonth() + 1 }
  }, [pagos, data.payments])

  /**
   * Pagos del mes de referencia, tomados de TODA la base y no del filtro.
   *
   * Es lo que hace que las tarjetas y el listado no se vacíen cuando el filtro
   * de fechas no tiene pagos: el contador `usos` de las cuotas es global, así
   * que mostrar los pacientes con un origen distinto hacía que el "1 atención"
   * no tuviera a quién corresponderse.
   */
  const pagosDelMes = useMemo(() => {
    const clave = mesRef.anio * 12 + (mesRef.mes - 1)
    return (data.payments ?? []).filter((p) => {
      const d = fechaDePago(p.fecha)
      return !!d && d.getFullYear() * 12 + d.getMonth() === clave
    })
  }, [data.payments, mesRef])

  /**
   * De dónde saca el listado de atenciones.
   *
   * Si el filtro de Pagos tiene resultados, se respetan: al elegir una obra
   * social o un plan en el filtro, el listado se reduce a esos pagos y queda
   * alineado con la tabla de arriba. Si el filtro está vacío, se cae al mes,
   * para que las tarjetas no queden mudas.
   */
  const pagosFuente = pagos.length > 0 ? pagos : pagosDelMes

  /**
 * Nombres originales de los planes que tienen atenciones en el mes.
 *
 * Se guardan con su mayúsculas porque son los que se usan como valor del
 * selector y como etiqueta de la fila; para comparar se normaliza aparte,
 * ya que la cobertura del pago viene del `obraSocialOverride`.
 */
  const planesAtendidos = useMemo(() => {
    const porNombre = new Map(
      planesActivos.map((p) => [p.nombre.trim().toLowerCase(), p.nombre.trim()]),
    )
    const usados = new Set<string>()
    for (const p of pagosFuente) {
      const original = porNombre.get(obraSocialDe(p).trim().toLowerCase())
      if (original) usados.add(original)
    }
    return usados
  }, [planesActivos, pagosFuente, obraSocialDe])



  /**
 * Atenciones del filtro actual cubiertas por un plan.
 *
 * Se reconocen por nombre: la Agenda guarda el plan en `obraSocialOverride`,
 * así que el pago llega acá con el nombre del plan como cobertura.
 */
  const _atencionesPlan = useMemo(() => {
    // Se compara sin mayúsculas porque la cobertura viene del
    // `obraSocialOverride` escrita a mano o de un plan renombrado.
    const planesNorm = new Set(Array.from(planesAtendidos, (n) => n.toLowerCase()))
    if (planesNorm.size === 0) return []
    const pacientesPorId = new Map((data.patients ?? []).map((p) => [p.id, p]))
    return pagosFuente
      .filter((p) => planesNorm.has(obraSocialDe(p).trim().toLowerCase()))
      .map((p) => {
        const pac = pacientesPorId.get(p.patientId)
        const doc = doctorById(p.doctorId)
        const d = fechaDePago(p.fecha)
        return {
          id: p.id,
          fecha: d ? format(d, 'dd/MM/yyyy') : '—',
          _orden: p.fecha,
          paciente: pac ? `${pac.apellido}, ${pac.nombre}` : '—',
          medico: doc ? `${doc.apellido}, ${doc.nombre}` : '—',
          motivo: motivosDe(p)[0] || '—',
          plan: obraSocialDe(p),
          monto: formatMonto(p.monto),
          montoNum: p.monto,
        }
      })
      .sort((a, b) => (a._orden < b._orden ? 1 : a._orden > b._orden ? -1 : 0))
  }, [pagosFuente, planesAtendidos, data.patients, doctorById, obraSocialDe, motivosDe])





/**
 * Obras sociales del listado actual, más las que ya tengan % configurado.
 *
 * Los planes NO entran como columna: en esta tabla sólo se reparte entre
 * obras sociales. Un plan es una suscripción, no un receptor de la
 * distribución, así que tampoco se resta del Total. El consumo de los planes
 * se mira en las secciones de abajo.
 */
  const obras = useMemo(() => {
    const s = new Set<string>()
    // Ni "Particular" (es dinero del bolsillo, no se reparte) ni los planes
    // (son suscripciones, no obras sociales) llegan a ser columna.
    for (const f of filas)
      for (const o of f.porObraSocial.keys()) if (!esParticular(o) && !esPlan(o)) s.add(o)
    for (const p of porcentajes)
      if (p.porcentaje > 0 && !esParticular(p.obraSocial) && !esPlan(p.obraSocial))
        s.add(p.obraSocial)
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  }, [filas, porcentajes, esPlan])

  /** % de una obra social. Sin valor guardado arranca en el 30 % por defecto,
   *  el mismo que usa el PDF: si difieren, la pantalla y el archivo muestran
   *  números distintos. */
  function pctDe(obraSocial: string): number {
    const f = porcentajes.find(p => p.obraSocial === obraSocial)
    return f ? f.porcentaje : PCT_CUIDAR_POR_DEFECTO
  }

  const totalMonto = filas.reduce((s, f) => s + f.monto, 0)
  const totalRepartido = filas.reduce((s, f) => s + f.total, 0)
  /** Suma de los totales de cada columna de obra social: lo que reparte Cuidar. */
  const totalCuidar = obras.reduce(
    (acc, o) => acc + filas.reduce((s, f) => s + (f.porObraSocial.get(o) ?? 0), 0),
    0,
  )
  const cantidadMedicos = new Set(filas.map((f) => f.id)).size
  /** Cuenta los motivos/prestaciones del DETALLE en las dos vistas. */
  const cantidadMotivos = detalle.length
  const MEDOS: { valor: DistribucionModo; texto: string; ayuda: string }[] = [
    {
      valor: 'resumen',
      texto: 'Resumen',
      ayuda: 'Una fila por médico, con todos sus motivos ya sumados.',
    },
    {
      valor: 'completo',
      texto: 'Completo',
      ayuda: 'Una fila por consulta, con el paciente y el motivo de cada una.',
    },
  ]

  /** Estado del botón de exportar: generando / aviso con la ruta. */
  const [exportando, setExportando] = useState(false)
  const [exportadoEn, setExportadoEn] = useState<string | null>(null)

  /**
   * Guarda el PDF y avisa dónde quedó.
   *
   * Los errores se muestran con el mensaje del comando, que ya viene en
   * castellano y explica qué pasó; el `catch` propio sólo cubre el caso de que
   * falle el diálogo y no llegue a bonificarse.
   */
  const handleExportar = async () => {
    if (exportando) return
    setExportando(true)
    try {
      const ruta = await onExportarPdf()
      // `null` = el usuario cerró el diálogo: no hay nada que avisar.
      if (ruta) setExportadoEn(ruta)
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err)
      console.error('No se pudo exportar el PDF de distribución:', err)
      void confirm({
        message: `No se pudo generar el PDF. Detalle: ${detalle}`,
      })
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="dist-os">
      {/* El título va FUERA de la tabla. Dentro de una celda ocupaba la
          columna Médico y, con el nowrap de la cabecera, imponía su propio
          ancho mínimo: la columna no bajaba de ~570px por más que se le pidiera. */}
      <div className="dist-os__head">
        <h2 className="pagos-table-title">DISTRIBUCIÓN POR MÉDICO · OBRAS SOCIALES</h2>
        <span className="pagos-table-count-badge">
          {cantidadMedicos} médico{cantidadMedicos === 1 ? '' : 's'}
        </span>
        {/* Resumen = agrupado por médico + motivo. Completo = cada consulta. */}
        <div
          className="dist-os__modo"
          role="group"
          aria-label="Resumen o listado completo de consultas"
        >
          {MEDOS.map((m) => (
            <button
              key={m.valor}
              type="button"
              className={`dist-os__modo-btn ${modo === m.valor ? 'dist-os__modo-btn--on' : ''}`}
              aria-pressed={modo === m.valor}
              title={m.ayuda}
              onClick={() => onModoChange(m.valor)}
            >
              {m.texto}
            </button>
          ))}
        </div>
        {/* Exportar PDF. Va al lado del selector de vista porque el archivo
            sale siempre en RESUMEN: dejarlo al lado de la tabla, y no del
            toggle, evita que se lea como "el PDF de lo que estoy viendo". */}
        <button
          type="button"
          className="dist-os__export-btn"
          onClick={handleExportar}
          disabled={exportando}
          title="Guarda el PDF de la vista Resumen (una fila por médico)."
        >
          {exportando ? 'Generando PDF…' : 'Exportar PDF'}
        </button>
      </div>

      {/* Aviso con la ruta del archivo y acción para abrirlo. Se oculta solo a
          los 12 s para no dejar el cartel pegado si el usuario se ausenta. */}
      {exportadoEn && (
        <div className="dist-os__aviso" role="status">
          <span className="dist-os__aviso-text">
            PDF guardado en <code>{exportadoEn}</code>
          </span>
          <button
            type="button"
            className="dist-os__aviso-accion"
            onClick={() => {
              void abrirArchivo(exportadoEn)
            }}
          >
            Abrir
          </button>
          <button
            type="button"
            className="dist-os__aviso-cerrar"
            aria-label="Cerrar aviso"
            onClick={() => setExportadoEn(null)}
          >
            ×
          </button>
        </div>
      )}
      <div className="pagos-table-wrap dist-os__wrap">
        <table className="dist-os__table">
          <caption className="sr-only">
            Reparto, según el porcentaje de cada obra social, del total facturado
            por cada médico del listado actual.
          </caption>
          <thead>
            <tr className="dist-os__pct-row">
              {/* Cubre Médico, Paciente, Especialidad, Motivo y Monto: son las
                  columnas fijas, las de obras sociales son las que llevan %. */}
              <th scope="col" colSpan={6} className="dist-os__pct-label" style={{ textAlign: 'right', paddingRight: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b' }}>
                  Total Cuidar: {formatMonto(totalCuidar)}
                </span>{' '}
                · % Cuidar
              </th>
              {obras.map(o => (
                <th key={o} scope="col" className="dist-os__pct-cell">
                  <label className="sr-only" htmlFor={`dist-pct-${o}`}>Porcentaje de {o}</label>
                  <span aria-hidden="true">%</span>
                  <input
                    id={`dist-pct-${o}`}
                    className="dist-os__pct-input"
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    inputMode="numeric"
                    defaultValue={pctDe(o)}
                    onBlur={e => {
                      // Campo vacío: se guarda el 30 del predeterminado en vez
                      // de un 0 silencioso, que dejaba la obra social sin reparto.
                      const n = e.target.value.trim() === '' ? 30 : Number(e.target.value)
                      if (Number.isFinite(n)) setDistribucionOSPorcentaje(o, n)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                  />
                </th>
              ))}
              <th scope="col" className="text-right dist-os__total-col">
                    <span className="sr-only">Total médico</span>
                  </th>
            </tr>
            <tr>
              <th scope="col" className="dist-os__fecha-col">Fecha</th>
              <th scope="col" className="dist-os__med-col">Médico</th>
              <th scope="col" className="dist-os__pac-col">Paciente</th>
              <th scope="col" className="dist-os__esp-col">Especialidad</th>
              <th scope="col" className="dist-os__motivo-col">Motivo de la Consulta</th>
              <th scope="col" className="text-right">Monto</th>
              {obras.map(o => (
                <th key={o} scope="col" className="text-right dist-os__os-cell">
                  {o}
                </th>
              ))}
              <th scope="col" className="text-right dist-os__total-col">Total Medico</th>
            </tr>
          </thead>

          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={obras.length + 7} className="empty-hint" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                  No hay pagos con obra social en el filtro actual.
                </td>
              </tr>
            )}

            {filas.map((f, idx) => {
              const isFirst = idx === 0 || filas[idx - 1].id !== f.id
              const sameDoctor = idx > 0 && filas[idx - 1].id === f.id
              const doctorRank = doctorRanks.get(f.id) ?? 0
              return (
              <tr key={`${f.id}|${f.motivo}|${idx}`} className={`${sameDoctor ? 'dist-os__row-child' : 'dist-os__row-doctor'} ${doctorRank % 2 === 0 ? 'dist-os__doc--even' : 'dist-os__doc--odd'}`}>
                <td className="dist-os__fecha-col" title={f.fechaTitle}>
                  <span className="dist-os__clip">{f.fecha}</span>
                </td>

                <td className="dist-os__med dist-os__med-col" title={f.nombre}>
                  {isFirst ? <span className="dist-os__clip">{f.nombre}</span> : ''}
                </td>

                <td className="dist-os__pac-col" title={f.mostrarPaciente ? f.paciente : undefined}>
                  {f.mostrarPaciente ? <span className="dist-os__clip">{f.paciente}</span> : ''}
                </td>

                <td className="dist-os__esp-col" title={isFirst ? f.especialidad : undefined}>
                  {isFirst ? <span className="dist-os__clip">{f.especialidad}</span> : ''}
                </td>

                <td className="dist-os__motivo" title={f.motivoTitle}>
                  {titleCaseMotivo(f.motivo)}
                </td>

                <td className="text-right">{f.monto === 0 ? '' : formatMonto(f.monto)}</td>

                {obras.map(o => {
                  if (!f.porObraSocial.has(o)) {
                    return (
                      <td key={o} className="text-right dist-os__os-cell" />
                    )
                  }
                  const val = f.porObraSocial.get(o) ?? 0
                  return (
                    <td key={o} className="text-right dist-os__os-cell">
                      {val === 0 ? '' : formatMonto(val)}
                    </td>
                  )
                })}

                <td className="text-right dist-os__total-col">
                  {/* Total = Monto − todo lo que se repartió entre obras sociales.
                      Lo que no se reparte (incluido lo particular) queda acá. */}
                  <span className="dist-os__suma">
                    {f.total === 0 ? '' : formatMonto(f.total)}
                  </span>
                </td>
              </tr>
              )
            })}
          </tbody>

          <tfoot>
            <tr>
              <td className="dist-os__foot-label">TOTALES</td>
              <td></td>
              <td></td>
              <td></td>
              <td>{cantidadMotivos} motivo{cantidadMotivos !== 1 ? 's' : ''}</td>
              <td className="text-right">{formatMonto(totalMonto)}</td>
              {obras.map(o => (
                <td key={o} className="text-right dist-os__os-cell">
                  {formatMonto(filas.reduce((s, f) => s + (f.porObraSocial.get(o) ?? 0), 0))}
                </td>
              ))}
              <td className="text-right dist-os__total-col">{formatMonto(totalRepartido)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}


/**
 * Fecha de un pago como objeto Date, o null si no se puede leer.
 *
 * No siempre viene igual: los pagos que crea la Agenda guardan un ISO completo
 * ('2026-10-14T23:30:00.000Z') y los cargados a mano sólo 'YYYY-MM-DD'.
 * Concatenarle 'T12:00:00' al primero produce una fecha inválida y el listado de
 * atenciones salía vacío; y parsear el segundo como UTC lo corre un día hacia
 * atrás en Argentina, con lo cual un pago del día 1 caía en el mes anterior.
 * Por eso se distingue el formato antes de construir la fecha.
 */
function fechaDePago(fecha: string): Date | null {
  if (!fecha) return null
  const d = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? new Date(`${fecha}T12:00:00`)
    : new Date(fecha)
  return Number.isNaN(d.getTime()) ? null : d
}