import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { isTauri } from '@tauri-apps/api/core'
import { IconEye, IconEyeOff } from '../components/icons'
import { useAppState } from '../context/AppStateContext'
import { useConfirm } from '../context/ConfirmContext'
import {
  getEffectiveAccounts,
  getLoginUserOptions,
  hashAccountsForStorage,
  readStoredAccounts,
  saveStoredAccounts,
} from '../lib/auth'
import { loadSmtpSecret } from '../lib/smtpSecret'
import type { AppRole } from '../lib/auth'
import { isGmailAddress } from '../lib/agendaEmail'
import {
  DAILY_BACKUP_RETENTION_DAYS,
  DAILY_BACKUP_SUBDIR,
  listDailyDataBackups,
  listDataBackups,
  getBackupLocations,
  type BackupEntry,
  type BackupSlot,
  type DailyBackupEntry,
} from '../lib/appBackup'
import { getAppDataFilePath } from '../lib/appStorage'
import './pages.css'

function backupOptionLabel(entry: BackupEntry): string {
  if (!entry.exists) {
    return `Respaldo ${entry.slot} — (vacío)`
  }
  const when = entry.modifiedMs
    ? format(new Date(entry.modifiedMs), 'dd-MM-yyyy HH:mm', { locale: es })
    : 'sin fecha'
  const hint =
    entry.slot === 1
      ? ' — más reciente'
      : entry.slot === 2
        ? ' — anterior'
        : ' — más antigua'
  return `Respaldo ${entry.slot} — ${when}${hint}`
}

