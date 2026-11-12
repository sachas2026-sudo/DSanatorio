import type { Doctor } from '../types'

export function normalizeOsName(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

export function isParticularCobertura(cobertura: string): boolean {
  return normalizeOsName(cobertura) === 'particular'
}

export function doctorAttendsCoverage(doctor: Doctor, cobertura: string): boolean {
  if (isParticularCobertura(cobertura)) return true
  const normCob = normalizeOsName(cobertura)
  if (!normCob) return false

  if (doctor.obraSocial && normalizeOsName(doctor.obraSocial) === normCob) {
    return true
  }

  if (Array.isArray(doctor.obrasSociales)) {
    return doctor.obrasSociales.some(
      (os) => normalizeOsName(typeof os === 'string' ? os : os.nombre) === normCob,
    )
  }

  return false
}

export type MontoSugeridoResult = {
  monto: number
  origen: 'ok' | 'sin-monto'
}

function normalizeCoverageKey(value: string): string {
  return value.trim().toLocaleUpperCase('es')
}

export function calcularMontoSugerido(
  doctor: Doctor | null | undefined,
  cobertura: string,
): MontoSugeridoResult {
  if (!doctor) return { monto: 0, origen: 'sin-monto' }

  if (isParticularCobertura(cobertura)) {
    const monto = Math.round(Number(doctor.particular || 0))
    return monto > 0 ? { monto, origen: 'ok' } : { monto: 0, origen: 'sin-monto' }
  }

  const coberturaKey = normalizeCoverageKey(cobertura)
  const obraSocial = doctor.obrasSociales?.find(
    (item) => normalizeCoverageKey(item.nombre) === coberturaKey,
  )
  const monto = Math.round(Number(obraSocial?.monto || 0))
  return monto > 0 ? { monto, origen: 'ok' } : { monto: 0, origen: 'sin-monto' }
}
