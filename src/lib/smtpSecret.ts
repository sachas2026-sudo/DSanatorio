import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AppSettings } from '../types'
import { isClientMode } from './appMode'

const SMTP_SECRET_KEY = 'sanatorio-smtp-clave-v1'

export async function loadSmtpSecret(): Promise<string> {
  if (isTauri()) {
    try {
      return await invoke<string>('load_smtp_secret')
    } catch {
      return ''
    }
  }
  return localStorage.getItem(SMTP_SECRET_KEY) ?? ''
}

export async function saveSmtpSecret(secret: string): Promise<void> {
  const trimmed = secret.trim()
  if (isTauri()) {
    // La clave SMTP es un archivo local de la PC servidor: en clientes no se guarda.
    if (await isClientMode()) return
    await invoke('save_smtp_secret', { secret: trimmed })
    return
  }
  if (trimmed) {
    localStorage.setItem(SMTP_SECRET_KEY, trimmed)
  } else {
    localStorage.removeItem(SMTP_SECRET_KEY)
  }
}

/** Clave SMTP: almacén separado; fallback legacy en settings.clave. */
export async function resolveSmtpPassword(
  settings: AppSettings,
): Promise<string> {
  const fromStore = await loadSmtpSecret()
  if (fromStore.trim()) return fromStore
  return settings.clave.trim()
}

export async function migrateSmtpSecretFromSettings(
  settings: AppSettings,
): Promise<string> {
  const legacy = settings.clave.trim()
  const stored = await loadSmtpSecret()
  if (!stored && legacy) {
    await saveSmtpSecret(legacy)
    return legacy
  }
  return stored || legacy
}
