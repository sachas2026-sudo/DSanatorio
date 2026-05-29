import { describe, expect, it } from 'vitest'
import { formatMontoFieldInput, parseMontoInput } from './paymentInput'

describe('paymentInput', () => {
  it('parseMontoInput acepta miles con punto', () => {
    expect(parseMontoInput('1.500,50')).toBe(1500.5)
  })

  it('formatMontoFieldInput vacía montos no positivos', () => {
    expect(formatMontoFieldInput('0')).toBe('')
  })
})
