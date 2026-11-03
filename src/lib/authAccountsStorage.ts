import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AuthAccount } from './auth'
import { isClientMode } from './appMode'
import { clientApi, ensureApiOk } from './clientApi'

const ACCOUNTS_STORAGE_KEY = 'sanatorio-auth-accounts-v1'

export function readLegacyAccountsFromLocalStorage(): AuthAccount[] | null {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed as AuthAccount[]
  } catch {
    return null
  }
}

export function clearLegacyAccountsLocalStorage(): void {
  localStorage.removeItem(ACCOUNTS_STORAGE_KEY)
}

export async function loadAuthAccountsRaw(): Promise<string> {
  if (isTauri()) {
    // En modo cliente las cuentas viven en el servidor de la PC1.
    if (await isClientMode()) {
      try {
        const reply = await clientApi<unknown>('GET', '/api/auth-accounts')
        ensureApiOk(reply)
        if (reply.body == null) return ''
        return JSON.stringify(reply.body)
      } catch {
        return ''
      }
    }
    try {
      return await invoke<string>('load_auth_accounts')
    } catch {
      return ''
    }
  }
  return localStorage.getItem(ACCOUNTS_STORAGE_KEY) ?? ''
}

export async function saveAuthAccountsRaw(json: string): Promise<void> {
  if (isTauri()) {
    // En modo cliente las cuentas se guardan en el servidor de la PC1.
    if (await isClientMode()) {
      const payload = json.trim() ? JSON.parse(json) : []
      const reply = await clientApi('POST', '/api/auth-accounts', payload)
      ensureApiOk(reply)
      return
    }
    await invoke('save_auth_accounts', { json })
    return
  }
  if (json.trim()) {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, json)
  } else {
    localStorage.removeItem(ACCOUNTS_STORAGE_KEY)
  }
}
