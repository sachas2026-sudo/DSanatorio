import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  historicoArchiveFilename,
  type HistoricoArchivePayload,
} from './archiveHistorico'
import { isClientMode } from './appMode'

export type HistoricoArchiveEntry = {
  filename: string
  path: string
  cutoffDate?: string
  archivedAt?: string
  sizeBytes?: number
  modifiedMs?: number
}

export async function saveHistoricoArchive(
  payload: HistoricoArchivePayload,
): Promise<string> {
  const filename = historicoArchiveFilename(payload.cutoffDate)
  const json = JSON.stringify(payload)
  // El histórico vive en el disco de la PC servidor: desde un cliente no se escribe.
  if (await isClientMode()) return filename
  if (!isTauri()) {
    localStorage.setItem(`sanatorio-historico-${payload.cutoffDate}`, json)
    return filename
  }
  return await invoke<string>('save_historico_archive', { filename, json })
}

export async function readHistoricoArchive(
  cutoffDate: string,
): Promise<HistoricoArchivePayload | null> {
  const filename = historicoArchiveFilename(cutoffDate)
  if (await isClientMode()) return null
  if (!isTauri()) {
    const raw = localStorage.getItem(`sanatorio-historico-${cutoffDate}`)
    if (!raw) return null
    return JSON.parse(raw) as HistoricoArchivePayload
  }
  try {
    const raw = await invoke<string>('read_historico_archive', { filename })
    return JSON.parse(raw) as HistoricoArchivePayload
  } catch {
    return null
  }
}

export async function listHistoricoArchives(): Promise<HistoricoArchiveEntry[]> {
  if (await isClientMode()) return []
  if (!isTauri()) {
    const out: HistoricoArchiveEntry[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('sanatorio-historico-')) continue
      const raw = localStorage.getItem(key)
      out.push({
        filename: key,
        path: key,
        cutoffDate: key.replace('sanatorio-historico-', ''),
        sizeBytes: raw ? new Blob([raw]).size : undefined,
      })
    }
    return out.sort((a, b) => (a.cutoffDate ?? '').localeCompare(b.cutoffDate ?? ''))
  }
  return await invoke<HistoricoArchiveEntry[]>('list_historico_archives')
}
