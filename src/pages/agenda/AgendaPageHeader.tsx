import type { AgendaPdfScope } from '../../lib/agendaWeekPdf'
import type { Doctor } from '../../types'
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
  agendaExportScope: AgendaPdfScope
  onExportScopeChange: (scope: AgendaPdfScope) => void
  onTurnosPdf: () => void
  onWhatsAppPacientesPdf: () => void
  onPreviewPdf: () => void
  puedeEnviarCorreo: boolean
  enviandoCorreo: boolean
  onEnviarCorreo: () => void
}

export function AgendaPageHeader({
  tab,
  onTabChange,
  onOpenAgendaMedico,
  onOpenAtencionSinTurno,
  onOpenEspecialidades,
  onOpenMedicosDia,
  agendaExportDoctors,
  agendaExportDoctorId,
  onExportDoctorIdChange,
  agendaExportScope,
  onExportScopeChange,
  onTurnosPdf,
  onWhatsAppPacientesPdf,
  onPreviewPdf,
  puedeEnviarCorreo,
  enviandoCorreo,
  onEnviarCorreo,
}: Props) {
  return (
      <header className="page-header page-header--agenda">
        <div className="tabs tabs--agenda">
          <h1 className="tabs--agenda__title">Agenda</h1>
          <button
            type="button"
            className={`tab tab--agenda-celeste${tab === 'turnos' ? ' tab--on' : ''}`}
            onClick={() => onTabChange('turnos')}
             style={{ marginTop: '-12px' }}
          >
            AGENDA
          </button>
          <div className="tabs--agenda__right" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '-18px', transform: 'translateY(-3px)' }}>
            <div className="tabs--agenda__secondary" style={{ transform: 'translateY(-3px)' }}>
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
              exportScope={agendaExportScope}
              onExportScopeChange={onExportScopeChange}
              onTurnosPdf={onTurnosPdf}
              onWhatsAppPacientesPdf={onWhatsAppPacientesPdf}
              onPreviewPdf={onPreviewPdf}
              puedeEnviarCorreo={puedeEnviarCorreo}
              enviandoCorreo={enviandoCorreo}
              onEnviarCorreo={onEnviarCorreo}
            />
          </div>
        </div>
      </header>
    )
  }
