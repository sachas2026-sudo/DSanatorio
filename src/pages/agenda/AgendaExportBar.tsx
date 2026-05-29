import type { AgendaPdfScope } from '../../lib/agendaWeekPdf'
import type { Doctor } from '../../types'

type Props = {
  doctors: Doctor[]
  exportDoctorId: string
  onExportDoctorIdChange: (id: string) => void
  exportScope: AgendaPdfScope
  onExportScopeChange: (scope: AgendaPdfScope) => void
  onTurnosPdf: () => void
  onPreviewPdf: () => void
  puedeEnviarCorreo: boolean
  enviandoCorreo: boolean
  onEnviarCorreo: () => void
}

export function AgendaExportBar({
  doctors,
  exportDoctorId,
  onExportDoctorIdChange,
  exportScope,
  onExportScopeChange,
  onTurnosPdf,
  onPreviewPdf,
  puedeEnviarCorreo,
  enviandoCorreo,
  onEnviarCorreo,
}: Props) {
  return (
    <div className="agenda-export-bar">
      <div className="agenda-export-bar__field">
        <label className="agenda-export-bar__label" htmlFor="agenda-export-doctor">
          Médico
        </label>
        <select
          id="agenda-export-doctor"
          className="agenda-export-bar__select agenda-export-bar__select--doctor"
          value={exportDoctorId}
          onChange={(e) => onExportDoctorIdChange(e.target.value)}
          aria-label="Médico para PDF y correo"
        >
          <option value="">Todos</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.apellido}, {d.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="agenda-export-bar__field">
        <label className="agenda-export-bar__label" htmlFor="agenda-export-scope">
          Exportar
        </label>
        <select
          id="agenda-export-scope"
          className="agenda-export-bar__select"
          value={exportScope}
          onChange={(e) => onExportScopeChange(e.target.value as AgendaPdfScope)}
          aria-label="Período para PDF y correo"
        >
          <option value="day">Día</option>
          <option value="week">Semana</option>
          <option value="month">Mes</option>
        </select>
      </div>
      <button
        type="button"
        className="btn btn-pdf agenda-export-bar__pdf agenda-export-bar__pdf-turnos"
        onClick={onTurnosPdf}
      >
        <span className="btn-pdf__label">PDF Turnos</span>
      </button>
      <button
        type="button"
        className="btn btn-pdf agenda-export-bar__pdf"
        onClick={onPreviewPdf}
      >
        Vista previa
      </button>
      {puedeEnviarCorreo && (
        <button
          type="button"
          className={`btn btn-email agenda-export-bar__email${enviandoCorreo ? ' btn-email--sending' : ''}`}
          disabled={enviandoCorreo}
          aria-busy={enviandoCorreo}
          onClick={onEnviarCorreo}
        >
          {enviandoCorreo ? (
            <>
              <span className="btn-email__spinner" aria-hidden />
              <span className="btn-email__label btn-email__label--sending">
                Enviar Correo
              </span>
            </>
          ) : (
            <>
              <span className="btn-email__icon" aria-hidden>
                @
              </span>
              <span className="btn-email__label">Enviar Correo</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
