import { useEffect, useMemo, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { useAppState } from '../context/AppStateContext'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../context/ConfirmContext'
import {
  defaultHistoricoCutoffDate,
  previewArchiveHistorico,
  type ArchiveHistoricoStats,
} from '../lib/archiveHistorico'
import { getRecoveryChecklist, type RecoveryChecklistEntry } from '../lib/appBackup'
import { formatBackupSize } from '../lib/formatBackupSize'
import {
  listHistoricoArchives,
  type HistoricoArchiveEntry,
} from '../lib/historicoStorage'
import { canAccessMantenimiento } from '../lib/exportPermissions'
import { serializeAppDataForBackup } from '../lib/appStorage'
import './pages.css'

function formatArchiveStats(stats: ArchiveHistoricoStats): string {
  return [
    `${stats.appointments} turno${stats.appointments === 1 ? '' : 's'}`,
    `${stats.payments} pago${stats.payments === 1 ? '' : 's'}`,
    `${stats.pagosCancelados} cancelado${stats.pagosCancelados === 1 ? '' : 's'}`,
    `${stats.atencionesSinTurno} atención${stats.atencionesSinTurno === 1 ? '' : 'es'} sin turno`,
  ].join(' · ')
}

export function MantenimientoPage() {
  const { role } = useAuth()
  const { data, archiveHistoricoBeforeCutoff } = useAppState()
  const { confirm } = useConfirm()
  const esAdmi = canAccessMantenimiento(role)
  const [recoveryItems, setRecoveryItems] = useState<RecoveryChecklistEntry[]>(
    [],
  )
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [historicoItems, setHistoricoItems] = useState<HistoricoArchiveEntry[]>(
    [],
  )
  const [historicoLoading, setHistoricoLoading] = useState(false)
  const [cutoffDate, setCutoffDate] = useState(() => defaultHistoricoCutoffDate())
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveMsg, setArchiveMsg] = useState<{
    type: 'ok' | 'err'
    text: string
  } | null>(null)

  const activeSizeBytes = useMemo(() => {
    if (!data) return 0
    return new Blob([serializeAppDataForBackup(data)]).size
  }, [data])

  const previewStats = useMemo(() => {
    if (!data) return null
    try {
      return previewArchiveHistorico(data, cutoffDate)
    } catch {
      return null
    }
  }, [data, cutoffDate])

  useEffect(() => {
    if (!isTauri()) return
    setRecoveryLoading(true)
    void getRecoveryChecklist()
      .then(setRecoveryItems)
      .finally(() => setRecoveryLoading(false))
  }, [])

  const refreshHistorico = () => {
    if (!isTauri()) return
    setHistoricoLoading(true)
    void listHistoricoArchives()
      .then(setHistoricoItems)
      .finally(() => setHistoricoLoading(false))
  }

  useEffect(() => {
    refreshHistorico()
  }, [])

  async function handleArchiveHistorico() {
    if (!previewStats) return
    const total =
      previewStats.appointments +
      previewStats.payments +
      previewStats.pagosCancelados +
      previewStats.atencionesSinTurno
    if (total === 0) {
      setArchiveMsg({
        type: 'err',
        text: 'No hay registros anteriores a esa fecha para archivar.',
      })
      return
    }

    const ok = await confirm({
      title: 'Archivar historial',
      message: `Se moverán a un archivo histórico (no se borran) los registros anteriores al ${cutoffDate}:\n\n${formatArchiveStats(previewStats)}\n\nPacientes y médicos no se modifican. La base activa quedará más liviana.`,
      confirmLabel: 'Archivar',
      cancelLabel: 'Cancelar',
    })
    if (!ok) return

    setArchiveBusy(true)
    setArchiveMsg(null)
    const result = await archiveHistoricoBeforeCutoff(cutoffDate)
    setArchiveBusy(false)
    if (!result.ok) {
      setArchiveMsg({ type: 'err', text: result.error })
      return
    }
    setArchiveMsg({
      type: 'ok',
      text: `Archivado: ${formatArchiveStats(result.stats)}. La base activa se guardó en disco.`,
    })
    refreshHistorico()
  }

  if (!esAdmi) {
    return (
      <div className="page page--mantenimiento">
        <header className="page-header">
          <h1>Mantenimiento</h1>
          <p className="page-lead">Esta sección es solo para administración.</p>
        </header>
      </div>
    )
  }

  return (
    <div className="page page--mantenimiento page--mantenimiento-admi">
      <header className="page-header">
        <h1>Mantenimiento</h1>
        <p className="page-lead">
          Herramientas de administración e información de recuperación. El instalador configura la app en <strong>C:\Sanatorio</strong>.
        </p>
      </header>

      <div className="mant-grid">
        <section className="panel mant-panel" aria-labelledby="mant-historico-title">
          <h2 id="mant-historico-title">Rendimiento — archivar historial</h2>
          <p className="mant-note">
            Mueve turnos, pagos, cancelados y atenciones sin turno <strong>anteriores</strong> a
            una fecha a <code>C:\Sanatorio\datos\historico\</code>. Pacientes y médicos quedan en
            la base activa. Recomendado cada 2–3 años para mantener la app ágil.
          </p>
          <p className="field-hint">
            Base activa actual: {formatBackupSize(activeSizeBytes)}
          </p>
          <label className="field">
            <span className="field-label">Archivar todo anterior a</span>
            <input
              type="date"
              value={cutoffDate}
              onChange={(e) => {
                setArchiveMsg(null)
                setCutoffDate(e.target.value)
              }}
            />
          </label>
          {previewStats && (
            <p className="field-hint">
              Se archivarían: {formatArchiveStats(previewStats)}. Quedarían{' '}
              {previewStats.keptAppointments} turnos y {previewStats.keptPayments} pagos en la
              base activa.
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={archiveBusy || !previewStats}
              onClick={() => void handleArchiveHistorico()}
            >
              {archiveBusy ? 'Archivando…' : 'Archivar historial'}
            </button>
          </div>
          {archiveMsg && (
            <p
              className={
                archiveMsg.type === 'ok' ? 'config-saved-msg' : 'field-hint field-hint--err'
              }
              role="status"
            >
              {archiveMsg.text}
            </p>
          )}
          {!isTauri() ? (
            <p className="field-hint">Disponible en la app de escritorio.</p>
          ) : historicoLoading ? (
            <p className="field-hint">Leyendo archivos históricos…</p>
          ) : historicoItems.length > 0 ? (
            <table className="mant-table mant-recovery-table">
              <thead>
                <tr>
                  <th>Archivo histórico</th>
                  <th>Corte</th>
                  <th>Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {historicoItems.map((item) => (
                  <tr key={item.filename}>
                    <td>
                      <code>{item.filename}</code>
                    </td>
                    <td>{item.cutoffDate ?? '—'}</td>
                    <td>
                      {item.sizeBytes != null ? formatBackupSize(item.sizeBytes) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="field-hint">Todavía no hay archivos históricos.</p>
          )}
        </section>

        <section className="panel mant-panel">
          <h2>Para el técnico</h2>
          <ol className="mant-steps">
            <li>
              <strong>Datos:</strong> <code>C:\Sanatorio\datos\</code> — respaldos en{' '}
              <code>C:\Sanatorio\respaldo\</code>
            </li>
            <li>
              <strong>Histórico:</strong> <code>C:\Sanatorio\datos\historico\</code>
            </li>
            <li>
              <strong>Programa:</strong> <code>C:\Sanatorio\app\</code>
            </li>
          </ol>
        </section>

        <section className="panel mant-panel" aria-labelledby="mant-recovery-title">
          <h2 id="mant-recovery-title">Recuperación completa</h2>
          <p className="mant-note">
            Para restaurar la clínica después de un incidente, verificá que existan la base JSON,
            las cuentas de ingreso y los secretos. El respaldo JSON <strong>no incluye</strong>{' '}
            contraseñas SMTP ni usuarios.
          </p>
          {!isTauri() ? (
            <p className="field-hint">Checklist disponible en la app de escritorio.</p>
          ) : recoveryLoading ? (
            <p className="field-hint">Verificando archivos…</p>
          ) : recoveryItems.length === 0 ? (
            <p className="field-hint">No se pudo leer el estado de recuperación.</p>
          ) : (
            <table className="mant-table mant-recovery-table">
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th>Estado</th>
                  <th>Ruta</th>
                </tr>
              </thead>
              <tbody>
                {recoveryItems.map((item) => (
                  <tr key={item.key}>
                    <td>
                      {item.label}
                      {item.optional ? ' (opcional)' : ''}
                    </td>
                    <td>
                      {item.exists
                        ? 'Presente'
                        : item.required
                          ? 'Falta'
                          : item.optional
                            ? 'No configurado'
                            : 'Ausente'}
                    </td>
                    <td>
                      <code>{item.path}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
