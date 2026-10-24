import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  authenticate,
  canAccessPath,
  clearStoredSession,
  ensureAuthAccountsLoaded,
  isUsingDefaultAccounts,
  migrateAllPlainPasswordAccounts,
  revalidateStoredSession,
  storeSession,
  type AppRole,
  type AuthSession,
  type LoginAttemptResult,
} from '../lib/auth'
import { useConfirm } from './ConfirmContext'

type AuthCtx = {
  session: AuthSession | null
  authReady: boolean
  login: (username: string, password: string) => Promise<LoginAttemptResult>
  logout: () => void
  canAccessPath: (pathname: string) => boolean
}

const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { confirm } = useConfirm()
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState<AuthSession | null>(null)

  useEffect(() => {
    let cancelled = false
    void ensureAuthAccountsLoaded()
      .then(() => {
        if (cancelled) return
        // Migrar todas las cuentas con contraseñas en texto plano
        void migrateAllPlainPasswordAccounts()
        setSession(revalidateStoredSession())
        setAuthReady(true)
      })
      .catch((err) => {
        console.error('Error al preparar autenticación:', err)
        if (cancelled) return
        // Intentar migración incluso si hay error al cargar cuentas
        void migrateAllPlainPasswordAccounts()
        setSession(revalidateStoredSession())
        setAuthReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(
    async (username: string, password: string): Promise<LoginAttemptResult> => {
      await ensureAuthAccountsLoaded()
      const wasDefaults = isUsingDefaultAccounts()
      const result = await authenticate(username, password)
      if (!result.ok) return result
      storeSession(result.session)
      setSession(result.session)
      if (wasDefaults) {
        void confirm({
          title: 'Seguridad',
          message:
            'Está usando contraseñas por defecto (Admi/Admi).\n\nCámbielas en Configuración → Usuarios y contraseñas.',
          confirmLabel: 'Entendido',
          cancelLabel: 'Cerrar',
        })
      }
      return result
    },
    [confirm],
  )

  const logout = useCallback(() => {
    clearStoredSession()
    setSession(null)
  }, [])

  const canAccess = useCallback(
    (pathname: string) => {
      if (!session) return false
      return canAccessPath(session.role, pathname)
    },
    [session],
  )

  const value = useMemo(
    () => ({
      session,
      authReady,
      login,
      logout,
      canAccessPath: canAccess,
    }),
    [session, authReady, login, logout, canAccess],
  )

  if (!authReady) {
    return <div className="boot-placeholder" aria-hidden />
  }

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}

export function useAuthSession() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthSession debe usarse dentro de AuthProvider')
  }
  return ctx
}

export function useAuth() {
  const { session, ...rest } = useAuthSession()
  if (!session) {
    throw new Error('useAuth requiere sesión iniciada')
  }
  return { session, role: session.role as AppRole, ...rest }
}
