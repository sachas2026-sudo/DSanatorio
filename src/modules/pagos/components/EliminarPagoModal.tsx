import { useEffect, useState } from 'react'

import { format, parseISO } from 'date-fns'

import { es } from 'date-fns/locale'

import { MOTIVOS_CANCELACION_PAGO } from '../../../lib/pagosCancelados'

import type { MotivoCancelacionPago } from '../../../types'

import './eliminar-pago-modal.css'



type Props = {

  title: string

  fechaIso: string

  /** Si es null, no se muestra la fila de monto (turno sin pago). */

  montoTotal: number | null

  pacienteLabel: string

  medicoLabel: string

  onClose: () => void

  onConfirm: (motivo: MotivoCancelacionPago, notasOtros: string) => void

}



export function EliminarPagoModal({

  title,

  fechaIso,

  montoTotal,

  pacienteLabel,

  medicoLabel,

  onClose,

  onConfirm,

}: Props) {

  const [motivo, setMotivo] = useState<MotivoCancelacionPago | ''>('')

  const [notasOtros, setNotasOtros] = useState('')

  const [error, setError] = useState<string | null>(null)



  useEffect(() => {

    function onKey(e: KeyboardEvent) {

      if (e.key === 'Escape') onClose()

    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)

  }, [onClose])



  function handleSubmit(e: React.FormEvent) {

    e.preventDefault()

    if (!motivo) {

      setError('Seleccioná un motivo de eliminación.')

      return

    }

    if (motivo === 'otros' && !notasOtros.trim()) {

      setError('Indicá el detalle en "Otros".')

      return

    }

    onConfirm(motivo, notasOtros.trim())

  }



  const montoFmt =

    montoTotal != null

      ? montoTotal.toLocaleString('es-AR', {

          style: 'currency',

          currency: 'ARS',

          maximumFractionDigits: 2,

        })

      : null



  return (

    <div

      className="eliminar-pago-backdrop"

      role="presentation"

      onMouseDown={(e) => {

        if (e.target === e.currentTarget) onClose()

      }}

    >

      <div

        className="eliminar-pago-sheet"

        role="dialog"

        aria-modal="true"

        aria-labelledby="eliminar-pago-title"

      >

        <header className="eliminar-pago-sheet__head">

          <div>

            <h2 id="eliminar-pago-title">{title}</h2>

            <p className="eliminar-pago-sheet__sub">

              El registro se guardará en <strong>Pagos Cancelados</strong>.

            </p>

          </div>

          <button

            type="button"

            className="eliminar-pago-sheet__close"

            aria-label="Cerrar"

            onClick={onClose}

          >

            ×

          </button>

        </header>



        <form className="eliminar-pago-sheet__body" onSubmit={handleSubmit}>

          <dl className="eliminar-pago-resumen">

            <div>

              <dt>Fecha</dt>

              <dd>

                {format(parseISO(fechaIso), 'd MMM yyyy HH:mm', {

                  locale: es,

                })}

              </dd>

            </div>

            <div>

              <dt>Paciente</dt>

              <dd>{pacienteLabel}</dd>

            </div>

            <div>

              <dt>Médico</dt>

              <dd>{medicoLabel}</dd>

            </div>

            {montoFmt != null && (

              <div>

                <dt>Monto</dt>

                <dd>{montoFmt}</dd>

              </div>

            )}

          </dl>



          <label className="eliminar-pago-field" htmlFor="motivo-eliminacion">

            Motivo <span className="req">*</span>

          </label>

          <select

            id="motivo-eliminacion"

            className="eliminar-pago-select"

            value={motivo}

            onChange={(e) => {

              setMotivo(e.target.value as MotivoCancelacionPago | '')

              setError(null)

            }}

          >

            <option value="">— Seleccionar motivo —</option>

            {MOTIVOS_CANCELACION_PAGO.map((m) => (

              <option key={m.value} value={m.value}>

                {m.label}

              </option>

            ))}

          </select>



          {motivo === 'otros' && (

            <>

              <label className="eliminar-pago-field" htmlFor="motivo-otros-detalle">

                Detalle <span className="req">*</span>

              </label>

              <textarea

                id="motivo-otros-detalle"

                className="eliminar-pago-textarea"

                rows={3}

                value={notasOtros}

                onChange={(e) => {

                  setNotasOtros(e.target.value)

                  setError(null)

                }}

                placeholder="Describí el motivo…"

              />

            </>

          )}



          {error && (

            <p className="eliminar-pago-error" role="alert">

              {error}

            </p>

          )}



          <footer className="eliminar-pago-sheet__actions">

            <button type="button" className="btn btn-ghost" onClick={onClose}>

              Cancelar

            </button>

            <button type="submit" className="btn btn-danger">

              Eliminar y archivar

            </button>

          </footer>

        </form>

      </div>

    </div>

  )

}


