import { useState } from 'react'

type Mes = {
  nombre: string
  estado: 'Adeudado' | 'Adelantar'
  monto: string
}

const MESES: Mes[] = [
  { nombre: 'Septiembre 2026', estado: 'Adeudado', monto: '$70.000' },
  { nombre: 'Octubre 2026', estado: 'Adeudado', monto: '$70.000' },
  { nombre: 'Noviembre 2026', estado: 'Adeudado', monto: '$70.000' },
  { nombre: 'Diciembre 2026', estado: 'Adelantar', monto: '$70.000' },
]

type Props = {
  open: boolean
  onClose: () => void
  onRegistrar?: (meses: Mes[]) => void
}

export function CobrarCuotasModal({ open, onClose, onRegistrar }: Props) {
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set([0]))

  if (!open) return null

  const toggle = (idx: number) => {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const seleccionadosList = MESES.filter((_, i) => seleccionados.has(i))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-slate-900">Cobrar cuotas</h2>

        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-base font-bold text-slate-900 uppercase">RAMIREZ, SONIA</p>
          <p className="text-sm text-slate-500 mt-1">Familiar · $70.000 por mes</p>
        </div>

        <div className="mt-6 mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">MESES</span>
          <button
            type="button"
            className="text-sm text-cyan-600 font-medium hover:underline"
            onClick={() => setSeleccionados(new Set(MESES.map((_, i) => i)))}
          >
            Seleccionar adeudado
          </button>
        </div>

        <div>
          {MESES.map((mes, idx) => {
            const selected = seleccionados.has(idx)
            return (
              <div
                key={mes.nombre}
                onClick={() => toggle(idx)}
                className={`flex items-center justify-between p-3 rounded-lg border mb-2 cursor-pointer transition-colors ${
                  selected
                    ? 'bg-cyan-50/50 border-cyan-600'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggle(idx)}
                    className="mr-3 text-cyan-600 rounded focus:ring-cyan-500"
                  />
                  <span className="text-sm font-medium text-slate-700">{mes.nombre}</span>
                </div>
                {mes.estado === 'Adeudado' ? (
                  <span className="bg-orange-50 text-orange-600 text-xs font-medium px-2.5 py-0.5 rounded-full mr-3">
                    Adeudado
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 mr-3">Adelantar</span>
                )}
                <span className="text-sm font-semibold text-slate-700">{mes.monto}</span>
              </div>
            )
          })}
        </div>

        <div className="flex justify-between items-end mt-6 pt-4 border-t border-slate-100">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Forma de pago</label>
            <select className="border border-slate-300 rounded-lg p-2 text-sm text-slate-700 w-32 focus:ring-cyan-500 focus:border-cyan-500">
              <option>Efectivo</option>
            </select>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">TOTAL · {seleccionados.size} MES{seleccionados.size !== 1 ? 'ES' : ''}</p>
            <p className="text-2xl font-bold text-slate-900">${(seleccionados.size * 70000).toLocaleString('es-AR')}</p>
          </div>
        </div>

        <div className="flex justify-between items-center mt-6 w-full">
          <button
            type="button"
            onClick={onClose}
            className="bg-white border border-slate-300 text-slate-700 font-medium py-2 px-4 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onRegistrar?.(seleccionadosList)}
            disabled={seleccionados.size === 0}
            className="bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-2 px-6 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Registrar pago
          </button>
        </div>
      </div>
    </div>
  )
}

export default CobrarCuotasModal