import { useEffect } from 'react'

type Props = {
  onClose: () => void
}

export function PermisosUsuariosHelpModal({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="app-info-backdrop"
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(3px)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="app-info-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permisos-help-title"
        style={{
          width: 'min(580px, 100%)',
          maxHeight: 'min(88vh, 680px)',
          borderRadius: '14px',
          background: '#ffffff',
          boxShadow: '0 24px 54px rgba(15, 23, 42, 0.22)',
          border: '1px solid #dce4eb',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease-out',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.15rem 1.35rem',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div
              style={{
                width: '2rem',
                height: '2rem',
                borderRadius: '50%',
                background: '#e0f2fe',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
                fontWeight: 700,
              }}
            >
              ?
            </div>
            <div>
              <h2
                id="permisos-help-title"
                style={{
                  margin: 0,
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: '#1a2744',
                }}
              >
                Guía de Permisos de Usuarios
              </h2>
              <p
                style={{
                  margin: '0.15rem 0 0',
                  fontSize: '0.8rem',
                  color: '#64748b',
                }}
              >
                Configuración y alcance para el rol Secretaría
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '1.5rem',
              lineHeight: 1,
              color: '#64748b',
              cursor: 'pointer',
              padding: '0.35rem 0.5rem',
              borderRadius: '6px',
            }}
          >
            ×
          </button>
        </header>

        <div
          style={{
            padding: '1.35rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.15rem',
          }}
        >
          {/* Card 1: Modificar Mes */}
          <div
            style={{
              padding: '1rem 1.15rem',
              borderRadius: '10px',
              border: '1px solid #bfdbfe',
              background: '#f8fbff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem' }}>📅</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e3a8a' }}>
                1. Activar Modificar Mes
              </h3>
            </div>
            <p style={{ margin: '0 0 0.65rem', fontSize: '0.84rem', color: '#334155', lineHeight: 1.45 }}>
              Determina si Secretaría puede modificar o cancelar turnos de días pasados dentro del mes en curso:
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
              <li style={{ marginBottom: '0.35rem' }}>
                <strong style={{ color: '#1e293b' }}>Hacia el futuro:</strong> Secretaría <em>siempre</em> puede crear, modificar o cancelar turnos de la semana actual y de todos los meses futuros en adelante.
              </li>
              <li style={{ marginBottom: '0.35rem' }}>
                <strong style={{ color: '#1e293b' }}>Casilla Desactivada:</strong> Solo se permite editar turnos desde el lunes de la semana actual en adelante. Días de semanas anteriores quedan protegidos contra cambios.
              </li>
              <li>
                <strong style={{ color: '#1e293b' }}>Casilla Activada:</strong> Se habilita a Secretaría a modificar también turnos pasados del mes actual (por ejemplo principios de mes), manteniendo bloqueados los meses anteriores cerrados.
              </li>
            </ul>
          </div>

          {/* Card 2: Modificar turnos no suyos */}
          <div
            style={{
              padding: '1rem 1.15rem',
              borderRadius: '10px',
              border: '1px solid #bfdbfe',
              background: '#f8fbff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem' }}>👥</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e3a8a' }}>
                2. Activar usuarios de distintos turnos modificar turnos no suyos
              </h3>
            </div>
            <p style={{ margin: '0 0 0.65rem', fontSize: '0.84rem', color: '#334155', lineHeight: 1.45 }}>
              Controla la colaboración entre secretarias de diferentes turnos (Mañana / Tarde / Noche):
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
              <li style={{ marginBottom: '0.35rem' }}>
                <strong style={{ color: '#1e293b' }}>Casilla Activada (Recomendado):</strong> Permite que una secretaria (ej. Turno Tarde) pueda cancelar o reprogramar un turno creado por una secretaria de otro turno (ej. Turno Mañana) si el paciente o médico avisa fuera de horario.
              </li>
              <li style={{ marginBottom: '0.35rem' }}>
                <strong style={{ color: '#1e293b' }}>Casilla Desactivada:</strong> Limita a que cada usuario únicamente pueda editar o cancelar turnos registrados por su propia cuenta/turno.
              </li>
              <li>
                <strong style={{ color: '#1e293b' }}>Auditoría completa:</strong> En cualquier caso, el sistema siempre registra automáticamente quién realizó la última modificación (<code style={{ background: '#e2e8f0', padding: '0.1rem 0.3rem', borderRadius: '4px', fontSize: '0.78rem' }}>modificadoPor</code>) y la fecha/hora exacta.
              </li>
            </ul>
          </div>

          {/* Card 3: Activar las acciones en la lista de Pagos */}
          <div
            style={{
              padding: '1rem 1.15rem',
              borderRadius: '10px',
              border: '1px solid #bfdbfe',
              background: '#f8fbff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem' }}>💳</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e3a8a' }}>
                3. Activar las acciones en la lista de Pagos
              </h3>
            </div>
            <p style={{ margin: '0 0 0.65rem', fontSize: '0.84rem', color: '#334155', lineHeight: 1.45 }}>
              Permite ocultar o mostrar la columna de acciones (editar y eliminar) en la tabla del módulo de Pagos:
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
              <li style={{ marginBottom: '0.35rem' }}>
                <strong style={{ color: '#1e293b' }}>Casilla Desactivada (Por defecto):</strong> La tabla de pagos se visualiza en modo limpio sin la columna de botones de acciones.
              </li>
              <li>
                <strong style={{ color: '#1e293b' }}>Casilla Activada:</strong> Se visualiza la columna "ACCIONES" con los iconos de lápiz (editar) y papelera (eliminar/anular) en cada fila de pago.
              </li>
            </ul>
          </div>
        </div>

        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '0.85rem 1.35rem',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            style={{
              padding: '0.45rem 1.35rem',
              fontSize: '0.86rem',
              fontWeight: 600,
            }}
          >
            Entendido
          </button>
        </footer>
      </div>
    </div>
  )
}
