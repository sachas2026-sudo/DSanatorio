import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AuthAccount } from './auth'

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
    await invoke('save_auth_accounts', { json })
    return
  }
  if (json.trim()) {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, json)
  } else {
    localStorage.removeItem(ACCOUNTS_STORAGE_KEY)
  }
}
