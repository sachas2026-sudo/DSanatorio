/**
 * Funciones puras para el modal "Registro profesional" (Modelo A · Secciones).
 * Formateo de montos, validación y cálculos auxiliares.
 */

export interface DoctorFormValidationInput {
  apellido: string
  nombre: string
  dni: string
  especialidad: string
  telefono?: string
  email?: string
}

export interface DoctorFormValidationResult {
  isValid: boolean
  errors: {
    apellido?: boolean
    nombre?: boolean
    dni?: boolean
    especialidad?: boolean
    telefono?: boolean
    email?: boolean
    [key: string]: boolean | undefined
  }
  summaryMessage?: string
}

/**
 * Limpia y formatea un monto entero con puntos como separador de miles.
 * Ej: "100000" -> "100.000", "0" -> "0", "" -> ""
 */
export function formatThousands(value: string | number): string {
  if (value === '' || value === null || value === undefined) return ''
  const str = typeof value === 'number' ? String(Math.round(value)) : String(value)
  // Dejar sólo dígitos
  const digits = str.replace(/\D/g, '')
  if (!digits) return ''
  const num = parseInt(digits, 10)
  if (isNaN(num)) return ''
  return num.toLocaleString('es-AR')
}

/**
 * Parsea un monto formateado a número entero.
 */
export function parseThousands(value: string | number | undefined | null): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return isNaN(value) ? 0 : Math.round(value)
  const digits = String(value).replace(/\D/g, '')
  if (!digits) return 0
  const parsed = parseInt(digits, 10)
  return isNaN(parsed) ? 0 : parsed
}

/**
 * Calcula la suma de Particular + Cuidar.
 */
export function calculateTotalParticular(
  particular: string | number | undefined | null,
  cuidar: string | number | undefined | null,
): number {
  const p = parseThousands(particular)
  const c = parseThousands(cuidar)
  return p + c
}

/**
 * Formatea el total de consulta particular con prefijo "$ ".
 * Ej: "$ 100.000", o "$ 0" si no hay valores.
 */
export function formatTotalParticularDisplay(
  particular: string | number | undefined | null,
  cuidar: string | number | undefined | null,
): string {
  const total = calculateTotalParticular(particular, cuidar)
  return `$ ${total.toLocaleString('es-AR')}`
}

/**
 * Validador de formato de email básico.
 */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim()
  if (!trimmed) return true
  // RFC 5322 simplificado
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

/**
 * Apellido y Nombre son obligatorios; el email se valida sólo si está presente.
 */
export function validateDoctorForm(input: DoctorFormValidationInput): DoctorFormValidationResult {
  const errors: DoctorFormValidationResult['errors'] = {}

  if (!input.apellido || !input.apellido.trim()) {
    errors.apellido = true
  }

  if (!input.nombre || !input.nombre.trim()) {
    errors.nombre = true
  }

  const emailTrim = (input.email ?? '').trim()

  if (emailTrim && !isValidEmail(emailTrim)) {
    errors.email = true
  }

  const hasErrors = Object.values(errors).some(Boolean)

  return {
    isValid: !hasErrors,
    errors,
    summaryMessage: hasErrors ? 'Revisá los campos marcados en rojo' : undefined,
  }
}

/**
 * Obtiene las iniciales del médico para el avatar del encabezado.
 * Ej: "Ayala", "Marcela" -> "MA"
 */
export function getDoctorInitials(apellido?: string, nombre?: string): string {
  const n = (nombre ?? '').trim()
  const a = (apellido ?? '').trim()
  const firstN = n ? n[0]!.toUpperCase() : ''
  const firstA = a ? a[0]!.toUpperCase() : ''
  const res = `${firstA}${firstN}`.trim()
  return res || 'DR'
}

/**
 * Comprueba si el estado actual del formulario difiere del estado inicial.
 */
export function hasFormChanges<T extends Record<string, any>>(
  initial: T,
  current: T,
): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current)
}

