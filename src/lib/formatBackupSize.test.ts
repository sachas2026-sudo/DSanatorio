import { describe, expect, it } from 'vitest'
import { formatBackupSize } from './formatBackupSize'

describe('formatBackupSize', () => {
  it('formatea bytes, KB y MB', () => {
    expect(formatBackupSize(undefined)).toBe('—')
    expect(formatBackupSize(512)).toBe('512 B')
    expect(formatBackupSize(2048)).toBe('2.0 KB')
    expect(formatBackupSize(2 * 1024 * 1024)).toBe('2.00 MB')
  })
})
