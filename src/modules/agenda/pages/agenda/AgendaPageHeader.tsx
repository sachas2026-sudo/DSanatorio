import type { Doctor } from '../../../../types'
import { AgendaExportBar } from './AgendaExportBar'
import { AgendaMenu } from './AgendaMenu'

export type AgendaTab =
  | 'turnos'
  | 'horarios'
  | 'franja'
  | 'mensual'
  | 'libres'

type Props = {
  tab: AgendaTab
  onTabChange: (tab: AgendaTab) => void
  onOpenAgendaMedico: () => void
  onOpenAtencionSinTurno: () => void
  onOpenEspecialidades: () => void
  onOpenMedicosDia: () => void
  agendaExportDoctors: Doctor[]
  agendaExportDoctorId: string
  onExportDoctorIdChange: (id: string) => void
  agendaExportScope?: import('../../../../lib/agendaWeekPdf').AgendaPdfScope
  onExportScopeChange?: (scope: import('../../../../lib/agendaWeekPdf').AgendaPdfScope) => void
  onTurnosPdf: () => void
  onWhatsAppPacientesPdf: () => void
  onPreviewPdf: () => void
  puedeEnviarCorreo: boolean
  enviandoCorreo: boolean
  onEnviarCorreo: () => void
  onOpenObraSocial?: () => void
  onOpenAgendaManual?: () => void
}

export function AgendaPageHeader({
  tab,
  onTabChange,
  onOpenAgendaMedico,
  onOpenAtencionSinTurno,
  onOpenEspecialidades,
  onOpenMedicosDia,
  onOpenObraSocial,
  agendaExportDoctors,
  agendaExportDoctorId,
  onExportDoctorIdChange,
  onTurnosPdf,
  onWhatsAppPacientesPdf,
  onPreviewPdf,
  puedeEnviarCorreo,
  enviandoCorreo,
  onEnviarCorreo,
  onOpenAgendaManual,
}: Props) {
  return (
    <header className="page-header page-header--agenda">
      <div className="tabs tabs--agenda agenda-header-pill">
        <h1 className="tabs--agenda__title">AGENDA</h1>
        <div className="tabs--agenda__right">
          <div className="tabs--agenda__secondary">
            <button
              type="button"
              className={`agenda-menu__agenda-button${tab === 'turnos' ? ' agenda-menu__agenda-button--active' : ''}`}
              onClick={() => onTabChange('turnos')}
            >
              Agenda
            </button>
            <AgendaMenu
              triggerLabel="Configurar"
              items={[
                {
                  id: 'sin-turno',
                  label: 'Sin turno',
                  onClick: onOpenAtencionSinTurno,
                },
                {
                  id: 'agenda-medico',
                  label: 'Agenda médico',
                  onClick: onOpenAgendaMedico,
                },
                {
                  id: 'horarios',
                  label: 'Horarios',
                  onClick: () => onTabChange('horarios'),
                },
                {
                  id: 'franja',
                  label: 'Franja turno',
                  onClick: () => onTabChange('franja'),
                },
                {
                  id: 'libres',
                  label: 'Días libres',
                  onClick: () => onTabChange('libres'),
                },
                {
                  id: 'especialidades',
                  label: 'Especialidades',
                  onClick: onOpenEspecialidades,
                },
                {
                  id: 'medicos-hoy',
                  label: 'Médicos hoy',
                  onClick: onOpenMedicosDia,
                },
              ]}
            />
          </div>
          <AgendaExportBar
            doctors={agendaExportDoctors}
            exportDoctorId={agendaExportDoctorId}
            onExportDoctorIdChange={onExportDoctorIdChange}
            onTurnosPdf={onTurnosPdf}
            onWhatsAppPacientesPdf={onWhatsAppPacientesPdf}
            onPreviewPdf={onPreviewPdf}
            puedeEnviarCorreo={puedeEnviarCorreo}
            enviandoCorreo={enviandoCorreo}
            onEnviarCorreo={onEnviarCorreo}
            onOpenObraSocial={onOpenObraSocial}
            onOpenAgendaManual={onOpenAgendaManual}
          />
        </div>
      </div>
    </header>
  )
}
