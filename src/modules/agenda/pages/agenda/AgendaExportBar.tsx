import type { Doctor } from '../../../../types'

type Props = {
  doctors: Doctor[]
  exportDoctorId: string
  onExportDoctorIdChange: (id: string) => void
  onTurnosPdf: () => void
  onWhatsAppPacientesPdf: () => void
  onPreviewPdf: () => void
  puedeEnviarCorreo: boolean
  enviandoCorreo: boolean
  onEnviarCorreo: () => void
  onOpenObraSocial?: () => void
  onOpenAgendaManual?: () => void
}

export function AgendaExportBar({
  doctors,
  exportDoctorId,
  onExportDoctorIdChange,
  onTurnosPdf,
  onWhatsAppPacientesPdf,
  onPreviewPdf,
  puedeEnviarCorreo,
  enviandoCorreo,
  onEnviarCorreo,
  onOpenObraSocial,
  onOpenAgendaManual,
}: Props) {
  return (
    <div className="agenda-export-bar">
        <div className="agenda-export-bar__field">
          <select
            id="agenda-export-doctor"
            className="agenda-export-bar__select agenda-export-bar__select--doctor"
            value={exportDoctorId}
            onChange={(e) => onExportDoctorIdChange(e.target.value)}
            aria-label="Médico para PDF y correo"
            style={{ width: '100%', maxWidth: '100%' }}
          >
            <option value="">Todos los Médicos</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.apellido}, {d.nombre}
              </option>
            ))}
          </select>
        </div>
        {onOpenObraSocial && (
          <button
            type="button"
            className="pacientes-btn-os"
            onClick={onOpenObraSocial}
            title="Gestionar obras sociales"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>Obra Social</span>
          </button>
        )}
        <button
          type="button"
          className="btn btn-pdf agenda-export-bar__pdf agenda-export-bar__pdf-turnos"
          onClick={onTurnosPdf}
        >
          <span className="btn-pdf__label">PDF turnos</span>
        </button>
        <button
          type="button"
          className="btn btn-pdf agenda-export-bar__pdf"
          title="PDF de agenda por médico"
          onClick={onPreviewPdf}
        >
          <span className="btn-pdf__label">PDF doctor</span>
        </button>
        <button
          type="button"
          className="btn btn-pdf agenda-export-bar__pdf agenda-export-bar__pdf-whatsapp"
          title="Listado de mensajes WhatsApp a pacientes"
          onClick={onWhatsAppPacientesPdf}
        >
          <span className="btn-pdf__label">PDF WhatsApp</span>
        </button>
        {puedeEnviarCorreo && (
          <button
            type="button"
            className={`btn btn-email agenda-export-bar__email${enviandoCorreo ? ' btn-email--sending' : ''}`}
            disabled={enviandoCorreo}
            aria-busy={enviandoCorreo}
            title="Enviar correo"
            onClick={onEnviarCorreo}
          >
           {enviandoCorreo ? (
             <>
               <span className="btn-email__spinner" aria-hidden />
               <span className="btn-email__label btn-email__label--sending">
                 Enviar
               </span>
             </>
           ) : (
             <span className="btn-email__label">Enviar</span>
           )}
         </button>
       )}
       {onOpenAgendaManual && (
         <button
           type="button"
           className="btn btn-secondary agenda-export-bar__manual"
           title="Cargar turno en Agenda Manual"
           onClick={onOpenAgendaManual}
         >
           <span>Agenda Manual</span>
         </button>
       )}
    </div>
  )
}
