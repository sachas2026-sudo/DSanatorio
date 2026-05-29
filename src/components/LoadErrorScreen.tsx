import { useEffect, useState } from 'react'
import {
  BACKUP_SLOTS,
  listDataBackups,
  type BackupEntry,
  type BackupSlot,
} from '../lib/appBackup'
import './load-error.css'

type Props = {
  message: string
  onRestore: (slot: BackupSlot) => void | Promise<void>
  onStartEmpty: () => void | Promise<void>
}

export function LoadErrorScreen({
  message,
  onRestore,
  onStartEmpty,
}: Props) {
  const [backups, setBackups] = useState<BackupEntry[]>([])

  useEffect(() => {
    void listDataBackups().then(setBackups)
  }, [])

  return (
    <div className="load-error" role="alert">
      <div className="load-error__card">
        <h1 className="load-error__title">No se pudo cargar la base de datos</h1>
        <p className="load-error__message">{message}</p>
        <p className="load-error__hint">
          Podés restaurar una copia de resguardo (creada al salir del programa) o
          iniciar con una base vacía. No se cargarán datos de demostración sin tu
          confirmación.
        </p>
        <div className="load-error__actions">
          {BACKUP_SLOTS.map((slot) => {
            const entry = backups.find((b) => b.slot === slot)
            return (
              <button
                key={slot}
                type="button"
                className="btn btn-primary"
                disabled={!entry?.exists}
                onClick={() => void onRestore(slot)}
              >
                Restaurar respaldo {slot}
                {!entry?.exists && ' (no disponible)'}
              </button>
            )
          })}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onStartEmpty()}
          >
            Iniciar con base vacía
          </button>
        </div>
      </div>
    </div>
  )
}
