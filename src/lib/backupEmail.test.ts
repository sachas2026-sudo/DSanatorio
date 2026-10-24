import { describe, expect, it } from 'vitest'
import { buildDatabaseBackupEmailBody, utf8ToBase64 } from './backupEmail'

describe('backupEmail', () => {
  it('buildDatabaseBackupEmailBody menciona ZIP y archivos companion', () => {
    const body = buildDatabaseBackupEmailBody({
      whenLabel: '01-06-2026 12:00',
      filename: 'sanatorio-respaldo-2026-06-01-1200.zip',
    })
    expect(body).toContain('ZIP')
    expect(body).toContain('auth-accounts.json')
    expect(body).toContain('smtp-secret.txt')
  })

  it('utf8ToBase64 codifica texto', () => {
    expect(utf8ToBase64('hola')).toBe('aG9sYQ==')
  })
})
