import type { AppRole } from './auth'

/**
 * Permisos nombrados de la aplicación.
 *
 * Se asignan por rol en un solo lugar para que una pantalla no tenga que
 * preguntar "¿sos secretaria?" sino "¿podés cobrar cuotas de afiliados?".
 * En el futuro se puede agregar una lista de permisos por usuario sin cambiar
 * las pantallas que ya usan `hasPermission`.
 */
export const PERMISSIONS = {
  PAGOS_AFILIADOS: 'pagos_afiliados',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  admin: [PERMISSIONS.PAGOS_AFILIADOS],
  secretaria: [PERMISSIONS.PAGOS_AFILIADOS],
  // Afiliados no ve la deuda de otros contratantes.
  afiliado: [],
}

export function permissionsForRole(role: AppRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

export function hasPermission(role: AppRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission)
}
