const MAX_PORCENTAJE = 999

export function roundPorcentaje(n: number): number {
  return Math.round(n * 100) / 100
}

export function parsePorcentajeStored(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : NaN
  if (!Number.isFinite(n)) return undefined
  const rounded = roundPorcentaje(n)
  if (rounded < 0 || rounded > MAX_PORCENTAJE) return undefined
  return rounded
}

/** Muestra en formulario / listado (ej. 10,28). */
export function formatPorcentajeInput(n?: number): string {
  if (n == null || !Number.isFinite(n)) return ''
  const rounded = roundPorcentaje(Math.min(MAX_PORCENTAJE, Math.max(0, n)))
  const [entero, dec = ''] = rounded.toFixed(2).split('.')
  if (dec === '00') return entero
  if (dec.endsWith('0')) return `${entero},${dec.slice(0, -1)}`
  return `${entero},${dec}`
}

export function parsePorcentajeInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return parsePorcentajeStored(trimmed.replace(',', '.'))
}

/** Filtra lo que se puede tipear en el campo Porcentaje. */
export function sanitizePorcentajeInput(value: string): string {
  let out = ''
  let sepUsed = false
  for (const ch of value) {
    if (ch >= '0' && ch <= '9') {
      out += ch
    } else if ((ch === ',' || ch === '.') && !sepUsed) {
      out += ','
      sepUsed = true
    }
  }
  const comma = out.indexOf(',')
  if (comma === -1) return out.slice(0, 3)
  const entero = out.slice(0, comma).slice(0, 3)
  const dec = out.slice(comma + 1).slice(0, 2)
  return `${entero},${dec}`
}

export function formatPorcentajeLabel(n?: number): string {
  const f = formatPorcentajeInput(n)
  return f || '0'
}
