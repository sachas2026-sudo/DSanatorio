import { describe, expect, it } from 'vitest'
import { formatPanelSyncStatusLabel } from './panelSyncStatus'

describe('formatPanelSyncStatusLabel', () => {
  it('describe error con mensaje', () => {
    expect(
      formatPanelSyncStatusLabel('error', 'Sin conexión', null),
    ).toBe('Sin conexión')
  })

  it('describe sincronizando', () => {
    expect(formatPanelSyncStatusLabel('syncing', null, null)).toBe(
      'Sincronizando panel…',
    )
  })

  it('incluye hora en ok', () => {
    const label = formatPanelSyncStatusLabel('ok', null, Date.UTC(2026, 5, 2, 14, 30))
    expect(label).toMatch(/Panel sincronizado/)
  })
})
