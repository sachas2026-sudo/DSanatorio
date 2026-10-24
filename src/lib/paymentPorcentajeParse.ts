import { parsePorcentajeStored } from './porcentajeInput'

export function parsePorcentajeAplicado(raw: unknown): number | undefined {
  return parsePorcentajeStored(raw)
}
