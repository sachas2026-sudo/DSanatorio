import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { computePagosMesConDescuentos } from './panelCobranzasMes'
import type { AppData } from '../types'

export const PANEL_COBRANZAS_TEMP_STORAGE_KEY = 'panel-cobranzas-mes-temp-v1'

/** Valor neto del mes (PDF) persistido en temporal antes de publicar al panel web. */
export type PanelCobranzasTemporal = {
  mesLabel: string
  total: number
  cantidad: number
  totalFacturado: number
  computedAt: string
}

export function buildPanelCobranzasTemporal(
  data: AppData,
  refDate: Date = new Date(),
): PanelCobranzasTemporal {
  const cob = computePagosMesConDescuentos(data, refDate)
  return {
    mesLabel: format(refDate, 'MMMM yyyy', { locale: es }),
    total: cob.total,
    cantidad: cob.cantidad,
    totalFacturado: cob.totalFacturado,
    computedAt: refDate.toISOString(),
  }
}

export function parsePanelCobranzasTemporal(raw: unknown): PanelCobranzasTemporal | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (typeof v.mesLabel !== 'string') return null
  if (typeof v.total !== 'number' || !Number.isFinite(v.total)) return null
  if (typeof v.cantidad !== 'number' || !Number.isFinite(v.cantidad)) return null
  if (typeof v.computedAt !== 'string') return null
  const totalFacturado =
    typeof v.totalFacturado === 'number' && Number.isFinite(v.totalFacturado)
      ? v.totalFacturado
      : 0
  return {
    mesLabel: v.mesLabel,
    total: v.total,
    cantidad: v.cantidad,
    totalFacturado,
    computedAt: v.computedAt,
  }
}

/** Calcula, guarda en temporal (disco en Tauri) y devuelve el payload. */
export async function refreshPanelCobranzasTemporal(
  data: AppData,
  refDate: Date = new Date(),
): Promise<PanelCobranzasTemporal> {
  const temporal = buildPanelCobranzasTemporal(data, refDate)
  const json = JSON.stringify(temporal)

  if (isTauri()) {
    await invoke('write_panel_cobranzas_temporal', { json })
  } else {
    localStorage.setItem(PANEL_COBRANZAS_TEMP_STORAGE_KEY, json)
  }

  return temporal
}

export async function readPanelCobranzasTemporal(): Promise<PanelCobranzasTemporal | null> {
  try {
    if (isTauri()) {
      const raw = await invoke<string>('read_panel_cobranzas_temporal')
      if (!raw.trim()) return null
      return parsePanelCobranzasTemporal(JSON.parse(raw))
    }
    const raw = localStorage.getItem(PANEL_COBRANZAS_TEMP_STORAGE_KEY)
    if (!raw) return null
    return parsePanelCobranzasTemporal(JSON.parse(raw))
  } catch {
    return null
  }
}

export function panelPagosMesFromTemporal(
  temporal: PanelCobranzasTemporal,
): {
  mesLabel: string
  total: number
  totalFacturado: number
  cantidad: number
} {
  return {
    mesLabel: temporal.mesLabel,
    total: temporal.total,
    totalFacturado: temporal.totalFacturado,
    cantidad: temporal.cantidad,
  }
}
