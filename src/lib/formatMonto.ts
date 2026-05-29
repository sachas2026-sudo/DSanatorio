export function formatMonto(n: number): string {
  const abs = Math.abs(n)
  const core = abs.toLocaleString('es-AR', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })
  const sign = n < 0 ? '- ' : ''
  return `${sign}$ ${core}`
}
