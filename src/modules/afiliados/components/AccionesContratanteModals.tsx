import { useMemo, useState } from 'react'
import type {
  AdherenteCambioProgramado,
  Afiliado,
  OpcionAdherentesFamiliarAIndividual,
  Patient,
  PlanAfiliado,
  RelacionTitular,
} from '../../../types'
import type { ConsumoAfiliadoMes } from '../../../lib/consumoAfiliados'
import {
  formatearFechaLatina,
  hoyIsoLocal,
  primerDiaMesSiguienteIso,
} from '../../../lib/contratantesMovimientos'

const RELACIONES_OPCIONES: RelacionTitular[] = ['Cónyuge', 'Hijo/a', 'Otro']

const MOTIVOS_SUSPENSION = [
  'Falta de pago',
  'A pedido del contratante',
  'Viaje o ausencia',
  'Otro',
] as const

const MOTIVOS_BAJA = [
  'A pedido del contratante',
  'Falta de pago prolongada',
  'Fallecimiento',
  'Otro',
] as const

interface CambiarCoberturaModalProps {
  afiliado: Afiliado
  titular: Patient
  planActual: PlanAfiliado | undefined
  planes: readonly PlanAfiliado[]
  patients: readonly Patient[]
  tieneDeuda: boolean
  consumoTitularMes: ConsumoAfiliadoMes | null
  onClose: () => void
  onConfirm: (payload: {
    planNuevoId: string
    planNuevoNombre: string
    fechaVigencia: string
    programado: boolean
    opcionAdherentes?: OpcionAdherentesFamiliarAIndividual
    nuevosAdherentes?: AdherenteCambioProgramado[]
  }) => void
}