export function ConfiguracionPage() {
  const {
    data,
    updateSettings,
    restoreFromBackup,
    createBackupNow,
    sendDatabaseBackupByEmail,
  } = useAppState()
  const { confirm } = useConfirm()
  const [form, setForm] = useState(() => ({ ...data.settings }))
  const [saved, setSaved] = useState(false)
  const [showClave, setShowClave] = useState(false)
  const [dataFilePath, setDataFilePath] = useState<string | null>(null)
  const [backupLocations, setBackupLocations] = useState<string[]>([])
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [dailyBackups, setDailyBackups] = useState<DailyBackupEntry[]>([])
  const [restoreSlot, setRestoreSlot] = useState<'' | `${BackupSlot}`>('')
  const [restoreMsg, setRestoreMsg] = useState<{
    type: 'ok' | 'err'
    text: string
  } | null>(null)
  const [manualBackupBusy, setManualBackupBusy] = useState(false)
  const [manualBackupMsg, setManualBackupMsg] = useState<{
    type: 'ok' | 'err'
    text: string
  } | null>(null)
  const [emailBackupBusy, setEmailBackupBusy] = useState(false)
  const [emailBackupMsg, setEmailBackupMsg] = useState<{
    type: 'ok' | 'err'
    text: string
  } | null>(null)

  const [accountsDraft, setAccountsDraft] = useState(() =>
    getEffectiveAccounts().map((a) => ({ ...a, password: a.password ?? '', nextPassword: '' })),
  )
  const [showPassMap, setShowPassMap] = useState<Record<string, boolean>>({})
  const [accountsMsg, setAccountsMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  )
  const [newUser, setNewUser] = useState(() => ({
    username: '',
    password: '',
    role: 'secretaria' as AppRole,
    displayName: '',
  }))

  const refreshBackups = useCallback(async () => {
    try {
      setBackups(await listDataBackups())
    } catch {
      setBackups([])
    }
    try {
      setDailyBackups(await listDailyDataBackups())
    } catch {
      setDailyBackups([])
    }
  }, [])

  useEffect(() => {
    setForm({ ...data.settings })
  }, [data.settings])

  useEffect(() => {
    // Si se restauró una copia y cambió settings, mantenemos cuentas actuales desde storage.
    setAccountsDraft(
      getEffectiveAccounts().map((a) => ({
        ...a,
        password: a.password ?? '',
        nextPassword: '',
      })),
    )
  }, [data.settings])

  useEffect(() => {
    if (!isTauri()) return
    void getAppDataFilePath().then(setDataFilePath)
    void getBackupLocations().then(setBackupLocations)
  }, [])

  useEffect(() => {
    void refreshBackups()
  }, [refreshBackups])

  useEffect(() => {
    void loadSmtpSecret().then((clave) => {
      if (clave) setForm((f) => ({ ...f, clave }))
    })
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    updateSettings({
      email: form.email.trim(),
      emailGerente: form.emailGerente.trim(),
      telefonoGerente: form.telefonoGerente.trim(),
      clave: form.clave,
      telefono: form.telefono.trim(),
      cuit: form.cuit.trim(),
    })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  const storedAccountsHint = useMemo(() => {
    // Si no hay storage custom, estamos usando defaults hardcodeados.
    return readStoredAccounts() ? 'Cuentas personalizadas activas.' : 'Usando cuentas por defecto.'
  }, [])

  async function saveAccounts() {
    setAccountsMsg(null)
    const next = accountsDraft.map((a) => ({
      username: a.username.trim(),
      password: (a.nextPassword || a.password).trim(),
      role: a.role,
      displayName: a.displayName?.trim() || a.username.trim(),
    }))
    if (next.some((a) => !a.username || !a.password)) {
      setAccountsMsg({ type: 'err', text: 'Usuario y contraseña no pueden quedar vacíos.' })
      return
    }
    const dup = new Set<string>()
    for (const a of next) {
      const key = a.username.toLowerCase()
      if (dup.has(key)) {
        setAccountsMsg({ type: 'err', text: 'Hay usuarios repetidos.' })
        return
      }
      dup.add(key)
    }
    const ok = await confirm({
      title: 'ADMINISTRACION',
      message:
        '¿Guardar cambios de usuarios y contraseñas?\n\nA partir de ahora el ingreso usará estas credenciales.',
      confirmLabel: 'Guardar',
      cancelLabel: 'Cancelar',
    })
    if (!ok) return
    const hashed = await hashAccountsForStorage(
      next.map((a) => ({
        username: a.username,
        role: a.role,
        displayName: a.displayName,
        plainPassword: a.password,
      })),
    )
    saveStoredAccounts(hashed)
    setAccountsDraft(
      hashed.map((a) => ({ ...a, password: '', nextPassword: '' })),
    )
    setNewUser({ username: '', password: '', role: 'secretaria', displayName: '' })
    setAccountsMsg({ type: 'ok', text: 'Usuarios y contraseñas guardados.' })
  }

  function addNewUserToDraft() {
    setAccountsMsg(null)
    const username = newUser.username.trim()
    const password = newUser.password.trim()
    if (!username || !password) {
      setAccountsMsg({ type: 'err', text: 'Completá Usuario y Contraseña del nuevo usuario.' })
      return
    }
    if (accountsDraft.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
      setAccountsMsg({ type: 'err', text: 'Ese usuario ya existe.' })
      return
    }
    setAccountsDraft((list) => [
      ...list,
      {
        username,
        password,
        role: newUser.role,
        displayName: newUser.displayName.trim() || username,
        nextPassword: '',
      },
    ])
    setNewUser({ username: '', password: '', role: 'secretaria', displayName: '' })
  }

  function removeUserFromDraft(username: string) {
    setAccountsDraft((list) => list.filter((a) => a.username !== username))
  }

  async function handleSendBackupEmail() {
    const to = data.settings.emailGerente.trim()
    if (!to) {
      setEmailBackupMsg({
        type: 'err',
        text: 'Cargá el Email Gerente arriba y pulsá Guardar.',
      })
      return
    }
    const ok = await confirm({
      title: 'Enviar base por correo',
      message: `Se enviará la base de datos completa como adjunto JSON a:\n\n${to}\n\nEl archivo incluye datos personales. ¿Continuar?`,
      confirmLabel: 'Enviar',
      cancelLabel: 'Cancelar',
    })
    if (!ok) return

    setEmailBackupBusy(true)
    setEmailBackupMsg(null)
    const result = await sendDatabaseBackupByEmail({
      ...data.settings,
      email: form.email.trim(),
      emailGerente: form.emailGerente.trim(),
      clave: form.clave,
    })
    setEmailBackupBusy(false)
    if (result.ok) {
      setEmailBackupMsg({
        type: 'ok',
        text: `Copia enviada a ${to}. Revisá la bandeja de entrada (y spam).`,
      })
    } else {
      setEmailBackupMsg({
        type: 'err',
        text: result.error ?? 'No se pudo enviar el correo.',
      })
    }
  }

  async function handleManualBackup() {
    setManualBackupBusy(true)
    setManualBackupMsg(null)
    const result = await createBackupNow()
    setManualBackupBusy(false)
    if (result.ok) {
      await refreshBackups()
      setManualBackupMsg({
        type: 'ok',
        text: 'Copia de resguardo creada. Respaldo 1 es la más reciente.',
      })
    } else {
      setManualBackupMsg({
        type: 'err',
        text: result.error ?? 'No se pudo crear la copia.',
      })
    }
  }

  async function handleRestoreBackup() {
    if (restoreSlot !== '1' && restoreSlot !== '2' && restoreSlot !== '3') return
    const slot = Number(restoreSlot) as BackupSlot
    const entry = backups.find((b) => b.slot === slot)
    if (!entry?.exists) {
      setRestoreMsg({
        type: 'err',
        text: 'Ese respaldo no existe. Salí del programa al menos una vez para crear copias.',
      })
      return
    }
    const ok = await confirm({
      title: 'ADMINISTRACION',
      message: `¿Restaurar ${backupOptionLabel(entry)}?\n\nSe reemplazarán todos los datos actuales (pacientes, turnos, pagos, etc.) por los de esa copia.`,
    })
    if (!ok) return
    const result = await restoreFromBackup(slot)
    if (result.ok) {
      setRestoreMsg({
        type: 'ok',
        text: 'Respaldo restaurado. Los datos en pantalla ya son los de la copia elegida.',
      })
      setRestoreSlot('')
      void refreshBackups()
    } else {
      setRestoreMsg({
        type: 'err',
        text: result.error ?? 'No se pudo restaurar.',
      })
    }
  }

  const availableBackups = backups.filter((b) => b.exists)

  return (
    <div className="page">
      <header className="page-header">
        <h1>Configuración</h1>
      </header>

      <div className="config-top-row">
        <section className="panel panel--config">
          <h2>Datos del centro médico</h2>
          <form onSubmit={submit}>
            <div className="config-pills">
              <div className="config-pills__row">
                <div className="field field--pill">
                  <label htmlFor="cfg-email">Email</label>
                  <div className="pill-input">
                    <input
                      id="cfg-email"
                      type="email"
                      autoComplete="email"
                      placeholder="contacto@centromedico.com"
                      value={form.email}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, email: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="field field--pill field--clave">
                  <label htmlFor="cfg-clave">Clave</label>
                  <div className="pill-input pill-input--password">
                    <input
                      id="cfg-clave"
                      type={showClave ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={form.clave}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, clave: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="pill-input__toggle-clave"
                      onClick={() => setShowClave((v) => !v)}
                      aria-label={
                        showClave ? 'Ocultar clave' : 'Mostrar clave'
                      }
                      title={showClave ? 'Ocultar clave' : 'Mostrar clave'}
                    >
                      {showClave ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                  {isGmailAddress(form.email) && (
                    <p className="field-hint field-hint--clave">
                      Creala en{' '}
                      <a
                        href="https://myaccount.google.com/apppasswords"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Contraseñas de aplicaciones
                      </a>
                    </p>
                  )}
                </div>
              </div>
              <div className="config-pills__row">
                <div className="field field--pill">
                  <label htmlFor="cfg-email-gerente">Email Gerente</label>
                  <div className="pill-input">
                    <input
                      id="cfg-email-gerente"
                      type="email"
                      autoComplete="email"
                      placeholder="gerente@centromedico.com"
                      value={form.emailGerente}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, emailGerente: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="field field--pill">
                  <label htmlFor="cfg-tel-gerente">Teléfono Gerente</label>
                  <div className="pill-input">
                    <input
                      id="cfg-tel-gerente"
                      type="tel"
                      autoComplete="tel"
                      placeholder="011 5000-0000"
                      value={form.telefonoGerente}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          telefonoGerente: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="config-pills__row">
                <div className="field field--pill">
                  <label htmlFor="cfg-tel">Teléfono</label>
                  <div className="pill-input">
                    <input
                      id="cfg-tel"
                      type="tel"
                      autoComplete="tel"
                      placeholder="011 4000-0000"
                      value={form.telefono}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, telefono: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="field field--pill">
                  <label htmlFor="cfg-cuit">CUIT</label>
                  <div className="pill-input">
                    <input
                      id="cfg-cuit"
                      inputMode="numeric"
                      placeholder="30-12345678-9"
                      value={form.cuit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, cuit: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Guardar
              </button>
              {saved && (
                <span className="config-saved-msg" role="status">
                  Cambios guardados
                </span>
              )}
            </div>
          </form>
          {dataFilePath && (
            <p className="config-data-path" role="status">
              Base de datos (permanente, no se borra al actualizar el programa):{' '}
              <strong>{dataFilePath}</strong>
            </p>
          )}
        </section>

        <section className="panel panel--config panel--config-auth">
          <h2>Usuario y Contraseña</h2>
          <p className="config-auth-hint" role="status">
            {storedAccountsHint} Usuarios disponibles: <strong>{getLoginUserOptions().length}</strong>
          </p>

          <div className="config-auth-list">
            {accountsDraft.map((a) => {
              const show = showPassMap[a.username] ?? false
              const isDefaultCore = a.username === 'Admi' || a.username === 'Secretaria'
              return (
                <div key={a.username} className="config-auth-row">
                  <div className="field field--pill">
                    <label>Usuario</label>
                    <div className="pill-input">
                      <input value={a.username} readOnly />
                    </div>
                  </div>
                  <div className="field field--pill">
                    <label>Rol</label>
                    <div className="pill-select">
                      <select
                        value={a.role}
                        onChange={(e) =>
                          setAccountsDraft((list) =>
                            list.map((x) =>
                              x.username === a.username
                                ? { ...x, role: e.target.value as AppRole }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="secretaria">Secretaría</option>
                        <option value="admin">Admi</option>
                      </select>
                    </div>
                  </div>
                  <div className="field field--pill field--clave">
                    <label>Nueva contraseña</label>
                    <div className="pill-input pill-input--password">
                      <input
                        type={show ? 'text' : 'password'}
                        placeholder="(sin cambios)"
                        value={a.nextPassword}
                        onChange={(e) =>
                          setAccountsDraft((list) =>
                            list.map((x) =>
                              x.username === a.username
                                ? { ...x, nextPassword: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="pill-input__toggle-clave"
                        onClick={() =>
                          setShowPassMap((m) => ({ ...m, [a.username]: !show }))
                        }
                        aria-label={show ? 'Ocultar' : 'Mostrar'}
                        title={show ? 'Ocultar' : 'Mostrar'}
                      >
                        {show ? <IconEyeOff /> : <IconEye />}
                      </button>
                    </div>
                  </div>
                  <div className="field field--pill">
                    <label>Acción</label>
                    <div className="pill-input">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={isDefaultCore}
                        title={
                          isDefaultCore
                            ? 'No se puede eliminar Admi / Secretaria'
                            : 'Eliminar usuario'
                        }
                        onClick={() => removeUserFromDraft(a.username)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="config-auth-new">
            <h3>Nuevo usuario</h3>
            <div className="config-auth-row">
              <div className="field field--pill">
                <label htmlFor="cfg-user">Usuario</label>
                <div className="pill-input">
                  <input
                    id="cfg-user"
                    value={newUser.username}
                    onChange={(e) =>
                      setNewUser((s) => ({ ...s, username: e.target.value }))
                    }
                    placeholder="Ej: Juan"
                  />
                </div>
              </div>
              <div className="field field--pill">
                <label htmlFor="cfg-role">Rol</label>
                <div className="pill-select">
                  <select
                    id="cfg-role"
                    value={newUser.role}
                    onChange={(e) =>
                      setNewUser((s) => ({ ...s, role: e.target.value as AppRole }))
                    }
                  >
                    <option value="secretaria">Secretaría</option>
                    <option value="admin">Admi</option>
                  </select>
                </div>
              </div>
              <div className="field field--pill field--clave">
                <label htmlFor="cfg-pass">Contraseña</label>
                <div className="pill-input">
                  <input
                    id="cfg-pass"
                    type="password"
                    value={newUser.password}
                    onChange={(e) =>
                      setNewUser((s) => ({ ...s, password: e.target.value }))
                    }
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <div className="field field--pill">
                <label>&nbsp;</label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={addNewUserToDraft}
                >
                  Agregar
                </button>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => void saveAccounts()}>
              Guardar usuarios
            </button>
            {accountsMsg && (
              <span
                className={accountsMsg.type === 'ok' ? 'config-saved-msg' : 'field-hint field-hint--err'}
                role="status"
              >
                {accountsMsg.text}
              </span>
            )}
          </div>
        </section>
      </div>

      <section className="panel panel--config panel--config-backup">
        <h2>Copias de seguridad</h2>
        <p className="config-backup-lead config-backup-lead--one" role="status">
          Al salir (<strong>Salir</strong>) y cada <strong>hora</strong>{' '}
          con la app abierta se actualizan las <strong>3 últimas</strong> copias
          de respaldo en <strong>PC y Dropbox</strong> (si Dropbox está activo):
          <ul className="config-backup-paths">
            {(backupLocations.length > 0
              ? backupLocations
              : [
                  'C:\\Sanatorio\\respaldo',
                  'C:\\Users\\LAS\\Dropbox\\Sanatorio\\respaldo',
                ]
            ).map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        </p>

        <div className="config-backup-manual">
          <h3>Copia ahora</h3>
          <p>
            Guarda la base actual y actualiza las tres copias de resguardo sin
            cerrar el programa (útil antes de cambios grandes o para copiar a un
            pendrive).
          </p>
          <button
            type="button"
            className="btn btn-primary config-backup-manual__btn"
            disabled={manualBackupBusy}
            onClick={() => void handleManualBackup()}
          >
            {manualBackupBusy ? 'Guardando…' : 'Hacer copia de resguardo ahora'}
          </button>
          {manualBackupMsg && (
            <p
              className={
                manualBackupMsg.type === 'ok'
                  ? 'config-saved-msg'
                  : 'field-hint field-hint--err'
              }
              role="status"
            >
              {manualBackupMsg.text}
            </p>
          )}
        </div>

        <div className="config-backup-email">
          <h3>Copia en la nube (correo)</h3>
          <p>
            Envía la base actual como archivo JSON al <strong>Email Gerente</strong>{' '}
            usando el Gmail y la clave del formulario de arriba (contraseña de
            aplicación de 16 caracteres para @gmail.com).
          </p>
          <button
            type="button"
            className="btn btn-primary config-backup-email__btn"
            disabled={emailBackupBusy}
            onClick={() => void handleSendBackupEmail()}
          >
            {emailBackupBusy ? 'Enviando…' : 'Enviar copia de base por correo'}
          </button>
          {emailBackupMsg && (
            <p
              className={
                emailBackupMsg.type === 'ok'
                  ? 'config-saved-msg'
                  : 'field-hint field-hint--err'
              }
              role="status"
            >
              {emailBackupMsg.text}
            </p>
          )}
        </div>

        <div className="config-backup-options">
          <h3>¿Dónde se guardan las copias?</h3>
          <p>
            En <code>C:\Sanatorio\respaldo</code> en esta PC y, si Dropbox está
            instalado, también en{' '}
            <code>C:\Users\LAS\Dropbox\Sanatorio\respaldo</code>. Al abrir la app
            no se usa Dropbox (así carga más rápido); se copia al guardar
            respaldos.
          </p>
          <p className="config-backup-note">
            «Recuperar respaldo» usa la copia de la carpeta en <strong>C:</strong>.
            Los tres archivos se actualizan al salir, cada hora o con «Hacer
            copia ahora». La base en uso sigue en AppData (arriba).
          </p>
        </div>

        <div className="config-backup-daily">
          <h3>Respaldo diario</h3>
          <p>
            Una vez por día (al abrir la app o al cambiar de fecha con la app
            abierta) se guarda una copia fechada en{' '}
            <code>
              C:\Sanatorio\respaldo\{DAILY_BACKUP_SUBDIR}\
            </code>{' '}
            con nombre <code>sanatorio-datos.AAAA-MM-DD.json</code>. Se conservan
            las últimas <strong>{DAILY_BACKUP_RETENTION_DAYS}</strong> copias
            (también en Dropbox si está activo).
          </p>
          {dailyBackups.length > 0 ? (
            <ul className="config-backup-daily-list">
              {dailyBackups.slice(0, 7).map((entry) => (
                <li key={entry.date}>
                  <code>{entry.date}</code>
                  {entry.modifiedMs != null && (
                    <span className="config-backup-daily-list__when">
                      {' '}
                      —{' '}
                      {format(new Date(entry.modifiedMs), 'dd-MM-yyyy HH:mm', {
                        locale: es,
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="field-hint">
              Aún no hay copias diarias. Se crea la primera al usar la app hoy
              (desktop).
            </p>
          )}
          {dailyBackups.length > 7 && (
            <p className="field-hint">
              Mostrando las 7 más recientes de {dailyBackups.length} en total.
            </p>
          )}
        </div>

        <div className="config-backup-restore">
          <h3>Recuperar respaldo</h3>
          <div className="config-backup-restore__row">
            <div className="field field--pill config-backup-restore__field">
              <label htmlFor="cfg-restore-slot">Copia de resguardo</label>
              <select
                id="cfg-restore-slot"
                className="config-backup-select"
                value={restoreSlot}
                onChange={(e) => {
                  setRestoreSlot(e.target.value as '' | `${BackupSlot}`)
                  setRestoreMsg(null)
                }}
              >
                <option value="">— Seleccionar —</option>
                {backups.map((b) => (
                  <option
                    key={b.slot}
                    value={String(b.slot)}
                    disabled={!b.exists}
                  >
                    {backupOptionLabel(b)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-primary config-backup-restore__btn"
              disabled={restoreSlot === '' || availableBackups.length === 0}
              onClick={() => void handleRestoreBackup()}
            >
              Restaurar
            </button>
          </div>
          {availableBackups.length === 0 && (
            <p className="field-hint">
              Aún no hay respaldos. Salí del programa una vez con{' '}
              <strong>Salir</strong> para crear la primera copia.
            </p>
          )}
          {restoreMsg && (
            <p
              className={
                restoreMsg.type === 'ok'
                  ? 'config-saved-msg'
                  : 'field-hint field-hint--err'
              }
              role="status"
            >
              {restoreMsg.text}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
