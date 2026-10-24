import { describe, expect, it } from 'vitest'
import { validateBackupRaw } from './restoreBackup'

const minimalJson = JSON.stringify({
  patients: [{ id: 'p1', nombre: 'Ana', apellido: 'López' }],
  doctors: [{ id: 'd1', nombre: 'Dr', apellido: 'House' }],
})

describe('validateBackupRaw', () => {
  it('acepta respaldo válido', () => {
    const { data, integrityAlert } = validateBackupRaw(minimalJson)
    expect(data.patients).toHaveLength(1)
    expect(integrityAlert).toBeNull()
  })

  it('rechaza JSON inválido', () => {
    expect(() => validateBackupRaw('{ no')).toThrow('JSON válido')
  })

  it('rechaza respaldo con formato no reconocido', () => {
    expect(() => validateBackupRaw('[]')).toThrow('Respaldo inválido')
  })
})