export function CambiarCoberturaModal({
  afiliado,
  titular,
  planActual,
  planes,
  patients,
  tieneDeuda,
  consumoTitularMes,
  onClose,
  onConfirm,
}: CambiarCoberturaModalProps) {
  const planesElegibles = useMemo(
    () => planes.filter((p) => p.activo && p.id !== afiliado.planId),
    [planes, afiliado.planId],
  )

  const [planNuevoId, setPlanNuevoId] = useState<string>(
    () => planesElegibles[0]?.id ?? '',
  )
  const [rigeDesdeModo, setRigeDesdeModo] = useState<'mes_siguiente' | 'hoy'>('mes_siguiente')

  const planNuevo = useMemo(
    () => planesElegibles.find((p) => p.id === planNuevoId),
    [planesElegibles, planNuevoId],
  )

  const hoyIso = useMemo(() => hoyIsoLocal(), [])
  const mesSiguienteIso = useMemo(() => primerDiaMesSiguienteIso(), [])
  const fechaVigencia = rigeDesdeModo === 'mes_siguiente' ? mesSiguienteIso : hoyIso

  const pasaAFamiliar = planNuevo?.tipo === 'familiar' && planActual?.tipo !== 'familiar'
  const pasaAIndividualConAdherentes =
    planNuevo?.tipo === 'individual' && (afiliado.adherentes?.length ?? 0) > 0

  const [adherentes, setAdherentes] = useState<AdherenteCambioProgramado[]>(() => [
    {
      dni: '',
      apellido: '',
      nombre: '',
      fechaNacimiento: '',
      relacion: 'Cónyuge',
    },
  ])

  const [opcionAdherentes, setOpcionAdherentes] = useState<
    OpcionAdherentesFamiliarAIndividual | ''
  >('')

  const maxAdh = planNuevo?.maxAdherentes ?? 0

  // Mapear DNI -> Paciente existente para detectar coincidencias y autocompletar
  const patientByDni = useMemo(() => {
    const m = new Map<string, Patient>()
    for (const p of patients) {
      const d = p.dni.trim()
      if (d) m.set(d, p)
    }
    return m
  }, [patients])

  const validacionAdherentes = useMemo(() => {
    if (!pasaAFamiliar) {
      return { ok: true, error: null as string | null, dnisExistentes: [] as Patient[] }
    }
    if (adherentes.length === 0) {
      return {
        ok: false,
        error: 'Agregá al menos un adherente para la cobertura Familiar.',
        dnisExistentes: [],
      }
    }
    if (maxAdh > 0 && adherentes.length > maxAdh) {
      return {
        ok: false,
        error: `Supera el máximo de ${maxAdh} adherentes permitido por la cobertura.`,
        dnisExistentes: [],
      }
    }

    const vistos = new Set<string>()
    const dnisExistentes: Patient[] = []
    const titularDni = titular.dni.trim()

    for (let i = 0; i < adherentes.length; i++) {
      const a = adherentes[i]
      const dni = a.dni.trim()
      const ap = a.apellido.trim()
      const nom = a.nombre.trim()
      const rel = String(a.relacion ?? '').trim()

      if (!dni || !ap || !nom || !rel) {
        return {
          ok: false,
          error: `Completá DNI, Apellido, Nombre y Relación en la fila ${i + 1}.`,
          dnisExistentes,
        }
      }
      if (!/^\d{1,8}$/.test(dni)) {
        return {
          ok: false,
          error: `El DNI de la fila ${i + 1} debe tener solo números (hasta 8 dígitos).`,
          dnisExistentes,
        }
      }
      if (titularDni && dni === titularDni) {
        return {
          ok: false,
          error: `El DNI de la fila ${i + 1} coincide con el del contratante titular.`,
          dnisExistentes,
        }
      }
      if (vistos.has(dni)) {
        return {
          ok: false,
          error: `El DNI ${dni} está repetido en la lista de adherentes.`,
          dnisExistentes,
        }
      }
      vistos.add(dni)
      const ex = patientByDni.get(dni)
      if (ex) dnisExistentes.push(ex)
    }

    return { ok: true, error: null, dnisExistentes }
  }, [pasaAFamiliar, adherentes, maxAdh, titular.dni, patientByDni])

  // Aviso si ya usó más consultas o prestaciones este mes que el límite de la nueva cobertura
  const avisoExcesoConsumo = useMemo(() => {
    if (!planNuevo || !consumoTitularMes) return null
    const excesos: string[] = []
    if (
      planNuevo.cupoConsultas > 0 &&
      consumoTitularMes.consultasUsadas > planNuevo.cupoConsultas
    ) {
      excesos.push(
        `usó ${consumoTitularMes.consultasUsadas} consultas este mes y la cobertura ${planNuevo.nombre} permite ${planNuevo.cupoConsultas}`,
      )
    }
    const cupoPrest = planNuevo.prestacionesPorMes ?? 0
    if (cupoPrest > 0 && consumoTitularMes.prestacionesUsadas > cupoPrest) {
      excesos.push(
        `usó ${consumoTitularMes.prestacionesUsadas} prestaciones este mes y la cobertura ${planNuevo.nombre} permite ${cupoPrest}`,
      )
    }
    if (excesos.length === 0) return null
    return `Aviso de consumo: el contratante ya ${excesos.join(' y ')}. El cambio está permitido; los nuevos límites rigen desde la fecha del cambio.`
  }, [planNuevo, consumoTitularMes])

  const puedeConfirmar = useMemo(() => {
    if (!planNuevo || planNuevo.id === afiliado.planId) return false
    if (pasaAFamiliar && !validacionAdherentes.ok) return false
    if (pasaAIndividualConAdherentes && !opcionAdherentes) return false
    return true
  }, [
    planNuevo,
    afiliado.planId,
    pasaAFamiliar,
    validacionAdherentes.ok,
    pasaAIndividualConAdherentes,
    opcionAdherentes,
  ])

  function handleDniChange(index: number, rawValue: string) {
    const clean = rawValue.replace(/\D/g, '').slice(0, 8)
    const existente = clean ? patientByDni.get(clean) : undefined
    setAdherentes((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row
        if (existente && existente.id !== titular.id) {
          return {
            ...row,
            dni: clean,
            pacienteExistenteId: existente.id,
            apellido: existente.apellido,
            nombre: existente.nombre,
            fechaNacimiento: existente.fechaNacimiento || row.fechaNacimiento,
          }
        }
        return {
          ...row,
          dni: clean,
          pacienteExistenteId: undefined,
        }
      }),
    )
  }

  function handleAddAdherente() {
    if (maxAdh > 0 && adherentes.length >= maxAdh) return
    setAdherentes((prev) => [
      ...prev,
      {
        dni: '',
        apellido: '',
        nombre: '',
        fechaNacimiento: '',
        relacion: 'Hijo/a',
      },
    ])
  }

  function handleRemoveAdherente(index: number) {
    setAdherentes((prev) => prev.filter((_, idx) => idx !== index))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!puedeConfirmar || !planNuevo) return
    onConfirm({
      planNuevoId: planNuevo.id,
      planNuevoNombre: planNuevo.nombre,
      fechaVigencia,
      programado: rigeDesdeModo === 'mes_siguiente',
      ...(pasaAIndividualConAdherentes && opcionAdherentes
        ? { opcionAdherentes }
        : {}),
      ...(pasaAFamiliar ? { nuevosAdherentes: adherentes } : {}),
    })
  }

  return (
    <div
      className="af-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="af-modal af-modal-dialog"
        style={{ maxWidth: pasaAFamiliar ? 660 : 540 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-cambiar-cobertura-title"
      >
        <div className="af-modal__head">
          <div>
            <h2 id="modal-cambiar-cobertura-title" style={{ margin: 0, fontSize: '1.15rem' }}>
              Cambiar cobertura
            </h2>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
              Contratante: <strong>{titular.apellido}, {titular.nombre}</strong> (DNI {titular.dni})
            </span>
          </div>
          <button
            type="button"
            className="af-btn af-btn--icon"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="af-form" style={{ gap: '0.9rem' }}>
          {/* Texto informativo fijo obligatorio */}
          <div
            style={{
              padding: '0.6rem 0.8rem',
              borderRadius: '8px',
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              color: '#0369a1',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            Lo ya usado este mes se conserva. Los límites nuevos rigen desde la fecha del cambio. La deuda no cambia.
          </div>

          {/* Aviso si tiene deuda pendiente */}
          {tieneDeuda && (
            <div
              role="status"
              style={{
                padding: '0.55rem 0.8rem',
                borderRadius: '8px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#b45309',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}
            >
              Tiene deuda pendiente; el cambio no la modifica
            </div>
          )}

          {/* Cobertura actual y nueva */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="af-field">
              <label>Cobertura actual</label>
              <div
                style={{
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  fontWeight: 700,
                  color: '#334155',
                  fontSize: '0.9rem',
                }}
              >
                {planActual?.nombre ?? 'Sin cobertura'}
              </div>
            </div>

            <div className="af-field">
              <label htmlFor="select-nueva-cobertura">Nueva cobertura *</label>
              <select
                id="select-nueva-cobertura"
                className="af-select"
                value={planNuevoId}
                onChange={(e) => setPlanNuevoId(e.target.value)}
              >
                {planesElegibles.length === 0 ? (
                  <option value="">No hay otra cobertura disponible</option>
                ) : (
                  planesElegibles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.tipo === 'familiar' ? 'Familiar' : 'Individual'})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Aviso si superó el límite de la nueva cobertura */}
          {avisoExcesoConsumo && (
            <div
              role="status"
              style={{
                padding: '0.55rem 0.8rem',
                borderRadius: '8px',
                background: '#fff7ed',
                border: '1px solid #fed7aa',
                color: '#9a3412',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
            >
              {avisoExcesoConsumo}
            </div>
          )}

          {/* Rige desde */}
          <div className="af-field">
            <label>Rige desde *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  padding: '0.6rem 0.75rem',
                  borderRadius: '8px',
                  border: `2px solid ${rigeDesdeModo === 'mes_siguiente' ? '#0891b2' : '#cbd5e1'}`,
                  background: rigeDesdeModo === 'mes_siguiente' ? '#ecfeff' : '#ffffff',
                  cursor: 'pointer',
                  margin: 0,
                }}
              >
                <input
                  type="radio"
                  name="rige-desde"
                  checked={rigeDesdeModo === 'mes_siguiente'}
                  onChange={() => setRigeDesdeModo('mes_siguiente')}
                  style={{ marginTop: '0.2rem' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0f172a' }}>
                    1.º del mes siguiente
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#475569' }}>
                    Programado para el {formatearFechaLatina(mesSiguienteIso)}
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  padding: '0.6rem 0.75rem',
                  borderRadius: '8px',
                  border: `2px solid ${rigeDesdeModo === 'hoy' ? '#0891b2' : '#cbd5e1'}`,
                  background: rigeDesdeModo === 'hoy' ? '#ecfeff' : '#ffffff',
                  cursor: 'pointer',
                  margin: 0,
                }}
              >
                <input
                  type="radio"
                  name="rige-desde"
                  checked={rigeDesdeModo === 'hoy'}
                  onChange={() => setRigeDesdeModo('hoy')}
                  style={{ marginTop: '0.2rem' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0f172a' }}>
                    Desde hoy
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#475569' }}>
                    Se aplica hoy ({formatearFechaLatina(hoyIso)})
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* De Individual a Familiar: Adherentes de la cobertura Familiar */}
          {pasaAFamiliar && (
            <div
              style={{
                padding: '0.8rem',
                borderRadius: '10px',
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>
                  Adherentes de la cobertura Familiar ({adherentes.length}
                  {maxAdh > 0 ? `/${maxAdh}` : ''})
                </strong>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Al menos 1 adherente · todos los campos son obligatorios
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {adherentes.map((row, idx) => {
                  const yaExiste = row.dni.trim() ? patientByDni.get(row.dni.trim()) : undefined
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '110px 1fr 1fr 120px 34px',
                        gap: '0.45rem',
                        alignItems: 'center',
                        background: '#ffffff',
                        padding: '0.45rem',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <input
                        type="text"
                        className="af-input"
                        placeholder="DNI *"
                        value={row.dni}
                        onChange={(e) => handleDniChange(idx, e.target.value)}
                        aria-label={`DNI adherente ${idx + 1}`}
                      />
                      <input
                        type="text"
                        className="af-input"
                        placeholder="Apellido *"
                        value={row.apellido}
                        onChange={(e) =>
                          setAdherentes((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, apellido: e.target.value } : r)),
                          )
                        }
                        aria-label={`Apellido adherente ${idx + 1}`}
                      />
                      <input
                        type="text"
                        className="af-input"
                        placeholder="Nombre *"
                        value={row.nombre}
                        onChange={(e) =>
                          setAdherentes((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, nombre: e.target.value } : r)),
                          )
                        }
                        aria-label={`Nombre adherente ${idx + 1}`}
                      />
                      <select
                        className="af-select"
                        value={row.relacion}
                        onChange={(e) =>
                          setAdherentes((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, relacion: e.target.value } : r)),
                          )
                        }
                        aria-label={`Relación adherente ${idx + 1}`}
                      >
                        {RELACIONES_OPCIONES.map((rel) => (
                          <option key={rel} value={rel}>
                            {rel}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="af-btn af-btn--icon af-btn--danger-ghost"
                        onClick={() => handleRemoveAdherente(idx)}
                        disabled={adherentes.length <= 1}
                        title={
                          adherentes.length <= 1
                            ? 'Se requiere al menos un adherente'
                            : 'Quitar adherente'
                        }
                        aria-label={`Quitar adherente ${idx + 1}`}
                      >
                        ✕
                      </button>
                      {yaExiste && yaExiste.id !== titular.id && (
                        <div
                          style={{
                            gridColumn: '1 / -1',
                            fontSize: '0.75rem',
                            color: '#0369a1',
                            background: '#e0f2fe',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '5px',
                            fontWeight: 600,
                          }}
                        >
                          DNI existente en Pacientes ({yaExiste.apellido}, {yaExiste.nombre}): se vinculará sin duplicar y se actualizará su cobertura a {planNuevo?.nombre}.
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {validacionAdherentes.error && (
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: '#b91c1c',
                    fontWeight: 600,
                  }}
                >
                  {validacionAdherentes.error}
                </div>
              )}

              <button
                type="button"
                className="af-btn af-btn--ghost"
                onClick={handleAddAdherente}
                disabled={maxAdh > 0 && adherentes.length >= maxAdh}
                style={{ alignSelf: 'flex-start', fontSize: '0.82rem' }}
              >
                + Agregar adherente
              </button>
            </div>
          )}

          {/* De Familiar a Individual (si tiene adherentes): obligar a elegir qué pasa con ellos */}
          {pasaAIndividualConAdherentes && (
            <div
              style={{
                padding: '0.8rem',
                borderRadius: '10px',
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
              }}
            >
              <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>
                ¿Qué pasa con los {afiliado.adherentes?.length} adherentes actuales? *
              </strong>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.55rem',
                  padding: '0.6rem 0.75rem',
                  borderRadius: '8px',
                  border: `2px solid ${opcionAdherentes === 'sin_cobertura' ? '#0891b2' : '#cbd5e1'}`,
                  background: opcionAdherentes === 'sin_cobertura' ? '#ecfeff' : '#ffffff',
                  cursor: 'pointer',
                  margin: 0,
                }}
              >
                <input
                  type="radio"
                  name="opcion-adherentes"
                  checked={opcionAdherentes === 'sin_cobertura'}
                  onChange={() => setOpcionAdherentes('sin_cobertura')}
                  style={{ marginTop: '0.2rem' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0f172a' }}>
                    Quedan sin cobertura
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#475569' }}>
                    Siguen como pacientes en la base y se les restaura su obra social anterior.
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.55rem',
                  padding: '0.6rem 0.75rem',
                  borderRadius: '8px',
                  border: `2px solid ${opcionAdherentes === 'pasan_individual' ? '#0891b2' : '#cbd5e1'}`,
                  background: opcionAdherentes === 'pasan_individual' ? '#ecfeff' : '#ffffff',
                  cursor: 'pointer',
                  margin: 0,
                }}
              >
                <input
                  type="radio"
                  name="opcion-adherentes"
                  checked={opcionAdherentes === 'pasan_individual'}
                  onChange={() => setOpcionAdherentes('pasan_individual')}
                  style={{ marginTop: '0.2rem' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0f172a' }}>
                    Pasan a Individual
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#475569' }}>
                    Cada adherente se convierte en contratante titular con cobertura Individual.
                  </div>
                </div>
              </label>
            </div>
          )}

          <div className="af-modal__actions">
            <button
              type="submit"
              className="af-btn af-btn--primary"
              disabled={!puedeConfirmar}
            >
              Confirmar cambio
            </button>
            <button type="button" className="af-btn af-btn--ghost" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface SuspenderContratanteModalProps {
  afiliado: Afiliado
  titular: Patient
  onClose: () => void
  onConfirm: (payload: {
    motivo: string
    desde: string
    hasta?: string
    observaciones?: string
  }) => void
}

export function SuspenderContratanteModal({
  afiliado,
  titular,
  onClose,
  onConfirm,
}: SuspenderContratanteModalProps) {
  const [motivo, setMotivo] = useState<string>('')
  const [desde, setDesde] = useState<string>(() => hoyIsoLocal())
  const [hasta, setHasta] = useState<string>('')
  const [observaciones, setObservaciones] = useState<string>('')

  const fechaHastaInvalida = Boolean(hasta && desde && hasta <= desde)
  const puedeConfirmar = Boolean(motivo.trim() && desde && !fechaHastaInvalida)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!puedeConfirmar) return
    onConfirm({
      motivo: motivo.trim(),
      desde,
      ...(hasta.trim() ? { hasta: hasta.trim() } : {}),
      ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
    })
  }

  return (
    <div
      className="af-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="af-modal af-modal-dialog"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-suspender-title"
      >
        <div className="af-modal__head">
          <div>
            <h2 id="modal-suspender-title" style={{ margin: 0, fontSize: '1.15rem' }}>
              Suspender contratante
            </h2>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
              <strong>{titular.apellido}, {titular.nombre}</strong>
              {(afiliado.adherentes?.length ?? 0) > 0
                ? ` · y ${afiliado.adherentes?.length} adherente(s)`
                : ''}
            </span>
          </div>
          <button
            type="button"
            className="af-btn af-btn--icon"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="af-form" style={{ gap: '0.85rem' }}>
          <div
            style={{
              padding: '0.55rem 0.75rem',
              borderRadius: '8px',
              background: '#f5f3ff',
              border: '1px solid #ddd6fe',
              color: '#5b21b6',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            Mientras esté suspendido no se podrán emitir órdenes médicas ni usar la cobertura en turnos. La deuda y los datos de los pacientes se conservan intactos.
          </div>

          <div className="af-field">
            <label htmlFor="suspender-motivo">Motivo *</label>
            <select
              id="suspender-motivo"
              className="af-select"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            >
              <option value="">— Seleccionar motivo —</option>
              {MOTIVOS_SUSPENSION.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="af-field">
              <label htmlFor="suspender-desde">Desde *</label>
              <input
                id="suspender-desde"
                type="date"
                className="af-input"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                required
              />
            </div>

            <div className="af-field">
              <label htmlFor="suspender-hasta">Hasta (opcional)</label>
              <input
                id="suspender-hasta"
                type="date"
                className="af-input"
                value={hasta}
                min={desde}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
          </div>

          {fechaHastaInvalida && (
            <div style={{ fontSize: '0.78rem', color: '#b91c1c', fontWeight: 600 }}>
              La fecha &ldquo;Hasta&rdquo; debe ser posterior a la fecha &ldquo;Desde&rdquo;.
            </div>
          )}

          <div className="af-field">
            <label htmlFor="suspender-obs">Observaciones (opcional)</label>
            <textarea
              id="suspender-obs"
              className="af-input"
              rows={2}
              placeholder="Notas adicionales sobre la suspensión…"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>

          <div className="af-modal__actions">
            <button
              type="submit"
              className="af-btn af-btn--primary"
              disabled={!puedeConfirmar}
            >
              Suspender contratante
            </button>
            <button type="button" className="af-btn af-btn--ghost" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface DarDeBajaContratanteModalProps {
  afiliado: Afiliado
  titular: Patient
  onClose: () => void
  onConfirm: (payload: { motivo: string; fechaBaja: string }) => void
}

export function DarDeBajaContratanteModal({
  afiliado,
  titular,
  onClose,
  onConfirm,
}: DarDeBajaContratanteModalProps) {
  const [motivo, setMotivo] = useState<string>('')
  const [fechaBaja, setFechaBaja] = useState<string>(() => hoyIsoLocal())
  const [confirmado, setConfirmado] = useState<boolean>(false)

  const puedeConfirmar = Boolean(motivo.trim() && fechaBaja && confirmado)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!puedeConfirmar) return
    onConfirm({
      motivo: motivo.trim(),
      fechaBaja,
    })
  }

  return (
    <div
      className="af-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="af-modal af-modal-dialog"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-baja-title"
      >
        <div className="af-modal__head">
          <div>
            <h2 id="modal-baja-title" style={{ margin: 0, fontSize: '1.15rem' }}>
              Dar de baja
            </h2>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
              Contratante: <strong>{titular.apellido}, {titular.nombre}</strong>
            </span>
          </div>
          <button
            type="button"
            className="af-btn af-btn--icon"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="af-form" style={{ gap: '0.85rem' }}>
          <div
            style={{
              padding: '0.55rem 0.75rem',
              borderRadius: '8px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              color: '#334155',
              fontSize: '0.8rem',
            }}
          >
            La afiliación terminará en la fecha elegida. El titular
            {(afiliado.adherentes?.length ?? 0) > 0 ? ' y sus adherentes' : ''} seguirán en Pacientes con su obra social anterior restaurada, conservando todo el historial, órdenes emitidas y estado de cuenta.
          </div>

          <div className="af-field">
            <label htmlFor="baja-motivo">Motivo *</label>
            <select
              id="baja-motivo"
              className="af-select"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            >
              <option value="">— Seleccionar motivo —</option>
              {MOTIVOS_BAJA.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="af-field">
            <label htmlFor="baja-fecha">Fecha de baja *</label>
            <input
              id="baja-fecha"
              type="date"
              className="af-input"
              value={fechaBaja}
              onChange={(e) => setFechaBaja(e.target.value)}
              required
            />
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.55rem',
              padding: '0.6rem 0.75rem',
              borderRadius: '8px',
              background: confirmado ? '#fef2f2' : '#f8fafc',
              border: `1px solid ${confirmado ? '#fca5a5' : '#cbd5e1'}`,
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#0f172a',
              margin: 0,
            }}
          >
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
            />
            <span>Entiendo que la baja termina la cobertura</span>
          </label>

          <div className="af-modal__actions">
            <button
              type="submit"
              className="af-btn af-btn--danger"
              disabled={!puedeConfirmar}
            >
              Confirmar baja
            </button>
            <button type="button" className="af-btn af-btn--ghost" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

