/**
 * Utilidades para formateo y parsing de campos de dinero en pesos (ARS).
 * Formato es-AR con punto de miles y prefijo "$".
 * Solo dígitos enteros, sin decimales ni negativos.
 */

export const MONTO_MAXIMO_MEDICO = 100_000_000

/**
 * Parsea un string (ej. "$ 10.000", "$25.000", "10000") a un número entero no negativo.
 * Retorna 0 si no hay dígitos válidos o si es negativo. Aplica tope máximo.
 */
export function parseMoneyInput(str: string | number | null | undefined, max = MONTO_MAXIMO_MEDICO): number {
  if (str === null || str === undefined) return 0
  if (typeof str === 'number') {
    if (isNaN(str) || str <= 0) return 0
    return Math.min(Math.round(str), max)
  }
  const digits = str.replace(/\D/g, '')
  if (!digits) return 0
  const parsed = parseInt(digits, 10)
  if (isNaN(parsed) || parsed <= 0) return 0
  return Math.min(parsed, max)
}

/**
 * Convierte un entero a representación visual con prefijo "$" y separador de miles.
 * Ej: 10000 -> "$ 10.000"
 * Ej: 0 -> "$ 0"
 */
export function formatMoneyDisplay(value: number | string | null | undefined): string {
  const num = parseMoneyInput(value)
  return `$ ${num.toLocaleString('es-AR')}`
}

/**
 * Sanitiza y formatea el valor mientras el usuario tipea en un input:
 * Si el input queda completamente en blanco, devuelve "" para permitir borrar.
 * Si tiene dígitos, devuelve el formato "$ X.XXX".
 */
export function sanitizeMoneyTyping(input: string, max = MONTO_MAXIMO_MEDICO): string {
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''
  const num = Math.min(parseInt(digits, 10), max)
  return `$ ${num.toLocaleString('es-AR')}`
}

