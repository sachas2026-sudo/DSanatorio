import { hashPassword, verifyPassword } from './passwordHash'

export type AppRole = 'admin' | 'secretaria'

export type AuthSession = {
  username: string
  role: AppRole
  displayName: string
}

const SESSION_KEY = 'sanatorio-auth-session'

export type AuthAccount = {
  username: string
  role: AppRole
  displayName: string
  /** Legacy: texto plano (se migra al iniciar sesión). */
  password?: string
  passwordHash?: string
  passwordSalt?: string
}

const ACCOUNTS_STORAGE_KEY = 'sanatorio-auth-accounts-v1'

const DEFAULT_ACCOUNTS: AuthAccount[] = [
  {
    username: 'Admi',
    password: 'Admi',
    role: 'admin',
    displayName: 'Administración',
  },
  {
    username: 'Secretaria',
    password: '123',
    role: 'secretaria',
    displayName: 'Secretaría',
  },
]

/** Rutas solo para administración. */
const ADMIN_ONLY_PATHS = new Set(['/configuracion'])

export function canUsePagosPeriodFilters(role: AppRole): boolean {
  return role === 'admin'
}

function normalizeLogin(value: string): string {
  return value.trim()
}

function parseStoredAccountRow(row: unknown): AuthAccount | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const username = typeof r.username === 'string' ? r.username.trim() : ''
  const role = r.role === 'admin' || r.role === 'secretaria' ? r.role : null
  const displayName =
    typeof r.displayName === 'string' ? r.displayName.trim() : ''
  const password = typeof r.password === 'string' ? r.password : undefined
  const passwordHash =
    typeof r.passwordHash === 'string' ? r.passwordHash : undefined
  const passwordSalt =
    typeof r.passwordSalt === 'string' ? r.passwordSalt : undefined
  if (!username || !role) return null
  if (!password && !(passwordHash && passwordSalt)) return null
  return {
    username,
    role,
    displayName: displayName || username,
    password,
    passwordHash,
    passwordSalt,
  }
}

export function readStoredAccounts(): AuthAccount[] | null {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const out: AuthAccount[] = []
    for (const row of parsed) {
      const account = parseStoredAccountRow(row)
      if (!account) return null
      out.push(account)
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

export function saveStoredAccounts(accounts: AuthAccount[]): void {
  const sanitized = accounts.map(({ password: _p, ...rest }) => rest)
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(sanitized))
}

export function isUsingDefaultAccounts(): boolean {
  return readStoredAccounts() === null
}

export function getEffectiveAccounts(): AuthAccount[] {
  return readStoredAccounts() ?? DEFAULT_ACCOUNTS
}

/** Usuario sugerido al abrir la pantalla de ingreso. */
export function getDefaultLoginUsername(): string {
  return getEffectiveAccounts().some((a) => a.username === 'Secretaria')
    ? 'Secretaria'
    : getEffectiveAccounts()[0]?.username ?? 'Admi'
}

/** Opciones del desplegable de ingreso (orden de visualización). */
export function getLoginUserOptions(): string[] {
  const accounts = getEffectiveAccounts()
  const sorted = [...accounts].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'secretaria' ? -1 : 1
    return a.username.localeCompare(b.username, 'es', { sensitivity: 'base' })
  })
  return sorted.map((a) => a.username)
}

async function verifyAccountPassword(
  account: AuthAccount,
  password: string,
): Promise<boolean> {
  if (account.passwordHash && account.passwordSalt) {
    return verifyPassword(password, account.passwordHash, account.passwordSalt)
  }
  if (account.password) {
    return account.password === password
  }
  return false
}

async function hashAccountPassword(
  account: AuthAccount,
  plainPassword: string,
): Promise<AuthAccount> {
  const { hash, salt } = await hashPassword(plainPassword)
  return {
    username: account.username,
    role: account.role,
    displayName: account.displayName,
    passwordHash: hash,
    passwordSalt: salt,
  }
}

/** Hashea contraseñas para guardar desde Configuración. */
export async function hashAccountsForStorage(
  accounts: Array<
    AuthAccount & { plainPassword: string }
  >,
): Promise<AuthAccount[]> {
  const out: AuthAccount[] = []
  for (const a of accounts) {
    out.push(await hashAccountPassword(a, a.plainPassword))
  }
  return out
}

async function migrateAccountsToHashed(
  accounts: AuthAccount[],
  verifiedUsername: string,
  plainPassword: string,
): Promise<void> {
  const migrated: AuthAccount[] = []
  for (const a of accounts) {
    if (a.username === verifiedUsername && a.password) {
      migrated.push(await hashAccountPassword(a, plainPassword))
    } else if (a.password && !a.passwordHash) {
      migrated.push(await hashAccountPassword(a, a.password))
    } else {
      migrated.push(a)
    }
  }
  saveStoredAccounts(migrated)
}

export async function authenticate(
  username: string,
  password: string,
): Promise<AuthSession | null> {
  const u = normalizeLogin(username)
  const p = normalizeLogin(password)
  const accounts = getEffectiveAccounts()
  const account = accounts.find(
    (a) =>
      a.username.localeCompare(u, 'es', { sensitivity: 'accent' }) === 0,
  )
  if (!account) return null

  const ok = await verifyAccountPassword(account, p)
  if (!ok) return null

  const needsMigration =
    account.password != null ||
    accounts.some((a) => a.password && !a.passwordHash) ||
    isUsingDefaultAccounts()

  if (needsMigration) {
    await migrateAccountsToHashed(accounts, account.username, p)
  }

  return {
    username: account.username,
    role: account.role,
    displayName: account.displayName,
  }
}

export function canAccessPath(role: AppRole, pathname: string): boolean {
  const path = pathname.split('?')[0]?.replace(/\/$/, '') || '/'
  if (!ADMIN_ONLY_PATHS.has(path)) return true
  return role === 'admin'
}

export function readStoredSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthSession
    if (parsed.role !== 'admin' && parsed.role !== 'secretaria') return null
    if (typeof parsed.username !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function storeSession(session: AuthSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearStoredSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}
