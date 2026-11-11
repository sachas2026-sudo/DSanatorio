import type { Doctor, ObraSocialCatalog } from '../types'
import { formatPesosAr, parsePesosAr } from './obrasSocialesCatalog'

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

  // Revisar obraSocial única legacy
  if (doctor.obraSocial && normalizeOsName(doctor.obraSocial) === normCob) {
    return true
  }

  // Revisar array obrasSociales del médico
  if (Array.isArray(doctor.obrasSociales)) {
    return doctor.obrasSociales.some(
      (os) => normalizeOsName(typeof os === 'string' ? os : os.nombre) === normCob,
    )
  }

  return false
}

export type MontoAvisoType =
  | 'automatic-plus'
  | 'warning-not-attended'
  | 'info-manual'
  | 'automatic-particular'

export interface MontoSugeridoResult {
  montoCalculado: number | null
  montoCalculadoFormateado: string
  avisoTexto: string
  avisoTipo: MontoAvisoType
  sugeridoParaBoton: number | null
  mostrarBotonUsarSugerido: boolean
}

export interface CalcularMontoSugeridoParams {
  doctor: Doctor | null | undefined
  cobertura: string
  obrasSocialesCatalog: ObraSocialCatalog[]
  montoActualInput?: string | number | null
  usuarioEditoManualmente?: boolean
}

/**
 * Calcula el monto sugerido/automático del turno según 5 reglas en orden estricto:
 * 1. Si el médico atiende la obra social y tiene Plus > 0: valor automático del Plus.
 * 2. Si el médico no atiende esa obra social: monto vacío y aviso ámbar de advertencia.
 * 3. Si la obra social no tiene Plus cargado (0 o vacío): monto vacío y aviso gris para cargar a mano.
 * 4. Si la cobertura es Particular: usa el valor Particular de la ficha del médico.
 * 5. Si el usuario escribe otro monto: se respeta y se ofrece "Sugerido: $ X" con botón "Usar sugerido".
 */
export function calcularMontoSugerido({
  doctor,
  cobertura,
  obrasSocialesCatalog,
  montoActualInput,
  usuarioEditoManualmente = false,
}: CalcularMontoSugeridoParams): MontoSugeridoResult {
  const normCob = normalizeOsName(cobertura)

  // Nombre representativo del médico
  const medicoNombre = doctor
    ? `${doctor.apellido ? doctor.apellido + ', ' : ''}${doctor.nombre || ''}`.trim() || 'el médico'
    : 'el médico'

  let montoBase: number | null = null
  let avisoTexto = ''
  let avisoTipo: MontoAvisoType = 'info-manual'

  if (!doctor || !normCob) {
    return {
      montoCalculado: null,
      montoCalculadoFormateado: '',
      avisoTexto: '',
      avisoTipo: 'info-manual',
      sugeridoParaBoton: null,
      mostrarBotonUsarSugerido: false,
    }
  }

  // REGLA 4: Cobertura Particular
  if (isParticularCobertura(normCob)) {
    const partValor = Math.round(Number(doctor.particular || 0))
    if (partValor > 0) {
      montoBase = partValor
      avisoTexto = `Valor automático · Particular de ${medicoNombre}.`
      avisoTipo = 'automatic-particular'
    } else {
      montoBase = null
      avisoTexto = `${medicoNombre} no tiene valor Particular cargado. Cargá el monto a mano.`
      avisoTipo = 'info-manual'
    }
  } else {
    // REGLA 2: Si el médico no atiende esa obra social
    const atiende = doctorAttendsCoverage(doctor, normCob)
    if (!atiende) {
      montoBase = null
      avisoTexto = `${medicoNombre} no atiende ${cobertura}. Elegí otra cobertura.`
      avisoTipo = 'warning-not-attended'
    } else {
      // Buscar la obra social en el catálogo
      const osItem = obrasSocialesCatalog.find(
        (o) => normalizeOsName(o.nombre) === normCob,
      )
      const plusValor = Math.round(Number(osItem?.plus || 0))

      // REGLA 1: Si atiende y tiene Plus cargado
      if (plusValor > 0) {
        montoBase = plusValor
        avisoTexto = `Valor automático · Plus de ${osItem?.nombre || cobertura} (Obras sociales).`
        avisoTipo = 'automatic-plus'
      } else {
        // REGLA 3: Si la obra social no tiene Plus cargado (vacío o 0)
        montoBase = null
        avisoTexto = 'Esta obra social no tiene Plus cargado. Cargá el monto a mano.'
        avisoTipo = 'info-manual'
      }
    }
  }

  // REGLA 5: Evaluación de valor manual del usuario vs sugerido
  let sugeridoParaBoton: number | null = null
  let mostrarBotonUsarSugerido = false

  if (usuarioEditoManualmente && montoActualInput !== undefined && montoActualInput !== null) {
    const parsedActual =
      typeof montoActualInput === 'number'
        ? Math.round(montoActualInput)
        : parsePesosAr(String(montoActualInput))

    if (montoBase !== null && parsedActual !== montoBase) {
      sugeridoParaBoton = montoBase
      mostrarBotonUsarSugerido = true
    }
  }

  return {
    montoCalculado: montoBase,
    montoCalculadoFormateado: montoBase !== null ? formatPesosAr(montoBase) : '',
    avisoTexto,
    avisoTipo,
    sugeridoParaBoton,
    mostrarBotonUsarSugerido,
  }
}

